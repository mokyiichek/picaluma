import { isMac } from "../platform";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { api } from "../api";
import { Edit } from "../effects";
import { isPersonId, PERSON_BASE, selectVisible, useStore } from "../store";
import { Item, MenuEntry } from "./MenuBar";
import {
  copyEffects,
  deleteFolder,
  deletePhotos,
  emailPhotos,
  exportHtml,
  exportPhotos,
  moveFolder,
  moveToNewFolder,
  pasteEffects,
  printPhotos,
  removeFromAlbum,
  renameFolder,
  renamePhoto,
  setAsDesktop,
  transferPhotos,
} from "../actions";
import { copyPicture } from "../share";
import { askText, confirmAsk } from "../dialogs";

const sep: MenuEntry = { label: "", sep: true };

/** Folder › Sort Folder By / Album › Sort Album By. `id` < 0 is an album; the order is kept per folder. */
function sortEntry(id: number, current: string): MenuEntry {
  const album = id < 0;
  const opts: [string, string][] = [
    ...(album ? ([["Order Added", ""]] as [string, string][]) : []),
    ["Date Taken", album ? "date" : ""],
    ["Recent Changes", "modified"],
    ["Size", "size"],
    ["Name", "name"],
  ];
  return {
    label: album ? "Sort Album By" : "Sort Folder By",
    submenu: opts.map(([label, sort]) => ({
      label,
      checked: current === sort,
      action: () => api.setSort(id, sort).then(() => useStore.getState().loadSnapshot()),
    })),
  };
}

export function rotateSelected(deg: number) {
  const s = useStore.getState();
  for (const id of s.selected) {
    if (s.videos.has(id)) continue;
    const list: Edit[] = [...(s.edits.get(id) ?? []), { op: "rotate", v: deg }];
    s.setPhotoEdits(id, list);
  }
}

/** Right-click menus for photos and folders, mirroring Picasa's entries. */
export default function ContextMenu() {
  const menu = useStore((s) => s.contextMenu);
  const close = () => useStore.getState().openContextMenu(null);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && close();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", close);
    };
  }, [menu]);

  // Keep the menu on screen.
  useLayoutEffect(() => {
    if (!menu || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setPos({ x: Math.min(menu.x, window.innerWidth - r.width - 4), y: Math.min(menu.y, window.innerHeight - r.height - 4) });
  }, [menu]);

  if (!menu) return null;
  const personId = menu.kind === "person" ? menu.personId! : menu.kind === "folder" && isPersonId(menu.folderId!) ? PERSON_BASE - menu.folderId! : null;
  const albumId = menu.kind === "album" ? menu.albumId! : menu.kind === "folder" && menu.folderId! < 0 && personId == null ? -menu.folderId! : null;
  const entries =
    menu.kind === "photo" ? photoEntries() : personId != null ? personEntries(personId) : albumId != null ? albumEntries(albumId) : folderEntries(menu.folderId!);

  return (
    <div className="menu-drop context" ref={ref} style={{ left: pos.x, top: pos.y, position: "fixed" }}>
      {entries.map((e, i) => (e.sep ? <div key={i} className="menu-sep" /> : <Item key={i} e={e} close={close} bold={i === 0} />))}
    </div>
  );
}

