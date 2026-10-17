import { fmtShortcut, isMac, platformItem } from "../platform";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { api } from "../api";
import { Edit } from "../effects";
import { selectVisible, useStore } from "../store";
import { MenuEntry } from "./MenuBar";
import { deleteFolder, deletePhotos, moveFolder, moveToNewFolder, renameFolder, transferPhotos } from "../actions";

const sep: MenuEntry = { label: "", sep: true };

export function rotateSelected(deg: number) {
  const s = useStore.getState();
  for (const id of s.selected) {
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
  const albumId = menu.kind === "album" ? menu.albumId! : menu.kind === "folder" && menu.folderId! < 0 ? -menu.folderId! : null;
  const entries = menu.kind === "photo" ? photoEntries() : albumId != null ? albumEntries(albumId) : folderEntries(menu.folderId!);

  return (
    <div className="menu-drop context" ref={ref} style={{ left: pos.x, top: pos.y, position: "fixed" }}>
      {entries.map((e, i) =>
        e.sep ? (
          <div key={i} className="menu-sep" />
        ) : (
          <div
            key={i}
            className={`menu-item${e.action ? "" : " disabled"}${i === 0 ? " bold" : ""}`}
            onMouseUp={() => {
              if (!e.action) return;
              close();
              e.action();
            }}
          >
            <span>{platformItem(e.label).label}</span>
            {platformItem(e.label, e.shortcut).shortcut && <span className="shortcut">{fmtShortcut(platformItem(e.label, e.shortcut).shortcut!)}</span>}
          </div>
        ),
      )}
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
      ? [{ label: "Remove from Album", action: () => s.removeFromAlbum(s.albumView!, ids) } as MenuEntry]
      : []),
    sep,
    { label: "Rotate Clockwise", shortcut: "Ctrl+R", action: () => rotateSelected(90) },
    { label: "Rotate Counterclockwise", shortcut: "Ctrl+Shift+R", action: () => rotateSelected(-90) },
    sep,
    { label: "Undo all Edits", action: ids.some((id) => s.edits.has(id)) ? () => ids.forEach((id) => s.setPhotoEdits(id, [])) : undefined },
    sep,
    { label: ids.every((id) => s.starred.has(id)) ? "Remove Star" : "Add Star", shortcut: "Ctrl+Shift+8", action: () => s.toggleStar(ids) },
    { label: "Hide" },
    sep,
    { label: "Move to Folder...", action: ids.length ? () => transferPhotos(ids, false) : undefined },
    { label: "Copy to Folder...", action: ids.length ? () => transferPhotos(ids, true) : undefined },
    { label: "Move to New Folder...", action: ids.length ? () => moveToNewFolder(ids) : undefined },
    sep,
    { label: "Open File", shortcut: "Ctrl+Shift+O", action: withPath((p) => api.openInDefaultApp(p)) },
    { label: "Open With" },
    sep,
    { label: "Locate on Disk", shortcut: "Ctrl+Enter", action: withPath((p) => revealItemInDir(p)) },
    { label: "Delete from Disk", shortcut: isMac ? "Ctrl+Delete" : "Delete", action: ids.length ? () => deletePhotos(ids) : undefined },
    { label: "Delete Permanently", shortcut: isMac ? "Alt+Ctrl+Delete" : "Shift+Delete", action: ids.length ? () => deletePhotos(ids, true) : undefined },
    { label: "Copy Full Path", action: withPath((p) => navigator.clipboard.writeText(p)) },
    sep,
    { label: "Tags...", shortcut: "Ctrl+T", action: () => !(s.showProps && s.sidePanel === "tags") && s.toggleTags() },
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
    sep,
    {
      label: "Rename Album...",
      action: () => {
        const n = prompt("Album name:", album.name);
        if (n && n.trim() && n.trim() !== album.name) s.renameAlbum(albumId, n.trim());
      },
    },
    {
      label: "Delete Album",
      action: () => {
        if (confirm(`Delete the album "${album.name}"?\n\nOnly the album is removed — the pictures stay in their folders.`)) s.deleteAlbum(albumId);
      },
    },
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
    { label: "Invert Selection", shortcut: "Ctrl+I", action: () => s.selectOnly(photos.filter((p) => !s.selected.has(p))) },
    sep,
    { label: "View Slideshow", shortcut: "Ctrl+4", action: () => s.startSlideshow(photos) },
    { label: "Refresh Thumbnails", action: () => api.rescan() },
    { label: "Sort Folder By" },
    sep,
    { label: "Hide Folder" },
    sep,
    { label: "Locate on Disk", shortcut: "Ctrl+Enter", action: folder ? () => revealItemInDir(folder.path) : undefined },
    {
      label: "Remove from Picaluma...",
      action: folder
        ? () => {
            if (confirm(`Remove "${folder.name}" from Picaluma?\n\nThe folder and its pictures stay on disk; Picaluma just stops showing it.`)) api.excludeFolder(folder.path);
          }
        : undefined,
    },
    sep,
    { label: "Rename Folder...", action: folder ? () => renameFolder(folderId) : undefined },
    { label: "Move Folder...", action: folder ? () => moveFolder(folderId) : undefined },
    { label: "Delete Folder...", action: folder ? () => deleteFolder(folderId) : undefined },
    sep,
    { label: "Export as HTML Page..." },
  ];
}
