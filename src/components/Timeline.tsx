import { useEffect, useMemo, useRef, useState } from "react";
import { thumbUrl } from "../api";
import { fmtDate, plural } from "../format";
import { useStore } from "../store";

/**
 * View › Timeline (Ctrl+5), Picasa's way: the library's folders in date order across a
 * timeline, the current one shown as a fan of pictures. ← / → or the wheel to move, click the
 * timeline to jump, Enter (or Play) for a slideshow of that folder, Esc to leave.
 */
export default function Timeline() {
  const open = useStore((s) => s.timelineOpen);
  const folders = useStore((s) => s.snapshot?.folders);
  const hidden = useStore((s) => s.hidden);
  const list = useMemo(
    () =>
      (folders ?? [])
        .map((f) => ({ ...f, photos: f.photos.filter((p) => !hidden.has(p)), when: f.dateMin || f.dateMax || f.updated }))
        .filter((f) => f.photos.length && f.when)
        .sort((a, b) => a.when - b.when),
    [folders, hidden],
  );
  const [i, setI] = useState(0);
  const wheel = useRef(0);
  // The Esc that ends a slideshow (and leaves full screen) mustn't also close the timeline.
  const slideshow = useStore((s) => s.slideshow != null);
  const slideEnded = useRef(0);
  useEffect(() => {
    if (!slideshow) slideEnded.current = Date.now();
  }, [slideshow]);

  // Start at the folder that was open (or the newest).
  useEffect(() => {
    if (!open) return;
    const cur = useStore.getState().currentFolderId;
    const at = list.findIndex((f) => f.id === cur);
    setI(at >= 0 ? at : list.length - 1);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const s = useStore.getState();
      if (s.slideshow) return;
      if (e.key === "Escape") {
        if (Date.now() - slideEnded.current > 600) s.setTimelineOpen(false);
      }
      else if (e.key === "ArrowRight") setI((x) => Math.min(list.length - 1, x + 1));
      else if (e.key === "ArrowLeft") setI((x) => Math.max(0, x - 1));
      else if (e.key === "Home") setI(0);
      else if (e.key === "End") setI(list.length - 1);
      else if (e.key === "Enter" || e.key === " ") list[i] && s.startSlideshow(list[i].photos);
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, list, i]);

  if (!open) return null;
  const f = list[Math.min(i, list.length - 1)];
  const first = list[0]?.when ?? 0;
  const last = list[list.length - 1]?.when ?? 1;
  const span = Math.max(1, last - first);
  const pos = (t: number) => ((t - first) / span) * 100;
  const years: number[] = [];
  if (list.length) {
    for (let y = new Date(first * 1000).getUTCFullYear(); y <= new Date(last * 1000).getUTCFullYear(); y++) years.push(y);
  }
  const yearStep = Math.max(1, Math.ceil(years.length / 14));
  const fan = f ? f.photos.slice(0, 5) : [];

  return (
    <div
      className="timeline"
      onWheel={(e) => {
        wheel.current += e.deltaY + e.deltaX;
        if (Math.abs(wheel.current) < 60) return;
        const d = wheel.current > 0 ? 1 : -1;
        wheel.current = 0;
        setI((x) => Math.max(0, Math.min(list.length - 1, x + d)));
      }}
    >
      <button className="tl-close" onClick={() => useStore.getState().setTimelineOpen(false)} title="Back to Library (Esc)">
        ✕
      </button>
      {!f ? (
        <p className="tl-empty">No dated folders yet.</p>
      ) : (
        <>
          <div className="tl-stage">
            <button className="tl-arrow" disabled={i <= 0} onClick={() => setI(i - 1)} title="Earlier (←)">
              ‹
            </button>
            <div className="tl-fan" key={f.id} onClick={() => useStore.getState().startSlideshow(f.photos)} title="Play a slideshow of this folder (Enter)">
              {fan.map((p, k) => (
                <img
                  key={p}
                  src={thumbUrl(p)}
                  alt=""
                  draggable={false}
                  style={{ transform: `translate(-50%, -50%) translateX(${(k - (fan.length - 1) / 2) * 70}px) rotate(${(k - (fan.length - 1) / 2) * 6}deg)`, zIndex: k === Math.floor(fan.length / 2) ? 10 : 5 - Math.abs(k - 2) }}
                />
              ))}
            </div>
            <button className="tl-arrow" disabled={i >= list.length - 1} onClick={() => setI(i + 1)} title="Later (→)">
              ›
            </button>
          </div>
          <div className="tl-caption">
            <h2>{f.name}</h2>
            <span>
              {fmtDate(f.when)} · {plural(f.photos.length, "picture")}
            </span>
            {f.description && <p>{f.description}</p>}
            <div className="tl-buttons">
              <button className="tbtn" onClick={() => useStore.getState().startSlideshow(f.photos)}>
                ▶ Play
              </button>
              <button
                className="tbtn"
                onClick={() => {
                  const s = useStore.getState();
                  s.setTimelineOpen(false);
                  s.selectFolder(f.id);
                }}
              >
                Open Folder
              </button>
            </div>
          </div>
          <div
            className="tl-track"
            onClick={(e) => {
              const b = e.currentTarget.getBoundingClientRect();
              const t = first + ((e.clientX - b.left) / b.width) * span;
              let best = 0;
              list.forEach((x, k) => Math.abs(x.when - t) < Math.abs(list[best].when - t) && (best = k));
              setI(best);
            }}
          >
            {list.map((x, k) => (
              <span key={x.id} className={`tl-tick${k === i ? " on" : ""}`} style={{ left: `${pos(x.when)}%` }} />
            ))}
            {years
              .filter((y, k) => k % yearStep === 0 && pos(Date.UTC(y, 0, 1) / 1000) >= 0)
              .map((y) => (
                <span key={y} className="tl-year" style={{ left: `${pos(Date.UTC(y, 0, 1) / 1000)}%` }}>
                  {y}
                </span>
              ))}
          </div>
          <div className="tl-count">
            {i + 1} of {list.length} folders
          </div>
        </>
      )}
    </div>
  );
}
