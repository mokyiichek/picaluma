// Pixel effects that CSS filters can't express: Red-eye, Retouch, Pixelate, Focal Zoom and Text.
// Red-eye and Retouch work on the original image (their positions are fractions of it, so later
// crops and rotations keep them on the right spot); the others work on the finished picture.

import type { Edit } from "./effects";

export const SOURCE_OPS = new Set(["redeye", "retouch"]);
export const FINAL_OPS = new Set(["pixelate", "focalZoom", "text"]);
export const hasPixelOps = (edits: Edit[]) => edits.some((e) => SOURCE_OPS.has(e.op) || FINAL_OPS.has(e.op));

type Ctx = CanvasRenderingContext2D;

/** Applies Red-eye and Retouch edits to a canvas holding the original image. */
export function applySourceOps(ctx: Ctx, edits: Edit[]) {
  for (const e of edits) {
    if (e.op === "redeye") for (const r of e.pts ?? []) redeye(ctx, r);
    else if (e.op === "retouch") for (const s of e.pts ?? []) retouch(ctx, s);
  }
}

/** Applies Pixelate, Focal Zoom and Text to the finished picture. */
export function applyFinalOps(canvas: HTMLCanvasElement, edits: Edit[]) {
  const ctx = canvas.getContext("2d")!;
  for (const e of edits) {
    if (e.op === "pixelate") pixelate(canvas, e.v ?? 1);
    else if (e.op === "focalZoom") focalZoom(canvas, e.p ?? [0.5, 0.5], e.v ?? 1);
    else if (e.op === "text" && e.t) drawText(ctx, canvas.width, canvas.height, e);
  }
}

/** Red-eye: inside the ellipse [x, y, w, h], pull strongly red pixels down to the eye's own grey. */
function redeye(ctx: Ctx, [fx, fy, fw, fh]: number[]) {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const x0 = Math.max(0, Math.floor(fx * W));
  const y0 = Math.max(0, Math.floor(fy * H));
  const w = Math.min(W - x0, Math.ceil(fw * W));
  const h = Math.min(H - y0, Math.ceil(fh * H));
  if (w < 2 || h < 2) return;
  const img = ctx.getImageData(x0, y0, w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const nx = (x - w / 2) / (w / 2);
      const ny = (y - h / 2) / (h / 2);
      const dist = nx * nx + ny * ny;
      if (dist > 1) continue;
      const i = (y * w + x) * 4;
      const r = d[i];
      const g = d[i + 1];
      const b = d[i + 2];
      if (r > 50 && r > 1.4 * Math.max(g, b)) {
        const grey = (g + b) / 2;
        const k = dist > 0.7 ? (1 - dist) / 0.3 : 1; // soften the rim
        d[i] = r + (grey * 0.9 - r) * k;
      }
    }
  }
  ctx.putImageData(img, x0, y0);
}

/** Retouch (heal): covers the spot [x, y, radius] with the best-matching patch next to it. */
function retouch(ctx: Ctx, [fx, fy, fr]: number[]) {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const R = Math.max(3, fr * Math.min(W, H));
  const cx = fx * W;
  const cy = fy * H;
  const pad = Math.ceil(R * 3.6);
  const bx = Math.max(0, Math.floor(cx - pad));
  const by = Math.max(0, Math.floor(cy - pad));
  const bw = Math.min(W, Math.ceil(cx + pad)) - bx;
  const bh = Math.min(H, Math.ceil(cy + pad)) - by;
  if (bw < 4 || bh < 4) return;
  const img = ctx.getImageData(bx, by, bw, bh);
  const d = img.data;
  const at = (x: number, y: number) => ((Math.round(y) - by) * bw + (Math.round(x) - bx)) * 4;
  const inside = (x: number, y: number) => x >= bx && y >= by && x < bx + bw && y < by + bh;

  // Compare the ring just outside the spot with the same ring around each candidate patch.
  let best: [number, number] | null = null;
  let bestScore = Infinity;
  for (let a = 0; a < 8; a++) {
    const ox = Math.cos((a * Math.PI) / 4) * R * 2.2;
    const oy = Math.sin((a * Math.PI) / 4) * R * 2.2;
    let score = 0;
    let n = 0;
    for (let t = 0; t < 24; t++) {
      const ang = (t / 24) * Math.PI * 2;
      const px = cx + Math.cos(ang) * R * 1.15;
      const py = cy + Math.sin(ang) * R * 1.15;
      if (!inside(px, py) || !inside(px + ox, py + oy)) continue;
      const i = at(px, py);
      const j = at(px + ox, py + oy);
      score += (d[i] - d[j]) ** 2 + (d[i + 1] - d[j + 1]) ** 2 + (d[i + 2] - d[j + 2]) ** 2;
      n++;
    }
    if (n > 12 && score / n < bestScore) {
      bestScore = score / n;
      best = [ox, oy];
    }
  }
  if (!best) return;
  const [ox, oy] = best;
  const src = new Uint8ClampedArray(d);
  for (let y = Math.floor(cy - R); y <= Math.ceil(cy + R); y++) {
    for (let x = Math.floor(cx - R); x <= Math.ceil(cx + R); x++) {
      const dist = Math.hypot(x - cx, y - cy) / R;
      if (dist > 1 || !inside(x, y) || !inside(x + ox, y + oy)) continue;
      const alpha = dist < 0.6 ? 1 : (1 - dist) / 0.4; // feathered edge
      const i = at(x, y);
      const j = at(x + ox, y + oy);
      for (let c = 0; c < 3; c++) d[i + c] = d[i + c] + (src[j + c] - d[i + c]) * alpha;
    }
  }
  ctx.putImageData(img, bx, by);
}

