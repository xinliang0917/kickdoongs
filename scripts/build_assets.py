import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage

ROOT = Path(__file__).resolve().parent.parent
SHEET_SRC = ROOT / 'source' / 'qihou_sheet.jpg'
FRONT_SRC = ROOT / 'source' / 'qihou_front.png'
SKATE_SRC = ROOT / 'source' / 'qihou_skate.jpg'
OUT = ROOT / 'assets' / 'pet'
PREVIEW = ROOT / 'scripts' / 'preview'

W, H = 400, 560
CONTENT_W = 392
CONTENT_H = 520
BOTTOM = 552
SS = 4

INK = (22, 20, 20)
CREAM = (253, 247, 231)
PINK = (255, 119, 171)
YELLOW = (244, 226, 112)
BLUSH = (246, 136, 156)
EAR_RED = (226, 82, 110)

NAMES = [
    'idle', 'stand', 'sleepy', 'happy', 'hot',
    'giggle', 'choco', 'bored', 'confused',
    'love', 'shy', 'wave', 'goodnight',
    'angry', 'back', 'surprised', 'cuddle', 'skate',
]

# 4x4 expression sheet: (row, column), 1-indexed
CELLS = {
    'idle': (1, 1),
    'sleepy': (4, 4),
    'happy': (4, 1),
    'bored': (3, 2),
    'shy': (2, 1),
    'choco': (2, 2),
    'hot': (2, 3),
    'confused': (1, 1),
    'angry': (3, 1),
    'back': (4, 3),
    'surprised': (3, 3),
    'wave': (3, 4),
    'love': (4, 1),
    'cuddle': (4, 2),
    'goodnight': (4, 4),
}


def load_rgba(path):
    return Image.open(path).convert('RGBA')


def remove_bg(img, tol=14, edge_px=1.6):
    rgb = np.asarray(img.convert('RGB')).astype(np.float32)
    border = np.concatenate(
        [rgb[0, :], rgb[-1, :], rgb[:, 0], rgb[:, -1]], axis=0
    )
    bg = np.median(border, axis=0)
    dist = np.sqrt(((rgb - bg) ** 2).sum(axis=2))
    spread = rgb.max(axis=2) - rgb.min(axis=2)

    candidate = (rgb[:, :, 2] > 228) & (spread < 20) & (dist < 120)
    labels, _ = ndimage.label(candidate)
    edge_labels = set(labels[0, :].tolist()) | set(labels[-1, :].tolist())
    edge_labels |= set(labels[:, 0].tolist()) | set(labels[:, -1].tolist())
    edge_labels.discard(0)
    bg_mask = np.isin(labels, list(edge_labels))
    bg_mask = ndimage.binary_closing(bg_mask, iterations=1)

    fg = ~bg_mask
    depth = ndimage.distance_transform_edt(fg)
    core = depth > edge_px

    nearest = ndimage.distance_transform_edt(~core, return_indices=True)[1]
    fg_color = rgb[nearest[0], nearest[1]]
    delta = fg_color - bg
    denom = (delta * delta).sum(axis=2)
    num = ((rgb - bg) * delta).sum(axis=2)
    matte = np.clip(num / np.maximum(denom, 1.0), 0.0, 1.0)

    t = np.clip((dist - 10.0) / 72.0, 0.0, 1.0)
    soft = t * t * (3.0 - 2.0 * t)
    edge_alpha = np.where(denom < 400.0, soft, matte)
    alpha = np.where(core, 1.0, np.where(fg, edge_alpha, 0.0))
    alpha = np.where(alpha < 0.03, 0.0, alpha)

    out = rgb.copy()
    edge_zone = fg & ~core
    out[edge_zone] = fg_color[edge_zone]
    out[alpha <= 0.03] = 0
    return np.dstack([out, alpha * 255]).astype(np.uint8)


def trim(rgba, pad=6):
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


def keep_character(rgba):
    alpha = rgba[:, :, 3]
    fg = alpha > 90
    labels, count = ndimage.label(fg)
    if not count:
        return rgba

    sizes = ndimage.sum(fg, labels, range(1, count + 1))
    main = int(np.argmax(sizes)) + 1
    boxes = ndimage.find_objects(labels)
    main_box = boxes[main - 1]
    my0, my1 = main_box[0].start, main_box[0].stop
    mx0, mx1 = main_box[1].start, main_box[1].stop
    mh = my1 - my0
    mw = mx1 - mx0
    rgb = rgba[:, :, :3].astype(np.int16)
    fb = face_box(rgba)
    face_top = fb[1] if fb else my0 + int(0.25 * mh)

    keep = np.zeros_like(fg)
    keep[labels == main] = True
    for i in range(1, count + 1):
        if i == main or sizes[i - 1] < 24:
            continue
        box = boxes[i - 1]
        if box is None:
            continue
        y0, y1 = box[0].start, box[0].stop
        x0, x1 = box[1].start, box[1].stop
        cy = (y0 + y1) / 2
        cx = (x0 + x1) / 2
        near_y = cy >= my0 + 0.02 * mh and cy <= my1 + 0.05 * mh
        near_x = cx >= mx0 - 0.5 * mw and cx <= mx1 + 0.5 * mw
        if not (near_y and near_x):
            continue
        mask = labels == i
        mean = rgb[mask].mean(axis=0)
        colored = int(mean.max() - mean.min()) > 22
        large_shape = sizes[i - 1] >= 700 and cy > face_top - 0.02 * mh
        if large_shape or (colored and sizes[i - 1] >= 30):
            keep |= mask

    out = rgba.copy()
    out[:, :, 3] = np.where(keep, alpha, 0)
    out[out[:, :, 3] == 0, :3] = 0
    return out


