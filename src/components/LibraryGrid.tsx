import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { thumbUrl, Folder } from "../api";
import { cropViewBox, render } from "../effects";
import { fmtDate } from "../format";
import { selectAlbum, selectVisible, useStore } from "../store";
import { CollageIcon, FolderIcon, MovieIcon, PinIcon, PlayIcon, SaveIcon, StarIcon } from "./Icons";
import { exportPhotos } from "../actions";
import { aspectCache } from "./EditView";
import JogScrollbar from "./JogScrollbar";

type Row =
  | { kind: "head"; folder: Folder; photos: number[]; h: number }
  | { kind: "thumbs"; folderId: number; photos: number[]; h: number };

const HEAD_H = 124;
const SIDE_PAD = 18;
const RESIZE_ANIM_MS = 240;
/** Spring stiffness (rad/s) fitted to Picasa's wheel animation. */
const WHEEL_OMEGA = 16;
/** WebView2 reports ~91 deltaY per notch here; Picasa moves ~117px per notch. */
const WHEEL_PX_PER_DELTA = 1.16;

/** Thumbnails that have already decoded once; remounts show them instantly without a placeholder. */
const loadedThumbs = new Set<number>();

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
  const [resizing, setResizing] = useState(false);
  const topAnchor = useRef<{ photo: number; delta: number } | null>(null);
  const smooth = useRef<{ to: (y: number) => void } | null>(null);
  /** True while gliding to a clicked folder: the tree keeps that folder highlighted meanwhile. */
  const gliding = useRef(false);
  const effects = useStore((s) => s.effects);
  const album = useStore(selectAlbum);

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

  const { rows, offsets, ordered, rowOfPhoto, headOfFolder } = useMemo(() => {
    const rows: Row[] = [];
    const offsets: number[] = [];
    const ordered: number[] = [];
    const rowOfPhoto = new Map<number, number>();
    const headOfFolder = new Map<number, number>();
    let y = 0;
    const push = (r: Row) => {
      offsets.push(y);
      y += r.h;
      rows.push(r);
    };
    for (const { folder, photos } of visible) {
      headOfFolder.set(folder.id, rows.length);
      push({ kind: "head", folder, photos, h: HEAD_H });
      for (let i = 0; i < photos.length; i += cols) {
        const chunk = photos.slice(i, i + cols);
        for (const p of chunk) rowOfPhoto.set(p, rows.length);
        push({ kind: "thumbs", folderId: folder.id, photos: chunk, h: cellH + (i + cols >= photos.length ? 18 : 0) });
        ordered.push(...chunk);
      }
    }
    return { rows, offsets, ordered, rowOfPhoto, headOfFolder };
  }, [visible, cols, cellH]);

  const v = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => rows[i].h,
    overscan: 3,
  });

  useLayoutEffect(() => v.measure(), [rows]); // eslint-disable-line react-hooks/exhaustive-deps

  // Picasa's animated wheel scrolling, measured frame-by-frame from Picasa 3 with special effects
  // on: each notch moves ~117px, easing in from rest and gliding out (≈15% at 60ms, 54% at
  // 120ms, 90% at 280ms). A critically damped spring reproduces that curve; notches accumulate.
  // The same spring also carries folder-to-folder jumps (see scrollTarget below).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let target = 0;
    let pos = 0;
    let vel = 0;
    let raf = 0;
    let last = 0;
    const sync = () => {
      // Something else (jog bar, keys, slider) may have moved the grid since the last animation.
      if (!raf) {
        pos = el.scrollTop;
        target = pos;
        vel = 0;
        last = 0;
      }
    };
    const maxTop = () => el.scrollHeight - el.clientHeight;
    smooth.current = {
      to: (dest: number) => {
        sync();
        gliding.current = true;
        dest = Math.max(0, Math.min(maxTop(), dest));
        // Long hops pre-jump so the glide only ever covers about two screens, like Picasa's
        // fast scroll: you see motion and direction without waiting through every folder.
        const span = el.clientHeight * 2;
        if (Math.abs(dest - pos) > span) {
          pos = dest - Math.sign(dest - pos) * span;
          vel = 0;
          el.scrollTop = pos;
        }
        target = dest;
        if (!raf) raf = requestAnimationFrame(step);
      },
    };
    const step = (t: number) => {
      const dt = last ? Math.min(0.032, (t - last) / 1000) : 1 / 60;
      last = t;
      const acc = WHEEL_OMEGA * WHEEL_OMEGA * (target - pos) - 2 * WHEEL_OMEGA * vel;
      vel += acc * dt;
      pos += vel * dt;
      if (Math.abs(target - pos) < 0.5 && Math.abs(vel) < 20) {
        el.scrollTop = target;
        raf = 0;
        vel = 0;
        gliding.current = false;
        return;
      }
      el.scrollTop = pos;
      raf = requestAnimationFrame(step);
    };
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || !useStore.getState().effects) return; // effects off: native scrolling
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? el.clientHeight : 1;
      sync();
      gliding.current = false; // the user took over; let the tree follow again
      target = Math.max(0, Math.min(maxTop(), target + e.deltaY * unit * WHEEL_PX_PER_DELTA));
      if (!raf) raf = requestAnimationFrame(step);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      cancelAnimationFrame(raf);
      smooth.current = null;
    };
  }, []);

  // Thumbnail-size slider: animate cells to their new size and keep the same photo at the top.
  const prevSize = useRef(thumbSize);
  useLayoutEffect(() => {
    if (prevSize.current === thumbSize) return;
    prevSize.current = thumbSize;
    setResizing(true);
    const a = topAnchor.current;
    const el = scrollRef.current;
    if (a && el) {
      const idx = rowOfPhoto.get(a.photo);
      if (idx != null) el.scrollTop = Math.max(0, offsets[idx] - a.delta);
    }
    const t = window.setTimeout(() => setResizing(false), RESIZE_ANIM_MS);
    return () => clearTimeout(t);
  }, [thumbSize, rowOfPhoto, offsets]);

  // Folder click glides to the folder (instant jump with special effects off); leaving the
  // editor reveals the photo if it is off-screen.
  useLayoutEffect(() => {
    if (!scrollTarget) return;
    const el = scrollRef.current;
    if (!el) return;
    if (scrollTarget.photoId != null && rowOfPhoto.has(scrollTarget.photoId)) {
      const idx = rowOfPhoto.get(scrollTarget.photoId)!;
      const top = offsets[idx];
      if (top < el.scrollTop || top + rows[idx].h > el.scrollTop + el.clientHeight) {
        el.scrollTop = Math.max(0, top - (el.clientHeight - rows[idx].h) / 2);
      }
      return;
    }
    const idx = headOfFolder.get(scrollTarget.folderId);
    if (idx == null) return;
    if (useStore.getState().effects && smooth.current) smooth.current.to(offsets[idx]);
    else el.scrollTop = offsets[idx];
  }, [scrollTarget]); // eslint-disable-line react-hooks/exhaustive-deps

  // As the grid scrolls, the tree highlights whichever folder is at the top.
  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || !rows.length) return;
    const top = el.scrollTop + 30;
    // Binary search the row under the top edge.
    let lo = 0;
    let hi = offsets.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (offsets[mid] <= top) lo = mid;
      else hi = mid - 1;
    }
    const r = rows[lo];
    const firstThumbRow = r.kind === "thumbs" ? lo : lo + 1 < rows.length ? lo + 1 : lo;
    const tr = rows[firstThumbRow];
    if (tr?.kind === "thumbs") topAnchor.current = { photo: tr.photos[0], delta: offsets[firstThumbRow] - el.scrollTop };
    if (!gliding.current) useStore.getState().setCurrentFolder(r.kind === "head" ? r.folder.id : r.folderId);
  }, [rows, offsets]);

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
      const el = scrollRef.current;
      if (idx != null && el) {
        const top = offsets[idx];
        if (top < el.scrollTop) el.scrollTop = top;
        else if (top + rows[idx].h > el.scrollTop + el.clientHeight) el.scrollTop = top + rows[idx].h - el.clientHeight;
      }
    };
    if (e.key === "ArrowRight") move(1);
    else if (e.key === "ArrowLeft") move(-1);
    else if (e.key === "ArrowDown") move(cols);
    else if (e.key === "ArrowUp") move(-cols);
    else if (e.key === "Enter" && s.anchor != null) openWithFlight(s.anchor);
    else if (e.key === "Home" && scrollRef.current) scrollRef.current.scrollTop = 0;
    else if (e.key === "End" && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    else if (e.ctrlKey && e.key.toLowerCase() === "a") {
      e.preventDefault();
      const f = visible.find((x) => x.folder.id === s.currentFolderId);
      if (f) s.selectOnly(f.photos);
    }
  };

  const items = v.getVirtualItems();
  const children: React.ReactNode[] = [];
  for (const item of items) {
    const r = rows[item.index];
    if (r.kind === "head") {
      children.push(<FolderHead key={`f${r.folder.id}`} folder={r.folder} photos={r.photos} top={item.start} />);
      continue;
    }
    r.photos.forEach((id, j) =>
      children.push(<Thumb key={id} id={id} x={SIDE_PAD + j * cellW} y={item.start} w={cellW} h={cellH} ordered={ordered} />),
    );
  }

  return (
    <div className="gridwrap">
      {album && (
        <div className="album-banner">
          <button onClick={() => useStore.getState().openAlbum(null)}>Back to Folders</button>
          <span>
            Album: {album.name} — {album.photos.length.toLocaleString()} pictures
          </span>
        </div>
      )}
      {search && (
        <div className="search-banner">
          <button onClick={clearSearch}>Back to View All</button>
          <span>
            Displaying {ordered.length.toLocaleString()} pictures in {visible.length.toLocaleString()} albums ({search.seconds.toFixed(3)} seconds)
          </span>
        </div>
      )}
      <div className="grid-body">
        <div className="grid-scroll" ref={scrollRef} onScroll={onScroll} tabIndex={0} onKeyDown={onKeyDown}>
          <div className={`grid-canvas${resizing && effects ? " resizing" : ""}`} style={{ height: v.getTotalSize() }}>
            {children}
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
        <JogScrollbar target={scrollRef} rowHeight={cellH} />
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
    <div
      className="folder-head"
      style={{ top, height: HEAD_H - 6 }}
      onContextMenu={(e) => {
        e.preventDefault();
        useStore.getState().openContextMenu({ x: e.clientX, y: e.clientY, kind: "folder", folderId: folder.id });
      }}
    >
      <div className="title-row">
        <FolderIcon size={34} />
        <div style={{ minWidth: 0 }}>
          <h2 title={folder.path}>{folder.name}</h2>
          <div className="date">{range}</div>
        </div>
      </div>
      <div className="actions">
        <button className="tbtn icon sq" title="Play fullscreen slideshow" onClick={() => startSlideshow(photos)}>
          <PlayIcon />
        </button>
        <button className="tbtn icon sq" title="Create a picture collage (coming soon)" disabled>
          <CollageIcon />
        </button>
        <button className="tbtn icon sq" title="Create a movie (coming soon)" disabled>
          <MovieIcon />
        </button>
        <button className="tbtn icon sq" title="Star all photos in this folder" onClick={() => toggleStar(photos)}>
          <StarIcon />
        </button>
        <button className="tbtn icon sq" title="Export this folder with edits applied" onClick={() => exportPhotos(photos)}>
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

const Thumb = memo(function Thumb({ id, x, y, w, h, ordered }: { id: number; x: number; y: number; w: number; h: number; ordered: number[] }) {
  const selected = useStore((s) => s.selected.has(id));
  const starred = useStore((s) => s.starred.has(id));
  const geo = useStore((s) => s.geotagged.has(id));
  const edits = useStore((s) => s.edits.get(id));
  const clickPhoto = useStore((s) => s.clickPhoto);
  const [loaded, setLoaded] = useState(() => loadedThumbs.has(id));
  const r = edits ? render(edits) : null;
  const style = r
    ? ({
        filter: r.filter || undefined,
        transform: r.rotate ? `rotate(${r.rotate}deg)` : undefined,
        objectViewBox: cropViewBox(r.crop),
      } as React.CSSProperties)
    : undefined;

  return (
    <div
      className={`cell${selected ? " sel" : ""}`}
      style={{ width: w, height: h, transform: `translate(${x}px, ${y}px)` }}
      onMouseDown={(e) => {
        if (e.button !== 0) return;
        clickPhoto(id, { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey }, ordered);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        if (!useStore.getState().selected.has(id)) clickPhoto(id, { ctrl: false, shift: false }, ordered);
        useStore.getState().openContextMenu({ x: e.clientX, y: e.clientY, kind: "photo" });
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
          loadedThumbs.add(id);
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
