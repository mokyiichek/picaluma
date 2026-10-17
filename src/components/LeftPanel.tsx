import { useEffect, useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Section, selectVisible, useStore } from "../store";
import { fmtMonth } from "../format";
import { CollapseIcon, FolderIcon, PicturesIcon, StarIcon } from "./Icons";
import type { Album } from "../api";

const NO_ALBUMS: Album[] = [];

type Row = { kind: "group"; label: string } | { kind: "folder"; id: number; name: string; count: number };

const ROW_H = 22;

export default function LeftPanel() {
  const open = useStore((s) => s.openSections);
  const toggleSection = useStore((s) => s.toggleSection);
  const visible = useStore(selectVisible);
  const starredCount = useStore((s) => s.starred.size);
  const query = useStore((s) => s.query);
  const search = useStore((s) => s.search);
  const starredOnly = useStore((s) => s.starredOnly);
  const setStarredOnly = useStore((s) => s.setStarredOnly);
  const currentName = useStore((s) => (s.currentFolderId != null ? s.folderById.get(s.currentFolderId)?.name : ""));
  const width = useStore((s) => s.leftWidth);
  const albums = useStore((s) => s.snapshot?.albums ?? NO_ALBUMS);
  const albumView = useStore((s) => s.albumView);
  const openAlbum = useStore((s) => s.openAlbum);
  const folderCount = useStore((s) => s.snapshot?.folders.length ?? 0);

  // Picasa: clicking a header toggles just that section; any combination can be open.
  const head = (id: Section, label: string) => (
    <div className="section-head" onClick={() => toggleSection(id)} title={open[id] ? "Collapse" : "Expand"}>
      <CollapseIcon open={open[id]} />
      <span>{label}</span>
      {!open[id] && id === "folders" && <span className="ghost">{currentName}</span>}
    </div>
  );

  return (
    <div className="left" style={{ width }}>
      {head("albums", `Albums (${albums.length + 1 + (search ? 1 : 0)})`)}
      {open.albums && (
        <div className="section-body auto">
          {search && (
            <div className="tree-row sel dim">
              <FolderIcon />
              <span className="name">
                Search results for "{query}" ({search.ids.size.toLocaleString()})
              </span>
            </div>
          )}
          <div
            className={`tree-row${starredOnly && albumView == null ? " sel" : ""}`}
            onClick={() => {
              openAlbum(null);
              setStarredOnly(!starredOnly);
            }}
          >
            <StarIcon size={15} />
            <span className="name">Starred Photos ({starredCount.toLocaleString()})</span>
          </div>
          {albums.map((a) => (
            <div
              key={a.id}
              className={`tree-row${albumView === a.id ? " sel" : ""}`}
              onMouseDown={(e) => e.button === 0 && openAlbum(albumView === a.id ? null : a.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                useStore.getState().openContextMenu({ x: e.clientX, y: e.clientY, kind: "album", albumId: a.id });
              }}
              title={albumView === a.id ? "Click again to return to all folders" : a.name}
            >
              <PicturesIcon size={15} />
              <span className="name">
                {a.name} ({a.photos.length.toLocaleString()})
              </span>
            </div>
          ))}
          {!albums.length && <div className="tree-hint">Right-click photos › Add to Album to make your first album.</div>}
        </div>
      )}
      {head("people", "People (0)")}
      {open.people && (
        <div className="section-body auto people-empty">
          Face grouping is planned for a later release.
          <br />
          Picaluma will detect faces locally — nothing is uploaded.
        </div>
      )}
      {head("folders", `Folders (${(albumView != null ? folderCount : visible.length).toLocaleString()})`)}
      {open.folders && <FolderTree />}
    </div>
  );
}

/** Drag handle between the tree and the grid. */
export function Splitter() {
  const setLeftWidth = useStore((s) => s.setLeftWidth);
  const onDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startW = useStore.getState().leftWidth;
    const move = (ev: PointerEvent) => setLeftWidth(Math.max(200, Math.min(window.innerWidth * 0.6, startW + ev.clientX - startX)));
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  };
  return <div className="splitter" onPointerDown={onDown} />;
}

function FolderTree() {
  const filtered = useStore(selectVisible);
  const albumView = useStore((s) => s.albumView);
  const allFolders = useStore((s) => s.snapshot?.folders);
  // In album view the grid shows the album, but the tree still lists every folder.
  const visible = useMemo(
    () => (albumView != null ? (allFolders ?? []).map((folder) => ({ folder, photos: folder.photos })) : filtered),
    [albumView, allFolders, filtered],
  );
  const current = useStore((s) => s.currentFolderId);
  const selectFolder = useStore((s) => s.selectFolder);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Picasa groups folders under "Updated <Month Year>" headings, newest first.
  const rows = useMemo(() => {
    const out: Row[] = [];
    let last = "";
    for (const { folder, photos } of visible) {
      const label = `Updated ${fmtMonth(folder.updated)}`;
      if (label !== last) {
        out.push({ kind: "group", label });
        last = label;
      }
      out.push({ kind: "folder", id: folder.id, name: folder.name, count: photos.length });
    }
    return out;
  }, [visible]);

  const rowIndex = useMemo(() => {
    const m = new Map<number, number>();
    rows.forEach((r, i) => r.kind === "folder" && m.set(r.id, i));
    return m;
  }, [rows]);

  const v = useVirtualizer({ count: rows.length, getScrollElement: () => scrollRef.current, estimateSize: () => ROW_H, overscan: 20 });

  // Keep the highlighted folder in view as the grid scrolls (Picasa's tree follows the grid).
  useEffect(() => {
    if (current == null) return;
    const i = rowIndex.get(current);
    if (i != null) v.scrollToIndex(i, { align: "auto" });
  }, [current, rowIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const ids = visible.map((x) => x.folder.id);
    const i = current != null ? ids.indexOf(current) : -1;
    const next = ids[Math.max(0, Math.min(ids.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))];
    if (next != null) selectFolder(next);
  };

  return (
    <div className="section-body" ref={scrollRef} tabIndex={0} onKeyDown={onKey} style={{ outline: "none" }}>
      <div style={{ height: v.getTotalSize(), position: "relative" }}>
        {v.getVirtualItems().map((item) => {
          const r = rows[item.index];
          const style = { position: "absolute" as const, top: item.start, left: 0, right: 0, height: ROW_H };
          if (r.kind === "group")
            return (
              <div key={item.key} className="tree-group" style={style}>
                {r.label}
              </div>
            );
          return (
            <div
              key={item.key}
              className={`tree-row${r.id === current ? " sel" : ""}`}
              style={style}
              onMouseDown={(e) => e.button === 0 && selectFolder(r.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                selectFolder(r.id);
                useStore.getState().openContextMenu({ x: e.clientX, y: e.clientY, kind: "folder", folderId: r.id });
              }}
            >
              <FolderIcon />
              <span className="name">
                {r.name} ({r.count.toLocaleString()})
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
