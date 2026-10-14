import { useEffect, useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { selectVisible, useStore } from "../store";
import { fmtMonth } from "../format";
import { CollapseIcon, FolderIcon, StarIcon } from "./Icons";

type Row = { kind: "group"; label: string } | { kind: "folder"; id: number; name: string; count: number };

const ROW_H = 22;

export default function LeftPanel() {
  const section = useStore((s) => s.leftSection);
  const setSection = useStore((s) => s.setLeftSection);
  const visible = useStore(selectVisible);
  const starredCount = useStore((s) => s.starred.size);
  const query = useStore((s) => s.query);
  const search = useStore((s) => s.search);
  const starredOnly = useStore((s) => s.starredOnly);
  const setStarredOnly = useStore((s) => s.setStarredOnly);
  const currentName = useStore((s) => (s.currentFolderId != null ? s.folderById.get(s.currentFolderId)?.name : ""));
  const width = useStore((s) => s.leftWidth);

  const head = (id: typeof section, label: string) => (
    <div className="section-head" onClick={() => setSection(id)}>
      <CollapseIcon open={section === id} />
      <span>{label}</span>
      {section !== id && id === "folders" && <span className="ghost">{currentName}</span>}
    </div>
  );

  return (
    <div className="left" style={{ width }}>
      {head("albums", `Albums (${1 + (search ? 1 : 0)})`)}
      {section === "albums" && (
        <div className="section-body">
          {search && (
            <div className="tree-row sel">
              <FolderIcon />
              <span className="name">
                Search results for "{query}" ({search.ids.size.toLocaleString()})
              </span>
            </div>
          )}
          <div className={`tree-row${starredOnly ? " sel" : ""}`} onClick={() => setStarredOnly(!starredOnly)}>
            <StarIcon size={15} />
            <span className="name">Starred Photos ({starredCount.toLocaleString()})</span>
          </div>
        </div>
      )}
      {head("people", "People (0)")}
      {section === "people" && (
        <div className="section-body people-empty">
          Face grouping is planned for a later release.
          <br />
          Picaluma will detect faces locally — nothing is uploaded.
        </div>
      )}
      {head("folders", `Folders (${visible.length.toLocaleString()})`)}
      {section === "folders" && <FolderTree />}
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
  const visible = useStore(selectVisible);
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
