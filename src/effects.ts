import { applyColorOps, applyFinalOps, applySourceOps, hexRgb, isPixelEdit, SOURCE_OPS } from "./pixelfx";

// Non-destructive edits. Each edit is rendered as CSS filters (+ optional overlay/frame) for
// display, and replayed onto a canvas for export. Originals on disk are never modified.

export interface Edit {
  op: string;
  v?: number;
  /** Crop rectangle as fractions of the (unrotated) image: [x, y, w, h]. */
  r?: [number, number, number, number];
  /** Red-eye ellipses [x, y, w, h] / Retouch spots [x, y, radius], as fractions of the original. */
  pts?: number[][];
  /** Text to draw, its position (fractions of the finished picture) and colour. */
  t?: string;
  p?: [number, number];
  c?: string;
  /** Second setting of an effect (Glow radius, Soft Focus amount, Vignette shade...). */
  a?: number;
  /** Levels measured by the auto fixes: [lo, hi] or per channel [rlo, rhi, glo, ghi, blo, bhi]. */
  lv?: number[];
  /** Neutral Color Picker: red, green and blue gains. */
  g?: number[];
}

/** An effect setting shown in its panel (Picasa's sliders and colour pickers). */
export type Param = { key: "v" | "a"; label: string; def: number; min?: number } | { key: "c"; label: string; def: string };

export type CropRect = [number, number, number, number];

export type Overlay = "grain" | "gradTint" | "cinemascope";
export type Frame = "border" | "shadow" | "matte" | "polaroid";

export interface EffectDef {
  id: string;
  label: string;
  /** CSS rendering: exact for simple colour effects, an approximation (for thumbnails) where the
   *  real work is done on the pixels (see pixelfx). */
  filter?: (v: number, e: Edit) => string;
  /** Settings, edited in the effect's panel before applying. */
  params?: Param[];
  /** Value for edits saved before the effect had settings. */
  legacy?: number;
  vignette?: number;
  overlay?: Overlay;
  frame?: Frame;
  /** Not yet implemented — rendered greyed out, as a placeholder for parity with Picasa. */
  todo?: boolean;
}

const f = (s: string) => () => s;

/** Thumbnail approximation of measured levels: the contrast stretch they amount to. */
const levelsCss = (fallback: string) => (_v: number, e: Edit) => {
  const lv = e.lv;
  if (!lv) return fallback;
  const spans = lv.length === 6 ? [lv[1] - lv[0], lv[3] - lv[2], lv[5] - lv[4]] : [lv[1] - lv[0]];
  const span = spans.reduce((a, b) => a + b, 0) / spans.length;
  return `contrast(${Math.min(2.5, 1 / Math.max(0.4, span)).toFixed(3)})`;
};

/** Thumbnail approximation of a tint colour. */
const tintCss = (_v: number, e: Edit) => {
  const [r, g, b] = hexRgb(e.c, [91, 143, 208]);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  if (max !== min) h = max === r ? ((g - b) / (max - min)) * 60 : max === g ? (2 + (b - r) / (max - min)) * 60 : (4 + (r - g) / (max - min)) * 60;
  return `grayscale(1) sepia(1) hue-rotate(${Math.round(h - 38)}deg) saturate(${(1.2 + 1.3 * (1 - (e.v ?? 0))).toFixed(2)})`;
};

