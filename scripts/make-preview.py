"""Renders the landing page's app preview (the .mock block in site/index.html) to
site/preview.png at 2x, so phones show it scaled down like a screenshot instead of reflowing.

    python scripts/make-preview.py
Needs Microsoft Edge (Windows) or Google Chrome for the headless screenshot.
"""
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
html = (ROOT / "site" / "index.html").read_text(encoding="utf-8")

css = re.search(r"<style>(.*?)</style>", html, re.S).group(1)  # the page's own stylesheet
mock = (ROOT / "scripts" / "preview-mock.html").read_text(encoding="utf-8")
# Sample holiday photos: free Unsplash photos served by Lorem Picsum.
ids = [1015, 1011, 1040, 1043, 1050, 1039, 1047, 1067, 129, 1016]
tiles = "".join(
    f'<img class="tile{" sel" if i == 6 else ""}" src="https://picsum.photos/id/{x}/320/240" alt="">' for i, x in enumerate(ids)
)
mock = mock.replace('<div class="tiles" id="tiles"></div>', f'<div class="tiles">{tiles}</div>')

W, H = 960, 440
page = f"""<!doctype html><html><head><meta charset="utf-8"><style>
{css}
html, body {{ margin: 0; background: #fff; }}
body {{ width: {W}px; padding: 0; overflow: hidden; }}
.mock {{ margin: 0 !important; max-width: none !important; width: {W}px; box-shadow: none !important; }}
</style></head><body>{mock}</body></html>"""

tmp = Path(tempfile.mkdtemp())
src = tmp / "preview.html"
src.write_text(page, encoding="utf-8")
out = tmp / "preview.png"
browser = next(
    p for p in [
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        shutil.which("google-chrome") or "",
        shutil.which("chromium") or "",
    ] if p and os.path.exists(p)
)
out.unlink(missing_ok=True)
subprocess.run([
    browser, "--headless=new", "--disable-gpu", "--hide-scrollbars", f"--user-data-dir={tmp / 'profile'}",
    "--force-device-scale-factor=2", f"--window-size={W},{H}", "--virtual-time-budget=15000",
    f"--screenshot={out}", src.as_uri(),
], check=True, timeout=120)
# Edge hands off to a child process and can return before the file is written.
import time
for _ in range(120):
    if out.exists() and out.stat().st_size > 0:
        time.sleep(1)
        break
    time.sleep(0.5)
# Trim the white below the window and save a compact JPEG for the page.
from PIL import Image, ImageChops
img = Image.open(out).convert("RGB")
bbox = ImageChops.difference(img, Image.new("RGB", img.size, "white")).getbbox()
img = img.crop((0, 0, img.width, bbox[3] + 2))
final = ROOT / "site" / "preview.jpg"
img.save(final, quality=86, optimize=True, progressive=True)
print(f"wrote {final} {img.width}x{img.height} ({final.stat().st_size // 1024} KB)")
