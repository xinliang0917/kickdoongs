import json
import math
import os

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FACE_SRC = os.path.join(ROOT, "source", "face_sheet.png")
BODY_SRC = os.path.join(ROOT, "source", "body_sheet.png")
OUT = os.path.join(ROOT, "assets", "pet")
PREVIEW = os.path.join(ROOT, "scripts", "preview")
ICON = os.path.join(ROOT, "assets", "icon.png")

NAMES = [
    "idle", "sleepy", "happy", "hot",
    "giggle", "snack", "bored", "confused",
    "love", "shy", "wave", "goodnight",
    "angry", "back", "surprised", "cuddle", "skate",
]

EYE_LINE = (24, 24, 24, 255)
HEART_FILL = (176, 57, 84, 255)
PUPIL_FILL = (92, 48, 35, 255)
FACE_GREEN = (111, 220, 140, 255)


def load_rgb(path):
    return np.array(Image.open(path).convert("RGB"))[:, :, ::-1].copy()


def trim(rgba, pad=4):
    alpha = rgba[:, :, 3]
    ys, xs = np.where(alpha > 12)
    if not len(xs):
        return rgba
    h, w = alpha.shape
    x0 = max(0, xs.min() - pad)
    y0 = max(0, ys.min() - pad)
    x1 = min(w, xs.max() + pad + 1)
    y1 = min(h, ys.max() + pad + 1)
    return rgba[y0:y1, x0:x1]


def remove_white(rgb, threshold=235):
    white = (
        (rgb[:, :, 0] > threshold)
        & (rgb[:, :, 1] > threshold)
        & (rgb[:, :, 2] > threshold)
    )
    labels, _ = ndimage.label(white)
    border = set(labels[0].tolist()) | set(labels[-1].tolist())
    border |= set(labels[:, 0].tolist()) | set(labels[:, -1].tolist())
    border.discard(0)
    bg = np.isin(labels, list(border))
    fg_mask = ndimage.binary_erosion(~bg, iterations=1)
    alpha = ndimage.gaussian_filter(fg_mask.astype(np.float32), 0.6)

    edge = (~bg) & (alpha < 0.995) & (alpha > 0.02)
    safe = np.maximum(alpha[..., None], 0.05)
    fg = (rgb.astype(np.float32) - (1 - alpha[..., None]) * 255.0) / safe
    out = np.where(edge[..., None], np.clip(fg, 0, 255), rgb.astype(np.float32))
    return np.dstack([out, alpha * 255]).astype(np.uint8)


def extract_bodies():
    im = load_rgb(BODY_SRC)
    h, w = im.shape[:2]
    split = int(w / 2)
    front = trim(remove_white(im[:, :split]))
    dark = trim(remove_white(im[:, split:]))

    def bgra_to_rgba(a):
        out = a.copy()
        out[:, :, :3] = a[:, :, :3][:, :, ::-1]
        return out

    return bgra_to_rgba(front), bgra_to_rgba(dark)


def grab_cut_cutout(crop, rect_local, cleanups=()):
    h, w = crop.shape[:2]
    mask = np.zeros((h, w), np.uint8)
    rect = (
        max(2, rect_local[0]),
        max(2, rect_local[1]),
        min(w - 3, rect_local[2]),
        min(h - 3, rect_local[3]),
    )
    bgd = np.zeros((1, 65), np.float64)
    fgd = np.zeros((1, 65), np.float64)
    cv2.grabCut(crop, mask, rect, bgd, fgd, 8, cv2.GC_INIT_WITH_RECT)
    fg = np.isin(mask, (cv2.GC_FGD, cv2.GC_PR_FGD)).astype(np.uint8)

    labels, count = ndimage.label(fg)
    if count:
        sizes = ndimage.sum(fg, labels, range(1, count + 1))
        fg = (labels == np.argmax(sizes) + 1).astype(np.uint8)

    rgb = crop[:, :, ::-1].astype(int)
    r, g, b = rgb[:, :, 0], rgb[:, :, 1], rgb[:, :, 2]
    for name in cleanups:
        if name == "blue":
            blue = (b > g + 25) & (b > r + 15) & (b > 140)
            fg[blue] = 0
        elif name == "smudge":
            brown = (r > 40) & (r > g + 15) & (g > b + 5) & (r < 150)
            rows = np.arange(h)[:, None]
            fg[brown & (rows > 400)] = 0
        elif name == "shadow":
            value = rgb.max(axis=2)
            sat = rgb.max(axis=2) - rgb.min(axis=2)
            shadow = (value > 35) & (value < 120) & (sat > 25) & (g >= r) & (g > b)
            sl, sn = ndimage.label(shadow & (fg > 0))
            if sn:
                sizes = ndimage.sum(shadow & (fg > 0), sl, range(1, sn + 1))
                light = (g > 150) & (r > 90)
                for i, size in enumerate(sizes, start=1):
                    if size <= 600:
                        continue
                    comp = sl == i
                    overlap = (comp & light).sum()
                    if overlap < size * 0.15:
                        fg[ndimage.binary_dilation(comp, iterations=1)] = 0

    fg = ndimage.binary_fill_holes(fg).astype(np.uint8)
    fg = ndimage.binary_erosion(fg, iterations=1).astype(np.uint8)
    alpha = ndimage.gaussian_filter(fg.astype(np.float32), 0.8)

    rgb = crop[:, :, ::-1].astype(np.float32)
    border = np.concatenate(
        [rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1]],
        axis=0,
    )
    bg_color = np.median(border, axis=0)
    edge = (alpha > 0.03) & (alpha < 0.995)
    safe = np.maximum(alpha[..., None], 0.06)
    fg_color = (rgb - (1 - alpha[..., None]) * bg_color) / safe
    out_rgb = np.where(edge[..., None], np.clip(fg_color, 0, 255), rgb)
    rgba = np.dstack([out_rgb, (alpha * 255).clip(0, 255)]).astype(np.uint8)
    return trim(rgba, pad=10)