export const EFFECTS: Record<string, EffectDef> = {
  // Basic fixes
  crop: { id: "crop", label: "Crop" },
  straighten: { id: "straighten", label: "Straighten" },
  redeye: { id: "redeye", label: "Redeye" },
  lucky: { id: "lucky", label: "I'm Feeling Lucky", filter: levelsCss("contrast(1.12) saturate(1.12) brightness(1.04)") },
  autoContrast: { id: "autoContrast", label: "Auto Contrast", filter: levelsCss("contrast(1.2)") },
  autoColor: { id: "autoColor", label: "Auto Color", filter: levelsCss("saturate(1.15) hue-rotate(-3deg)") },
  retouch: { id: "retouch", label: "Retouch" },
  text: { id: "text", label: "Text" },
  // Tuning sliders (v in 0..1, temp in -1..1)
  fillLight: { id: "fillLight", label: "Fill Light", filter: (v) => `brightness(${1 + 0.35 * v}) contrast(${1 - 0.1 * v})` },
  highlights: { id: "highlights", label: "Highlights", filter: (v) => `brightness(${1 + 0.12 * v}) contrast(${1 + 0.12 * v})` },
  shadows: { id: "shadows", label: "Shadows", filter: (v) => `brightness(${1 - 0.1 * v}) contrast(${1 + 0.22 * v})` },
  temp: {
    id: "temp",
    label: "Color Temperature",
    filter: (v) => (v >= 0 ? `sepia(${0.35 * v}) saturate(${1 + 0.15 * v})` : `hue-rotate(${-v * 18}deg) saturate(${1 - 0.15 * v})`),
  },
  neutral: { id: "neutral", label: "Neutral Color" },
  // Effects — page 1
  sharpen: { id: "sharpen", label: "Sharpen", filter: (v) => `contrast(${1 + 0.12 * v})`, params: [{ key: "v", label: "Amount", def: 0.5 }], legacy: 0.5 },
  sepia: { id: "sepia", label: "Sepia", filter: f("sepia(1)") },
  bw: { id: "bw", label: "B&W", filter: f("grayscale(1)") },
  warmify: { id: "warmify", label: "Warmify", filter: f("sepia(0.25) saturate(1.25) hue-rotate(-8deg)") },
  filmGrain: { id: "filmGrain", label: "Film Grain", filter: f("contrast(1.1)") },
  tint: {
    id: "tint",
    label: "Tint",
    filter: tintCss,
    params: [
      { key: "c", label: "Pick color", def: "#5b8fd0" },
      { key: "v", label: "Preserve color", def: 0 },
    ],
    legacy: 0,
  },
  saturation: { id: "saturation", label: "Saturation", filter: (v) => `saturate(${(1 + 1.2 * v).toFixed(3)})`, params: [{ key: "v", label: "Amount", def: 0.5, min: -1 }], legacy: 0.58 },
  softFocus: {
    id: "softFocus",
    label: "Soft Focus",
    filter: f("blur(0.6px)"),
    params: [
      { key: "v", label: "Size", def: 0.5 },
      { key: "a", label: "Amount", def: 0.5 },
    ],
  },
  glow: {
    id: "glow",
    label: "Glow",
    filter: (v) => `brightness(${1 + 0.15 * v}) contrast(0.95)`,
    params: [
      { key: "v", label: "Intensity", def: 0.5 },
      { key: "a", label: "Radius", def: 0.5 },
    ],
    legacy: 0.5,
  },
  filteredBW: { id: "filteredBW", label: "Filtered B&W", filter: f("grayscale(1) contrast(1.2)"), params: [{ key: "c", label: "Pick color", def: "#ff8a00" }] },
  focalBW: {
    id: "focalBW",
    label: "Focal B&W",
    filter: f("grayscale(0.85) contrast(1.1)"),
    params: [
      { key: "v", label: "Size", def: 0.5 },
      { key: "a", label: "Sharpness", def: 0.5 },
    ],
  },
  graduatedTint: {
    id: "graduatedTint",
    label: "Graduated Tint",
    params: [
      { key: "c", label: "Pick color", def: "#ff8c28" },
      { key: "v", label: "Shade", def: 0.4 },
      { key: "a", label: "Feather", def: 0.6 },
    ],
  },
  // Effects — page 2
  infrared: { id: "infrared", label: "Infrared Film", filter: f("grayscale(1) invert(0.15) brightness(1.35) contrast(1.4)") },
  lomo: { id: "lomo", label: "Lomo-ish", filter: f("contrast(1.35) saturate(1.4)"), vignette: 0.6 },
  holga: { id: "holga", label: "Holga-ish", filter: f("grayscale(1) contrast(1.3) blur(0.4px)"), vignette: 0.7 },
  hdr: { id: "hdr", label: "HDR-ish", filter: f("contrast(1.45) saturate(1.3) brightness(1.05)") },
  cinemascope: { id: "cinemascope", label: "Cinemascope", filter: f("contrast(1.1) saturate(0.9)"), overlay: "cinemascope" },
  orton: { id: "orton", label: "Orton-ish", filter: f("brightness(1.15) saturate(1.3) blur(0.8px)") },
  sixties: { id: "sixties", label: "1960's", filter: f("sepia(0.35) saturate(0.75) contrast(0.92) brightness(1.05)") },
  invert: { id: "invert", label: "Invert Colors", filter: f("invert(1)") },
  heatmap: { id: "heatmap", label: "Heat Map", filter: f("invert(1) hue-rotate(180deg) saturate(4) contrast(1.4)") },
  crossProcess: { id: "crossProcess", label: "Cross Process", filter: f("contrast(1.25) saturate(1.5) hue-rotate(-12deg) sepia(0.15)") },
  posterize: { id: "posterize", label: "Posterize", filter: f("contrast(1.8) saturate(1.5)") },
  duotone: { id: "duotone", label: "Duo-Tone", filter: f("grayscale(1) sepia(1) hue-rotate(20deg) saturate(2.5)") },
  // Effects — page 3
  boost: { id: "boost", label: "Boost", filter: f("contrast(1.15) saturate(1.35) brightness(1.03)") },
  soften: { id: "soften", label: "Soften", filter: f("blur(0.7px)") },
  vignette: {
    id: "vignette",
    label: "Vignette",
    vignette: 0.55,
    params: [
      { key: "v", label: "Size", def: 0.5 },
      { key: "a", label: "Shade", def: 0.55 },
    ],
  },
  pixelate: { id: "pixelate", label: "Pixelate" },
  focalZoom: { id: "focalZoom", label: "Focal Zoom" },
  pencilSketch: { id: "pencilSketch", label: "Pencil Sketch", filter: f("grayscale(1) contrast(2.2) brightness(1.3)") },
  neon: { id: "neon", label: "Neon", filter: f("invert(1) hue-rotate(90deg) saturate(5) contrast(2)") },
  comicBook: { id: "comicBook", label: "Comic Book", filter: f("contrast(1.9) saturate(1.8)") },
  border: { id: "border", label: "Border", frame: "border" },
  dropShadow: { id: "dropShadow", label: "Drop Shadow", frame: "shadow" },
  museumMatte: { id: "museumMatte", label: "Museum Matte", frame: "matte" },
  polaroid: { id: "polaroid", label: "Polaroid", frame: "polaroid" },
};

