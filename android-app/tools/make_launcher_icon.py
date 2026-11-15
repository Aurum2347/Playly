"""Builds Playly's adaptive launcher icon from the desktop logo (src-tauri/icons/icon.png).

The desktop logo is a whole black tile (rounded square, white frame, vinyl + play). Used as an
adaptive foreground it gets cropped by the launcher mask and sits on a white background. Here
only the white symbol is kept (as alpha), scaled into the 66dp safe zone, on a dark background.
The same layer doubles as the monochrome (themed icon) layer.
"""
import os
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, '..', 'src-tauri', 'icons', 'icon.png')
RES = os.path.join(ROOT, 'app', 'src', 'main', 'res')
# Symbol size inside the 108dp canvas: its rounded corners stay within the 66dp safe circle.
SYMBOL_DP = 52
DENSITIES = {'mdpi': 1, 'hdpi': 1.5, 'xhdpi': 2, 'xxhdpi': 3, 'xxxhdpi': 4}

src = Image.open(SRC).convert('RGBA')
# White symbol as alpha: brightness of each pixel times its own opacity.
alpha = Image.new('L', src.size)
alpha.putdata([round((r + g + b) / 3 * a / 255) for r, g, b, a in src.getdata()])
alpha = alpha.point(lambda v: 0 if v < 8 else v)
symbol = alpha.crop(alpha.getbbox())

for name, scale in DENSITIES.items():
    canvas_px = round(108 * scale)
    side = round(SYMBOL_DP * scale)
    w, h = symbol.size
    k = side / max(w, h)
    scaled = symbol.resize((max(1, round(w * k)), max(1, round(h * k))), Image.LANCZOS)
    layer = Image.new('L', (canvas_px, canvas_px), 0)
    layer.paste(scaled, ((canvas_px - scaled.width) // 2, (canvas_px - scaled.height) // 2))
    out = Image.new('RGBA', (canvas_px, canvas_px), (255, 255, 255, 0))
    out.putalpha(layer)
    folder = os.path.join(RES, 'mipmap-' + name)
    os.makedirs(folder, exist_ok=True)
    out.save(os.path.join(folder, 'ic_launcher_foreground.png'), optimize=True)
    print(name, canvas_px, scaled.size)