def add_outer_outline(rgba, width=4):
    alpha = rgba[:, :, 3]
    mask = alpha > 20
    mask = ndimage.binary_dilation(mask, iterations=1)
    inner = ndimage.binary_erosion(mask, iterations=width)
    band = mask & ~inner

    out = rgba.copy()
    out[band] = [20, 20, 20, 255]
    out[inner] = rgba[inner]
    out[~mask] = [0, 0, 0, 0]

    soft = ndimage.gaussian_filter(out[:, :, 3].astype(np.float32) / 255.0, 0.5)
    soft[~mask] = 0
    out[:, :, 3] = (soft * 255).clip(0, 255).astype(np.uint8)
    return trim(out, pad=10)


def extract_faces():
    im = load_rgb(FACE_SRC)
    quads = {
        "tl": (0, 0, 720, 720),
        "br": (720, 720, 1440, 1440),
    }
    rects = {
        "tl": (35, 110, 700, 630),
        "br": (940, 870, 1430, 1430),
    }
    cleanups = {
        "tl": ("blue",),
        "br": ("shadow",),
    }
    out = {}
    for name, (x0, y0, x1, y1) in quads.items():
        crop = im[y0:y1, x0:x1]
        rx0, ry0, rx1, ry1 = rects[name]
        out[name] = grab_cut_cutout(
            crop,
            (rx0 - x0, ry0 - y0, rx1 - x0, ry1 - y0),
            cleanups[name],
        )
    return out


def find_eye_boxes(front):
    rgb = front[:, :, :3].astype(int)
    alpha = front[:, :, 3]
    white = (
        (rgb[:, :, 0] > 225)
        & (rgb[:, :, 1] > 225)
        & (rgb[:, :, 2] > 225)
        & (alpha > 200)
    )
    labels, _ = ndimage.label(white)
    boxes = []
    for i, sl in enumerate(ndimage.find_objects(labels), start=1):
        if sl is None:
            continue
        area = int((labels[sl] == i).sum())
        x0, y0, x1, y1 = sl[1].start, sl[0].start, sl[1].stop, sl[0].stop
        if 1000 < area < 20000 and y0 < front.shape[0] * 0.55:
            boxes.append((x0, y0, x1, y1))
    boxes.sort(key=lambda box: box[0])
    if len(boxes) < 2:
        raise RuntimeError("Could not find frog eyes")
    return boxes[:2]


def inset_box(box, inset):
    x0, y0, x1, y1 = box
    return (x0 + inset, y0 + inset, x1 - inset, y1 - inset)


def clear_eyes(im, eye_boxes):
    draw = ImageDraw.Draw(im)
    for box in eye_boxes:
        draw.ellipse(inset_box(box, 2), fill=(255, 255, 255, 255))


def closed_eyes(im, eye_boxes):
    clear_eyes(im, eye_boxes)
    draw = ImageDraw.Draw(im)
    for x0, y0, x1, y1 in eye_boxes:
        draw.arc(
            (x0 + 12, y0 + 26, x1 - 12, y1 - 24),
            200,
            340,
            fill=EYE_LINE,
            width=8,
        )


def heart_eyes(im, eye_boxes):
    clear_eyes(im, eye_boxes)
    draw = ImageDraw.Draw(im)
    try:
        font = ImageFont.truetype(r"C:\Windows\Fonts\seguisym.ttf", 72)
    except OSError:
        font = ImageFont.truetype(r"C:\Windows\Fonts\arial.ttf", 72)
    for x0, y0, x1, y1 in eye_boxes:
        cx = (x0 + x1) / 2
        cy = (y0 + y1) / 2 + 6
        bb = draw.textbbox((0, 0), "\u2665", font=font)
        tw = bb[2] - bb[0]
        th = bb[3] - bb[1]
        draw.text(
            (cx - tw / 2 - bb[0], cy - th / 2 - bb[1]),
            "\u2665",
            font=font,
            fill=HEART_FILL,
        )
        draw.ellipse(
            (cx - 15, cy - 17, cx - 5, cy - 7),
            fill=(255, 255, 255, 235),
        )