export const TABS: { id: string; title: string; effects: string[] }[] = [
  { id: "fixes", title: "Commonly needed fixes", effects: ["crop", "straighten", "redeye", "lucky", "autoContrast", "autoColor", "retouch", "text"] },
  { id: "tuning", title: "Fine-tuned lighting and color fixes", effects: [] },
  {
    id: "fx1",
    title: "Fun and useful image processing",
    effects: ["sharpen", "sepia", "bw", "warmify", "filmGrain", "tint", "saturation", "softFocus", "glow", "filteredBW", "focalBW", "graduatedTint"],
  },
  {
    id: "fx2",
    title: "More fun and useful image processing",
    effects: ["infrared", "lomo", "holga", "hdr", "cinemascope", "orton", "sixties", "invert", "heatmap", "crossProcess", "posterize", "duotone"],
  },
  {
    id: "fx3",
    title: "Even more fun and useful image processing",
    effects: ["boost", "soften", "vignette", "pixelate", "focalZoom", "pencilSketch", "neon", "comicBook", "border", "dropShadow", "museumMatte", "polaroid"],
  },
];

/** Slider ops collapse into one value instead of stacking. */
export const SLIDER_OPS = new Set(["fillLight", "highlights", "shadows", "temp"]);

export interface Rendered {
  filter: string;
  rotate: number;
  vignette: number;
  /** How far the vignette reaches in (0 = only the corners, 1 = most of the picture). */
  vignetteSize: number;
  overlays: Overlay[];
  frame: Frame | null;
  crop: CropRect | null;
  straighten: number;
}

/**
 * The edit stack as CSS. `forCanvas`: leave out the CSS approximations of effects that the canvas
 * renderer does on the pixels.
 */
export function render(edits: Edit[], forCanvas = false): Rendered {
  const out: Rendered = { filter: "", rotate: 0, vignette: 0, vignetteSize: 0.5, overlays: [], frame: null, crop: null, straighten: 0 };
  const parts: string[] = [];
  for (const e of edits) {
    if (e.op === "rotate") {
      out.rotate = (((out.rotate + (e.v ?? 0)) % 360) + 360) % 360;
      continue;
    }
    if (e.op === "crop") {
      out.crop = e.r ?? null;
      continue;
    }
    if (e.op === "straighten") {
      out.straighten = e.v ?? 0;
      continue;
    }
    const def = EFFECTS[e.op];
    if (!def || def.todo) continue;
    if (def.filter && !(forCanvas && isPixelEdit(e))) parts.push(def.filter(e.v ?? def.legacy ?? 1, e));
    if (e.op === "vignette") {
      out.vignette = Math.max(out.vignette, e.a ?? 0.55);
      out.vignetteSize = e.v ?? 0.5;
    } else if (def.vignette) out.vignette = Math.max(out.vignette, def.vignette);
    if (def.overlay && !out.overlays.includes(def.overlay)) out.overlays.push(def.overlay);
    if (def.frame) out.frame = def.frame;
  }
  out.filter = parts.join(" ");
  return out;
}

/** CSS object-view-box that shows only the cropped region (the img's aspect follows it). */
export function cropViewBox(c: CropRect | null): string | undefined {
  if (!c) return undefined;
  const [x, y, w, h] = c;
  const pct = (n: number) => `${(Math.max(0, n) * 100).toFixed(3)}%`;
  return `inset(${pct(y)} ${pct(1 - x - w)} ${pct(1 - y - h)} ${pct(x)})`;
}

