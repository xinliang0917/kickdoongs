import os

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets", "pet")
SRC = os.path.join(OUT, "skate.png")

DECK = np.array([75, 161, 221], dtype=np.int32)
SHADOW = np.array([42, 89, 119], dtype=np.int32)


def top_edge(width):
    xs = np.arange(width)
    top = np.where(
        xs < 72,
        308 - 0.2 * (xs - 16),
        np.where(
            xs < 120,
            296.8 - 0.1875 * (xs - 72),
            287 - 0.35 * (xs - 120),
        ),
    )
    return np.round(top).astype(int)


def distance(rgb, target):
    diff = rgb.astype(np.int32) - target
    return (diff * diff).sum(axis=-1)


def main():
    image = Image.open(SRC).convert("RGBA")
    pixels = np.array(image)
    height, width = pixels.shape[:2]
    top = top_edge(width)
    board_edge = top - 3
    rider_edge = top - 7
    rows = np.arange(height)[:, None]

    rider = pixels.copy()
    rider[rows >= rider_edge[None, :]] = [0, 0, 0, 0]

    board = pixels.copy()
    board[rows < board_edge[None, :]] = [0, 0, 0, 0]

    foot_mask = np.zeros((height, width), dtype=bool)
    for x in range(76, 135):
        start = max(0, board_edge[x])
        end = min(height, board_edge[x] + 30)
        for y in range(start, end):
            if board[y, x, 3] < 20:
                continue
            if distance(board[y, x, :3], DECK) > 55 ** 2:
                foot_mask[y, x] = True

    for y, x in zip(*np.where(foot_mask)):
        source_x = x + 70
        if source_x < width:
            source = board[y, source_x]
            if source[3] > 200 and distance(source[:3], DECK) < 50 ** 2:
                board[y, x] = source
                continue
        board[y, x] = [*DECK.astype(np.uint8), 255]

    shadow = distance(board[:, :, :3], SHADOW) < 45 ** 2
    board[shadow, 3] = 0

    for x in range(62, 137):
        edge = board_edge[x]
        for dy in range(3):
            board[edge + dy, x] = [0, 0, 0, 255]

    Image.fromarray(rider).save(os.path.join(OUT, "skate_rider.png"))
    Image.fromarray(board).save(os.path.join(OUT, "skate_board.png"))
    print("skate_rider.png skate_board.png")


if __name__ == "__main__":
    main()
