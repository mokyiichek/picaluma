import { open } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { api, bumpPhoto } from "./api";
import { stripGps } from "./prefs";
import { aspectCache } from "./aspect";
import { parseEdits } from "./effects";
import { hasEdits, joinPath, renderJpegBase64 } from "./share";
import { selectVisible, useStore } from "./store";
import { binName } from "./platform";
import { askText, confirmAsk, notify, NO_CONFIRM_DELETE, NO_CONFIRM_REMOVE } from "./dialogs";

/** Export Picture to Folder: opens the Export dialog for these pictures. */
export function exportPhotos(ids: number[]) {
  useStore.getState().setShare({ kind: "export", ids });
}

export function emailPhotos(ids: number[]) {
  useStore.getState().setShare({ kind: "email", ids });
}

/** Print screen, optionally starting on a layout ("index" = contact sheet, "poster"). */
export function printPhotos(ids: number[], layout?: "index" | "poster") {
  const s = useStore.getState();
  const pictures = ids.filter((id) => !s.videos.has(id));
  if (!pictures.length) return void notify("Movies can't be printed. Select some pictures to print.");
  s.setPrint({ ids: pictures, layout });
}

const plural = (n: number) => `${n} picture${n === 1 ? "" : "s"}`;
const parentOf = (p: string) => p.replace(/[\\/][^\\/]*[\\/]?$/, "");

function reportFailures(failed: string[]) {
  if (failed.length) notify(`${plural(failed.length)} could not be processed:\n\n${failed.slice(0, 10).join("\n")}${failed.length > 10 ? "\n…" : ""}`);
}

/**
 * Delete key / "Delete from Disk": pictures go to the Recycle Bin (Trash on macOS).
 * With `permanent` (Shift+Del / Ctrl+Del, ⌥⌘⌫ on Mac) they are deleted outright.
 */
export async function deletePhotos(ids: number[], permanent = false): Promise<boolean> {
  if (!ids.length) return false;
  const one = ids.length === 1;
  const what = one ? "the selected picture" : `the ${ids.length} selected pictures`;
  const ok = permanent
    ? await confirmAsk(`Permanently delete ${what}?\n\nThis can't be undone: ${one ? "it" : "they"} won't go to the ${binName}.`, {
        title: "Delete Permanently",
        ok: one ? "Delete File" : "Delete Files",
        danger: true,
      })
    : await confirmAsk(`Move ${what} to the ${binName}?\n\n${one ? "It" : "They"} will also be removed from any albums.`, {
        title: one ? "Delete Picture" : "Delete Pictures",
        ok: one ? "Delete Picture" : "Delete Pictures",
        dontAskKey: NO_CONFIRM_DELETE,
      });
  if (!ok) return false;
  const s = useStore.getState();
  const res = await api.deletePhotos(ids, permanent);
  s.clearSelection();
  await s.loadSnapshot();
  reportFailures(res.failed);
  // Like Picasa: offer to tidy up a folder the delete left empty.
  for (const dir of res.emptyFolders ?? []) {
    const name = dir.split(/[\\/]/).pop();
    if (await confirmAsk(`The folder "${name}" is now empty. Delete the folder too?`, { title: "Empty Folder", ok: "Delete Folder" })) {
      await api.removeEmptyFolder(dir).catch((e) => notify(String(e), "error"));
    }
  }
  if (res.emptyFolders?.length) await s.loadSnapshot();
  return true;
}

/** Takes pictures out of an album (Delete key in album view); the files stay where they are. */
export async function removeFromAlbum(albumId: number, ids: number[]) {
  if (!ids.length) return;
  const one = ids.length === 1;
  const ok = await confirmAsk(`Remove ${one ? "the selected picture" : `the ${ids.length} selected pictures`} from this album?\n\nThe ${one ? "file stays" : "files stay"} in ${one ? "its folder" : "their folders"}.`, {
    title: "Remove from Album",
    ok: one ? "Remove Picture" : "Remove Pictures",
    dontAskKey: NO_CONFIRM_REMOVE,
  });
  if (ok) await useStore.getState().removeFromAlbum(albumId, ids);
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
  const name = await askText(`Move ${plural(ids.length)} to a new folder named:`, "New Folder", "Move");
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
  const name = await askText("Rename folder to:", f.name, "Rename");
  if (!name || name === f.name) return;
  try {
    await api.renameFolder(folderId, name);
    await useStore.getState().loadSnapshot();
  } catch (e) {
    notify(String(e), "error");
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
    notify(String(e), "error");
  }
}

