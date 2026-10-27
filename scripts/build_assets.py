from pathlib import Path
from PIL import Image, ImageDraw
import numpy as np
from scipy import ndimage

ROOT = Path(__file__).resolve().parent.parent
SRC_FRONT = ROOT / 'source' / 'jiuwang_front.png'
SRC_SKATE = ROOT / 'source' / 'jiuwang_skate.jpg'
OUT = ROOT / 'assets' / 'pet'
W, H = 400, 560
CONTENT_W = 392
CONTENT_H = 544
BOTTOM = 552
SS = 4

BODY = (253, 182, 100)
CREAM = (253, 247, 225)
EYE = (99, 58, 54)
MOUTH = (112, 58, 46)
INK = (28, 27, 27)
PINK = (232, 95, 117)
BLUSH = (243, 156, 156)

EYE_L = (151, 158)
EYE_R = (254, 158)
MOUTH_C = (202, 194)


def remove_bg(img, tol, bg_rgb=None):
    if bg_rgb is None:
        bg_rgb = img.getpixel((0, 0))[:3]
    rgb = np.array(img.convert('RGB')).astype(np.int32)
    dist = np.sqrt(((rgb - np.array(bg_rgb)) ** 2).sum(axis=2))
    near = dist < tol
    labels, _ = ndimage.label(near)
    edge = np.concatenate([
        labels[0, :].ravel(), labels[-1, :].ravel(),
        labels[:, 0].ravel(), labels[:, -1].ravel(),
    ])
    bg_labels = set(int(v) for v in np.unique(edge) if v != 0)
    bg = np.isin(labels, list(bg_labels))
    alpha = np.where(bg, 0, 255).astype(np.uint8)
    rgba = np.dstack([rgb.astype(np.uint8), alpha])
    out = Image.fromarray(rgba)
    return out.crop(out.getbbox())