def fit_canvas(img, content_w=CONTENT_W, content_h=CONTENT_H, bottom=BOTTOM):
    scale = min(content_w / img.width, content_h / img.height)
    tw = max(1, round(img.width * scale))
    th = max(1, round(img.height * scale))
    resized = img.resize((tw, th), Image.LANCZOS)
    canvas = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    canvas.alpha_composite(resized, ((W - tw) // 2, bottom - th))
    return canvas


def face_box(rgba):
    rgb = rgba[:, :, :3].astype(np.int16)
    alpha = rgba[:, :, 3]
    ys, xs = np.where(alpha > 120)
    if not len(xs):
        return None
    y0, y1 = ys.min(), ys.max()
    h = y1 - y0 + 1
    cream = (
        (rgb[:, :, 0] > 235)
        & (rgb[:, :, 1] > 222)
        & (rgb[:, :, 2] > 195)
        & (rgb[:, :, 2] < 246)
        & (alpha > 150)
    )
    cream[: y0 + int(0.08 * h), :] = False
    cream[y0 + int(0.72 * h):, :] = False
    labels, count = ndimage.label(cream)
    if not count:
        return None
    sizes = ndimage.sum(cream, labels, range(1, count + 1))
    face = labels == (int(np.argmax(sizes)) + 1)
    if face.sum() < 60:
        return None
    yy, xx = np.where(face)
    return int(xx.min()), int(yy.min()), int(xx.max()), int(yy.max())


def draw_blush(rgba, strength=1.0):
    box = face_box(np.array(rgba))
    if not box:
        return rgba
    fx0, fy0, fx1, fy1 = box
    fw = max(1, fx1 - fx0)
    fh = max(1, fy1 - fy0)
    cy = fy0 + int(fh * 0.66)
    rx = max(9, int(fw * 0.13))
    ry = max(5, int(fh * 0.06))
    ov = Image.new('RGBA', rgba.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(ov)
    for cx in (fx0 + int(fw * 0.25), fx0 + int(fw * 0.75)):
        d.ellipse(
            [cx - rx, cy - ry, cx + rx, cy + ry],
            fill=(BLUSH[0], BLUSH[1], BLUSH[2], int(105 * strength)),
        )
    ov = ov.filter(ImageFilter.GaussianBlur(max(2, int(fw * 0.025))))
    return Image.alpha_composite(rgba, ov)


def redden_ears(rgba, amount=0.82):
    a = np.array(rgba).astype(np.float32)
    r, g, b = a[:, :, 0], a[:, :, 1], a[:, :, 2]
    pink = (
        (r > 195)
        & (g > 130)
        & (g < 226)
        & (b > 145)
        & (b < 242)
        & (r - g > 24)
        & (b - g > -8)
        & (a[:, :, 3] > 120)
    )
    if not pink.any():
        return rgba
    target = np.array(EAR_RED, dtype=np.float32)
    a[:, :, :3][pink] = a[:, :, :3][pink] * (1 - amount) + target * amount
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))


def build_front():
    raw = remove_bg(load_rgba(FRONT_SRC), 16, edge_px=4.0)
    return Image.fromarray(trim(raw))


def build_sheet_cells():
    sheet = Image.open(SHEET_SRC).convert('RGB')
    w, h = sheet.size
    xs = [round(w * i / 4) for i in range(5)]
    ys = [round(h * i / 4) for i in range(5)]
    cells = {}
    for name, (row, col) in CELLS.items():
        x0, x1 = xs[col - 1], xs[col]
        y0, y1 = ys[row - 1], ys[row]
        crop = sheet.crop((x0, y0, x1, y1)).convert('RGBA')
        rgba = keep_character(remove_bg(crop, 14, edge_px=2.0))
        cells[name] = Image.fromarray(trim(rgba))
    return cells


def s(v):
    return int(round(v * SS))


def build_skate(front):
    canvas = Image.new('RGBA', (W, H), (0, 0, 0, 0))

    board = Image.new('RGBA', (W * SS, H * SS), (0, 0, 0, 0))
    d = ImageDraw.Draw(board)
    d.ellipse([s(58), s(528), s(342), s(554)], fill=(88, 32, 54, 55))
    for cx in (116, 284):
        d.ellipse([s(cx - 17), s(497), s(cx + 17), s(531)], fill=YELLOW, outline=INK, width=s(4))
        d.ellipse([s(cx - 6), s(507), s(cx + 6), s(519)], fill=(255, 251, 214, 255))
    d.rounded_rectangle(
        [s(28), s(468), s(372), s(508)], radius=s(19), fill=PINK, outline=INK, width=s(5)
    )
    d.rounded_rectangle(
        [s(38), s(494), s(362), s(502)], radius=s(4), fill=(255, 255, 255, 255)
    )
    d.rounded_rectangle(
        [s(43), s(475), s(357), s(482)], radius=s(3), fill=(255, 196, 220, 255)
    )
    board = board.resize((W, H), Image.LANCZOS)
    canvas = Image.alpha_composite(canvas, board)

    scale = min(360 / front.width, 432 / front.height)
    tw = max(1, round(front.width * scale))
    th = max(1, round(front.height * scale))
    rider = front.resize((tw, th), Image.LANCZOS)
    canvas.alpha_composite(rider, ((W - tw) // 2, 477 - th))
    return canvas


def save_icon(front):
    box = front.getbbox()
    x0, y0, x1, y1 = box
    head_h = int((y1 - y0) * 0.62)
    head = front.crop((x0, y0, x1, y0 + head_h))
    canvas = Image.new('RGBA', (256, 256), (0, 0, 0, 0))
    d = ImageDraw.Draw(canvas)
    d.ellipse([4, 4, 252, 252], fill=(255, 236, 244, 255), outline=INK, width=6)
    scale = 208 / head.width
    tw = 208
    th = max(1, round(head.height * scale))
    if th > 214:
        scale = 214 / head.height
        th = 214
        tw = max(1, round(head.width * scale))
    resized = head.resize((tw, th), Image.LANCZOS)
    canvas.alpha_composite(resized, ((256 - tw) // 2, (256 - th) // 2 + 4))
    canvas.save(ROOT / 'assets' / 'icon.png')


def write_preview(images):
    PREVIEW.mkdir(parents=True, exist_ok=True)
    cell = 240
    cols = 5
    rows = (len(images) + cols - 1) // cols
    sheet = Image.new('RGBA', (cols * cell, rows * cell), (60, 63, 74, 255))
    checker = ImageDraw.Draw(sheet)
    for y in range(0, sheet.height, 20):
        for x in range(0, sheet.width, 20):
            if (x // 20 + y // 20) % 2:
                checker.rectangle([x, y, x + 19, y + 19], fill=(92, 96, 110, 255))
    for i, (name, im) in enumerate(images.items()):
        scale = min((cell - 22) / im.width, (cell - 22) / im.height, 1.0)
        thumb = im.resize(
            (max(1, int(im.width * scale)), max(1, int(im.height * scale))), Image.LANCZOS
        )
        x = (i % cols) * cell + (cell - thumb.width) // 2
        y = (i // cols) * cell + (cell - thumb.height) // 2
        sheet.alpha_composite(thumb, (x, y))
    sheet.convert('RGB').save(PREVIEW / 'contact_sheet.png')


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    front = build_front()
    cells = build_sheet_cells()

    images = {}
    for name, raw in cells.items():
        images[name] = fit_canvas(raw)

    images['idle'] = fit_canvas(cells['idle'])
    images['happy'] = fit_canvas(cells['happy'])
    images['giggle'] = fit_canvas(cells['wave'])
    images['shy'] = redden_ears(fit_canvas(cells['shy']), 0.9)
    images['angry'] = draw_blush(redden_ears(fit_canvas(cells['angry']), 0.9), 1.0)
    images['love'] = fit_canvas(cells['love'])
    images['cuddle'] = fit_canvas(cells['cuddle'])
    images['choco'] = fit_canvas(cells['choco'])

    images['stand'] = fit_canvas(front)
    images['skate'] = build_skate(front)

    for name in NAMES:
        if name not in images:
            raise RuntimeError(f'missing sprite: {name}')
        images[name].save(OUT / f'{name}.png')

    save_icon(front)

    manifest = {}
    for name in NAMES:
        img = images[name]
        alpha = np.array(img)[:, :, 3]
        rows = np.where((alpha > 12).any(axis=1))[0]
        top = int(rows.min()) if len(rows) else 0
        manifest[name] = {'w': img.width, 'h': img.height, 'top': top}
    (OUT / 'manifest.json').write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + '\n', encoding='utf-8'
    )
    write_preview({name: images[name] for name in NAMES})
    print('done')
    print(json.dumps(manifest, indent=2))


if __name__ == '__main__':
    main()