export async function deleteFolder(folderId: number) {
  const f = useStore.getState().folderById.get(folderId);
  if (!f) return;
  if (!(await confirmAsk(`Delete the folder "${f.name}" and everything in it?\n\n${f.path}\n\nIt will be moved to the ${binName}.`, { ok: "Delete Folder", danger: true }))) return;
  try {
    await api.deleteFolder(folderId);
    await useStore.getState().loadSnapshot();
  } catch (e) {
    notify(String(e), "error");
  }
}

/** File › Rename (F2). */
/** File › Rename (F2): one picture by name, several with Picasa's batch rename. */
export function renamePictures(ids: number[]) {
  if (ids.length > 1) useStore.getState().setRenameIds(ids);
  else if (ids.length) renamePhoto(ids[0]);
}

export async function renamePhoto(id: number) {
  const photo = await api.getPhoto(id);
  const stem = photo.name.replace(/\.[^.]+$/, "");
  const name = await askText("Rename picture:", stem, "Rename");
  if (!name || name.trim() === stem) return;
  try {
    await api.renamePhoto(id, name.trim());
    await useStore.getState().loadSnapshot();
  } catch (e) {
    notify(String(e), "error");
  }
}

/**
 * File › Save (Ctrl+S), as in Picasa: until now the edits only live in the folder's
 * .picaluma.ini; Save writes them into the picture. The original is kept in the folder's
 * .picalumaoriginals subfolder, and File › Undo Save brings it back.
 */
export async function savePictures(ids: number[]) {
  const edited = ids.filter(hasEdits);
  if (!edited.length) return void notify("There are no edits to save. Make changes in Edit view first.");
  const what = edited.length === 1 ? "this picture" : `these ${edited.length} pictures`;
  const ok = await confirmAsk(
    `Save the changes to ${what}?\n\nThe edited picture replaces the file on disk. The original is kept in a hidden ".picalumaoriginals" folder beside it, so you can always use File › Undo Save.`,
    { title: "Save", ok: "Save" },
  );
  if (!ok) return;
  const s = useStore.getState();
  const failed: string[] = [];
  for (const id of edited) {
    try {
      await api.savePicture(id, await renderJpegBase64(id, { maxEdge: 0, quality: 0.95 }));
      bumpPhoto(id);
      aspectCache.delete(id); // a saved crop changes the picture's shape
      const edits = new Map(useStore.getState().edits);
      edits.delete(id);
      useStore.setState({ edits });
    } catch (e) {
      failed.push(String(e));
    }
  }
  await s.loadSnapshot();
  reportFailures(failed);
}

/** File › Undo Save: the saved original comes back, with its edits. */
export async function undoSave(ids: number[]) {
  const saved = await api.savedOriginals(ids);
  if (!saved.length) return void notify("These pictures haven't been saved, so there is no original to go back to.");
  const what = saved.length === 1 ? "this picture" : `these ${saved.length} pictures`;
  if (!(await confirmAsk(`Go back to the original of ${what}?\n\nThe saved version is replaced by the original, and its edits come back so you can change them.`, { title: "Undo Save", ok: "Undo Save" }))) return;
  const failed: string[] = [];
  for (const id of saved) {
    try {
      const json = await api.undoSave(id);
      bumpPhoto(id);
      aspectCache.delete(id);
      const edits = new Map(useStore.getState().edits);
      const list = parseEdits(json);
      list.length ? edits.set(id, list) : edits.delete(id);
      useStore.setState({ edits });
    } catch (e) {
      failed.push(String(e));
    }
  }
  await useStore.getState().loadSnapshot();
  reportFailures(failed);
}

/** File › Save a Copy: the edited picture as a new JPEG beside the original (which is never changed). */
export async function saveCopies(ids: number[]) {
  const edited = ids.filter(hasEdits);
  if (!edited.length) return void notify("These pictures have no edits to save. Make changes in Edit view first.");
  const failed: string[] = [];
  for (const id of edited) {
    const photo = await api.getPhoto(id);
    const dir = parentOf(photo.path);
    const base = photo.name.replace(/\.[^.]+$/, "");
    try {
      await api.exportPicture(joinPath(dir, `${base} (edited).jpg`), await renderJpegBase64(id, { maxEdge: 0, quality: 0.92 }), photo.path);
    } catch (e) {
      failed.push(`${photo.name}: ${e}`);
    }
  }
  api.rescan();
  reportFailures(failed);
}