function photoEntries(): MenuEntry[] {
  const s = useStore.getState();
  const ids = [...s.selected];
  const one = ids.length === 1 ? ids[0] : null;
  const withPath = (fn: (path: string) => void) => (one != null ? () => api.getPhoto(one).then((p) => fn(p.path)) : undefined);
  return [
    { label: "View and Edit", shortcut: "Enter", action: one != null ? () => s.openEditor(one) : undefined },
    { label: "Add to Album...", action: ids.length ? () => s.setAlbumPicker(ids) : undefined },
    ...(s.albumView != null
      ? [{ label: "Remove from Album", shortcut: "Delete", action: () => removeFromAlbum(s.albumView!, ids) } as MenuEntry]
      : []),
    sep,
    { label: "Rotate Clockwise", shortcut: "Ctrl+R", action: () => rotateSelected(90) },
    { label: "Rotate Counterclockwise", shortcut: "Ctrl+Shift+R", action: () => rotateSelected(-90) },
    sep,
    { label: "Copy All Effects", action: one != null && s.edits.has(one) ? () => copyEffects(one) : undefined },
    { label: "Paste All Effects", action: s.copiedEdits ? () => pasteEffects(ids) : undefined },
    { label: "Undo all Edits", action: ids.some((id) => s.edits.has(id)) ? () => ids.forEach((id) => s.setPhotoEdits(id, [])) : undefined },
    sep,
    { label: ids.every((id) => s.starred.has(id)) ? "Remove Star" : "Add Star", shortcut: "Ctrl+Shift+8", action: () => s.toggleStar(ids) },
    ids.some((id) => s.hidden.has(id))
      ? { label: "Unhide", action: () => api.setHidden(ids, false).then(() => s.loadSnapshot()) }
      : { label: "Hide", action: ids.length ? () => api.setHidden(ids, true).then(() => (s.clearSelection(), s.loadSnapshot())) : undefined },
    sep,
    { label: "Move to Folder...", action: ids.length ? () => transferPhotos(ids, false) : undefined },
    { label: "Copy to Folder...", action: ids.length ? () => transferPhotos(ids, true) : undefined },
    { label: "Move to New Folder...", action: ids.length ? () => moveToNewFolder(ids) : undefined },
    sep,
    { label: "Rename...", shortcut: "F2", action: one != null ? () => renamePhoto(one) : undefined },
    { label: "Open File", shortcut: "Ctrl+Shift+O", action: withPath((p) => api.openInDefaultApp(p)) },
    { label: "Copy Picture", shortcut: "Ctrl+C", action: one != null ? () => copyPicture(one) : undefined },
    { label: "Set as Desktop", action: one != null ? () => setAsDesktop(one) : undefined },
    sep,
    { label: "Print...", shortcut: "Ctrl+P", action: ids.length ? () => printPhotos(ids) : undefined },
    { label: "E-Mail...", shortcut: "Ctrl+E", action: ids.length ? () => emailPhotos(ids) : undefined },
    { label: "Export Picture to Folder...", shortcut: "Ctrl+Shift+S", action: ids.length ? () => exportPhotos(ids) : undefined },
    sep,
    { label: "Locate on Disk", shortcut: "Ctrl+Enter", action: withPath((p) => revealItemInDir(p)) },
    { label: "Delete from Disk", shortcut: isMac ? "Ctrl+Delete" : "Delete", action: ids.length ? () => deletePhotos(ids) : undefined },
    { label: "Delete Permanently", shortcut: isMac ? "Alt+Ctrl+Delete" : "Shift+Delete", action: ids.length ? () => deletePhotos(ids, true) : undefined },
    { label: "Copy Full Path", action: withPath((p) => navigator.clipboard.writeText(p)) },
    sep,
    { label: "Tags...", shortcut: "Ctrl+T", action: () => !(s.showProps && s.sidePanel === "tags") && s.toggleTags() },
    { label: "People in Picture...", action: one != null ? () => !(s.showProps && s.sidePanel === "people") && s.togglePeople() : undefined },
    ...(s.personView != null
      ? [
          {
            label: "Make This the Person's Picture",
            action:
              s.personView != null && one != null
                ? () =>
                    api.facesInPhoto(one).then(async (faces) => {
                      const f = faces.find((x) => x.personId === s.personView && x.state === 1);
                      if (f) {
                        await api.setPersonCover(s.personView!, f.id);
                        await s.loadSnapshot();
                      }
                    })
                : undefined,
          },
        ]
      : []),
    { label: "Properties", shortcut: "Alt+Enter", action: () => !(s.showProps && s.sidePanel === "props") && s.toggleProps() },
  ];
}

function albumEntries(albumId: number): MenuEntry[] {
  const s = useStore.getState();
  const album = s.snapshot?.albums.find((a) => a.id === albumId);
  if (!album) return [];
  return [
    { label: "View Album", action: () => s.openAlbum(albumId) },
    { label: "View Slideshow", shortcut: "Ctrl+4", action: album.photos.length ? () => s.startSlideshow(album.photos) : undefined },
    sortEntry(-albumId, album.sort ?? ""),
    sep,
    {
      label: "Rename Album...",
      action: async () => {
        const n = await askText("Album name:", album.name, "Rename");
        if (n && n !== album.name) s.renameAlbum(albumId, n);
      },
    },
    {
      label: "Delete Album",
      action: async () => {
        if (await confirmAsk(`Delete the album "${album.name}"?\n\nOnly the album is removed — the pictures stay in their folders.`, { ok: "Delete Album" })) s.deleteAlbum(albumId);
      },
    },
  ];
}

