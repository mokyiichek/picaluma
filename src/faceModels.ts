import { api } from "./api";
import { confirmAsk, notify } from "./dialogs";
import { useStore } from "./store";

const mb = (n: number) => Math.max(1, Math.round(n / 1_000_000));

/**
 * People needs the face models (39 MB), downloaded once and only if the user says yes.
 * At startup a "Not now" is remembered, so the question isn't asked every time; the People
 * section and Options › Name Tags keep a Download button.
 */
export async function offerFaceModels(atStartup = false) {
  const st = await api.faceModelsStatus();
  useStore.getState().setFaceModels(st);
  if (st.ready || st.downloading) return;
  const size = mb(st.total);
  const yes = await confirmAsk(
    `People finds the faces in your pictures and groups the ones that look alike, so you can name someone once and find them everywhere.\n\nPicaluma needs to download its face recognition models first (${size} MB, once). Faces are then found on this computer — your pictures are never uploaded.`,
    { title: "People", ok: `Download (${size} MB)`, cancel: "Not now" },
  );
  if (yes) {
    await api.setFaceModelsDeclined(false);
    await api.downloadFaceModels();
    useStore.getState().setFaceModels({ ...st, downloading: true, error: null });
  } else if (atStartup) {
    await api.setFaceModelsDeclined(true);
  }
}

/** Shown when a download fails. */
export function reportModelError(error: string | null) {
  if (error) notify(error, "error");
}

export const fmtMB = mb;