/** Edit › Copy All Effects / Paste All Effects. */
export function copyEffects(id: number) {
  const s = useStore.getState();
  s.setCopiedEdits([...(s.edits.get(id) ?? [])]);
}

export function pasteEffects(ids: number[]) {
  const s = useStore.getState();
  const copied = s.copiedEdits;
  if (!copied) return;
  for (const id of ids) if (!s.videos.has(id)) s.setPhotoEdits(id, [...copied]);
}

/** Picture › Batch Edit: apply one effect to every selected picture. */
export function batchEdit(ids: number[], op: string, v?: number) {
  const s = useStore.getState();
  for (const id of ids) if (!s.videos.has(id)) s.setPhotoEdits(id, [...(s.edits.get(id) ?? []), v == null ? { op } : { op, v }]);
}

/** Create › Set as Desktop. */
export async function setAsDesktop(id: number) {
  try {
    await api.setWallpaper(await renderJpegBase64(id, { maxEdge: 3840, quality: 0.92 }));
  } catch (e) {
    notify(`Couldn't set the desktop picture: ${e}`, "error");
  }
}

/** File › Add File to Picaluma: watches the folders of the chosen pictures. */
export async function addFiles() {
  const picked = await open({
    multiple: true,
    title: "Add pictures to Picaluma",
    filters: [{ name: "Pictures", extensions: ["jpg", "jpeg", "png", "gif", "bmp", "webp", "tif", "tiff", "heic", "heif"] }],
  });
  const files = Array.isArray(picked) ? picked : picked ? [picked] : [];
  const dirs = [...new Set(files.map(parentOf))];
  for (const d of dirs) await api.addRoot(d);
  if (dirs.length) api.rescan();
}

/** Folder › Export as HTML Page: a self-contained web gallery (index.html, pictures and thumbnails). */
export async function exportHtml(folderId: number) {
  const s = useStore.getState();
  const vis = selectVisible(s).find((v) => v.folder.id === folderId);
  const folder = s.folderById.get(folderId);
  if (!vis || !folder) return;
  const location = await open({ directory: true, title: `Export "${folder.name}" as a web page to…` });
  if (typeof location !== "string") return;
  const dir = await api.makeExportDir(location, folder.name);
  const items: string[] = [];
  const failed: string[] = [];
  for (const id of vis.photos) {
    const photo = await api.getPhoto(id);
    try {
      const big = await api.exportPicture(joinPath(joinPath(dir, "images"), photo.name.replace(/\.[^.]+$/, ".jpg")), await renderJpegBase64(id, { maxEdge: 1600, quality: 0.85 }), photo.path, stripGps());
      const small = await api.exportPicture(joinPath(joinPath(dir, "thumbnails"), photo.name.replace(/\.[^.]+$/, ".jpg")), await renderJpegBase64(id, { maxEdge: 360, quality: 0.8 }));
      const rel = (p: string) => p.slice(dir.length + 1).replace(/\\/g, "/");
      const cap = escapeHtml(photo.caption || photo.name);
      items.push(`<a href="${encodeURI(rel(big))}" title="${cap}"><img src="${encodeURI(rel(small))}" alt="${cap}" loading="lazy"><span>${cap}</span></a>`);
    } catch (e) {
      failed.push(`${photo.name}: ${e}`);
    }
  }
  const title = escapeHtml(folder.name);
  const desc = folder.description ? `<p>${escapeHtml(folder.description)}</p>` : "";
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
body{margin:0;font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;background:#f4f4f4;color:#222}
header{padding:28px 24px 8px;max-width:1200px;margin:auto}h1{margin:0;font:400 30px Georgia,serif}
main{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:18px;padding:16px 24px 40px;max-width:1200px;margin:auto}
a{display:flex;flex-direction:column;align-items:center;text-decoration:none;color:#555;font-size:13px}
img{max-width:100%;height:180px;object-fit:contain;box-shadow:0 2px 8px rgba(0,0,0,.25);background:#fff}
span{margin-top:6px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
footer{text-align:center;color:#999;font-size:12px;padding:0 0 24px}
</style></head><body>
<header><h1>${title}</h1>${desc}<p>${items.length} pictures</p></header>
<main>
${items.join("\n")}
</main>
<footer>Made with Picaluma</footer>
</body></html>
`;
  const index = joinPath(dir, "index.html");
  await api.writeTextFile(index, html);
  reportFailures(failed);
  revealItemInDir(index).catch(() => {});
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
