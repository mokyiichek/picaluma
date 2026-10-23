import type { Project } from "./api";
import { useStore } from "./store";

/** Projects › Make Again: reopen Collage or Movie with the same pictures and options. */
export function remakeProject(p: Project) {
  const s = useStore.getState();
  if (!p.photos.length) return;
  s.setRemake({ kind: p.kind, settings: p.settings });
  if (p.kind === "movie") s.setMovie(p.photos);
  else s.setCollage(p.photos);
}

/** The options a dialog was reopened with (once), if they are for `kind`. */
export function takeRemake<T>(kind: string): Partial<T> | null {
  const s = useStore.getState();
  const r = s.remake;
  if (!r || r.kind !== kind) return null;
  s.setRemake(null);
  try {
    return JSON.parse(r.settings) as Partial<T>;
  } catch {
    return null;
  }
}
