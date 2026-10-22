import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { pathParts, Section, selectVisible, useStore } from "../store";
import { fmtMonth } from "../format";
import { CollapseIcon, FolderIcon, PersonIcon, PicturesIcon, StarIcon } from "./Icons";
import { faceUrl, type Album, type Person } from "../api";
import { fmtMB, offerFaceModels } from "../faceModels";

const NO_ALBUMS: Album[] = [];
const NO_PEOPLE: Person[] = [];

type Row =
  | { kind: "group"; label: string }
  | { kind: "folder"; id: number; name: string; count: number; depth?: number; key?: string; parent?: boolean }
  | { kind: "dir"; name: string; depth: number; key: string };

const ROW_H = 22;

export default function LeftPanel() {
  const open = useStore((s) => s.openSections);
  const toggleSection = useStore((s) => s.toggleSection);
  const visible = useStore(selectVisible);
  const starredCount = useStore((s) => s.starred.size);
  const recentCount = useStore((s) => s.recent.size);
  const recentOnly = useStore((s) => s.recentOnly);
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
  const allPeople = useStore((s) => s.snapshot?.people ?? NO_PEOPLE);
  const peopleSort = useStore((s) => s.peopleSort);
  // Sort People by Name (as loaded), Amount (most pictures first) or Top 10.
  const people = useMemo(() => {
    if (peopleSort === "name") return allPeople;
    const byCount = [...allPeople].sort((a, b) => b.photos.length - a.photos.length);
    return peopleSort === "top" ? byCount.slice(0, 10) : byCount;
  }, [allPeople, peopleSort]);
  const unnamed = useStore((s) => s.snapshot?.unnamed ?? 0);
  const personView = useStore((s) => s.personView);
  const openPerson = useStore((s) => s.openPerson);
  const pm = useStore((s) => s.peopleManager);
  const progress = useStore((s) => s.faceProgress);
  const models = useStore((s) => s.faceModels);

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
      {head("albums", `Albums (${albums.length + 2 + (search ? 1 : 0)})`)}
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
          <div
            className={`tree-row${recentOnly ? " sel" : ""}`}
            title="Pictures changed or added in the last 30 days"
            onClick={() => useStore.getState().setRecentOnly(!recentOnly)}
          >
            <PicturesIcon size={15} />
            <span className="name">Recently Updated ({recentCount.toLocaleString()})</span>
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
      {head("people", `People (${people.length.toLocaleString()})`)}
      {open.people && (
        <div className="section-body auto people-list">
          {unnamed > 0 && (
            <div
              className={`tree-row${pm?.tab === "unnamed" ? " sel" : ""}`}
              onMouseDown={(e) => e.button === 0 && useStore.getState().setPeopleManager({ tab: "unnamed" })}
              title="Name the faces Picaluma found"
            >
              <PersonIcon size={15} />
              <span className="name">Unnamed ({unnamed.toLocaleString()})</span>
            </div>
          )}
          {people.map((p) => (
            <div
              key={p.id}
              className={`tree-row${personView === p.id ? " sel" : ""}`}
              onMouseDown={(e) => e.button === 0 && openPerson(personView === p.id ? null : p.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                useStore.getState().openContextMenu({ x: e.clientX, y: e.clientY, kind: "person", personId: p.id });
              }}
              title={personView === p.id ? "Click again to return to all folders" : p.name}
            >
              {p.cover != null ? <img className="face-ico" src={faceUrl(p.cover)} alt="" /> : <PersonIcon size={15} />}
              <span className="name">
                {p.name} ({p.photos.length.toLocaleString()})
              </span>
              {p.suggestions > 0 && (
                <span
                  className="suggest-badge"
                  title={`${p.suggestions} suggested faces to confirm`}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    useStore.getState().setPeopleManager({ tab: "suggestions", person: p.id });
                  }}
                >
                  ?
                </span>
              )}
            </div>
          ))}
          {models && !models.ready && (
            <div className="tree-hint">
              {models.downloading ? (
                `Downloading face models… ${fmtMB(models.received)} of ${fmtMB(models.total)} MB`
              ) : (
                <>
                  {models.error ? "The face models didn't download. " : "To find faces, Picaluma needs its face models. "}
                  <button className="link" onClick={() => offerFaceModels()}>
                    {models.error ? "Try again" : `Download (${fmtMB(models.total)} MB)`}
                  </button>
                </>
              )}
            </div>
          )}
          {progress.running && (
            <div className="tree-hint">
              Finding faces… {progress.done.toLocaleString()} of {progress.total.toLocaleString()} pictures
            </div>
          )}
          {!people.length && !unnamed && !progress.running && models?.ready && (
            <div className="tree-hint">Faces Picaluma finds appear here — found on this computer, nothing is uploaded.</div>
          )}
        </div>
      )}
      {head("folders", `Folders (${(albumView != null || personView != null ? folderCount : visible.length).toLocaleString()})`)}
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
  const personView = useStore((s) => s.personView);
  const allFolders = useStore((s) => s.snapshot?.folders);
  // In album and person view the grid shows the album, but the tree still lists every folder.
  const visible = useMemo(
    () => (albumView != null || personView != null ? (allFolders ?? []).map((folder) => ({ folder, photos: folder.photos })) : filtered),
    [albumView, personView, allFolders, filtered],
  );
  const current = useStore((s) => s.currentFolderId);
  const selectFolder = useStore((s) => s.selectFolder);
  const view = useStore((s) => s.folderView);
  const sort = useStore((s) => s.folderSort);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const rows = useMemo(() => {
    const out: Row[] = [];
    if (view === "tree") {
      // Disk hierarchy below the folders' common parent. Parents without pictures appear as plain rows.
      const parts = visible.map((v) => pathParts(v.folder.path));
      let common = parts.length ? parts[0].length - 1 : 0;
      for (const p of parts) {
        let i = 0;
        while (i < common && i < p.length - 1 && p[i].toLowerCase() === parts[0][i].toLowerCase()) i++;
        common = i;
      }
      const seen = new Map<string, Row>();
      visible.forEach(({ folder, photos }, n) => {
        const p = parts[n];
        for (let d = common; d < p.length; d++) {
          const key = p.slice(0, d + 1).join("/").toLowerCase();
          const parentKey = p.slice(0, d).join("/").toLowerCase();
          const parent = seen.get(parentKey);
          if (parent && parent.kind !== "group") (parent as { parent?: boolean }).parent = true;
          if (d === p.length - 1) {
            const row: Row = { kind: "folder", id: folder.id, name: folder.name, count: photos.length, depth: d - common, key };
            seen.set(key, row);
            out.push(row);
          } else if (!seen.has(key)) {
            const row: Row = { kind: "dir", name: p[d], depth: d - common, key };
            seen.set(key, row);
            out.push(row);
          }
        }
      });
      // Hide everything under a collapsed row.
      return out.filter((r) => r.kind === "group" || ![...collapsed].some((c) => r.key !== c && r.key!.startsWith(c + "/")));
    }
    // Flat view: Picasa groups folders under "Updated <Month Year>" (or the date taken) headings.
    let last = "";
    for (const { folder, photos } of visible) {
      const label = sort === "updated" ? `Updated ${fmtMonth(folder.updated)}` : sort === "created" ? fmtMonth(folder.dateMin) : "";
      if (label && label !== last) {
        out.push({ kind: "group", label });
        last = label;
      }
      out.push({ kind: "folder", id: folder.id, name: folder.name, count: photos.length });
    }
    return out;
  }, [visible, view, sort, collapsed]);

  const toggle = (key: string) =>
    setCollapsed((c) => {
      const next = new Set(c);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

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
          const indent = r.depth != null ? { paddingLeft: 6 + r.depth * 16 } : undefined;
          const twisty =
            r.depth != null ? (
              <span
                className={`twisty${(r.kind === "dir" || r.parent) ? "" : " leaf"}`}
                onMouseDown={(e) => {
                  e.stopPropagation();
                  if (r.kind === "dir" || r.parent) toggle(r.key!);
                }}
              >
                <CollapseIcon open={!collapsed.has(r.key!)} />
              </span>
            ) : null;
          if (r.kind === "dir")
            return (
              <div key={item.key} className="tree-row dir" style={{ ...style, ...indent }} onMouseDown={() => toggle(r.key)}>
                {twisty}
                <FolderIcon />
                <span className="name">{r.name}</span>
              </div>
            );
          return (
            <div
              key={item.key}
              className={`tree-row${r.id === current ? " sel" : ""}`}
              style={{ ...style, ...indent }}
              onMouseDown={(e) => e.button === 0 && selectFolder(r.id)}
              onDoubleClick={() => useStore.getState().setFolderProps(r.id)}
              title="Double-click for Folder Properties"
              onContextMenu={(e) => {
                e.preventDefault();
                selectFolder(r.id);
                useStore.getState().openContextMenu({ x: e.clientX, y: e.clientY, kind: "folder", folderId: r.id });
              }}
            >
              {twisty}
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
