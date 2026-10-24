// Pixel effects that CSS filters can't express: Red-eye, Retouch, Pixelate, Focal Zoom, Text, and
// the real tone and colour work (auto levels, tuning curves, sharpening, tints and blends).
// Red-eye and Retouch work on the original image (their positions are fractions of it, so later
// crops and rotations keep them on the right spot); the others work on the finished picture.

import type { Edit } from "./effects";

export const SOURCE_OPS = new Set(["redeye", "retouch"]);
export const FINAL_OPS = new Set(["pixelate", "focalZoom", "text"]);
/** Tone and colour work done on the pixels (CSS filters only approximate these, for thumbnails). */
export const COLOR_OPS = new Set([
  "fillLight",
  "highlights",
  "shadows",
  "temp",
  "neutral",
  "sharpen",
  "filteredBW",
  "tint",
  "softFocus",
  "glow",
  "focalBW",
  "graduatedTint",
  "filmGrain",
]);
/** Auto fixes measure the picture when applied and store the levels found (`lv`). */
export const LEVEL_OPS = new Set(["autoContrast", "autoColor", "lucky"]);
export const isPixelEdit = (e: Edit) => SOURCE_OPS.has(e.op) || FINAL_OPS.has(e.op) || COLOR_OPS.has(e.op) || (LEVEL_OPS.has(e.op) && !!e.lv);
/** Crops are drawn on the canvas too: CSS object-view-box isn't supported by Safari (macOS). */
export const hasPixelOps = (edits: Edit[]) => edits.some((e) => isPixelEdit(e) || e.op === "crop");

export function hexRgb(hex: string | undefined, fallback: [number, number, number]): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? "");
  if (!m) return fallback;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Levels for the auto fixes, measured on the picture as it is so far: the darkest and brightest
 * 0.5% are clipped. `perChannel` (Auto Color) stretches red, green and blue separately, which
 * also removes a colour cast; otherwise (Auto Contrast) one stretch keeps the colours as they are.
 */
export function measureLevels(canvas: HTMLCanvasElement, perChannel: boolean, clip = 0.005): number[] {
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const hist = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
  for (let i = 0; i < d.length; i += 4) {
    hist[0][d[i]]++;
    hist[1][d[i + 1]]++;
    hist[2][d[i + 2]]++;
    hist[3][Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2])]++;
  }
  const n = d.length / 4;
  const bounds = (h: Uint32Array): [number, number] => {
    let lo = 0;
    let hi = 255;
    for (let acc = h[0]; lo < 254 && acc < n * clip; acc += h[++lo]);
    for (let acc = h[255]; hi > lo + 1 && acc < n * clip; acc += h[--hi]);
    // Never stretch more than 2.5×: very flat pictures (fog, night) stay believable.
    if (hi - lo < 102) {
      const mid = (hi + lo) / 2;
      lo = Math.max(0, mid - 51);
      hi = Math.min(255, mid + 51);
    }
    return [lo / 255, hi / 255];
  };
  return perChannel ? [...bounds(hist[0]), ...bounds(hist[1]), ...bounds(hist[2])] : bounds(hist[3]);
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
type Curve = (x: number, ch: number) => number;

/** Per-channel tone curve of one edit, or null if it isn't a curve. x and the result are 0..1. */
function curveOf(e: Edit): Curve | null {
  const v = e.v ?? 0;
  switch (e.op) {
    case "autoContrast":
    case "autoColor":
    case "lucky": {
      const lv = e.lv;
      if (!lv) return null;
      return (x, ch) => {
        const lo = lv.length === 6 ? lv[ch * 2] : lv[0];
        const hi = lv.length === 6 ? lv[ch * 2 + 1] : lv[1];
        return clamp01((x - lo) / Math.max(0.01, hi - lo));
      };
    }
    // Fill Light lifts the shadows and midtones; Highlights brightens the bright end; Shadows
    // deepens the dark end. Smooth curves that leave black and white where they are.
    case "fillLight":
      return (x) => clamp01(x + v * 0.4 * 6.75 * x * (1 - x) * (1 - x));
    case "highlights":
      return (x) => clamp01(x + v * 0.3 * 6.75 * x * x * (1 - x));
    case "shadows":
      return (x) => clamp01(x - v * 0.3 * 6.75 * x * (1 - x) * (1 - x));
    case "temp": {
      const gain = [1 + 0.14 * v, 1 + 0.02 * v, 1 - 0.14 * v];
      return (x, ch) => clamp01(x * gain[ch]);
    }
    case "neutral": {
      const g = e.g ?? [1, 1, 1];
      return (x, ch) => clamp01(x * g[ch]);
    }
    default:
      return null;
  }
}

