import { useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { api, musicUrl, photoUrl } from "../api";
import { loadSlideshowOpts } from "../slideshowOpts";
import { render } from "../effects";
import { useStore } from "../store";

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
  // Options are read when the slideshow starts.
  const opts = useMemo(() => loadSlideshowOpts(), [show != null]); // eslint-disable-line react-hooks/exhaustive-deps
  const [caption, setCaption] = useState("");
  // Folder Properties › music: the folder of the first picture.
  const music = useMemo(() => {
    if (!show) return null;
    const s = useStore.getState();
    const folder = s.folderOfPhoto.get(show.photos[0]);
    return folder != null && s.folderById.get(folder)?.music ? musicUrl(folder) : null;
  }, [show != null]); // eslint-disable-line react-hooks/exhaustive-deps
  const audio = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const a = audio.current;
    if (!a) return;
    playing ? a.play().catch(() => {}) : a.pause();
  }, [playing, music]);

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
      else if (opts.loop) setIndex(0);
      else stop();
    }, opts.seconds * 1000);
    return () => clearTimeout(t);
  }, [show, playing, setIndex, stop, opts]);

  // The picture's caption, shown at the bottom (Options › Slideshow).
  useEffect(() => {
    setCaption("");
    if (!show || !opts.captions) return;
    let live = true;
    api
      .getPhoto(show.photos[show.index])
      .then((p) => live && setCaption(p.caption))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [show?.index, show?.photos, opts.captions]); // eslint-disable-line react-hooks/exhaustive-deps

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
      className={`slideshow${ui ? " ui" : ""} tr-${opts.transition}`}
      style={{ "--slide-ms": `${opts.seconds * 1000 + 800}ms` } as React.CSSProperties}
      onMouseMove={() => {
        setUi(true);
        clearTimeout(uiTimer.current);
        uiTimer.current = window.setTimeout(() => setUi(false), 1800);
      }}
      onClick={() => setPlaying((p) => !p)}
    >
      {layers.a != null && (
        <img key={`a${layers.a}`} className={`${layers.front === "a" ? "front" : ""}${style(layers.a).transform ? " rot" : ""}`} src={photoUrl(layers.a)} style={{ ...style(layers.a), opacity: layers.front === "a" ? 1 : 0 }} alt="" />
      )}
      {layers.b != null && (
        <img key={`b${layers.b}`} className={`${layers.front === "b" ? "front" : ""}${style(layers.b).transform ? " rot" : ""}`} src={photoUrl(layers.b)} style={{ ...style(layers.b), opacity: layers.front === "b" ? 1 : 0 }} alt="" />
      )}
      {caption && <div className="slide-caption">{caption}</div>}
      {music && <audio ref={audio} src={music} autoPlay loop />}
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
