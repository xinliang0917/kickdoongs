import os
import json
import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "TempDragFile_20261026_003616(1).png")
OUT = os.path.join(ROOT, "assets", "pet")
DEBUG = os.path.join(ROOT, "scripts", "debug_components.png")

NAMES = [
    "idle", "sleepy", "happy", "hot",
    "giggle", "bubbletea", "bored", "confused",
    "love", "shy", "wave", "goodnight",
    "angry", "back", "surprised", "cuddle",
]


def load_clean():
    im = Image.open(SRC).convert("RGB")
    arr = np.array(im)[1:, :, :]
    rgb = arr.astype(np.int32)
    lum = rgb.mean(axis=2)
    sat = rgb.max(axis=2) - rgb.min(axis=2)

    bg_mask = (lum >= 231) & (sat <= 22)
    labels, _ = ndimage.label(bg_mask, structure=np.ones((3, 3), dtype=bool))
    border = set(labels[0].tolist()) | set(labels[-1].tolist())
    border |= set(labels[:, 0].tolist()) | set(labels[:, -1].tolist())
    border.discard(0)
    bg = np.isin(labels, list(border))

    alpha = np.where(bg, 0, 255).astype(np.uint8)

    rgba = np.dstack([arr, alpha])
    return Image.fromarray(rgba), bg


def analyze(img):
    a = np.array(img)[:, :, 3]
    fg = a > 24
    labels, _ = ndimage.label(fg, structure=np.ones((3, 3), dtype=bool))
    objs = ndimage.find_objects(labels)
    rgb = np.array(img)[:, :, :3].astype(np.int32)
    comps = []
    for i, sl in enumerate(objs, start=1):
        if sl is None:
            continue
        mask = labels[sl] == i
        area = int(mask.sum())
        if area < 25:
            continue
        px = rgb[sl][mask]
        y0, y1 = sl[0].start, sl[0].stop
        x0, x1 = sl[1].start, sl[1].stop
        comps.append({
            "id": i, "area": area, "x0": x0, "x1": x1, "y0": y0, "y1": y1,
            "sat": round(float((px.max(axis=1) - px.min(axis=1)).mean()), 1),
            "color": [int(v) for v in px.mean(axis=0)],
        })
    return comps, labels


def main():
    os.makedirs(OUT, exist_ok=True)
    img, bg = load_clean()
    W, H = img.size
    comps, labels = analyze(img)
    arr = np.array(img)
    alpha = arr[:, :, 3].copy()
    rgb = arr[:, :, :3].astype(np.float32)
    lum = rgb.mean(axis=2)
    sat = rgb.max(axis=2) - rgb.min(axis=2)

    cw, ch = W / 4.0, H / 4.0
    kept_ids = set()
    report = {}
    manifest = {}

    for row in range(4):
        for col in range(4):
            name = NAMES[row * 4 + col]
            cell = []
            for c in comps:
                cx = (c["x0"] + c["x1"]) / 2
                cy = (c["y0"] + c["y1"]) / 2
                if col * cw <= cx < (col + 1) * cw and row * ch <= cy < (row + 1) * ch:
                    cell.append(c)
            cell.sort(key=lambda c: -c["area"])
            if not cell:
                continue
            main = cell[0]
            main_mask = ndimage.binary_dilation(labels == main["id"], iterations=4)
            kept = [main]
            for c in cell[1:]:
                cx = int((c["x0"] + c["x1"]) / 2)
                cy = int((c["y0"] + c["y1"]) / 2)
                on_body = bool(main_mask[min(H - 1, max(0, cy)), min(W - 1, max(0, cx))])
                chromatic = c["sat"] >= 18 and c["area"] >= 60
                if chromatic or (on_body and c["area"] >= 25):
                    kept.append(c)
            dropped = [c for c in cell if c not in kept]
            kx0 = min(c["x0"] for c in kept)
            ky0 = min(c["y0"] for c in kept)
            kx1 = max(c["x1"] for c in kept)
            ky1 = max(c["y1"] for c in kept)
            report[name] = {
                "kept": [c["id"] for c in kept],
                "dropped": [c["id"] for c in dropped],
                "box": [kx0, ky0, kx1, ky1],
            }
            kept_ids.update(c["id"] for c in kept)
            for c in dropped:
                m = labels == c["id"]
                m = ndimage.binary_dilation(m, iterations=2)
                alpha[m] = 0

    # Remove white matte fringe left by the paper background.
    fringe = ndimage.binary_dilation(bg, iterations=2) & (alpha > 0) & (sat < 60) & (lum > 165)
    a_f = np.clip((242.0 - lum) / 58.0, 0, 1) ** 1.15
    alpha2 = np.where(fringe, np.minimum(alpha / 255.0, a_f), alpha / 255.0)
    safe = np.maximum(alpha2[..., None], 0.04)
    fg = (rgb - (1 - alpha2[..., None]) * 255.0) / safe
    out_rgb = np.where(fringe[..., None], np.clip(fg, 0, 255), rgb)
    out_alpha = (alpha2 * 255).round().astype(np.uint8)

    # Also clear any tiny isolated alpha specks left behind.
    solid = out_alpha > 12
    lab, n = ndimage.label(solid, structure=np.ones((3, 3), dtype=bool))
    sizes = ndimage.sum(solid, lab, range(1, n + 1))
    for i, s in enumerate(sizes, start=1):
        if s < 60:
            out_alpha[lab == i] = 0

    out = np.dstack([out_rgb.astype(np.uint8), out_alpha])

    for name, info in report.items():
        kx0, ky0, kx1, ky1 = info["box"]
        pad = 4
        bx0 = max(0, kx0 - pad)
        by0 = max(0, ky0 - pad)
        bx1 = min(W, kx1 + pad)
        by1 = min(H, ky1 + pad)
        crop = Image.fromarray(out[by0:by1, bx0:bx1])
        crop.save(os.path.join(OUT, name + ".png"))
        manifest[name] = {"w": bx1 - bx0, "h": by1 - by0}

    with open(os.path.join(OUT, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)
    with open(os.path.join(ROOT, "scripts", "report.json"), "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, ensure_ascii=False)
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()
