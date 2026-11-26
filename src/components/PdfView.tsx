import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { api, pdfPageUrl, Photo, thumbUrl } from "../api";
import { mod } from "../platform";
import { editorGo, slideInArrival } from "../navAnim";
import { selectEditorSequence, useStore } from "../store";
import { ArrowIcon } from "./Icons";

// PDF documents in the Edit view: the page fitted to the window, zoomed with the tray's zoom
// slider (↑ / ↓, + / −, Ctrl+wheel, 0 fits, 1 is actual size) and dragged around when zoomed in;
// pages turned with the page bar, Page Up / Page Down, Home / End, the wheel, or the page
// thumbnails on the left. ← / → still go to the next file, as for pictures.

const EASE = "cubic-bezier(0.2, 0.8, 0.2, 1)";
const PAD = 28;
const MAX_ZOOM = 8;
const THUMB_EDGE = 220;
/** Screen pixels per PDF point at actual size (96 per inch). */
const PT = 96 / 72;

const fmtBytes = (n: number) =>
  n >= 1 << 30 ? `${(n / (1 << 30)).toFixed(2)} GB` : n >= 1 << 20 ? `${(n / (1 << 20)).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;

/** The page sizes of a PDF (points), or "failed". */
function usePdfPages(id: number) {
  const [pages, setPages] = useState<{ id: number; sizes: [number, number][] | "failed" } | null>(null);
  useEffect(() => {
    let live = true;
    api
      .pdfPages(id)
      .then((sizes) => live && setPages({ id, sizes: sizes.length ? sizes : "failed" }))
      .catch(() => live && setPages({ id, sizes: "failed" }));
    return () => {
      live = false;
    };
  }, [id]);
  return pages && pages.id === id ? pages.sizes : null;
}

export default function PdfEditor({ id, photo, active, caption, onBack }: { id: number; photo: Photo | null; active: boolean; caption: ReactNode; onBack: () => void }) {
  const sizes = usePdfPages(id);
  const [page, setPageRaw] = useState({ id, n: 0, dir: 0 });
  const n = page.id === id ? page.n : 0;
  const count = Array.isArray(sizes) ? sizes.length : 0;
  /** Go to a page, or (a function) a page counted from the current one. */
  const goPage = useCallback(
    (to: number | ((cur: number) => number)) =>
      setPageRaw((p) => {
        const cur = p.id === id ? p.n : 0;
        const t = Math.max(0, Math.min(count - 1, typeof to === "function" ? to(cur) : to));
        return p.id === id && p.n === t ? p : { id, n: t, dir: Math.sign(t - cur) };
      }),
    [id, count],
  );
  return (
    <>
      <PdfPanel id={id} photo={photo} count={count} page={n} goPage={goPage} />
      <div className="edit-center">
        <PdfStage id={id} sizes={sizes} page={n} dir={page.id === id ? page.dir : 0} goPage={goPage} active={active} onBack={onBack} />
        {caption}
      </div>
    </>
  );
}

type GoPage = (to: number | ((cur: number) => number)) => void;

/** Left panel: the file, and every page as a thumbnail to jump to. */
function PdfPanel({ id, photo, count, page, goPage }: { id: number; photo: Photo | null; count: number; page: number; goPage: GoPage }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const v = useVirtualizer({ count, getScrollElement: () => scrollRef.current, estimateSize: () => 178, overscan: 4 });
  useEffect(() => {
    if (count) v.scrollToIndex(page, { align: "auto" });
  }, [page, count]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="edit-left">
      <div className="video-panel pdf-panel">
        <b className="lbl" title={photo?.name}>
          {photo?.name ?? ""}
        </b>
        {photo && (
          <span className="muted">
            {count ? `${count} page${count === 1 ? "" : "s"} · ` : ""}
            {fmtBytes(photo.size)}
          </span>
        )}
        <button className="tbtn" disabled={!photo} onClick={() => photo && api.openInDefaultApp(photo.path)}>
          Open in Default App
        </button>
        <button className="tbtn" disabled={!photo} onClick={() => photo && revealItemInDir(photo.path)}>
          Locate on Disk
        </button>
      </div>
      <div className="pdf-thumbs" ref={scrollRef}>
        <div style={{ height: v.getTotalSize(), position: "relative" }}>
          {v.getVirtualItems().map((it) => (
            <button
              key={it.index}
              className={`pdf-thumb${it.index === page ? " cur" : ""}`}
              style={{ top: it.start, height: it.size }}
              onClick={() => goPage(it.index)}
              title={`Page ${it.index + 1}`}
            >
              <img src={pdfPageUrl(id, it.index, THUMB_EDGE)} alt="" draggable={false} />
              <span>{it.index + 1}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function PdfStage({
  id,
  sizes,
  page,
  dir,
  goPage,
  active,
  onBack,
}: {
  id: number;
  sizes: [number, number][] | "failed" | null;
  page: number;
  dir: number;
  goPage: GoPage;
  active: boolean;
  onBack: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ w: 0, h: 0 });
  const measure = useCallback(() => {
    const el = scrollRef.current;
    if (el) setView((v) => (v.w === el.clientWidth && v.h === el.clientHeight ? v : { w: el.clientWidth, h: el.clientHeight }));
  }, []);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure]);

  const size = Array.isArray(sizes) ? sizes[page] ?? sizes[0] : null;
  const zStore = useStore((s) => s.editZoom);
  const z = Math.min(MAX_ZOOM, Math.max(1, zStore));
  const fit = size && view.w ? Math.max(0.01, Math.min((view.w - PAD) / size[0], (view.h - PAD) / size[1])) : 0;
  const dw = size ? Math.round(size[0] * fit * z) : 0;
  const dh = size ? Math.round(size[1] * fit * z) : 0;
  // Sharp at any zoom: the page is drawn again at the size it's shown, in steps, up to the limit.
  const dpr = window.devicePixelRatio || 1;
  const edge = Math.min(6000, Math.max(512, Math.ceil((Math.max(dw, dh) * dpr) / 512) * 512));
  const [sharp, setSharp] = useState<string | null>(null);
  const want = size ? pdfPageUrl(id, page, edge) : null;
  useEffect(() => {
    if (!want) return;
    let live = true;
    const img = new Image();
    img.onload = () => live && setSharp(want);
    img.src = want;
    return () => {
      live = false;
    };
  }, [want]);
  // The last sharp drawing of this page stays up while a bigger one is drawn.
  const lastSharp = useRef<string | null>(null);
  const samePage = (u: string | null) => !!u && !!want && u.split("&edge=")[0] === want.split("&edge=")[0];
  if (samePage(sharp)) lastSharp.current = sharp;
  else if (!samePage(lastSharp.current)) lastSharp.current = null;
  const shown = lastSharp.current;

  // Tray zoom slider: actual size (the page at 96 per inch) is the middle mark.
  useEffect(() => {
    if (fit) useStore.setState({ editActual: Math.max(1, PT / fit) });
  }, [fit]);
  useEffect(() => () => useStore.getState().setEditZoom(1), []);
  useEffect(() => useStore.getState().setEditZoom(1), [id]);

  // Zooming keeps the spot in the middle of the view where it was. (The scroll position is
  // remembered as it changes: zooming out, the browser may clamp it before this runs.)
  const lastZ = useRef(z);
  const scrolled = useRef({ l: 0, t: 0 });
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const prev = lastZ.current;
    lastZ.current = z;
    if (!el || prev === z || !dw) return;
    const k = prev / z;
    const axis = (view: number, size: number, scroll: number) => {
      const oldSize = size * k;
      const oldLeft = (Math.max(view, oldSize + PAD) - oldSize) / 2;
      const f = Math.max(0, Math.min(1, (scroll + view / 2 - oldLeft) / oldSize));
      const left = (Math.max(view, size + PAD) - size) / 2;
      return left + f * size - view / 2;
    };
    el.scrollLeft = axis(el.clientWidth, dw, scrolled.current.l);
    el.scrollTop = axis(el.clientHeight, dh, scrolled.current.t);
    scrolled.current = { l: el.scrollLeft, t: el.scrollTop };
  }, [z]); // eslint-disable-line react-hooks/exhaustive-deps
  const zoomBy = useCallback((dirZ: 1 | -1) => {
    const s = useStore.getState();
    const cur = Math.max(1, s.editZoom);
    const next = dirZ > 0 ? Math.min(MAX_ZOOM, cur * 1.25) : cur / 1.25 < 1.05 ? 1 : cur / 1.25;
    s.setEditZoom(next);
  }, []);

  // A new page: back to its top, sliding in from the side it came from.
  const effects = useStore((s) => s.effects);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = scrolled.current.t = 0;
    if (!dir || !effects || !pageRef.current) return;
    pageRef.current.animate(
      [
        { translate: `0px ${dir * 48}px`, opacity: 0 },
        { translate: "0px 0px", opacity: 1 },
      ],
      { duration: 200, easing: EASE },
    );
  }, [page, id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Arriving: slide in (← / →, filmstrip) or grow out of the thumbnail double-clicked.
  const flight = useStore((s) => s.flight);
  const hasPage = !!size && !!view.w;
  useLayoutEffect(() => {
    const el = pageRef.current;
    if (!active || !hasPage || !el) return;
    if (slideInArrival(el, id)) return;
    const s = useStore.getState();
    if (!s.flight || s.flight.photoId !== id) return;
    const to = el.getBoundingClientRect();
    const from = s.flight.from;
    if (!s.effects || !to.width) return s.endFlight();
    const anim = el.animate(
      [{ transform: `translate(${from.x - to.left}px, ${from.y - to.top}px) scale(${from.w / to.width}, ${from.h / to.height})` }, { transform: "none" }],
      { duration: 230, easing: EASE },
    );
    anim.onfinish = anim.oncancel = () => useStore.getState().endFlight();
  }, [id, hasPage, active, flight?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (flight && flight.photoId === id && sizes === "failed") useStore.getState().endFlight();
  }, [flight, sizes, id]);

  // Keys: pages, zoom.
  const count = Array.isArray(sizes) ? sizes.length : 0;
  // The page bar takes its room when the pages are known.
  useLayoutEffect(measure, [count > 0, measure]);
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || mod(e) || e.altKey || useStore.getState().slideshow) return;
      if (e.key === "PageDown" || (e.key === " " && !e.shiftKey)) goPage((p) => p + 1);
      else if (e.key === "PageUp" || (e.key === " " && e.shiftKey)) goPage((p) => p - 1);
      else if (e.key === "Home") goPage(0);
      else if (e.key === "End") goPage(count - 1);
      else if (e.key === "ArrowUp" || e.key === "+" || e.key === "=") zoomBy(1);
      else if (e.key === "ArrowDown" || e.key === "-" || e.key === "_") zoomBy(-1);
      else if (e.key === "0") useStore.getState().setEditZoom(1);
      else if (e.key === "1") useStore.getState().setEditZoom(useStore.getState().editActual);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, count, goPage, zoomBy]);

  // Wheel: turns pages when the page fits (scrolls when zoomed in); Ctrl+wheel (pinch) zooms; a
  // sideways trackpad swipe goes to the next or previous file.
  const wheel = useRef({ acc: 0, at: 0, x: 0, lock: 0 });
  const onWheel = (e: React.WheelEvent) => {
    const w = wheel.current;
    const now = performance.now();
    if (e.ctrlKey || e.metaKey) {
      w.acc += e.deltaY;
      if (Math.abs(w.acc) < 40) return;
      zoomBy(w.acc > 0 ? -1 : 1);
      w.acc = 0;
      return;
    }
    if (z > 1) return; // the view scrolls
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      if (now < w.lock) {
        w.lock = now + 200;
        return;
      }
      w.x += e.deltaX;
      if (Math.abs(w.x) < 70) return;
      const d = w.x > 0 ? 1 : -1;
      w.x = 0;
      w.lock = now + 200;
      const seq = selectEditorSequence(useStore.getState());
      const next = seq[seq.indexOf(id) + d];
      if (next != null) editorGo(next, d);
      return;
    }
    w.acc += e.deltaY;
    if (Math.abs(w.acc) < 60) return;
    const down = w.acc > 0;
    w.acc = 0;
    if (now - w.at < 220) return;
    w.at = now;
    goPage((p) => p + (down ? 1 : -1));
  };

  // Drag to move around a zoomed page.
  const [dragging, setDragging] = useState(false);
  const onMouseDown = (e: React.MouseEvent) => {
    const el = scrollRef.current;
    if (!el || e.button !== 0 || z <= 1) return;
    e.preventDefault();
    const start = { x: e.clientX, y: e.clientY, l: el.scrollLeft, t: el.scrollTop };
    setDragging(true);
    const move = (ev: MouseEvent) => {
      el.scrollLeft = start.l - (ev.clientX - start.x);
      el.scrollTop = start.t - (ev.clientY - start.y);
    };
    const up = () => {
      setDragging(false);
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  const [typed, setTyped] = useState<string | null>(null);
  const cancelTyped = useRef(false);
  return (
    <div className="edit-stage pdf-stage">
      <div
        ref={scrollRef}
        className={`pdf-scroll${z > 1 ? " zoomed" : ""}${dragging ? " dragging" : ""}`}
        onWheel={onWheel}
        onMouseDown={onMouseDown}
        onScroll={(e) => (scrolled.current = { l: e.currentTarget.scrollLeft, t: e.currentTarget.scrollTop })}
        onDoubleClick={(e) => e.target === e.currentTarget && onBack()}
      >
        {sizes === "failed" ? (
          <div className="video-fail">
            <img src={thumbUrl(id)} alt="" draggable={false} onError={(e) => (e.currentTarget.style.visibility = "hidden")} />
            <span>This PDF can't be shown inside Picaluma (it may be password-protected or damaged).</span>
          </div>
        ) : (
          hasPage && (
            <div className="pdf-canvas" style={{ width: Math.max(view.w, dw + PAD), height: Math.max(view.h, dh + PAD) }} onDoubleClick={(e) => e.target === e.currentTarget && onBack()}>
              <div ref={pageRef} className="edit-photo pdf-page" style={{ width: dw, height: dh }}>
                <img className="pdf-low" src={pdfPageUrl(id, page, THUMB_EDGE * 2)} alt="" draggable={false} />
                {shown && <img className="pdf-sharp" src={shown} alt="" draggable={false} />}
              </div>
            </div>
          )
        )}
      </div>
      {count > 0 && (
        <div className="pdf-pagebar">
          <button className="tbtn icon" title="Previous page (Page Up)" disabled={page <= 0} onClick={() => goPage(page - 1)}>
            <ArrowIcon dir="left" />
          </button>
          <span>
            Page
            <input
              value={typed ?? String(page + 1)}
              onFocus={(e) => (setTyped(String(page + 1)), e.currentTarget.select())}
              onChange={(e) => setTyped(e.target.value.replace(/\D/g, ""))}
              onBlur={() => {
                if (typed && !cancelTyped.current) goPage(Number(typed) - 1);
                cancelTyped.current = false;
                setTyped(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                else if (e.key === "Escape") {
                  cancelTyped.current = true;
                  e.currentTarget.blur();
                }
                e.stopPropagation();
              }}
              aria-label="Page number"
            />
            of {count}
          </span>
          <button className="tbtn icon" title="Next page (Page Down)" disabled={page >= count - 1} onClick={() => goPage(page + 1)}>
            <ArrowIcon dir="right" />
          </button>
        </div>
      )}
    </div>
  );
}
