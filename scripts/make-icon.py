"""Draws app-icon.png (1024x1024): a house of eight coloured tiles, four roof triangles over
four wall tiles with a door. Regenerate the platform icons afterwards with `npx tauri icon app-icon.png`.

    python scripts/make-icon.py
"""
from pathlib import Path

from PIL import Image, ImageDraw

SIZE = 1024
SS = 4  # supersampling for smooth edges

# The house exactly fills the square L..R (768 px, centred). The roof is a triangle from the
# top of the square to EAVE, split into four congruent right triangles; below it are two
# rows of two wall tiles. Every gap between tiles is GAP wide, while the outer edges stay on the
# square. The two bottom tiles are shortened by DOOR to leave a door between them.
L, R, MID = 128, 896, 512
GAP = 32
H = GAP / 2
EAVE = MID                          # roof base
ROW = (R - EAVE - 2 * GAP) / 2      # wall row height
TOP1, TOP2 = EAVE + GAP, EAVE + GAP + ROW + GAP
DOOR = 48                           # each bottom tile gives up this much width to the door

# The apex sits H above the square so the two roof tips, cut by the centre gap, touch its top.
A, Q = (MID, L - H), (MID, EAVE)                   # apex, centre of the roof base
ML, MR = ((L + MID) / 2, (A[1] + EAVE) / 2), ((MID + R) / 2, (A[1] + EAVE) / 2)  # mid-slopes

# (polygon, inset of each edge i→i+1, top-left colour, bottom-right colour). Edges on the outside
# of the house keep inset 0; edges shared with a neighbour are inset by half the gap.
PIECES = [
    ([(L, EAVE), ML, Q], [0, H, 0], "#E3392D", "#C51D12"),          # roof: red
    ([ML, A, Q], [0, H, H], "#F48C20", "#DE6608"),                  # orange
    ([A, MR, Q], [0, H, H], "#F7BC08", "#DFA000"),                  # yellow
    ([Q, MR, (R, EAVE)], [H, 0, 0], "#7DBE3C", "#58A01E"),          # green
    ([(L, TOP1), (MID, TOP1), (MID, TOP1 + ROW), (L, TOP1 + ROW)], [0, H, 0, 0], "#1C75E9", "#0348C2"),  # blue
    ([(MID, TOP1), (R, TOP1), (R, TOP1 + ROW), (MID, TOP1 + ROW)], [0, 0, 0, H], "#25B6DA", "#0790B6"),  # cyan
    ([(L, TOP2), (MID - DOOR, TOP2), (MID - DOOR, R), (L, R)], [0, H, 0, 0], "#9C51D8", "#782CB0"),      # purple
    ([(MID + DOOR, TOP2), (R, TOP2), (R, R), (MID + DOOR, R)], [0, 0, 0, H], "#16A381", "#06785A"),      # teal
]


def inset(poly, dists):
    """Moves edge i (poly[i] → poly[i+1]) of a convex polygon inward by dists[i]."""
    n = len(poly)
    area = sum(poly[i][0] * poly[(i + 1) % n][1] - poly[(i + 1) % n][0] * poly[i][1] for i in range(n))
    sign = 1 if area > 0 else -1
    lines = []
    for i in range(n):
        (x0, y0), (x1, y1) = poly[i], poly[(i + 1) % n]
        dx, dy = x1 - x0, y1 - y0
        ln = (dx * dx + dy * dy) ** 0.5
        nx, ny = -dy / ln * sign, dx / ln * sign  # inward normal
        lines.append(((x0 + nx * dists[i], y0 + ny * dists[i]), (dx, dy)))
    out = []
    for i in range(n):
        (p, r), (q, s) = lines[i - 1], lines[i]
        cross = r[0] * s[1] - r[1] * s[0]
        t = ((q[0] - p[0]) * s[1] - (q[1] - p[1]) * s[0]) / cross
        out.append((p[0] + t * r[0], p[1] + t * r[1]))
    return out


def rgb(hex_colour):
    return tuple(int(hex_colour[i:i + 2], 16) for i in (1, 3, 5))


def gradient(box, c0, c1):
    """Diagonal gradient (top-left c0 → bottom-right c1) filling box."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    a, b = rgb(c0), rgb(c1)
    small = Image.new("RGB", (64, 64))
    px = small.load()
    for y in range(64):
        for x in range(64):
            t = (x + y) / 126
            px[x, y] = tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))
    return small.resize((w, h), Image.BILINEAR)


def main():
    big = SIZE * SS
    out = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    for poly, dists, c0, c1 in PIECES:
        pts = [(x * SS, y * SS) for x, y in inset(poly, dists)]
        xs, ys = [p[0] for p in pts], [p[1] for p in pts]
        box = tuple(int(v) for v in (min(xs), min(ys), max(xs) + 1, max(ys) + 1))
        mask = Image.new("L", (big, big), 0)
        ImageDraw.Draw(mask).polygon(pts, fill=255)
        fill = Image.new("RGBA", (big, big), (0, 0, 0, 0))
        fill.paste(gradient(box, c0, c1), box[:2])
        out.paste(fill, (0, 0), mask)
    out = out.resize((SIZE, SIZE), Image.LANCZOS)
    root = Path(__file__).resolve().parent.parent
    out.save(root / "app-icon.png")
    out.resize((256, 256), Image.LANCZOS).save(root / "public" / "logo.png")
    out.resize((256, 256), Image.LANCZOS).save(root / "site" / "logo.png")
    out.resize((32, 32), Image.LANCZOS).save(root / "site" / "favicon.png")
    print("wrote app-icon.png, public/logo.png, site/logo.png, site/favicon.png")


if __name__ == "__main__":
    main()
