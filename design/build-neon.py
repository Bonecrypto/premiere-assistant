"""PNG из design/neon → src/graphics/neon.ts (base64 PNG + превью 16:9). Нужен Pillow."""
import base64, glob, io, os
from PIL import Image

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, "..", "packages", "panel-premiere", "src", "graphics", "neon.ts")

def b64(im, **kw):
    buf = io.BytesIO()
    im.save(buf, "PNG", optimize=True, **kw)
    return base64.b64encode(buf.getvalue()).decode()

lines = ["// Сгенерировано design/build-neon.py — не править руками.", "export const NEON: Record<string, { w: number; h: number; png: string; thumb: string }> = {"]
for f in sorted(glob.glob(os.path.join(ROOT, "neon", "*.png"))):
    key = os.path.basename(f)[:2]
    im = Image.open(f)
    full = open(f, "rb").read()
    rgba = im.convert("RGBA")
    t = Image.new("RGBA", (192, 108), (0, 0, 0, 0))
    r = rgba.copy()
    r.thumbnail((176, 96), Image.LANCZOS)
    t.alpha_composite(r, ((192 - r.width) // 2, (108 - r.height) // 2))
    thumb = b64(t.quantize(colors=128, method=Image.FASTOCTREE))
    lines.append(f'  "{key}": {{ w: {im.width}, h: {im.height}, png: "{base64.b64encode(full).decode()}", thumb: "data:image/png;base64,{thumb}" }},')
lines.append("};")
open(OUT, "w", encoding="utf-8").write("\n".join(lines) + "\n")
print(OUT, os.path.getsize(OUT))
