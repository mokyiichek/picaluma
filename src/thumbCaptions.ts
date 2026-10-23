import { useEffect, useState } from "react";
import { api } from "./api";
import { useStore } from "./store";

// View › Thumbnail Caption: text under each thumbnail, fetched in batches for the thumbnails on
// screen and cached until the library changes.

export type CaptionKind = "none" | "filename" | "caption" | "tags" | "resolution";

const cache = new Map<string, string>();
const waiting = new Map<number, Set<(t: string) => void>>();
let timer: number | undefined;
let lastSnapshot: unknown = null;

function flush(kind: CaptionKind) {
  const ids = [...waiting.keys()];
  const subs = new Map(waiting);
  waiting.clear();
  api
    .photoLabels(ids, kind)
    .then((rows) => {
      const got = new Map(rows);
      for (const id of ids) {
        const text = got.get(id) ?? "";
        cache.set(`${kind}:${id}`, text);
        subs.get(id)?.forEach((f) => f(text));
      }
    })
    .catch(() => {});
}

export function useThumbCaption(id: number): string | null {
  const kind = useStore((s) => s.thumbCaption);
  const snapshot = useStore((s) => s.snapshot);
  const key = `${kind}:${id}`;
  const [text, setText] = useState<string | null>(() => (kind === "none" ? null : cache.get(key) ?? null));
  useEffect(() => {
    if (snapshot !== lastSnapshot) {
      // Captions, tags and names can change with any library update.
      lastSnapshot = snapshot;
      cache.clear();
    }
    if (kind === "none") return setText(null);
    const hit = cache.get(key);
    if (hit != null) return setText(hit);
    let live = true;
    const set = waiting.get(id) ?? new Set();
    const cb = (t: string) => live && setText(t);
    set.add(cb);
    waiting.set(id, set);
    clearTimeout(timer);
    timer = window.setTimeout(() => flush(kind), 30);
    return () => {
      live = false;
      waiting.get(id)?.delete(cb);
    };
  }, [key, snapshot]); // eslint-disable-line react-hooks/exhaustive-deps
  return kind === "none" ? null : text;
}