def shock_eyes(im, eye_boxes):
    clear_eyes(im, eye_boxes)
    draw = ImageDraw.Draw(im)
    for x0, y0, x1, y1 in eye_boxes:
        cx = (x0 + x1) / 2
        cy = (y0 + y1) / 2
        draw.ellipse((cx - 12, cy - 14, cx + 12, cy + 14), fill=PUPIL_FILL)
        draw.ellipse((cx - 7, cy - 9, cx - 2, cy - 4), fill=(255, 255, 255, 225))


def shy_blush(im):
    draw = ImageDraw.Draw(im)
    for cx in (53, 400):
        for dy in (-8, 2, 12):
            draw.line(
                (cx - 14, 214 + dy, cx + 8, 210 + dy),
                fill=(233, 120, 150, 255),
                width=4,
            )


def blueberry(im):
    draw = ImageDraw.Draw(im)
    cx, cy = 318, 363
    r = 60
    draw.ellipse(
        (cx - r, cy - r, cx + r, cy + r),
        fill=(74, 99, 171, 255),
        outline=(28, 34, 66, 255),
        width=5,
    )
    draw.arc(
        (cx - r + 14, cy - r + 18, cx + r - 30, cy + r - 42),
        200,
        300,
        fill=(132, 158, 220, 255),
        width=8,
    )
    crown = []
    for i in range(10):
        radius = 12 if i % 2 == 0 else 5
        angle = -math.pi / 2 + i * math.pi / 5
        crown.append(
            (cx + radius * math.cos(angle), cy - r + 12 + radius * math.sin(angle))
        )
    draw.polygon(crown, fill=(30, 38, 76, 255))


def save(im, name, previews):
    path = os.path.join(OUT, name + ".png")
    im.save(path)
    previews[name] = im


def save_icon(head):
    canvas = Image.new("RGBA", (256, 256), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)
    draw.ellipse((6, 6, 250, 250), fill=(226, 248, 233, 255), outline=(24, 24, 24, 255), width=6)
    hw = 208
    scale = hw / head.width
    hh = int(head.height * scale)
    resized = head.resize((hw, hh), Image.LANCZOS)
    canvas.alpha_composite(resized, ((256 - hw) // 2, (256 - hh) // 2 + 6))
    canvas.save(ICON)


def write_preview_sheet(images):
    os.makedirs(PREVIEW, exist_ok=True)
    cell = 240
    cols = 5
    rows = (len(images) + cols - 1) // cols
    sheet = Image.new("RGBA", (cols * cell, rows * cell), (246, 246, 246, 255))
    for i, (name, im) in enumerate(images.items()):
        scale = min((cell - 24) / im.width, (cell - 24) / im.height, 1.0)
        thumb = im.resize((int(im.width * scale), int(im.height * scale)), Image.LANCZOS)
        x = (i % cols) * cell + (cell - thumb.width) // 2
        y = (i // cols) * cell + (cell - thumb.height) // 2
        sheet.alpha_composite(thumb, (x, y))
    sheet.save(os.path.join(PREVIEW, "contact_sheet.png"))


def main():
    os.makedirs(OUT, exist_ok=True)
    front, dark = extract_bodies()
    faces = extract_faces()
    eye_boxes = find_eye_boxes(front)

    front_im = Image.fromarray(front)
    dark_im = Image.fromarray(dark)
    images = {}

    save(front_im, "idle", images)

    im = front_im.copy()
    closed_eyes(im, eye_boxes)
    save(im, "sleepy", images)
    save(im.copy(), "happy", images)
    save(im.copy(), "giggle", images)
    save(im.copy(), "goodnight", images)
    save(im.copy(), "bored", images)

    save(front_im.copy(), "hot", images)
    save(front_im.copy(), "confused", images)
    save(front_im.copy(), "wave", images)

    im = front_im.copy()
    heart_eyes(im, eye_boxes)
    save(im, "love", images)
    save(im.copy(), "cuddle", images)

    im = front_im.copy()
    shy_blush(im)
    save(im, "shy", images)

    im = front_im.copy()
    shock_eyes(im, eye_boxes)
    save(im, "surprised", images)

    im = front_im.copy()
    blueberry(im)
    save(im, "snack", images)

    save(dark_im, "back", images)
    save(dark_im.copy(), "angry", images)

    skate = Image.fromarray(add_outer_outline(faces["br"]))
    save(skate, "skate", images)

    save_icon(Image.fromarray(faces["tl"]))

    missing = [name for name in NAMES if name not in images]
    if missing:
        raise RuntimeError(f"Missing sprites: {missing}")

    manifest = {name: {"w": images[name].width, "h": images[name].height} for name in NAMES}
    with open(os.path.join(OUT, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)

    write_preview_sheet({name: images[name] for name in NAMES})
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()




