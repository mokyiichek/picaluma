import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { thumbUrl, Folder } from "../api";
import { render } from "../effects";
import { fmtDate } from "../format";
import { selectVisible, useStore } from "../store";
import { CollageIcon, FolderIcon, MovieIcon, PinIcon, PlayIcon, SaveIcon, StarIcon } from "./Icons";
import { exportPhotos } from "../actions";
import { aspectCache } from "./EditView";

type Row =
  | { kind: "head"; folder: Folder; photos: number[]; h: number }
  | { kind: "thumbs"; folderId: number; photos: number[]; h: number };

const HEAD_H = 124;
const SIDE_PAD = 18;

export default function LibraryGrid() {
  const visible = useStore(selectVisible);
  const thumbSize = useStore((s) => s.thumbSize);
  const search = useStore((s) => s.search);
  const clearSearch = useStore((s) => s.clearSearch);
  const scrollTarget = useStore((s) => s.scrollTarget);
  const scanning = useStore((s) => s.scan.scanning);
  const snapshotLoaded = useStore((s) => s.snapshot != null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const cellMin = thumbSize + 34;
  const cols = Math.max(1, Math.floor((width - SIDE_PAD * 2) / cellMin));
  const cellW = (width - SIDE_PAD * 2) / cols;
  const cellH = thumbSize + 30;

  const { rows, ordered, rowOfPhoto, headOfFolder } = useMemo(() => {
    const rows: Row[] = [];
    const ordered: number[] = [];
    const rowOfPhoto = new Map<number, number>();
    const headOfFolder = new Map<number, number>();
    for (const { folder, photos } of visible) {
      headOfFolder.set(folder.id, rows.length);
      rows.push({ kind: "head", folder, photos, h: HEAD_H });
      for (let i = 0; i < photos.length; i += cols) {
        const chunk = photos.slice(i, i + cols);
        for (const p of chunk) rowOfPhoto.set(p, rows.length);
        rows.push({ kind: "thumbs", folderId: folder.id, photos: chunk, h: cellH + (i + cols >= photos.length ? 18 : 0) });
        ordered.push(...chunk);
      }
    }
    return { rows, ordered, rowOfPhoto, headOfFolder };
  }, [visible, cols, cellH]);

  const v = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => rows[i].h,
    overscan: 4,
  });

  useEffect(() => v.measure(), [rows]); // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll to a folder (tree click) or back to a photo (leaving the editor).
  useLayoutEffect(() => {
    if (!scrollTarget) return;
    const idx =
      scrollTarget.photoId != null && rowOfPhoto.has(scrollTarget.photoId)
        ? rowOfPhoto.get(scrollTarget.photoId)!
        : headOfFolder.get(scrollTarget.folderId);
    if (idx == null) return;
    if (scrollTarget.photoId != null) {
      const el = scrollRef.current!;
      let top = 0;
      for (let i = 0; i < idx; i++) top += rows[i].h;
      // Only move if the photo is off-screen; keeps the zoom-back landing where the user left.
      if (top < el.scrollTop || top + rows[idx].h > el.scrollTop + el.clientHeight) v.scrollToIndex(idx, { align: "center" });
    } else {
      v.scrollToIndex(idx, { align: "start" });
    }
  }, [scrollTarget]); // eslint-disable-line react-hooks/exhaustive-deps

  // As the grid scrolls, the tree highlights whichever folder is at the top.
  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const items = v.getVirtualItems();
    const top = el.scrollTop + 30;
    const item = items.find((it) => it.end > top);
    if (!item) return;
    const r = rows[item.index];
    if (!r) return;
    useStore.getState().setCurrentFolder(r.kind === "head" ? r.folder.id : r.folderId);
  }, [rows, v]);

  // Rows change while scanning or searching; re-derive which folder is at the top.
  useEffect(() => {
    const id = requestAnimationFrame(onScroll);
    return () => cancelAnimationFrame(id);
  }, [onScroll]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const s = useStore.getState();
    const cur = s.anchor != null ? ordered.indexOf(s.anchor) : -1;
    const move = (delta: number) => {
      e.preventDefault();
      const next = ordered[Math.max(0, Math.min(ordered.length - 1, (cur < 0 ? 0 : cur) + delta))];
      if (next == null) return;
      s.clickPhoto(next, { ctrl: false, shift: e.shiftKey }, ordered);
      const idx = rowOfPhoto.get(next);
      if (idx != null) v.scrollToIndex(idx, { align: "auto" });
    };
    if (e.key === "ArrowRight") move(1);
    else if (e.key === "ArrowLeft") move(-1);
    else if (e.key === "ArrowDown") move(cols);
    else if (e.key === "ArrowUp") move(-cols);
    else if (e.key === "Enter" && s.anchor != null) openWithFlight(s.anchor);
    else if (e.ctrlKey && e.key.toLowerCase() === "a") {
      e.preventDefault();
      const f = visible.find((x) => x.folder.id === s.currentFolderId);
      if (f) s.selectOnly(f.photos);
    }
  };

  const items = v.getVirtualItems();

  return (
    <div className="gridwrap">
      {search && (
        <div className="search-banner">
          <button onClick={clearSearch}>Back to View All</button>
          <span>
            Displaying {ordered.length.toLocaleString()} pictures in {visible.length.toLocaleString()} albums ({search.seconds.toFixed(3)} seconds)
          </span>
        </div>
      )}
      <div className="grid-scroll" ref={scrollRef} onScroll={onScroll} tabIndex={0} onKeyDown={onKeyDown}>
        <div style={{ height: v.getTotalSize(), position: "relative" }}>
          {items.map((item) => {
            const r = rows[item.index];
            if (r.kind === "head") return <FolderHead key={item.key} folder={r.folder} photos={r.photos} top={item.start} />;
            return (
              <div key={item.key} className="thumb-row" style={{ top: item.start, height: cellH }}>
                {r.photos.map((id) => (
                  <Thumb key={id} id={id} w={cellW} h={cellH} ordered={ordered} />
                ))}
              </div>
            );
          })}
        </div>
        {snapshotLoaded && rows.length === 0 && (
          <div className="grid-empty">
            {search ? (
              <span>No pictures match your search.</span>
            ) : scanning ? (
              <>
                <div className="spinner" />
                <span>Scanning your folders for pictures…</span>
              </>
            ) : (
              <span>No pictures yet — use Import or Tools › Folder Manager to add folders.</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function openWithFlight(id: number) {
  const s = useStore.getState();
  const img = document.querySelector(`.grid-scroll img[data-photo="${id}"]`) as HTMLImageElement | null;
  if (img && img.complete && img.naturalWidth) {
    const r = img.getBoundingClientRect();
    const rendered = render(s.edits.get(id) ?? []);
    s.openEditor(id, { photoId: id, src: img.src, from: { x: r.left, y: r.top, w: r.width, h: r.height }, filter: rendered.filter, rotate: rendered.rotate });
  } else {
    s.openEditor(id);
  }
}

const FolderHead = memo(function FolderHead({ folder, photos, top }: { folder: Folder; photos: number[]; top: number }) {
  const startSlideshow = useStore((s) => s.startSlideshow);
  const toggleStar = useStore((s) => s.toggleStar);
  const setDesc = useStore((s) => s.setFolderDescription);
  const [desc, setLocal] = useState(folder.description);
  useEffect(() => setLocal(folder.description), [folder.description]);

  const range =
    folder.dateMin && folder.dateMax && fmtDate(folder.dateMin) !== fmtDate(folder.dateMax)
      ? fmtDate(folder.dateMin)
      : fmtDate(folder.dateMax || folder.dateMin);

  return (
    <div className="folder-head" style={{ top, height: HEAD_H - 6 }}>
      <div className="title-row">
        <FolderIcon size={34} />
        <div style={{ minWidth: 0 }}>
          <h2 title={folder.path}>{folder.name}</h2>
          <div className="date">{range}</div>
        </div>
      </div>
      <div className="actions">
        <button className="tbtn icon" title="Play fullscreen slideshow" onClick={() => startSlideshow(photos)}>
          <PlayIcon />
        </button>
        <button className="tbtn icon" title="Create a picture collage (coming soon)" disabled>
          <CollageIcon />
        </button>
        <button className="tbtn icon" title="Create a movie (coming soon)" disabled>
          <MovieIcon />
        </button>
        <button className="tbtn icon" title="Star all photos in this folder" onClick={() => toggleStar(photos)}>
          <StarIcon />
        </button>
        <button className="tbtn icon" title="Export this folder with edits applied" onClick={() => exportPhotos(photos)}>
          <SaveIcon />
        </button>
      </div>
      <input
        className="desc"
        data-desc={folder.id}
        value={desc}
        placeholder="Add a description"
        onChange={(e) => setLocal(e.target.value)}
        onBlur={() => desc !== folder.description && setDesc(folder.id, desc)}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      />
    </div>
  );
});

const Thumb = memo(function Thumb({ id, w, h, ordered }: { id: number; w: number; h: number; ordered: number[] }) {
  const selected = useStore((s) => s.selected.has(id));
  const starred = useStore((s) => s.starred.has(id));
  const geo = useStore((s) => s.geotagged.has(id));
  const edits = useStore((s) => s.edits.get(id));
  const clickPhoto = useStore((s) => s.clickPhoto);
  const [loaded, setLoaded] = useState(false);
  const r = edits ? render(edits) : null;
  const style: React.CSSProperties | undefined = r
    ? { filter: r.filter || undefined, transform: r.rotate ? `rotate(${r.rotate}deg)` : undefined }
    : undefined;

  return (
    <div
      className={`cell${selected ? " sel" : ""}`}
      style={{ width: w, height: h }}
      onMouseDown={(e) => {
        if (e.button !== 0) return;
        clickPhoto(id, { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey }, ordered);
      }}
      onDoubleClick={() => openWithFlight(id)}
    >
      <img
        data-photo={id}
        src={thumbUrl(id)}
        className={loaded ? "" : "loading"}
        decoding="async"
        draggable={false}
        style={style}
        onLoad={(e) => {
          const img = e.currentTarget;
          aspectCache.set(id, img.naturalWidth / img.naturalHeight);
          setLoaded(true);
        }}
        alt=""
      />
      {starred && <StarIcon size={14} className="star" />}
      {geo && (
        <span className="badges">
          <PinIcon />
        </span>
      )}
    </div>
  );
});
