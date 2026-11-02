import { CSSProperties, useEffect, useRef, useState } from "react";
import { thumbUrl } from "./api";
import { canvasFilters, cropViewBox, Edit, render, renderToCanvas } from "./effects";
import { hasPixelOps } from "./pixelfx";
import { useStore } from "./store";

// Thumbnails of pictures with effects CSS can't show exactly (auto fixes, tuning, Tint, Retouch,
// Straighten, Vignette…) are rendered with the same code as exports. Two at a time, cached (most
// recent 400) for the session.

const cache = new Map<string, string>();
const failed = new Set<string>();
const waiting: (() => Promise<void>)[] = [];
let running = 0;
const LIMIT = 400;

function pump() {
  while (running < 2 && waiting.length) {
    const job = waiting.shift()!;
    running++;
    job().finally(() => {
      running--;
      pump();
    });
  }
}

function remember(key: string, url: string) {
  cache.set(key, url);
  if (cache.size > LIMIT) {
    const [oldKey, oldUrl] = cache.entries().next().value as [string, string];
    cache.delete(oldKey);
    URL.revokeObjectURL(oldUrl);
  }
}

const keyOf = (id: number, edits: Edit[]) => `${id}:${JSON.stringify(edits)}`;

function needsRender(edits: Edit[]) {
  if (hasPixelOps(edits)) return true;
  const r = render(edits);
  return r.straighten !== 0 || r.vignette > 0 || r.overlays.length > 0;
}

/**
 * The thumbnail with its edits baked in. `url` is null while rendering (the previous rendering stays
 * up until the new one is ready) or when CSS is exact; `waiting` means nothing has been shown yet,
 * so the untouched picture must not appear first. `force`: render even when CSS would do.
 */
export function useEditedThumb(id: number, edits: Edit[] | undefined, force = false): { url: string | null; waiting: boolean } {
  const key = edits?.length && (force || needsRender(edits)) ? keyOf(id, edits) : "";
  const [, redraw] = useState(0);
  const last = useRef<{ id: number; url: string } | null>(null);
  // The picture is already on screen with CSS: it stays up until the rendering replaces it.
  const plain = useRef<number | null>(key ? null : id);
  if (!key) {
    plain.current = id;
    last.current = null;
  }
  const hit = key ? cache.get(key) : undefined;
  if (hit) last.current = { id, url: hit };
  useEffect(() => {
    if (!key || cache.has(key) || failed.has(key)) return;
    let live = true;
    waiting.push(async () => {
      if (!live) return;
      try {
        if (!cache.has(key)) {
          const canvas = await renderToCanvas(thumbUrl(id), edits!, 0);
          const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/jpeg", 0.88));
          canvas.width = 0;
          if (!blob) throw new Error("no image");
          if (!cache.has(key)) remember(key, URL.createObjectURL(blob));
        }
      } catch {
        failed.add(key); // keep the CSS approximation
      }
      if (live) redraw((n) => n + 1);
    });
    pump();
    return () => {
      live = false;
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const url = hit ?? (last.current?.id === id ? last.current.url : null);
  return { url, waiting: !!key && !url && plain.current !== id && !failed.has(key) };
}

/** What an <img> needs to show a picture's thumbnail as edited. */
export function useThumbImage(id: number): { src: string | undefined; style: CSSProperties | undefined; baked: boolean; waiting: boolean } {
  const edits = useStore((s) => s.edits.get(id));
  const { url, waiting: pending } = useEditedThumb(id, edits);
  if (url) {
    const filter = canvasFilters || !edits ? "" : render(edits, true).filter;
    return { src: url, style: filter ? { filter } : undefined, baked: true, waiting: false };
  }
  if (pending) return { src: undefined, style: undefined, baked: false, waiting: true };
  const r = edits ? render(edits) : null;
  const style = r
    ? ({
        filter: r.filter || undefined,
        transform: r.rotate ? `rotate(${r.rotate}deg)` : undefined,
        objectViewBox: cropViewBox(r.crop),
      } as CSSProperties)
    : undefined;
  return { src: thumbUrl(id), style, baked: false, waiting: false };
}

/** What the picture flies back to the grid as; null when its rendering isn't ready yet. */
export function flightThumb(id: number, edits: Edit[]): { src: string; filter: string } | null {
  const hit = cache.get(keyOf(id, edits));
  if (hit) return { src: hit, filter: canvasFilters ? "" : render(edits, true).filter };
  const r = render(edits);
  if (r.rotate || needsRender(edits)) return null;
  return { src: thumbUrl(id), filter: r.filter };
}
