import { fmtShortcut, isMac, platformItem } from "../platform";
import { useEffect, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { api } from "../api";
import { selectVisible, useStore } from "../store";
import {
  addFiles,
  batchEdit,
  copyEffects,
  deletePhotos,
  deleteFolder,
  emailPhotos,
  exportHtml,
  exportPhotos,
  moveFolder,
  pasteEffects,
  printPhotos,
  renameFolder,
  renamePhoto,
  saveCopies,
  setAsDesktop,
} from "../actions";
import { copyPicture, folderIds, trayIds } from "../share";
import { checkForUpdates, openWebsite, reportProblem } from "./ShortcutsDialog";
import { confirmAsk } from "../dialogs";

export interface MenuEntry {
  label: string;
  shortcut?: string;
  action?: () => void;
  checked?: boolean;
  sep?: boolean;
  submenu?: MenuEntry[];
}

const sep: MenuEntry = { label: "", sep: true };

/** Picture › Batch Edit: one-click effects applied to every selected picture. */
const BATCH: [string, string][] = [
  ["I'm Feeling Lucky", "lucky"],
  ["Auto Contrast", "autoContrast"],
  ["Auto Color", "autoColor"],
  ["Sharpen", "sharpen"],
  ["Black & White", "bw"],
  ["Sepia", "sepia"],
  ["Warmify", "warmify"],
];

/**
 * Menus mirror Picasa 3's structure, minus its Google services (web albums, Blogger, Order
 * Prints, Google+). Entries without an action are shown disabled.
 */
function useMenus(): [string, MenuEntry[]][] {
  const s = useStore();
  const selected = [...s.selected];
  const one = s.view === "edit" && s.editId != null ? s.editId : selected.length === 1 ? selected[0] : null;
  const vis = selectVisible(s);
  const folderPhotos = vis.find((v) => v.folder.id === s.currentFolderId)?.photos ?? [];
  const currentFolder = s.currentFolderId != null && s.currentFolderId > 0 ? s.folderById.get(s.currentFolderId) : undefined;
  const targets = trayIds();
  const edited = targets.filter((id) => s.edits.has(id));

  return [
    [
      "File",
      [
        { label: "New Album...", shortcut: "Ctrl+N", action: () => s.setAlbumPicker(selected) },
        sep,
        { label: "Add Folder to Picaluma...", action: () => s.setFolderManager(true) },
        { label: "Add File to Picaluma...", shortcut: "Ctrl+O", action: addFiles },
        { label: "Import From...", shortcut: "Ctrl+M", action: () => s.setFolderManager(true) },
        sep,
        { label: "Open File in an Editor", shortcut: "Ctrl+Shift+O", action: one != null ? () => api.getPhoto(one).then((p) => api.openInDefaultApp(p.path)) : undefined },
        sep,
        { label: "Rename...", shortcut: "F2", action: one != null ? () => renamePhoto(one) : undefined },
        { label: "Save a Copy", shortcut: "Ctrl+S", action: edited.length ? () => saveCopies(edited) : undefined },
        { label: "Revert", action: edited.length ? () => edited.forEach((id) => s.setPhotoEdits(id, [])) : undefined },
        sep,
        { label: "Export Picture to Folder...", shortcut: "Ctrl+Shift+S", action: targets.length ? () => exportPhotos(targets) : undefined },
        sep,
        {
          label: "Locate on Disk",
          shortcut: "Ctrl+Enter",
          action: one != null ? () => api.getPhoto(one).then((p) => revealItemInDir(p.path)) : undefined,
        },
        { label: "Delete from Disk", shortcut: "Delete", action: selected.length ? () => deletePhotos(selected) : undefined },
        sep,
        { label: "Print...", shortcut: "Ctrl+P", action: targets.length ? () => printPhotos(targets) : undefined },
        { label: "E-Mail...", shortcut: "Ctrl+E", action: targets.length ? () => emailPhotos(targets) : undefined },
        sep,
        { label: "Exit", action: () => getCurrentWindow().close() },
      ],
    ],
    [
      "Edit",
      [
        { label: "Copy Picture", shortcut: "Ctrl+C", action: one != null ? () => copyPicture(one) : undefined },
        sep,
        { label: "Copy All Effects", action: one != null && s.edits.has(one) ? () => copyEffects(one) : undefined },
        { label: "Paste All Effects", action: s.copiedEdits && targets.length ? () => pasteEffects(selected.length ? selected : targets) : undefined },
        sep,
        { label: "Select All", shortcut: "Ctrl+A", action: folderPhotos.length ? () => s.selectOnly(folderPhotos) : undefined },
        { label: "Select Starred", action: () => s.selectOnly(folderPhotos.filter((p) => s.starred.has(p))) },
        { label: "Invert Selection", shortcut: isMac ? "Ctrl+Shift+I" : "Ctrl+I", action: () => s.selectOnly(folderPhotos.filter((p) => !s.selected.has(p))) },
        { label: "Clear Selection", shortcut: "Ctrl+D", action: s.clearSelection },
      ],
    ],
    [
      "View",
      [
        { label: "Library View", checked: s.view === "library", action: s.view === "edit" ? () => s.closeEditor() : undefined },
        { label: "Edit View", shortcut: "Ctrl+3", checked: s.view === "edit", action: one != null ? () => s.openEditor(one) : undefined },
        sep,
        { label: "Properties", checked: s.showProps && s.sidePanel === "props", action: s.toggleProps },
        { label: "Tags", shortcut: "Ctrl+T", checked: s.showProps && s.sidePanel === "tags", action: s.toggleTags },
        { label: "People", checked: s.showProps && s.sidePanel === "people", action: s.togglePeople },
        { label: "Hidden Pictures", checked: s.showHidden, action: () => s.setShowHidden(!s.showHidden) },
        sep,
        { label: "Flat Folder View", checked: s.folderView === "flat", action: () => s.setFolderView("flat") },
        { label: "Tree Folder View", checked: s.folderView === "tree", action: () => s.setFolderView("tree") },
        sep,
        { label: "Slideshow", shortcut: "Ctrl+4", action: folderPhotos.length ? () => s.startSlideshow(folderPhotos) : undefined },
        sep,
        { label: "Small Thumbnails", shortcut: "Ctrl+1", checked: s.thumbSize <= 110, action: () => s.setThumbSize(100) },
        { label: "Normal Thumbnails", shortcut: "Ctrl+2", checked: s.thumbSize > 110, action: () => s.setThumbSize(150) },
      ],
    ],
    [
      "Folder",
      [
        { label: "Edit Description...", action: currentFolder ? () => focusDescription(currentFolder.id) : undefined },
        { label: "View Slideshow", shortcut: "Ctrl+4", action: folderPhotos.length ? () => s.startSlideshow(folderPhotos) : undefined },
        sep,
        { label: "Refresh Thumbnails", action: () => api.rescan() },
        sep,
        { label: "Locate on Disk", action: currentFolder ? () => revealItemInDir(currentFolder.path) : undefined },
        {
          label: "Remove from Picaluma...",
          action: currentFolder
            ? async () => {
                if (await confirmAsk(`Remove "${currentFolder.name}" from Picaluma?\n\nThe folder and its pictures stay on disk; Picaluma just stops showing it.`, { ok: "Remove" }))
                  api.excludeFolder(currentFolder.path);
              }
            : undefined,
        },
        sep,
        { label: "Rename Folder...", action: currentFolder ? () => renameFolder(currentFolder.id) : undefined },
        { label: "Move Folder...", action: currentFolder ? () => moveFolder(currentFolder.id) : undefined },
        { label: "Delete Folder...", action: currentFolder ? () => deleteFolder(currentFolder.id) : undefined },
        sep,
        { label: "Print Contact Sheet...", shortcut: "Ctrl+Shift+P", action: folderPhotos.length ? () => printPhotos(folderIds(), "index") : undefined },
        { label: "Export as HTML Page...", action: currentFolder ? () => exportHtml(currentFolder.id) : undefined },
      ],
    ],
    [
      "Picture",
      [
        { label: "View and Edit", shortcut: "Ctrl+3", action: one != null ? () => s.openEditor(one) : undefined },
        sep,
        { label: "Rotate Clockwise", shortcut: "Ctrl+R", action: targets.length ? () => batchEdit(targets, "rotate", 90) : undefined },
        { label: "Rotate Counterclockwise", shortcut: "Ctrl+Shift+R", action: targets.length ? () => batchEdit(targets, "rotate", -90) : undefined },
        {
          label: "Batch Edit",
          submenu: BATCH.map(([label, op]) => ({ label, action: selected.length ? () => batchEdit(selected, op) : undefined })),
        },
        { label: "Undo All Edits", action: edited.length ? () => edited.forEach((id) => s.setPhotoEdits(id, [])) : undefined },
        {
          label: "Hide",
          action: targets.some((id) => !s.hidden.has(id)) ? () => api.setHidden(targets, true).then(() => (s.clearSelection(), s.loadSnapshot())) : undefined,
        },
        {
          label: "Unhide",
          action: targets.some((id) => s.hidden.has(id)) ? () => api.setHidden(targets, false).then(() => s.loadSnapshot()) : undefined,
        },
        { label: "Reset Faces", action: targets.length ? () => api.resetFaces(targets).then(() => s.loadSnapshot()) : undefined },
        sep,
        {
          label: one != null && s.starred.has(one) ? "Remove Star" : "Add Star",
          shortcut: "Ctrl+Shift+8",
          action: selected.length ? () => s.toggleStar(selected) : undefined,
        },
        sep,
        { label: "Properties", shortcut: "Alt+Enter", action: s.toggleProps },
      ],
    ],
    [
      "Create",
      [
        { label: "Picture Collage...", action: targets.length > 1 ? () => s.setCollage(targets) : undefined },
        { label: "Make a Poster...", action: one != null ? () => printPhotos([one], "poster") : undefined },
        { label: "Set as Desktop", action: one != null ? () => setAsDesktop(one) : undefined },
        sep,
        { label: "Movie (coming soon)" },
      ],
    ],
    [
      "Tools",
      [
        { label: "Folder Manager...", action: () => s.setFolderManager(true) },
        { label: "People Manager...", shortcut: "Ctrl+Shift+M", action: () => s.setPeopleManager({ tab: "unnamed" }) },
        sep,
        { label: "Rescan Library", action: () => api.rescan() },
        sep,
        { label: "Options...", action: () => s.setOptionsOpen(true) },
      ],
    ],
    [
      "Help",
      [
        { label: "Keyboard Shortcuts", action: () => s.setShortcutsOpen(true) },
        { label: "Picaluma Website", action: openWebsite },
        { label: "Report a Problem...", action: reportProblem },
        { label: "Check for Updates...", action: checkForUpdates },
        sep,
        { label: "About Picaluma", action: () => s.setAboutOpen(true) },
      ],
    ],
  ];
}

function focusDescription(folderId: number) {
  useStore.getState().selectFolder(folderId);
  setTimeout(() => (document.querySelector(`[data-desc="${folderId}"]`) as HTMLInputElement | null)?.focus(), 80);
}

export function Item({ e, close, bold }: { e: MenuEntry; close: () => void; bold?: boolean }) {
  const [sub, setSub] = useState(false);
  const p = platformItem(e.label, e.shortcut);
  const enabled = !!e.action || !!e.submenu?.some((x) => x.action);
  return (
    <div
      className={`menu-item${enabled ? "" : " disabled"}${e.checked ? " checked" : ""}${e.submenu ? " has-sub" : ""}${bold ? " bold" : ""}`}
      onMouseEnter={() => e.submenu && setSub(true)}
      onMouseLeave={() => e.submenu && setSub(false)}
      onMouseUp={() => {
        if (!e.action) return;
        close();
        e.action();
      }}
    >
      <span>{p.label}</span>
      {e.submenu ? <span className="shortcut">▸</span> : p.shortcut && <span className="shortcut">{fmtShortcut(p.shortcut)}</span>}
      {e.submenu && sub && (
        <div className="menu-drop submenu">
          {e.submenu.map((x, i) => (x.sep ? <div key={i} className="menu-sep" /> : <Item key={i} e={x} close={close} />))}
        </div>
      )}
    </div>
  );
}

export default function MenuBar() {
  const menus = useMenus();
  const [open, setOpen] = useState<string | null>(null);
  const [version, setVersion] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const titleRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    getVersion().then(setVersion).catch(() => {});
  }, []);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(null);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);

  const openEntries = menus.find(([name]) => name === open)?.[1];
  const left = open ? titleRefs.current[open]?.offsetLeft ?? 0 : 0;

  return (
    <div className="menubar" ref={ref}>
      {menus.map(([name]) => (
        <div
          key={name}
          ref={(el) => (titleRefs.current[name] = el)}
          className={`menu-title${open === name ? " open" : ""}`}
          onMouseDown={() => setOpen(open === name ? null : name)}
          onMouseEnter={() => open && setOpen(name)}
        >
          {name}
        </div>
      ))}
      <span className="brand">
        <img src="/logo.png" width={14} height={14} alt="" style={{ verticalAlign: -2, marginRight: 5 }} />
        Picaluma {version}
      </span>
      {openEntries && (
        <div className="menu-drop" style={{ left }}>
          {openEntries.map((e, i) => (e.sep ? <div key={i} className="menu-sep" /> : <Item key={i} e={e} close={() => setOpen(null)} />))}
        </div>
      )}
    </div>
  );
}
