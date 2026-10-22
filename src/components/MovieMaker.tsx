import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openFile, save } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { api, photoUrl } from "../api";
import { renderToCanvas } from "../effects";
import { useStore } from "../store";
import { confirmAsk, notify } from "../dialogs";
import { plural } from "../format";

type Transition = "dissolve" | "panzoom" | "cut";
const SIZES: [string, number, number][] = [
  ["1280 × 720 (HD)", 1280, 720],
  ["1920 × 1080 (Full HD)", 1920, 1080],
  ["854 × 480", 854, 480],
];
const FPS = 30;
const FADE = 1; // seconds of overlap between slides

/** The best format this computer's recorder can make: MP4 where supported, else WebM. */
function recorderFormat(): { mime: string; ext: string } {
  const tries: [string, string][] = [
    ["video/mp4;codecs=avc1,mp4a.40.2", "mp4"],
    ["video/mp4", "mp4"],
    ["video/webm;codecs=vp9,opus", "webm"],
    ["video/webm;codecs=vp8,opus", "webm"],
    ["video/webm", "webm"],
  ];
  for (const [mime, ext] of tries) if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(mime)) return { mime, ext };
  return { mime: "", ext: "webm" };
}

const mediaUrl = (path: string) => {
  const isWindows = navigator.userAgent.includes("Windows");
  return `${isWindows ? "http://photo.localhost/" : "photo://localhost/"}media?p=${encodeURIComponent(path)}`;
};

/**
 * Create › Movie, as in Picasa's Movie Maker: the selected pictures as a video with a soundtrack,
 * transitions, a chosen slide length and optional captions. Recorded on this computer.
 */
