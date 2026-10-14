import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { photoUrl } from "../api";
import { render } from "../effects";
import { useStore } from "../store";

const INTERVAL_MS = 3500;

/** Fullscreen slideshow with Picasa-style crossfades. Space pauses, arrows step, Esc exits. */
export default function Slideshow() {
  const show = useStore((s) => s.slideshow);
  const setIndex = useStore((s) => s.setSlideshowIndex);
  const stop = useStore((s) => s.stopSlideshow);
  const edits = useStore((s) => s.edits);
  const [playing, setPlaying] = useState(true);
  const [ui, setUi] = useState(false);
  const [layers, setLayers] = useState<{ a: number | null; b: number | null; front: "a" | "b" }>({ a: null, b: null, front: "a" });
  const uiTimer = useRef<number>();

  useEffect(() => {
    if (!show) return;
    const win = getCurrentWindow();
    win.setFullscreen(true).catch(() => {});
    setPlaying(true);
    return () => {
      win.setFullscreen(false).catch(() => {});
    };
  }, [show != null]); // eslint-disable-line react-hooks/exhaustive-deps

  // Crossfade: load the next photo into the back layer, then swap which layer is in front.
  useEffect(() => {
    if (!show) return;
    const id = show.photos[show.index];
    setLayers((l) => (l.front === "a" ? { ...l, b: id, front: "b" } : { ...l, a: id, front: "a" }));
  }, [show?.index, show?.photos]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!show || !playing) return;
    const t = window.setTimeout(() => {
      if (show.index + 1 < show.photos.length) setIndex(show.index + 1);
      else stop();
    }, INTERVAL_MS);
    return () => clearTimeout(t);
  }, [show, playing, setIndex, stop]);

  useEffect(() => {
    if (!show) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      if (e.key === "Escape") stop();
      else if (e.key === " ") setPlaying((p) => !p);
      else if (e.key === "ArrowRight") setIndex(Math.min(show.photos.length - 1, show.index + 1));
      else if (e.key === "ArrowLeft") setIndex(Math.max(0, show.index - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [show, stop, setIndex]);

  if (!show) return null;
  const style = (id: number | null) => {
    if (id == null) return {};
    const r = render(edits.get(id) ?? []);
    return { filter: r.filter || undefined, transform: r.rotate ? `rotate(${r.rotate}deg)` : undefined };
  };

  return (
    <div
      className={`slideshow${ui ? " ui" : ""}`}
      onMouseMove={() => {
        setUi(true);
        clearTimeout(uiTimer.current);
        uiTimer.current = window.setTimeout(() => setUi(false), 1800);
      }}
      onClick={() => setPlaying((p) => !p)}
    >
      {layers.a != null && <img src={photoUrl(layers.a)} style={{ ...style(layers.a), opacity: layers.front === "a" ? 1 : 0 }} alt="" />}
      {layers.b != null && <img src={photoUrl(layers.b)} style={{ ...style(layers.b), opacity: layers.front === "b" ? 1 : 0 }} alt="" />}
      <div className="bar" onClick={(e) => e.stopPropagation()}>
        <button onClick={() => setIndex(Math.max(0, show.index - 1))}>⏮</button>
        <button onClick={() => setPlaying((p) => !p)}>{playing ? "⏸" : "▶"}</button>
        <button onClick={() => setIndex(Math.min(show.photos.length - 1, show.index + 1))}>⏭</button>
        <span style={{ fontSize: 12, minWidth: 70, textAlign: "center" }}>
          {show.index + 1} / {show.photos.length}
        </span>
        <button onClick={stop}>✕</button>
      </div>
    </div>
  );
}