/** Tone curves, sharpening, colour effects and soft-focus style blends on the finished picture. */
export function applyColorOps(canvas: HTMLCanvasElement, edits: Edit[]) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const W = canvas.width;
  const H = canvas.height;
  // 1. All curves folded into one lookup table per channel, in the order they were applied.
  const curves = edits.map(curveOf).filter((c): c is Curve => !!c);
  const pointwise = edits.filter((e) => e.op === "filteredBW" || e.op === "filmGrain");
  const sharpen = edits.filter((e) => e.op === "sharpen");
  if (curves.length || pointwise.length || sharpen.length) {
    const img = ctx.getImageData(0, 0, W, H);
    const d = img.data;
    if (curves.length) {
      const lut = [new Uint8ClampedArray(256), new Uint8ClampedArray(256), new Uint8ClampedArray(256)];
      for (let ch = 0; ch < 3; ch++)
        for (let i = 0; i < 256; i++) {
          let x = i / 255;
          for (const c of curves) x = c(x, ch);
          lut[ch][i] = Math.round(x * 255);
        }
      for (let i = 0; i < d.length; i += 4) {
        d[i] = lut[0][d[i]];
        d[i + 1] = lut[1][d[i + 1]];
        d[i + 2] = lut[2][d[i + 2]];
      }
    }
    for (const e of sharpen) unsharp(d, W, H, (e.v ?? 0.5) * 1.6);
    for (const e of pointwise) {
      if (e.op === "filteredBW") {
        // Black and white through a coloured filter: the filter's colour comes out light.
        const [r, g, b] = hexRgb(e.c, [255, 138, 0]);
        const sum = r + g + b + 30;
        const w = [(r + 10) / sum, (g + 10) / sum, (b + 10) / sum];
        for (let i = 0; i < d.length; i += 4) {
          const y = w[0] * d[i] + w[1] * d[i + 1] + w[2] * d[i + 2];
          d[i] = d[i + 1] = d[i + 2] = y;
        }
      } else {
        // Film grain: fine monochrome noise, strongest in the midtones.
        const amt = 18 + 30 * (e.v ?? 0.5);
        let seed = 1234567;
        for (let i = 0; i < d.length; i += 4) {
          seed = (seed * 1103515245 + 12345) & 0x7fffffff;
          const y = (d[i] + d[i + 1] + d[i + 2]) / 765;
          const n = (seed / 0x7fffffff - 0.5) * amt * (1 - Math.abs(2 * y - 1) * 0.6);
          d[i] += n;
          d[i + 1] += n;
          d[i + 2] += n;
        }
      }
    }
    ctx.putImageData(img, 0, 0);
  }
  // 2. Blends, drawn with the canvas compositor.
  const diag = Math.hypot(W, H);
  for (const e of edits) {
    const v = e.v ?? 0.5;
    const a = e.a ?? 0.5;
    if (e.op === "tint") {
      // The tint's colour with the picture's brightness; "Preserve color" keeps some original colour.
      ctx.save();
      ctx.globalCompositeOperation = "color";
      ctx.globalAlpha = 1 - 0.85 * (e.v ?? 0);
      ctx.fillStyle = e.c ?? "#5b8fd0";
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    } else if (e.op === "softFocus") {
      // Sharp in the middle, softly blurred towards the edges.
      const blurred = layer(canvas, `blur(${Math.max(1, a * 0.012 * diag)}px)`);
      maskRadial(blurred, 0.12 + 0.45 * v, true);
      ctx.drawImage(blurred, 0, 0);
      blurred.width = 0;
    } else if (e.op === "glow") {
      const blurred = layer(canvas, `blur(${Math.max(1, (0.004 + a * 0.025) * diag)}px)`);
      ctx.save();
      ctx.globalCompositeOperation = "screen";
      ctx.globalAlpha = 0.15 + 0.6 * v;
      ctx.drawImage(blurred, 0, 0);
      ctx.restore();
      blurred.width = 0;
    } else if (e.op === "focalBW") {
      // Colour in the middle, black and white outside.
      const grey = layer(canvas, "grayscale(1)");
      maskRadial(grey, 0.12 + 0.45 * v, true, 0.05 + 0.5 * (1 - a));
      ctx.drawImage(grey, 0, 0);
      grey.width = 0;
    } else if (e.op === "graduatedTint") {
      const [r, g, b] = hexRgb(e.c, [255, 140, 40]);
      const grad = ctx.createLinearGradient(0, 0, 0, H * (0.25 + 0.75 * a));
      grad.addColorStop(0, `rgba(${r},${g},${b},${0.15 + 0.7 * v})`);
      grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
      ctx.save();
      ctx.globalCompositeOperation = "multiply";
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
  }
}

/** A copy of the canvas through a CSS filter. */
function layer(canvas: HTMLCanvasElement, filter: string): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = canvas.width;
  c.height = canvas.height;
  const x = c.getContext("2d")!;
  x.filter = filter;
  x.drawImage(canvas, 0, 0);
  return c;
}

/** Keeps the layer only outside (or inside) an ellipse around the centre, with a soft edge. */
function maskRadial(c: HTMLCanvasElement, radius: number, outside: boolean, soft = 0.3) {
  const x = c.getContext("2d")!;
  const W = c.width;
  const H = c.height;
  const r = (Math.hypot(W, H) / 2) * radius;
  const g = x.createRadialGradient(W / 2, H / 2, r, W / 2, H / 2, r * (1 + soft * 3) + 1);
  g.addColorStop(0, outside ? "rgba(0,0,0,0)" : "rgba(0,0,0,1)");
  g.addColorStop(1, outside ? "rgba(0,0,0,1)" : "rgba(0,0,0,0)");
  x.globalCompositeOperation = "destination-in";
  x.fillStyle = g;
  x.fillRect(0, 0, W, H);
}

/** Unsharp mask: adds back the difference from a small blur, so edges get crisper. */
function unsharp(d: Uint8ClampedArray, W: number, H: number, amount: number) {
  if (amount <= 0 || W < 3 || H < 3) return;
  const src = new Uint8ClampedArray(d);
  const row = W * 4;
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * row + x * 4;
      for (let ch = 0; ch < 3; ch++) {
        const k = i + ch;
        const blur =
          (src[k - row - 4] + 2 * src[k - row] + src[k - row + 4] + 2 * src[k - 4] + 4 * src[k] + 2 * src[k + 4] + src[k + row - 4] + 2 * src[k + row] + src[k + row + 4]) / 16;
        d[k] = src[k] + amount * (src[k] - blur);
      }
    }
  }
}

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
