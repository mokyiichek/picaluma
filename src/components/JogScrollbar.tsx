import { RefObject, useEffect, useRef, useState } from "react";

/**
 * Picasa's library scrollbar is a jog shuttle, not a position thumb: the grip rests in the
 * middle, dragging it away scrolls continuously (faster the further you pull), and it springs
 * back on release. The end buttons jump to the top/bottom or step one row.
 */
export default function JogScrollbar({ target, rowHeight }: { target: RefObject<HTMLDivElement>; rowHeight: number }) {
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ startY: number; offset: number; raf: number } | null>(null);

  const scrollBy = (dy: number, smooth = true) => target.current?.scrollBy({ top: dy, behavior: smooth ? "smooth" : "auto" });
  const jump = (top: boolean) => {
    const el = target.current;
    if (el) el.scrollTo({ top: top ? 0 : el.scrollHeight, behavior: "auto" });
  };

  useEffect(() => () => cancelAnimationFrame(drag.current?.raf ?? 0), []);

  const onGripDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).dataset.step) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDragging(true);
    const state = { startY: e.clientY, offset: 0, raf: 0 };
    drag.current = state;
    const tick = () => {
      const o = state.offset;
      // Dead zone, then speed grows faster than linearly with distance (px per frame).
      const mag = Math.max(0, Math.abs(o) - 4);
      if (mag > 0 && target.current) target.current.scrollTop += Math.sign(o) * Math.min(400, 0.35 * Math.pow(mag, 1.45));
      state.raf = requestAnimationFrame(tick);
    };
    state.raf = requestAnimationFrame(tick);
  };

  const onGripMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const track = trackRef.current;
    const limit = track ? track.clientHeight / 2 - 34 : 200;
    d.offset = Math.max(-limit, Math.min(limit, e.clientY - d.startY));
    setOffset(d.offset);
  };

  const onGripUp = () => {
    if (!drag.current) return;
    cancelAnimationFrame(drag.current.raf);
    drag.current = null;
    setDragging(false);
    setOffset(0);
  };

  const onTrackDown = (e: React.MouseEvent) => {
    if (e.target !== e.currentTarget) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const page = (target.current?.clientHeight ?? 600) * 0.9;
    scrollBy(e.clientY < rect.top + rect.height / 2 ? -page : page);
  };

  return (
    <div className="jog">
      <button className="jog-btn" title="Top" onClick={() => jump(true)}>
        <Arrow up bar />
      </button>
      <button className="jog-btn" title="Up" onClick={() => scrollBy(-rowHeight)}>
        <Arrow up />
      </button>
      <div className="jog-track" ref={trackRef} onMouseDown={onTrackDown}>
        <div
          className={`jog-grip${dragging ? " dragging" : ""}`}
          style={{ transform: `translateY(calc(-50% + ${offset}px))` }}
          onPointerDown={onGripDown}
          onPointerMove={onGripMove}
          onPointerUp={onGripUp}
          onPointerCancel={onGripUp}
          title="Drag to scroll"
        >
          <span data-step="up" onClick={() => scrollBy(-rowHeight)}>
            <Arrow up />
          </span>
          <span data-step="down" onClick={() => scrollBy(rowHeight)}>
            <Arrow />
          </span>
        </div>
      </div>
      <button className="jog-btn" title="Down" onClick={() => scrollBy(rowHeight)}>
        <Arrow />
      </button>
      <button className="jog-btn" title="Bottom" onClick={() => jump(false)}>
        <Arrow bar />
      </button>
    </div>
  );
}

function Arrow({ up = false, bar = false }: { up?: boolean; bar?: boolean }) {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden style={{ pointerEvents: "none", transform: up ? undefined : "scaleY(-1)" }}>
      {bar && <rect x="1.5" y="1" width="9" height="1.6" fill="#4d7fb3" />}
      <path d="M6 3.6 10.5 9.4H1.5z" fill="#4d7fb3" />
    </svg>
  );
}