/** Pixelate: big square blocks, size growing with v. */
function pixelate(canvas: HTMLCanvasElement, v: number) {
  const block = Math.max(2, Math.round(Math.min(canvas.width, canvas.height) * 0.018 * v));
  const sw = Math.max(1, Math.round(canvas.width / block));
  const sh = Math.max(1, Math.round(canvas.height / block));
  const small = document.createElement("canvas");
  small.width = sw;
  small.height = sh;
  const sctx = small.getContext("2d")!;
  sctx.imageSmoothingQuality = "medium";
  sctx.drawImage(canvas, 0, 0, sw, sh);
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(small, 0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = true;
  small.width = 0; // release it now rather than at garbage collection
}

/** Focal Zoom: a zoom blur radiating from the focal point, which stays sharp. */
function focalZoom(canvas: HTMLCanvasElement, [fx, fy]: number[], v: number) {
  const W = canvas.width;
  const H = canvas.height;
  const cx = fx * W;
  const cy = fy * H;
  const copy = document.createElement("canvas");
  copy.width = W;
  copy.height = H;
  copy.getContext("2d")!.drawImage(canvas, 0, 0);
  const ctx = canvas.getContext("2d")!;
  const steps = 12;
  for (let i = 1; i <= steps; i++) {
    const s = 1 + (i / steps) * 0.035 * v;
    ctx.globalAlpha = 1 / (i + 1);
    ctx.drawImage(copy, cx - cx * s, cy - cy * s, W * s, H * s);
  }
  ctx.globalAlpha = 1;
  // Keep the focal area sharp, fading into the blur.
  const sharp = document.createElement("canvas");
  sharp.width = W;
  sharp.height = H;
  const sh = sharp.getContext("2d")!;
  sh.drawImage(copy, 0, 0);
  const r = Math.min(W, H);
  const g = sh.createRadialGradient(cx, cy, r * 0.18, cx, cy, r * 0.55);
  g.addColorStop(0, "rgba(0,0,0,1)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  sh.globalCompositeOperation = "destination-in";
  sh.fillStyle = g;
  sh.fillRect(0, 0, W, H);
  ctx.drawImage(sharp, 0, 0);
  copy.width = sharp.width = 0; // free the full-size scratch canvases straight away
}

/** Text: centred at p, height v as a fraction of the picture height, with a soft shadow. */
function drawText(ctx: Ctx, W: number, H: number, e: Edit) {
  const [px, py] = e.p ?? [0.5, 0.85];
  const size = Math.max(8, (e.v ?? 0.06) * H);
  ctx.save();
  ctx.font = `600 ${size}px "Segoe UI", -apple-system, "Helvetica Neue", Arial, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = e.c === "#000000" ? "rgba(255,255,255,0.5)" : "rgba(0,0,0,0.6)";
  ctx.shadowBlur = size * 0.18;
  ctx.fillStyle = e.c ?? "#ffffff";
  ctx.fillText(e.t!, px * W, py * H);
  ctx.restore();
}
