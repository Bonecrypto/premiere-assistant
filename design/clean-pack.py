"""Чистка пака картинок, вырезанных из общего листа: убирает обрезки соседей у краёв,
обрезает по содержимому, увеличивает ×2, 256 цветов. python3 design/clean-pack.py <папка-источник> <папка-результат>"""
import glob, os, sys
from collections import deque
import numpy as np
from PIL import Image

def dil(m, k):
    for _ in range(k):
        o = m.copy(); o[1:] |= m[:-1]; o[:-1] |= m[1:]; o[:, 1:] |= m[:, :-1]; o[:, :-1] |= m[:, 1:]; m = o
    return m

def label(m):
    H, W = m.shape; lab = np.zeros((H, W), int); n = 0
    for y in range(H):
        for x in range(W):
            if m[y, x] and not lab[y, x]:
                n += 1; q = deque([(y, x)]); lab[y, x] = n
                while q:
                    cy, cx = q.popleft()
                    for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                        ny, nx = cy + dy, cx + dx
                        if 0 <= ny < H and 0 <= nx < W and m[ny, nx] and not lab[ny, nx]:
                            lab[ny, nx] = n; q.append((ny, nx))
    return lab, n

src, dst = sys.argv[1], sys.argv[2]
os.makedirs(dst, exist_ok=True)
for f in sorted(glob.glob(os.path.join(src, "[0-9]*.png"))):
    a = np.array(Image.open(f).convert("RGBA"))
    al = a[:, :, 3] > 12
    lab, n = label(dil(al, 1))
    sizes = [int((al & (lab == i)).sum()) for i in range(1, n + 1)]
    big = max(sizes); H, W = al.shape
    keep = np.zeros_like(al)
    for i in range(1, n + 1):
        m = lab == i; ys, xs = np.where(m)
        border = ys.min() == 0 or xs.min() == 0 or ys.max() == H - 1 or xs.max() == W - 1
        if (border and sizes[i - 1] < 0.5 * big) or sizes[i - 1] < 0.002 * big:
            continue
        keep |= m
    a[~keep] = 0
    ys, xs = np.where(a[:, :, 3] > 0); p = 6
    a = a[max(0, ys.min() - p):ys.max() + p + 1, max(0, xs.min() - p):xs.max() + p + 1]
    out = Image.fromarray(a, "RGBA").resize((a.shape[1] * 2, a.shape[0] * 2), Image.LANCZOS)
    out.quantize(colors=256, method=Image.FASTOCTREE).save(os.path.join(dst, os.path.basename(f)), optimize=True)
    print(os.path.basename(f), out.size)
