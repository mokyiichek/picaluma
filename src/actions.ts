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

const plural = (n: number) => `${n} picture${n === 1 ? "" : "s"}`;
const joinPath = (dir: string, name: string) => {
  const sep = dir.includes("\\") ? "\\" : "/";
  return `${dir.replace(/[\\/]$/, "")}${sep}${name}`;
};
const parentOf = (p: string) => p.replace(/[\\/][^\\/]*[\\/]?$/, "");

function reportFailures(failed: string[]) {
  if (failed.length) alert(`${plural(failed.length)} could not be processed:\n\n${failed.slice(0, 10).join("\n")}${failed.length > 10 ? "\n…" : ""}`);
}

/** Delete key / "Delete from Disk": pictures go to the Recycle Bin (Trash on macOS). */
export async function deletePhotos(ids: number[]) {
  if (!ids.length) return;
  const bin = navigator.userAgent.includes("Mac") ? "Trash" : "Recycle Bin";
  if (!confirm(`Delete ${plural(ids.length)} from disk?\n\nThey will be moved to the ${bin}.`)) return;
  const s = useStore.getState();
  const res = await api.deletePhotos(ids);
  s.clearSelection();
  await s.loadSnapshot();
  reportFailures(res.failed);
}

/** "Move to Folder…" / "Copy to Folder…": pick a destination folder. */
export async function transferPhotos(ids: number[], copy: boolean) {
  if (!ids.length) return;
  const dest = await open({ directory: true, title: `${copy ? "Copy" : "Move"} ${plural(ids.length)} to folder` });
  if (!dest || Array.isArray(dest)) return;
  const res = await api.transferPhotos(ids, dest, copy);
  await useStore.getState().loadSnapshot();
  reportFailures(res.failed);
}

/** "Move to New Folder…": a new folder next to the pictures' current folder. */
export async function moveToNewFolder(ids: number[]) {
  if (!ids.length) return;
  const name = prompt(`Move ${plural(ids.length)} to a new folder named:`, "New Folder")?.trim();
  if (!name) return;
  const first = await api.getPhoto(ids[0]);
  const dest = joinPath(parentOf(parentOf(first.path)), name);
  const res = await api.transferPhotos(ids, dest, false);
  await useStore.getState().loadSnapshot();
  reportFailures(res.failed);
}

export async function renameFolder(folderId: number) {
  const f = useStore.getState().folderById.get(folderId);
  if (!f) return;
  const name = prompt("Rename folder to:", f.name)?.trim();
  if (!name || name === f.name) return;
  try {
    await api.renameFolder(folderId, name);
    await useStore.getState().loadSnapshot();
  } catch (e) {
    alert(String(e));
  }
}

export async function moveFolder(folderId: number) {
  const f = useStore.getState().folderById.get(folderId);
  if (!f) return;
  const dest = await open({ directory: true, title: `Move "${f.name}" into…` });
  if (!dest || Array.isArray(dest)) return;
  try {
    await api.moveFolder(folderId, dest);
    await useStore.getState().loadSnapshot();
  } catch (e) {
    alert(String(e));
  }
}

export async function deleteFolder(folderId: number) {
  const f = useStore.getState().folderById.get(folderId);
  if (!f) return;
  const bin = navigator.userAgent.includes("Mac") ? "Trash" : "Recycle Bin";
  if (!confirm(`Delete the folder "${f.name}" and everything in it?\n\n${f.path}\n\nIt will be moved to the ${bin}.`)) return;
  try {
    await api.deleteFolder(folderId);
    await useStore.getState().loadSnapshot();
  } catch (e) {
    alert(String(e));
  }
}
