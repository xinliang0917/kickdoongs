import json
import os

import cv2
import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VIDEO = os.path.join(ROOT, "video_20261026_182936.mp4")
OUT = os.path.join(ROOT, "assets", "pet")

CROP_X, CROP_Y, CROP_W, CROP_H = 1080, 300, 640, 700
START, END, FPS = 3.5, 4.28, 12.5
TARGET_HEIGHT = 360


def extract_frames():
    cap = cv2.VideoCapture(VIDEO)
    start_frame = round(START * 25)
    cap.set(cv2.CAP_PROP_POS_FRAMES, start_frame)
    frames = []
    count = int((END - START) * 25) + 1
    for index in range(count):
        ok, frame = cap.read()
        if not ok:
            break
        if index % 2:
            continue
        print(f"frame {index}/{count}", flush=True)
        crop = frame[CROP_Y : CROP_Y + CROP_H, CROP_X : CROP_X + CROP_W]
        hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV)

        # Remove the flat blue studio background that touches the crop border.
        bg = (
            (hsv[:, :, 0] >= 85)
            & (hsv[:, :, 0] <= 115)
            & (hsv[:, :, 1] >= 85)
            & (hsv[:, :, 2] >= 140)
        )
        labels, _ = ndimage.label(bg, np.ones((3, 3), dtype=bool))
        border = (
            set(labels[0].tolist())
            | set(labels[-1].tolist())
            | set(labels[:, 0].tolist())
            | set(labels[:, -1].tolist())
        )
        border.discard(0)
        background = np.isin(labels, list(border))
        alpha = np.where(background, 0, 255).astype(np.uint8)
        rgb = cv2.cvtColor(crop, cv2.COLOR_BGR2RGB)
        frames.append(Image.fromarray(np.dstack([rgb, alpha])))
    cap.release()
    return frames


def main():
    frames = extract_frames()
    if not frames:
        raise SystemExit("no frames extracted")

    # One shared canvas keeps the board's slight drift visible and stable.
    boxes = []
    for frame in frames:
        alpha = np.array(frame)[:, :, 3]
        ys, xs = np.where(alpha > 24)
        if len(xs):
            boxes.append((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))
    left = max(0, min(box[0] for box in boxes) - 4)
    top = max(0, min(box[1] for box in boxes) - 4)
    right = min(CROP_W, max(box[2] for box in boxes) + 4)
    bottom = min(CROP_H, max(box[3] for box in boxes) + 4)
    frames = [frame.crop((left, top, right, bottom)) for frame in frames]

    scale = TARGET_HEIGHT / frames[0].height
    size = (max(1, round(frames[0].width * scale)), TARGET_HEIGHT)
    frames = [
        frame.resize(size, Image.Resampling.LANCZOS)
        for frame in frames
    ]

    # Ping-pong so the short clip loops without a visible jump.
    sequence = frames + frames[-2:0:-1]
    webp = os.path.join(OUT, "skate.webp")
    png = os.path.join(OUT, "skate.png")
    sequence[0].save(
        webp,
        format="WEBP",
        save_all=True,
        append_images=sequence[1:],
        duration=80,
        loop=0,
        quality=88,
        method=4,
    )
    sequence[0].save(png, format="PNG", optimize=True)

    manifest_path = os.path.join(OUT, "manifest.json")
    with open(manifest_path, encoding="utf-8") as handle:
        manifest = json.load(handle)
    manifest["skate"] = {"w": size[0], "h": size[1]}
    with open(manifest_path, "w", encoding="utf-8") as handle:
        json.dump(manifest, handle, indent=2, ensure_ascii=False)

    print(f"frames={len(sequence)} size={size} webp={os.path.getsize(webp)}")


if __name__ == "__main__":
    main()