def fit_canvas(img, canvas_w, canvas_h, content_w, content_h, bottom):
    scale = min(content_w / img.width, content_h / img.height)
    tw = max(1, round(img.width * scale))
    th = max(1, round(img.height * scale))
    resized = img.resize((tw, th), Image.LANCZOS)
    canvas = Image.new('RGBA', (canvas_w, canvas_h), (0, 0, 0, 0))
    canvas.alpha_composite(resized, ((canvas_w - tw) // 2, bottom - th))
    return canvas


def s(v):
    return int(round(v * SS))


def draw_overlay(canvas, fn):
    ov = Image.new('RGBA', (W * SS, H * SS), (0, 0, 0, 0))
    d = ImageDraw.Draw(ov)
    fn(d)
    ov = ov.resize((W, H), Image.LANCZOS)
    return Image.alpha_composite(canvas, ov)


def cover_eyes(d):
    for cx, cy in (EYE_L, EYE_R):
        d.ellipse([s(cx - 19), s(cy - 27), s(cx + 19), s(cy + 27)], fill=BODY)


def closed_up(d, cy_offset=0):
    for cx, cy in (EYE_L, EYE_R):
        d.arc([s(cx - 18), s(cy - 10 + cy_offset), s(cx + 18), s(cy + 18 + cy_offset)], 180, 360, fill=EYE, width=s(5))


def closed_down(d):
    for cx, cy in (EYE_L, EYE_R):
        d.arc([s(cx - 18), s(cy - 16), s(cx + 18), s(cy + 10)], 0, 180, fill=EYE, width=s(5))


def half_eyes(d):
    for cx, cy in (EYE_L, EYE_R):
        d.ellipse([s(cx - 17), s(cy - 4), s(cx + 17), s(cy + 25)], fill=EYE)
        d.line([s(cx - 19), s(cy - 2), s(cx + 19), s(cy - 2)], fill=EYE, width=s(5))
        d.ellipse([s(cx - 9), s(cy + 7), s(cx - 3), s(cy + 13)], fill=(255, 255, 255))


def heart_eyes(d):
    for cx, cy in (EYE_L, EYE_R):
        d.ellipse([s(cx - 20), s(cy - 14), s(cx + 1), s(cy + 7)], fill=PINK)
        d.ellipse([s(cx - 1), s(cy - 14), s(cx + 20), s(cy + 7)], fill=PINK)
        d.polygon([(s(cx - 20), s(cy + 2)), (s(cx + 20), s(cy + 2)), (s(cx), s(cy + 23))], fill=PINK)
        d.ellipse([s(cx - 13), s(cy - 8), s(cx - 7), s(cy - 2)], fill=(255, 255, 255))


def blush(d):
    for cx in (116, 289):
        d.ellipse([s(cx - 22), s(176), s(cx + 22), s(198)], fill=(243, 156, 156, 105))


def brows(d):
    d.line([s(126), s(128), s(170), s(141)], fill=EYE, width=s(5))
    d.line([s(279), s(128), s(235), s(141)], fill=EYE, width=s(5))


def cover_mouth(d):
    d.ellipse([s(MOUTH_C[0] - 33), s(172), s(MOUTH_C[0] + 33), s(215)], fill=CREAM)


def mouth_frown(d):
    cover_mouth(d)
    d.arc([s(MOUTH_C[0] - 14), s(188), s(MOUTH_C[0] + 14), s(206)], 180, 360, fill=MOUTH, width=s(4))


def mouth_small(d):
    cover_mouth(d)
    d.arc([s(MOUTH_C[0] - 14), s(188), s(MOUTH_C[0] + 14), s(206)], 0, 180, fill=MOUTH, width=s(4))


def mouth_flat(d):
    cover_mouth(d)
    d.line([s(MOUTH_C[0] - 14), s(197), s(MOUTH_C[0] + 14), s(197)], fill=MOUTH, width=s(4))


def mouth_o(d):
    cover_mouth(d)
    d.ellipse([s(MOUTH_C[0] - 12), s(190), s(MOUTH_C[0] + 12), s(214)], fill=MOUTH)
    d.ellipse([s(MOUTH_C[0] - 7), s(206), s(MOUTH_C[0] + 7), s(214)], fill=(239, 143, 156, 255))


def add_sauce(canvas):
    def fx(d):
        bx, by = 200, 355
        d.rounded_rectangle([s(bx - 22), s(by - 55), s(bx + 22), s(by + 55)], radius=s(14), fill=(235, 86, 60, 255), outline=INK, width=s(3))
        d.rectangle([s(bx - 10), s(by - 77), s(bx + 10), s(by - 54)], fill=(245, 197, 68, 255), outline=INK, width=s(3))
        d.rounded_rectangle([s(bx - 17), s(by - 24), s(bx + 17), s(by + 18)], radius=s(7), fill=CREAM, outline=INK, width=s(2))
        d.ellipse([s(bx - 8), s(by - 10), s(bx + 8), s(by + 6)], fill=(235, 86, 60, 255))

    return draw_overlay(canvas, fx)


def stretch_legs(base):
    cut = 430
    factor = 2.1
    lower_h = H - cut
    new_h = cut + int(round(lower_h * factor))
    out = Image.new('RGBA', (W, new_h), (0, 0, 0, 0))
    out.alpha_composite(base.crop((0, 0, W, cut)), (0, 0))
    lower = base.crop((0, cut, W, H)).resize((W, new_h - cut), Image.LANCZOS)
    out.alpha_composite(lower, (0, cut))
    return out


def stretch_arms(base):
    a = np.array(base).astype(np.int16)
    rgb = a[:, :, :3].astype(np.float32)
    cream = np.sqrt(((rgb - np.array(CREAM)) ** 2).sum(axis=2)) < 65
    labels, n = ndimage.label(cream & (a[:, :, 3] > 200))
    nub_mask = np.zeros((H, W), dtype=bool)
    nub_boxes = []
    for i in range(1, n + 1):
        ys, xs = np.where(labels == i)
        if len(xs) < 600:
            continue
        if (xs.max() < 110 or xs.min() > 290) and 200 < ys.min() < 380 and ys.max() < 430:
            nub_mask |= labels == i
            nub_boxes.append((xs.min(), xs.max(), ys.min(), ys.max()))
    nub_zone = ndimage.binary_dilation(nub_mask, iterations=11)

    orange = (
        (rgb[:, :, 0] > 210) & (rgb[:, :, 1] > 140) & (rgb[:, :, 1] < 215)
        & (rgb[:, :, 2] > 55) & (rgb[:, :, 2] < 135) & (a[:, :, 3] > 0)
    )
    olabels, on = ndimage.label(orange)
    if on:
        sizes = ndimage.sum(orange, olabels, range(1, on + 1))
        body = olabels == (int(np.argmax(sizes)) + 1)
    else:
        body = orange
    a[:, :, 3][nub_zone & ~body] = 0
    border = ndimage.binary_dilation(body, iterations=5) & ~body & nub_zone
    a[:, :, :3][border] = [28, 27, 27]
    a[:, :, 3][border] = 255
    lum = 0.299 * rgb[:, :, 0] + 0.587 * rgb[:, :, 1] + 0.114 * rgb[:, :, 2]
    for x0, x1, y0, y1 in nub_boxes:
        box = np.zeros((H, W), dtype=bool)
        box[max(0, y0 - 20):min(H, y1 + 35), max(0, x0 - 25):min(W, x1 + 25)] = True
        stray = box & ~body & ~border & (lum < 105) & (a[:, :, 3] > 0)
        a[:, :, 3][stray] = 0
    out = Image.fromarray(a.astype(np.uint8))

    ov = Image.new('RGBA', (W * SS, H * SS), (0, 0, 0, 0))
    d = ImageDraw.Draw(ov)

    def capsule(points, color, width):
        pts = [(s(x), s(y)) for x, y in points]
        d.line(pts, fill=color, width=s(width), joint='curve')
        for x, y in pts:
            r = s(width) // 2
            d.ellipse([x - r, y - r, x + r, y + r], fill=color)

    arms = [
        [(78, 330), (52, 235), (32, 105)],
        [(322, 330), (348, 235), (368, 105)],
    ]
    for pts in arms:
        capsule(pts, INK, 46)
    for pts in arms:
        capsule(pts, CREAM, 36)

    ov = ov.resize((W, H), Image.LANCZOS)
    return Image.alpha_composite(ov, out)


def clean_skate_edges(img):
    a = np.array(img).astype(np.int16)
    rgb = a[:, :, :3].astype(np.float32)
    lum = 0.299 * rgb[:, :, 0] + 0.587 * rgb[:, :, 1] + 0.114 * rgb[:, :, 2]
    dark = lum < 80
    dark = ndimage.binary_dilation(dark, iterations=1)
    filled = ndimage.binary_fill_holes(dark)
    keep = (a[:, :, 3] > 0) & filled
    mask = ndimage.binary_erosion(keep, iterations=1)
    soft = ndimage.gaussian_filter(mask.astype(np.float32), 0.55)
    alpha = np.clip(soft * 255, 0, 255).astype(np.uint8)
    a[:, :, 3] = alpha
    a[:, :, :3][alpha == 0] = 0
    return Image.fromarray(a.astype(np.uint8))


def build_skate():
    shot = Image.open(SRC_SKATE).convert('RGB')
    w, h = shot.size
    left = int(w * 0.57)
    right = int(w * 0.805)
    top = int(h * 0.32)
    bottom = int(h * 0.95)
    crop = shot.crop((left, top, right, bottom))
    bg = crop.getpixel((0, crop.height - 1))[:3]
    cut = remove_bg(crop, 78, bg)
    cut = clean_skate_edges(cut)
    return fit_canvas(cut, W, H, CONTENT_W, 520, BOTTOM)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    front = Image.open(SRC_FRONT)
    base = fit_canvas(remove_bg(front, 210), W, H, CONTENT_W, CONTENT_H, BOTTOM)
    base.save(OUT / 'idle.png')

    happy = draw_overlay(base, lambda d: (cover_eyes(d), closed_up(d)))
    happy.save(OUT / 'happy.png')

    giggle = draw_overlay(base, lambda d: (cover_eyes(d), closed_up(d), blush(d)))
    giggle.save(OUT / 'giggle.png')

    sleepy = draw_overlay(base, lambda d: (cover_eyes(d), half_eyes(d), mouth_small(d)))
    sleepy.save(OUT / 'sleepy.png')

    goodnight = draw_overlay(base, lambda d: (cover_eyes(d), closed_down(d), mouth_small(d)))
    goodnight.save(OUT / 'goodnight.png')

    love = draw_overlay(base, lambda d: (cover_eyes(d), heart_eyes(d), blush(d)))
    love.save(OUT / 'love.png')

    shy = draw_overlay(base, blush)
    shy.save(OUT / 'shy.png')

    bored = draw_overlay(base, lambda d: (cover_eyes(d), half_eyes(d), mouth_flat(d)))
    bored.save(OUT / 'bored.png')

    angry = draw_overlay(base, lambda d: (brows(d), mouth_frown(d)))
    angry.save(OUT / 'angry.png')

    surprised = draw_overlay(base, mouth_o)
    surprised.save(OUT / 'surprised.png')

    base.save(OUT / 'hot.png')
    base.save(OUT / 'confused.png')
    base.save(OUT / 'wave.png')
    base.save(OUT / 'cuddle.png')
    base.save(OUT / 'back.png')

    add_sauce(base).save(OUT / 'sauce.png')

    st_legs = stretch_legs(base)
    st_legs.save(OUT / 'stretch-legs.png')
    st_arms = stretch_arms(base)
    st_arms.save(OUT / 'stretch.png')

    skate = build_skate()
    skate.save(OUT / 'skate.png')
    skate.save(OUT / 'skate_rider.png')

    icon = base.crop((38, 18, 362, 342)).resize((256, 256), Image.LANCZOS)
    icon.save(ROOT / 'assets' / 'icon.png')

    manifest = {}
    for name in ['idle', 'sleepy', 'happy', 'hot', 'giggle', 'sauce', 'bored', 'confused', 'love', 'shy', 'wave', 'goodnight', 'angry', 'back', 'surprised', 'cuddle', 'stretch', 'stretch-legs', 'skate']:
        img = Image.open(OUT / f'{name}.png')
        manifest[name] = {'w': img.width, 'h': img.height}
    import json
    (OUT / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    print('done', {k: (v['w'], v['h']) for k, v in manifest.items()})


if __name__ == '__main__':
    main()