export default function MovieMaker() {
  const ids = useStore((s) => s.movie);
  const close = () => useStore.getState().setMovie(null);
  const [seconds, setSeconds] = useState(4);
  const [transition, setTransition] = useState<Transition>("dissolve");
  const [size, setSize] = useState(0);
  const [captions, setCaptions] = useState(true);
  const [fill, setFill] = useState(false);
  const [music, setMusic] = useState("");
  const [title, setTitle] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const cancel = useRef(false);
  const preview = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!ids) return;
    const s = useStore.getState();
    const folder = s.folderOfPhoto.get(ids[0]);
    const f = folder != null ? s.folderById.get(folder) : undefined;
    setTitle(f?.name ?? "");
    setMusic(f?.music ?? "");
    setProgress(null);
  }, [ids]);

  if (!ids) return null;
  const pics = ids.filter((id) => !useStore.getState().videos.has(id));
  const total = pics.length * seconds + (title ? 3 : 0);
  const busy = progress != null;

  const pickMusic = async () => {
    const f = await openFile({ title: "Soundtrack", filters: [{ name: "Music", extensions: ["mp3", "m4a", "aac", "wav", "ogg", "flac"] }] });
    if (typeof f === "string") setMusic(f);
  };

  const make = async () => {
    const fmt = recorderFormat();
    if (!fmt.mime) return void notify("This computer can't record video.", "error");
    const name = `${(title || "Movie").replace(/[<>:"/\\|?*]/g, "-")}.${fmt.ext}`;
    const target = await save({ title: "Save movie", defaultPath: name, filters: [{ name: "Movie", extensions: [fmt.ext] }] });
    if (!target) return;
    cancel.current = false;
    setProgress(0);
    const [, W, H] = SIZES[size];
    const canvas = preview.current!;
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d")!;
    try {
      // Pictures with their edits, at the movie's size; captions alongside.
      const edits = useStore.getState().edits;
      const frames: { img: HTMLCanvasElement; caption: string }[] = [];
      for (let i = 0; i < pics.length; i++) {
        if (cancel.current) throw new Error("cancelled");
        const img = await renderToCanvas(photoUrl(pics[i]), edits.get(pics[i]) ?? [], Math.max(W, H) * 1.2);
        const caption = captions ? (await api.getPhoto(pics[i]).catch(() => null))?.caption ?? "" : "";
        frames.push({ img, caption });
        setProgress((i + 1) / pics.length / 4);
      }

      // Soundtrack through Web Audio, so it is part of the recording.
      const stream = canvas.captureStream(FPS);
      let audioEl: HTMLAudioElement | null = null;
      let actx: AudioContext | null = null;
      if (music) {
        await api.allowMedia(music);
        audioEl = new Audio(mediaUrl(music));
        audioEl.crossOrigin = "anonymous";
        audioEl.loop = true;
        actx = new AudioContext();
        const src = actx.createMediaElementSource(audioEl);
        const dest = actx.createMediaStreamDestination();
        const gain = actx.createGain();
        src.connect(gain).connect(dest);
        dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
        // Fade the music out over the last two seconds.
        gain.gain.setValueAtTime(1, actx.currentTime + Math.max(0, total - 2));
        gain.gain.linearRampToValueAtTime(0, actx.currentTime + total);
      }
      const chunks: Blob[] = [];
      const rec = new MediaRecorder(stream, { mimeType: fmt.mime, videoBitsPerSecond: W >= 1920 ? 10_000_000 : 6_000_000 });
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      const stopped = new Promise<void>((ok) => (rec.onstop = () => ok()));
      rec.start(1000);
      audioEl?.play().catch(() => {});

      const draw = (f: (typeof frames)[number], alpha: number, t: number) => {
        const { img } = f;
        const scale = (fill ? Math.max : Math.min)(W / img.width, H / img.height) * (transition === "panzoom" ? 1 + 0.1 * t : 1);
        const w = img.width * scale;
        const h = img.height * scale;
        const dx = transition === "panzoom" ? (t - 0.5) * W * 0.04 : 0;
        ctx.globalAlpha = alpha;
        ctx.drawImage(img, (W - w) / 2 + dx, (H - h) / 2, w, h);
        ctx.globalAlpha = 1;
      };
      const caption = (text: string, alpha: number) => {
        if (!text) return;
        ctx.globalAlpha = alpha;
        ctx.font = `${Math.round(H / 22)}px Georgia, serif`;
        ctx.textAlign = "center";
        const y = H - H / 12;
        const w = ctx.measureText(text).width + H / 18;
        ctx.fillStyle = "rgba(0,0,0,0.55)";
        ctx.fillRect(W / 2 - w / 2, y - H / 18, w, H / 14);
        ctx.fillStyle = "#fff";
        ctx.fillText(text, W / 2, y);
        ctx.globalAlpha = 1;
      };
      const intro = title ? 3 : 0;
      const start = performance.now();
      await new Promise<void>((done) => {
        const tick = () => {
          const t = (performance.now() - start) / 1000;
          if (cancel.current || t >= total) return done();
          ctx.fillStyle = "#000";
          ctx.fillRect(0, 0, W, H);
          if (t < intro) {
            // Title card, as in Picasa.
            const a = Math.min(1, t / 0.6, (intro - t) / 0.6);
            ctx.globalAlpha = a;
            ctx.fillStyle = "#fff";
            ctx.textAlign = "center";
            ctx.font = `${Math.round(H / 12)}px Georgia, serif`;
            ctx.fillText(title, W / 2, H / 2);
            ctx.globalAlpha = 1;
          } else {
            const st = t - intro;
            const i = Math.min(frames.length - 1, Math.floor(st / seconds));
            const local = (st - i * seconds) / seconds;
            draw(frames[i], 1, local);
            caption(frames[i].caption, 1);
            const into = st - (i + 1) * seconds + FADE;
            if (transition !== "cut" && i + 1 < frames.length && into > 0) {
              const a = Math.min(1, into / FADE);
              draw(frames[i + 1], a, 0);
              caption(frames[i + 1].caption, a);
            }
          }
          setProgress(0.25 + 0.75 * (t / total));
          requestAnimationFrame(tick);
        };
        tick();
      });
      rec.stop();
      audioEl?.pause();
      await stopped;
      actx?.close();
      frames.forEach((f) => (f.img.width = 0));
      if (cancel.current) throw new Error("cancelled");
      const blob = new Blob(chunks, { type: fmt.mime });
      const saved = await invoke<string>("write_bytes", new Uint8Array(await blob.arrayBuffer()), { headers: { path: encodeURIComponent(target) } });
      close();
      if (await confirmAsk(`Movie saved:
${saved}`, { title: "Movie", ok: "Show in Folder", cancel: "OK" })) revealItemInDir(saved).catch(() => {});
    } catch (e) {
      if (String(e).includes("cancelled")) setProgress(null);
      else {
        setProgress(null);
        notify(`Couldn't make the movie: ${e}`, "error");
      }
    }
  };

  const mm = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
  return (
    <div className="modal-back">
      <div className="modal movie-maker">
        <h3>Movie</h3>
        <div className="body mm-body">
          <div className="mm-opts">
            <label className="opt-row">
              Title
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="(no title card)" disabled={busy} />
            </label>
            <label className="opt-row">
              Soundtrack
              <span className="mm-music" title={music}>
                {music ? music.split(/[\\/]/).pop() : "None"}
              </span>
              <button className="tbtn" onClick={pickMusic} disabled={busy}>
                Load...
              </button>
              {music && (
                <button className="tbtn" onClick={() => setMusic("")} disabled={busy}>
                  Clear
                </button>
              )}
            </label>
            <label className="opt-row">
              Transition
              <select value={transition} onChange={(e) => setTransition(e.target.value as Transition)} disabled={busy}>
                <option value="dissolve">Dissolve</option>
                <option value="panzoom">Pan and zoom</option>
                <option value="cut">Cut</option>
              </select>
            </label>
            <label className="opt-row">
              Slide duration
              <input type="range" className="slider" min={1} max={12} step={0.5} value={seconds} onChange={(e) => setSeconds(Number(e.target.value))} disabled={busy} />
              <b>{seconds} s</b>
            </label>
            <label className="opt-row">
              Dimensions
              <select value={size} onChange={(e) => setSize(Number(e.target.value))} disabled={busy}>
                {SIZES.map(([label], i) => (
                  <option key={label} value={i}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="opt-check">
              <input type="checkbox" checked={captions} onChange={(e) => setCaptions(e.target.checked)} disabled={busy} />
              <span>Show captions</span>
            </label>
            <label className="opt-check">
              <input type="checkbox" checked={fill} onChange={(e) => setFill(e.target.checked)} disabled={busy} />
              <span>Full frame crop (no black bars)</span>
            </label>
            <p className="muted small">
              {plural(pics.length, "picture")} · {mm(total)} long. The movie is recorded in real time, so making it takes about as long as it lasts.
            </p>
          </div>
          <canvas ref={preview} className="mm-preview" width={1280} height={720} />
        </div>
        {busy && (
          <div className="mm-progress">
            <div style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        )}
        <div className="foot">
          <button className="tbtn default" disabled={busy || !pics.length} onClick={make}>
            Create Movie
          </button>
          <button
            className="tbtn"
            onClick={() => {
              if (busy) cancel.current = true;
              else close();
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