/**
 * A crop rectangle seen after turning the picture `deg` clockwise (0, 90, 180, 270). Crops are
 * stored on the unturned picture; the Crop tool works on the picture as you see it.
 * The way back is `turnRect(r, 360 - deg)`.
 */
export function turnRect(r: CropRect, deg: number): CropRect {
  const [x, y, w, h] = r;
  switch (((deg % 360) + 360) % 360) {
    case 90:
      return [1 - y - h, x, h, w];
    case 180:
      return [1 - x - w, 1 - y - h, w, h];
    case 270:
      return [y, 1 - x - w, h, w];
    default:
      return r;
  }
}

/** Scale needed so a w×h image rotated by `deg` still covers its original frame. */
export function straightenScale(deg: number, aspect: number): number {
  const t = (Math.abs(deg) * Math.PI) / 180;
  return Math.cos(t) + Math.sin(t) * Math.max(aspect, 1 / aspect);
}

/** Display aspect of a photo after crop and 90° rotations. */
export function displayAspect(base: number, r: Rendered): number {
  const a = r.crop ? (base * r.crop[2]) / r.crop[3] : base;
  return r.rotate === 90 || r.rotate === 270 ? 1 / a : a;
}

export function parseEdits(json: string | undefined): Edit[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function sliderValue(edits: Edit[], op: string, fallback = 0): number {
  for (let i = edits.length - 1; i >= 0; i--) if (edits[i].op === op) return edits[i].v ?? fallback;
  return fallback;
}

/**
 * Replays edits onto a canvas at full resolution for Export (or, with maxSource, a smaller
 * preview for the editor when pixel effects are present).
 */
export async function renderToCanvas(src: string, edits: Edit[], maxSource = 0): Promise<HTMLCanvasElement> {
  let img: HTMLImageElement | HTMLCanvasElement = await loadImage(src);
  const natural = (i: HTMLImageElement | HTMLCanvasElement) => (i instanceof HTMLImageElement ? [i.naturalWidth, i.naturalHeight] : [i.width, i.height]);
  const [nw0, nh0] = natural(img);
  const shrink = maxSource > 0 ? Math.min(1, maxSource / Math.max(nw0, nh0)) : 1;
  if (shrink < 1 || edits.some((e) => SOURCE_OPS.has(e.op))) {
    // Work on a copy: scaled down for previews, and with Red-eye / Retouch painted in.
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(nw0 * shrink));
    c.height = Math.max(1, Math.round(nh0 * shrink));
    // CPU-backed: Red-eye and Retouch read pixels back, which on a GPU canvas costs video memory.
    const cx = c.getContext("2d", { willReadFrequently: edits.some((e) => SOURCE_OPS.has(e.op)) })!;
    cx.drawImage(img, 0, 0, c.width, c.height);
    applySourceOps(cx, edits);
    img = c;
  }
  const [naturalWidth, naturalHeight] = natural(img);
  const r = render(edits, true);
  const [cx, cy, cw, ch] = r.crop ?? [0, 0, 1, 1];
  const sx = cx * naturalWidth;
  const sy = cy * naturalHeight;
  const sw = Math.max(1, cw * naturalWidth);
  const sh = Math.max(1, ch * naturalHeight);
  const swap = r.rotate === 90 || r.rotate === 270;
  const w = Math.round(swap ? sh : sw);
  const h = Math.round(swap ? sw : sh);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.filter = r.filter || "none";
  ctx.translate(w / 2, h / 2);
  ctx.rotate(((r.rotate + r.straighten) * Math.PI) / 180);
  if (r.straighten) {
    const k = straightenScale(r.straighten, sw / sh);
    ctx.scale(k, k);
  }
  ctx.drawImage(img, sx, sy, sw, sh, -sw / 2, -sh / 2, sw, sh);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.filter = "none";
  applyColorOps(canvas, edits);
  if (r.vignette > 0) {
    const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * (0.1 + 0.4 * r.vignetteSize), w / 2, h / 2, Math.hypot(w, h) / 2);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, `rgba(0,0,0,${r.vignette})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
  if (r.overlays.includes("cinemascope")) {
    const bar = Math.round(h * 0.12);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, w, bar);
    ctx.fillRect(0, h - bar, w, bar);
  }
  if (r.overlays.includes("gradTint")) {
    const g = ctx.createLinearGradient(0, 0, 0, h * 0.6);
    g.addColorStop(0, "rgba(255,140,40,0.35)");
    g.addColorStop(1, "rgba(255,140,40,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
  applyFinalOps(canvas, edits);
  return canvas;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
