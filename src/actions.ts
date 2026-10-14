import { open } from "@tauri-apps/plugin-dialog";
import { api, photoUrl } from "./api";
import { renderToCanvas } from "./effects";
import { useStore } from "./store";

/** Export Picture to Folder: renders each photo with its edits applied and writes a JPEG copy. */
export async function exportPhotos(ids: number[]) {
  const dir = await open({ directory: true, title: "Export pictures to folder" });
  if (!dir || Array.isArray(dir)) return;
  const edits = useStore.getState().edits;
  let done = 0;
  for (const id of ids) {
    const photo = await api.getPhoto(id);
    const canvas = await renderToCanvas(photoUrl(id), edits.get(id) ?? []);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
    const base = photo.name.replace(/\.[^.]+$/, "");
    const sep = dir.includes("/") ? "/" : "\\";
    await api.exportPicture(`${dir.replace(/[\\/]$/, "")}${sep}${base}.jpg`, dataUrl.slice(dataUrl.indexOf(",") + 1));
    done++;
  }
  alert(`Exported ${done} picture${done === 1 ? "" : "s"} to ${dir}`);
}
