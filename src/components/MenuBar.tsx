import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { api } from "../api";
import { selectVisible, useStore } from "../store";
import { exportPhotos } from "../actions";

export interface MenuEntry {
  label: string;
  shortcut?: string;
  action?: () => void;
  checked?: boolean;
  sep?: boolean;
}

const sep: MenuEntry = { label: "", sep: true };

/** Menus mirror Picasa 3's structure; entries without an action are shown disabled. */
function useMenus(): [string, MenuEntry[]][] {
  const s = useStore();
  const selected = [...s.selected];
  const one = selected.length === 1 ? selected[0] : null;
  const vis = selectVisible(s);
  const folderPhotos = vis.find((v) => v.folder.id === s.currentFolderId)?.photos ?? [];
  const currentFolder = s.currentFolderId != null ? s.folderById.get(s.currentFolderId) : undefined;

  return [
    [
      "File",
      [
        { label: "New Album...", shortcut: "Ctrl+N" },
        sep,
        { label: "Add Folder to Picaluma...", action: () => s.setFolderManager(true) },
        { label: "Add File to Picaluma...", shortcut: "Ctrl+O" },
        { label: "Import From...", shortcut: "Ctrl+M", action: () => s.setFolderManager(true) },
        sep,
        { label: "Open File(s) in an Editor", shortcut: "Ctrl+Shift+O" },
        sep,
        { label: "Rename...", shortcut: "F2" },
        { label: "Save", shortcut: "Ctrl+S" },
        { label: "Revert" },
        sep,
        { label: "Export Picture to Folder...", shortcut: "Ctrl+Shift+S", action: selected.length ? () => exportPhotos(selected) : undefined },
        sep,
        {
          label: "Locate on Disk",
          shortcut: "Ctrl+Enter",
          action: one != null ? () => api.getPhoto(one).then((p) => revealItemInDir(p.path)) : undefined,
        },
        { label: "Delete from Disk", shortcut: "Delete" },
        sep,
        { label: "Print...", shortcut: "Ctrl+P" },
        { label: "E-Mail...", shortcut: "Ctrl+E" },
        sep,
        { label: "Exit", action: () => getCurrentWindow().close() },
      ],
    ],
    [
      "Edit",
      [
        { label: "Cut", shortcut: "Ctrl+X" },
        { label: "Copy", shortcut: "Ctrl+C" },
        { label: "Paste", shortcut: "Ctrl+V" },
        sep,
        { label: "Copy All Effects" },
        { label: "Paste All Effects" },
        sep,
        { label: "Select All", shortcut: "Ctrl+A", action: folderPhotos.length ? () => s.selectOnly(folderPhotos) : undefined },
        {
          label: "Select Starred",
          action: () => s.selectOnly(folderPhotos.filter((p) => s.starred.has(p))),
        },
        {
          label: "Invert Selection",
          shortcut: "Ctrl+I",
          action: () => s.selectOnly(folderPhotos.filter((p) => !s.selected.has(p))),
        },
        { label: "Clear Selection", shortcut: "Ctrl+D", action: s.clearSelection },
      ],
    ],
    [
      "View",
      [
        { label: "Library View", checked: s.view === "library", action: s.view === "edit" ? () => s.closeEditor() : undefined },
        { label: "Edit View", shortcut: "Ctrl+3", checked: s.view === "edit", action: one != null ? () => s.openEditor(one) : undefined },
        sep,
        { label: "Properties", checked: s.showProps, action: s.toggleProps },
        { label: "Tags", shortcut: "Ctrl+T" },
        { label: "People" , action: () => s.setLeftSection("people") },
        { label: "Places" },
        sep,
        { label: "Slideshow", shortcut: "Ctrl+4", action: folderPhotos.length ? () => s.startSlideshow(folderPhotos) : undefined },
        { label: "Timeline", shortcut: "Ctrl+5" },
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
        { label: "Remove from Picaluma..." },
      ],
    ],
    [
      "Picture",
      [
        { label: "View and Edit", shortcut: "Ctrl+3", action: one != null ? () => s.openEditor(one) : undefined },
        sep,
        { label: "Undo All Edits", action: one != null && s.edits.has(one) ? () => s.setPhotoEdits(one, []) : undefined },
        sep,
        {
          label: s.starred.has(one ?? -1) ? "Remove Star" : "Add Star",
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
        { label: "Set as Desktop..." },
        { label: "Make a Poster..." },
        sep,
        { label: "Picture Collage..." },
        { label: "Movie" },
      ],
    ],
    [
      "Tools",
      [
        { label: "Folder Manager...", action: () => s.setFolderManager(true) },
        { label: "People Manager..." },
        sep,
        { label: "Rescan Library", action: () => api.rescan() },
        sep,
        { label: "Options..." },
      ],
    ],
    [
      "Help",
      [
        { label: "About Picaluma", action: () => alert("Picaluma 0.3.1\nOpen-source photo organizer\ngithub.com/mokyiichek/picaluma") },
      ],
    ],
  ];
}

function focusDescription(folderId: number) {
  useStore.getState().selectFolder(folderId);
  setTimeout(() => (document.querySelector(`[data-desc="${folderId}"]`) as HTMLInputElement | null)?.focus(), 80);
}

export default function MenuBar() {
  const menus = useMenus();
  const [open, setOpen] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const titleRefs = useRef<Record<string, HTMLDivElement | null>>({});

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
        Picaluma 0.3
      </span>
      {openEntries && (
        <div className="menu-drop" style={{ left }}>
          {openEntries.map((e, i) =>
            e.sep ? (
              <div key={i} className="menu-sep" />
            ) : (
              <div
                key={i}
                className={`menu-item${e.action ? "" : " disabled"}${e.checked ? " checked" : ""}`}
                onMouseUp={() => {
                  if (!e.action) return;
                  setOpen(null);
                  e.action();
                }}
              >
                <span>{e.label}</span>
                {e.shortcut && <span className="shortcut">{e.shortcut}</span>}
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}