/** Right-click on a person in the People section. */
function personEntries(personId: number): MenuEntry[] {
  const s = useStore.getState();
  const p = s.snapshot?.people?.find((x) => x.id === personId);
  if (!p) return [];
  return [
    { label: "View Person", action: () => s.openPerson(personId) },
    { label: "View Slideshow", shortcut: "Ctrl+4", action: p.photos.length ? () => s.startSlideshow(p.photos) : undefined },
    { label: `Review Suggestions (${p.suggestions})`, action: p.suggestions ? () => s.setPeopleManager({ tab: "suggestions", person: personId }) : undefined },
    sep,
    {
      label: "Rename Person...",
      action: async () => {
        const n = await askText("Name:", p.name, "Rename");
        if (n && n.trim() && n !== p.name) {
          const id = await api.renamePerson(personId, n);
          await s.loadSnapshot();
          if (s.personView === personId) useStore.getState().openPerson(id);
        }
      },
    },
    {
      label: "Delete Person...",
      action: async () => {
        if (
          await confirmAsk(`Remove the name "${p.name}" from ${p.photos.length.toLocaleString()} pictures?

The pictures stay where they are; only the name tags are removed.`, {
            ok: "Delete Person",
          })
        ) {
          await api.deletePerson(personId);
          if (useStore.getState().personView === personId) useStore.getState().openPerson(null);
          await s.loadSnapshot();
        }
      },
    },
    sep,
    { label: "Print Contact Sheet...", action: p.photos.length ? () => printPhotos(p.photos, "index") : undefined },
    { label: "Export Pictures...", action: p.photos.length ? () => exportPhotos(p.photos) : undefined },
  ];
}

function folderEntries(folderId: number): MenuEntry[] {
  const s = useStore.getState();
  const folder = s.folderById.get(folderId);
  const photos = selectVisible(s).find((v) => v.folder.id === folderId)?.photos ?? [];
  return [
    {
      label: "Edit Folder Description...",
      action: () => {
        s.selectFolder(folderId);
        setTimeout(() => (document.querySelector(`[data-desc="${folderId}"]`) as HTMLInputElement | null)?.focus(), 80);
      },
    },
    sep,
    { label: "Select All Pictures", shortcut: "Ctrl+A", action: () => s.selectOnly(photos) },
    { label: "Clear Selection", shortcut: "Ctrl+D", action: s.clearSelection },
    { label: "Invert Selection", shortcut: isMac ? "Ctrl+Shift+I" : "Ctrl+I", action: () => s.selectOnly(photos.filter((p) => !s.selected.has(p))) },
    sep,
    { label: "View Slideshow", shortcut: "Ctrl+4", action: () => s.startSlideshow(photos) },
    ...(folder ? [sortEntry(folderId, folder.sort ?? "")] : []),
    { label: "Refresh Thumbnails", action: () => api.rescan() },
    { label: "Picture Collage...", action: photos.length > 1 ? () => s.setCollage(photos) : undefined },
    sep,
    { label: "Locate on Disk", shortcut: "Ctrl+Enter", action: folder ? () => revealItemInDir(folder.path) : undefined },
    {
      label: "Remove from Picaluma...",
      action: folder
        ? async () => {
            if (await confirmAsk(`Remove "${folder.name}" from Picaluma?\n\nThe folder and its pictures stay on disk; Picaluma just stops showing it.`, { ok: "Remove" })) api.excludeFolder(folder.path);
          }
        : undefined,
    },
    sep,
    { label: "Rename Folder...", action: folder ? () => renameFolder(folderId) : undefined },
    { label: "Move Folder...", action: folder ? () => moveFolder(folderId) : undefined },
    { label: "Delete Folder...", action: folder ? () => deleteFolder(folderId) : undefined },
    sep,
    { label: "Print Contact Sheet...", shortcut: "Ctrl+Shift+P", action: photos.length ? () => printPhotos(photos, "index") : undefined },
    { label: "Export Folder to...", action: photos.length ? () => exportPhotos(photos) : undefined },
    { label: "Export as HTML Page...", action: folder ? () => exportHtml(folderId) : undefined },
  ];
}
