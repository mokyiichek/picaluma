import { useEffect, useState } from "react";
import { thumbUrl } from "./api";
import { Edit, renderToCanvas } from "./effects";
import { hasPixelOps } from "./pixelfx";

// Grid thumbnails of pictures with pixel effects (auto fixes, tuning, Tint, Retouch…): CSS can
// only approximate those, so the thumbnail is rendered with the same code as exports. Two at a
// time, cached (most recent 400) for the session.

const cache = new Map<string, string>();
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

/** The thumbnail with its edits baked in, or null while rendering / when CSS is exact. */
export function useEditedThumb(id: number, edits: Edit[] | undefined): string | null {
  const key = edits && hasPixelOps(edits) ? `${id}:${JSON.stringify(edits)}` : "";
  const [url, setUrl] = useState<string | null>(() => (key ? cache.get(key) ?? null : null));
  useEffect(() => {
    if (!key) return setUrl(null);
    const hit = cache.get(key);
    if (hit) return setUrl(hit);
    setUrl(null);
    let live = true;
    waiting.push(async () => {
      if (!live) return;
      try {
        const canvas = await renderToCanvas(thumbUrl(id), edits!, 0);
        const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/jpeg", 0.88));
        canvas.width = 0;
        if (!blob) return;
        const u = URL.createObjectURL(blob);
        remember(key, u);
        if (live) setUrl(u);
      } catch {
        /* keep the CSS approximation */
      }
    });
    pump();
    return () => {
      live = false;
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return url;
}
