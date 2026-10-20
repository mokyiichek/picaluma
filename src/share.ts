// Shared by Export, E-mail and Print: renders pictures with their edits applied, resized and
// optionally watermarked, as JPEG.
import { api, Photo, photoUrl } from "./api";
import { renderToCanvas } from "./effects";
import { selectVisible, useStore } from "./store";
import { notify } from "./dialogs";

export interface RenderOptions {
  /** Longest edge in pixels; 0 keeps the original size. */
  maxEdge: number;
  /** JPEG quality 0–1. */
  quality: number;
  watermark?: string;
}

/** The pictures the tray's Email / Print / Export act on: the selection, else the current folder or album. */
export function trayIds(): number[] {
  const s = useStore.getState();
  if (s.view === "edit" && s.editId != null) return [s.editId];
  if (s.selected.size) return [...s.selected];
  return folderIds();
}

/** Every picture in the current folder or album (Folder › Print Contact Sheet). */
export function folderIds(): number[] {
  const s = useStore.getState();
  return selectVisible(s).find((v) => v.folder.id === s.currentFolderId)?.photos ?? [];
}

export function hasEdits(id: number): boolean {
  return (useStore.getState().edits.get(id)?.length ?? 0) > 0;
}

/** Renders one picture to a canvas: edits applied, scaled down to maxEdge, watermark drawn. */
export async function renderPicture(id: number, opts: Pick<RenderOptions, "maxEdge" | "watermark">): Promise<HTMLCanvasElement> {
  let canvas = await renderToCanvas(photoUrl(id), useStore.getState().edits.get(id) ?? []);
  const edge = Math.max(canvas.width, canvas.height);
  if (opts.maxEdge > 0 && edge > opts.maxEdge) canvas = downscale(canvas, opts.maxEdge / edge);
  if (opts.watermark?.trim()) drawWatermark(canvas, opts.watermark.trim());
  return canvas;
}

export async function renderJpegBase64(id: number, opts: RenderOptions): Promise<string> {
  const url = (await renderPicture(id, opts)).toDataURL("image/jpeg", opts.quality);
  return url.slice(url.indexOf(",") + 1);
}

/** Writes the picture into dir as JPEG, or copies the original untouched when nothing would change it. Movies are always copied as they are. */
export async function writePicture(photo: Photo, dir: string, opts: RenderOptions): Promise<string> {
  if (useStore.getState().videos.has(photo.id)) return api.copyInto(photo.path, dir);
  const isJpeg = /\.jpe?g$/i.test(photo.name);
  const untouched = !hasEdits(photo.id) && !opts.watermark?.trim();
  const fits = opts.maxEdge === 0 || Math.max(photo.width, photo.height) <= opts.maxEdge;
  if (isJpeg && untouched && fits) return api.copyInto(photo.path, dir);
  const base = photo.name.replace(/\.[^.]+$/, "");
  return api.exportPicture(joinPath(dir, `${base}.jpg`), await renderJpegBase64(photo.id, opts));
}

export const joinPath = (dir: string, name: string) => {
  const sep = dir.includes("\\") ? "\\" : "/";
  return `${dir.replace(/[\\/]$/, "")}${sep}${name}`;
};

/** Steps down in halves for a sharp, alias-free result. */
function downscale(src: HTMLCanvasElement, k: number): HTMLCanvasElement {
  let cur = src;
  let w = src.width;
  let h = src.height;
  const tw = Math.max(1, Math.round(src.width * k));
  const th = Math.max(1, Math.round(src.height * k));
  do {
    w = Math.max(tw, Math.round(w / 2));
    h = Math.max(th, Math.round(h / 2));
    const next = document.createElement("canvas");
    next.width = w;
    next.height = h;
    const ctx = next.getContext("2d")!;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(cur, 0, 0, w, h);
    cur = next;
  } while (w > tw || h > th);
  return cur;
}

/** Picasa-style watermark: white text with a soft shadow in the bottom-right corner. */
function drawWatermark(canvas: HTMLCanvasElement, text: string) {
  const ctx = canvas.getContext("2d")!;
  const size = Math.max(12, Math.round(Math.min(canvas.width, canvas.height) * 0.045));
  const pad = Math.round(size * 0.8);
  ctx.font = `600 ${size}px "Segoe UI", -apple-system, Arial, sans-serif`;
  ctx.textAlign = "right";
  ctx.textBaseline = "bottom";
  ctx.shadowColor = "rgba(0,0,0,0.55)";
  ctx.shadowBlur = size * 0.25;
  ctx.shadowOffsetY = size * 0.05;
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.fillText(text, canvas.width - pad, canvas.height - pad);
}

/** Edit › Copy Picture: the edited picture on the clipboard, ready to paste into another app. */
export async function copyPicture(id: number) {
  try {
    const canvas = await renderPicture(id, { maxEdge: 2400 });
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/png"));
    if (!blob) throw new Error("render failed");
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
  } catch (e) {
    notify(`Couldn't copy the picture: ${e}`, "error");
  }
}
