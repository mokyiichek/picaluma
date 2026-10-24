import { mod } from "../platform";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { api, photoUrl, thumbUrl, Photo } from "../api";
import { CropRect, cropViewBox, displayAspect, Edit, EFFECTS, Param, render, renderToCanvas, SLIDER_OPS, sliderValue, straightenScale, TABS } from "../effects";
import { hasPixelOps, LEVEL_OPS, measureLevels } from "../pixelfx";
import { newPixelTool, PIXEL_TOOLS, PixelTool, PixelToolOverlay, PixelToolPanel, toolEdit, worksOnOriginal } from "./PixelTools";
import { CropOverlay, CropPanel, StraightenBar, Tool } from "./Tools";
import { selectEditorSequence, useStore } from "../store";
import { ArrowIcon, BackIcon, BrushIcon, PlayIcon, SunIcon, WrenchIcon } from "./Icons";
import { usePhoto } from "./PropertiesPanel";
import { usePhotoFaces } from "./PeoplePanel";
import { askText, notify } from "../dialogs";
import { menuOwnsShortcut } from "../nativeMenu";

const STAGE_PAD = 14;
/** Edit view zoom steps, as multiples of the fitted size. */
const ZOOMS = [1, 1.25, 1.5, 2, 3, 4, 6, 8];
type Zoom = { z: number; x: number; y: number };
const FIT: Zoom = { z: 1, x: 0, y: 0 };

type ToolName = "crop" | "straighten" | PixelTool["kind"];
let lastTab = "fixes";
/** Effects that open a tool instead of applying straight away. */
const TOOL_EFFECTS: Record<string, ToolName> = { crop: "crop", straighten: "straighten", redeye: "redeye", retouch: "retouch", text: "text", focalZoom: "focal" };

/** Canvas rendering of the edit stack for effects CSS can't show (Red-eye, Retouch, Text…). */
function usePixelPreview(id: number, edits: Edit[], enabled: boolean): string | null {
  const [url, setUrl] = useState<string | null>(null);
  const key = enabled ? JSON.stringify(edits) : "";
  useEffect(() => {
    if (!enabled) {
      setUrl((old) => {
        if (old) URL.revokeObjectURL(old);
        return null;
      });
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const canvas = await renderToCanvas(photoUrl(id), edits, 2000);
        const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/jpeg", 0.92));
        canvas.width = 0; // free the render canvas; the preview is the JPEG from here on
        if (cancelled || !blob) return;
        const next = URL.createObjectURL(blob);
        setUrl((old) => {
          if (old) URL.revokeObjectURL(old);
          return next;
        });
      } catch {
        /* keep showing the CSS rendering */
      }
    }, 150); // let quick successive changes (sliders, clicks) settle before rendering
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [id, key]); // eslint-disable-line react-hooks/exhaustive-deps
  return url;
}

/** Oriented thumbnail aspect ratios, filled by the grid as thumbnails load. */
export { aspectCache } from "../aspect";
import { aspectCache } from "../aspect";

/** Shared editor state: the current photo's edit stack plus a redo stack. */
function useEditStack(id: number | null) {
  const edits = useStore((s) => (id != null ? s.edits.get(id) : undefined)) ?? EMPTY;
  const setPhotoEdits = useStore((s) => s.setPhotoEdits);
  const [redo, setRedo] = useState<Edit[]>([]);
  useEffect(() => setRedo([]), [id]);

  const apply = useCallback(
    (op: string, v?: number, r?: CropRect) => {
      if (id == null) return;
      const last = edits[edits.length - 1];
      const e: Edit = r ? { op, r } : { op, v };
      const next = SLIDER_OPS.has(op) && last?.op === op ? [...edits.slice(0, -1), e] : [...edits, e];
      setPhotoEdits(id, next);
      setRedo([]);
    },
    [id, edits, setPhotoEdits],
  );
  const applyEdit = useCallback(
    (e: Edit) => {
      if (id == null) return;
      setPhotoEdits(id, [...edits, e]);
      setRedo([]);
    },
    [id, edits, setPhotoEdits],
  );
  const undo = useCallback(() => {
    if (id == null || !edits.length) return;
    setRedo((r) => [...r, edits[edits.length - 1]]);
    setPhotoEdits(id, edits.slice(0, -1));
  }, [id, edits, setPhotoEdits]);
  const redoOne = useCallback(() => {
    if (id == null || !redo.length) return;
    setPhotoEdits(id, [...edits, redo[redo.length - 1]]);
    setRedo((r) => r.slice(0, -1));
  }, [id, edits, redo, setPhotoEdits]);
  return { edits, apply, applyEdit, undo, redo: redoOne, canRedo: redo.length > 0 };
}
const EMPTY: Edit[] = [];

export function EditToolbar() {
  const id = useStore((s) => s.editId);
  const seq = useStore(selectEditorSequence);
  const setEditId = useStore((s) => s.setEditId);
  const startSlideshow = useStore((s) => s.startSlideshow);
  const compare = useStore((s) => s.compare);
  const setCompare = useStore((s) => s.setCompare);
  const idx = id != null ? seq.indexOf(id) : -1;
  const windowStart = Math.max(0, Math.min(idx - 4, seq.length - 9));
  const strip = seq.slice(windowStart, windowStart + 9);

  return (
    <div className="toolbar">
      <button className="tbtn" onClick={backToLibrary} title="Back to Library (Esc)">
        <BackIcon /> Back to Library
      </button>
      <div className="filmstrip">
        <button className="tbtn" style={{ width: 92 }} onClick={() => startSlideshow(seq, Math.max(0, idx))} title="Play fullscreen slideshow">
          <PlayIcon /> Play
        </button>
        <button className="arrow" onClick={() => idx > 0 && setEditId(seq[idx - 1])} title="Previous (←)">
          <ArrowIcon dir="left" />
        </button>
        <div className="strip">
          {strip.map((p) => (
            <img key={p} src={thumbUrl(p)} className={p === id ? "cur" : ""} onClick={() => setEditId(p)} alt="" draggable={false} onError={hideBroken} />
          ))}
        </div>
        <button className="arrow" onClick={() => idx < seq.length - 1 && setEditId(seq[idx + 1])} title="Next (→)">
          <ArrowIcon dir="right" />
        </button>
      </div>
      <div className="compare-modes">
        <button className={`tbtn mode${compare === "a" ? " pressed" : ""}`} title="The edited picture" onClick={() => setCompare("a")}>
          A
        </button>
        <button className={`tbtn mode${compare === "ab" ? " pressed" : ""}`} title="Before and after, side by side" onClick={() => setCompare("ab")}>
          AB
        </button>
        <button
          className={`tbtn mode${compare === "aa" ? " pressed" : ""}`}
          title="Compare two pictures: this one stays on the left while you move to others"
          onClick={() => setCompare("aa")}
        >
          AA
        </button>
      </div>
    </div>
  );
}

/** Leave the editor, zooming the photo back to its thumbnail. */
export function backToLibrary() {
  const s = useStore.getState();
  const id = s.editId;
  const box = document.querySelector(".edit-photo") as HTMLElement | null;
  if (id != null && box) {
    const r = box.getBoundingClientRect();
    const rendered = render(s.edits.get(id) ?? []);
    s.closeEditor({ photoId: id, src: thumbUrl(id), from: { x: r.left, y: r.top, w: r.width, h: r.height }, filter: rendered.filter, rotate: rendered.rotate });
  } else {
    s.closeEditor();
  }
}

export default function EditView({ active }: { active: boolean }) {
  const id = useStore((s) => s.editId);
  const photo = usePhoto(id);
  const stack = useEditStack(id);
  const isVideo = useStore((s) => id != null && s.videos.has(id));

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (menuOwnsShortcut(e)) return;
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" && (t as HTMLInputElement).type !== "range") return;
      const s = useStore.getState();
      if (s.slideshow) return;
      const seq = selectEditorSequence(s);
      const i = s.editId != null ? seq.indexOf(s.editId) : -1;
      if (e.key === "Escape" && s.drawFace) s.setDrawFace(false);
      else if (e.key === "Escape") backToLibrary();
      else if (e.key === "ArrowRight" && i < seq.length - 1) s.setEditId(seq[i + 1]);
      else if (e.key === "ArrowLeft" && i > 0) s.setEditId(seq[i - 1]);
      else if (mod(e) && e.shiftKey && e.key.toLowerCase() === "z") stack.redo(); // ⇧⌘Z on Mac
      else if (mod(e) && e.key.toLowerCase() === "z") stack.undo();
      else if (mod(e) && e.key.toLowerCase() === "y") stack.redo();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, stack]);

  // Modal tools (Crop / Straighten) take over the stage and left panel like Picasa's.
  const [tool, setTool] = useState<Tool>(null);
  useEffect(() => setTool(null), [id]);

  if (id == null) return null;
  if (isVideo) {
    return (
      <>
        <VideoPanel photo={photo} />
        <div className="edit-center">
          <VideoStage id={id} photo={photo} active={active} />
          <CaptionBar photo={photo} />
        </div>
      </>
    );
  }
  /** Clicking an effect: tools open, effects with settings open their panel, auto fixes measure the
   *  picture first, everything else applies straight away. */
  const onEffect = async (op: string) => {
    const def = EFFECTS[op];
    if (TOOL_EFFECTS[op]) return startTool(TOOL_EFFECTS[op]);
    if (def?.params) {
      setTool({ kind: "effect", edit: { op, ...Object.fromEntries(def.params.map((p) => [p.key, p.def])) } });
      return;
    }
    if (LEVEL_OPS.has(op)) {
      try {
        const c = await renderToCanvas(photoUrl(id), stack.edits, 640);
        const lv = measureLevels(c, op !== "autoContrast", op === "lucky" ? 0.003 : 0.005);
        c.width = 0;
        stack.applyEdit({ op, lv });
      } catch {
        stack.apply(op);
      }
      return;
    }
    stack.apply(op, op === "pixelate" ? 1 : undefined);
  };
  /** Neutral Color Picker: make the clicked spot grey, which corrects the colour of the whole picture. */
  const pickNeutral = async (fx: number, fy: number) => {
    const c = await renderToCanvas(photoUrl(id), stack.edits, 1200);
    const ctx = c.getContext("2d", { willReadFrequently: true })!;
    const cx = Math.round(fx * (c.width - 1));
    const cy = Math.round(fy * (c.height - 1));
    const x0 = Math.max(0, cx - 3);
    const y0 = Math.max(0, cy - 3);
    const d = ctx.getImageData(x0, y0, Math.min(7, c.width - x0), Math.min(7, c.height - y0)).data;
    c.width = 0;
    let [r, g, b] = [0, 0, 0];
    for (let i = 0; i < d.length; i += 4) [r, g, b] = [r + d[i], g + d[i + 1], b + d[i + 2]];
    if (Math.min(r, g, b) < (d.length / 4) * 6) {
      notify("That spot is too dark to judge its colour. Click something light grey or white.");
      return;
    }
    const m = (r + g + b) / 3;
    const gain = [m / r, m / g, m / b].map((k) => Math.min(2, Math.max(0.5, k)));
    stack.applyEdit({ op: "neutral", g: gain });
    setTool(null);
  };
  const startTool = (t: ToolName) => {
    const r = render(stack.edits);
    if (t === "crop") setTool({ kind: "crop", rect: r.crop ?? [0, 0, 1, 1], aspect: null });
    else if (t === "straighten") setTool({ kind: "straighten", angle: r.straighten });
    else setTool(newPixelTool(t));
  };
  const applyTool = () => {
    if (tool && PIXEL_TOOLS.has(tool.kind)) {
      const e = toolEdit(tool as PixelTool);
      if (e) stack.applyEdit(e);
    } else if (tool?.kind === "crop") {
      const [, , w, h] = tool.rect;
      if (w < 0.999 || h < 0.999) stack.apply("crop", undefined, tool.rect);
    } else if (tool?.kind === "straighten") stack.apply("straighten", tool.angle);
    else if (tool?.kind === "effect") stack.applyEdit(tool.edit);
    setTool(null);
  };

  return (
    <>
      {tool?.kind === "crop" ? (
        <CropPanel id={id} tool={tool} setTool={setTool} onApply={applyTool} onCancel={() => setTool(null)} />
      ) : tool && PIXEL_TOOLS.has(tool.kind) ? (
        <PixelToolPanel tool={tool as PixelTool} setTool={setTool} onApply={applyTool} onCancel={() => setTool(null)} />
      ) : tool?.kind === "effect" ? (
        <EffectPanel edit={tool.edit} onChange={(e) => setTool({ kind: "effect", edit: e })} onApply={applyTool} onCancel={() => setTool(null)} />
      ) : tool?.kind === "neutral" ? (
        <div className="edit-left tool-panel">
          <div className="tool-title">
            <span className="ico" />
            Neutral Color Picker
          </div>
          <p className="tool-help">Click something in the picture that should be grey or white — a wall, a shirt, a cloud. Its colour cast is removed from the whole picture.</p>
          <div className="tool-buttons">
            <span />
            <div className="row">
              <button className="tbtn" onClick={() => setTool(null)}>
                Cancel <span className="dot x">✕</span>
              </button>
            </div>
          </div>
        </div>
      ) : (
        <EditPanel id={id} photo={photo} stack={stack} onEffect={onEffect} onNeutral={() => setTool({ kind: "neutral" })} disabled={tool != null} />
      )}
      <div className="edit-center">
        <Stage id={id} photo={photo} edits={stack.edits} active={active} tool={tool} setTool={setTool} onNeutral={pickNeutral} />
        {tool?.kind === "straighten" && <StraightenBar tool={tool} setTool={setTool} onApply={applyTool} onCancel={() => setTool(null)} />}
        <CaptionBar photo={photo} />
      </div>
    </>
  );
}

const fmtBytes = (n: number) =>
  n >= 1 << 30 ? `${(n / (1 << 30)).toFixed(2)} GB` : n >= 1 << 20 ? `${(n / (1 << 20)).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
const hideBroken = (e: React.SyntheticEvent<HTMLImageElement>) => (e.currentTarget.style.visibility = "hidden");

/** Left panel for movies: there are no effects to apply, so it offers the file itself. */
function VideoPanel({ photo }: { photo: Photo | null }) {
  return (
    <div className="edit-left">
      <div className="video-panel">
        <b>{photo?.name ?? ""}</b>
        {photo && (
          <span className="muted">
            {photo.width ? `${photo.width} × ${photo.height} · ` : ""}
            {fmtBytes(photo.size)}
          </span>
        )}
        <span className="muted">Movies play here as they are; effects are for pictures only.</span>
        <button className="tbtn" disabled={!photo} onClick={() => photo && api.openInDefaultApp(photo.path)}>
          Open in Default Player
        </button>
        <button className="tbtn" disabled={!photo} onClick={() => photo && revealItemInDir(photo.path)}>
          Locate on Disk
        </button>
      </div>
    </div>
  );
}

/** Plays a movie straight from disk (streamed in pieces). `/` plays or pauses, `,` and `.` jump 5 seconds. */
function VideoStage({ id, photo, active }: { id: number; photo: Photo | null; active: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);
  const flight = useStore((s) => s.flight);
  useEffect(() => setFailed(false), [id]);
  useEffect(() => {
    if (flight) useStore.getState().endFlight();
  }, [flight]);
  useEffect(() => {
    if (!active) ref.current?.pause();
  }, [active]);
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const v = ref.current;
      if (!v || (e.target as HTMLElement).tagName === "INPUT") return;
      if (e.key === "/") v.paused ? v.play() : v.pause();
      else if (e.key === ",") v.currentTime = Math.max(0, v.currentTime - 5);
      else if (e.key === ".") v.currentTime = Math.min(v.duration || 0, v.currentTime + 5);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);

  return (
    <div className="edit-stage video-stage" onDoubleClick={(e) => e.target === e.currentTarget && backToLibrary()}>
      {failed ? (
        <div className="video-fail">
          <img src={thumbUrl(id)} alt="" draggable={false} onError={hideBroken} />
          <span>This movie's format can't be played inside Picaluma.</span>
          <button className="tbtn" disabled={!photo} onClick={() => photo && api.openInDefaultApp(photo.path)}>
            Open in Default Player
          </button>
        </div>
      ) : (
        <video key={id} ref={ref} src={photoUrl(id)} poster={thumbUrl(id)} controls autoPlay={active} onError={() => setFailed(true)} />
      )}
    </div>
  );
}

/** While a tool is open the stage previews the photo without the edit being changed. */
function previewEdits(edits: Edit[], tool: Tool): Edit[] {
  if (!tool) return edits;
  if (tool.kind === "effect") return [...edits, tool.edit];
  if (tool.kind === "neutral") return edits;
  // Crop › Preview: the picture as it will be cropped.
  if (tool.kind === "crop" && tool.preview) return [...edits.filter((e) => e.op !== "crop"), { op: "crop", r: tool.rect }];
  const original = tool.kind === "crop" || (PIXEL_TOOLS.has(tool.kind) && worksOnOriginal(tool as PixelTool));
  if (original) return edits.filter((e) => e.op !== "crop" && e.op !== "rotate" && e.op !== "straighten");
  if (tool.kind !== "straighten") return edits;
  return [...edits.filter((e) => e.op !== "straighten"), { op: "straighten", v: tool.angle }];
}

function Stage({
  id,
  photo,
  edits,
  active,
  tool,
  setTool,
  onNeutral,
}: {
  id: number;
  photo: Photo | null;
  edits: Edit[];
  active: boolean;
  tool: Tool;
  setTool: (t: Tool) => void;
  onNeutral: (fx: number, fy: number) => void;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState({ w: 0, h: 0 });
  const [baseAspect, setBaseAspect] = useState<number | null>(null);
  const [fullReady, setFullReady] = useState(false);
  const flight = useStore((s) => s.flight);
  const endFlight = useStore((s) => s.endFlight);
  const shown = previewEdits(edits, tool);
  const r = render(shown);
  const rot90 = r.rotate === 90 || r.rotate === 270;
  const preview = usePixelPreview(id, shown, hasPixelOps(shown));

  useLayoutEffect(() => {
    const el = stageRef.current!;
    const ro = new ResizeObserver(() => setStage({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setStage({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // The cached thumbnail tells us the oriented aspect ratio instantly — no waiting on the full file.
  useLayoutEffect(() => {
    setFullReady(false);
    if (aspectCache.has(id)) return setBaseAspect(aspectCache.get(id)!);
    setBaseAspect(null);
    const img = new Image();
    img.src = thumbUrl(id);
    const done = () => {
      aspectCache.set(id, img.naturalWidth / img.naturalHeight);
      setBaseAspect(img.naturalWidth / img.naturalHeight);
    };
    if (img.complete && img.naturalWidth) done();
    else img.onload = done;
  }, [id]);

  // Prefer the cache during render so the very first frame for a new photo has the right shape.
  const aspectNow = aspectCache.get(id) ?? baseAspect;
  const cropKey = r.crop?.join(",");
  // Before and after: the stage splits in two (not while a tool is open).
  const mode = useStore((s) => s.compare);
  const pin = useStore((s) => s.comparePin);
  const pinEdits = useStore((s) => (pin != null ? s.edits.get(pin) : undefined));
  // AA: the pinned picture on the left (once you've moved on to another one).
  const pair = mode === "aa" && pin != null && pin !== id ? pin : null;
  const compare = !tool && (mode === "ab" || pair != null);
  const pinPreview = usePixelPreview(pair ?? id, pinEdits ?? [], pair != null);
  const halfW = compare ? (stage.w - STAGE_PAD) / 2 : stage.w;
  const box = useMemo(() => {
    if (!aspectNow || !stage.w) return null;
    const aspect = displayAspect(aspectNow, r);
    const maxW = halfW - STAGE_PAD * 2;
    const maxH = stage.h - STAGE_PAD * 2;
    // Don't upscale small images past their real pixel size.
    const natW = photo && photo.width ? Math.max(photo.width, photo.height) * (aspect >= 1 ? 1 : aspect) : Infinity;
    let w = Math.min(maxW, natW);
    let h = w / aspect;
    if (h > maxH) {
      h = maxH;
      w = h * aspect;
    }
    return { x: compare ? halfW + STAGE_PAD / 2 + (halfW - w) / 2 : (stage.w - w) / 2, y: (stage.h - h) / 2, w, h };
  }, [aspectNow, stage, rot90, photo, cropKey, compare]); // eslint-disable-line react-hooks/exhaustive-deps
  const before = useMemo(() => {
    if (!compare || !aspectNow || !stage.w) return null;
    const maxW = halfW - STAGE_PAD * 2;
    const maxH = stage.h - STAGE_PAD * 2;
    let w = maxW;
    let h = w / aspectNow;
    if (h > maxH) {
      h = maxH;
      w = h * aspectNow;
    }
    return { x: (halfW - w) / 2, y: (stage.h - h) / 2, w, h };
  }, [compare, aspectNow, stage, halfW]);

  // Zoom in from the thumbnail that was double-clicked.
  useLayoutEffect(() => {
    if (!active || !flight || flight.photoId !== id || !box || !boxRef.current) return;
    const el = boxRef.current;
    const to = el.getBoundingClientRect();
    const from = flight.from;
    const anim = el.animate(
      [
        { transform: `translate(${from.x - to.left}px, ${from.y - to.top}px) scale(${from.w / to.width}, ${from.h / to.height})` },
        { transform: "none" },
      ],
      { duration: 230, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
    );
    anim.onfinish = anim.oncancel = () => endFlight();
  }, [flight?.nonce, box != null, active]); // eslint-disable-line react-hooks/exhaustive-deps

  // Zoom (↑/↓, Page Up/Down, +/−, wheel; 0 fits, 1 is actual size) and drag to pan. Tools work on the fitted view.
  const [zoom, setZoom] = useState<Zoom>(FIT);
  const [dragging, setDragging] = useState(false);
  const wheelAcc = useRef(0);
  useEffect(() => setZoom(FIT), [id, tool != null]);
  const actual = photo?.width && box ? Math.max(photo.width, photo.height) / Math.max(box.w, box.h) : 1;
  const clampPan = useCallback(
    (zm: Zoom): Zoom => {
      if (zm.z <= 1 || !box) return FIT;
      const mx = Math.max(0, (box.w * zm.z - stage.w) / 2 + STAGE_PAD);
      const my = Math.max(0, (box.h * zm.z - stage.h) / 2 + STAGE_PAD);
      return { z: zm.z, x: Math.max(-mx, Math.min(mx, zm.x)), y: Math.max(-my, Math.min(my, zm.y)) };
    },
    [box, stage],
  );
  const zoomTo = useCallback((z: number) => setZoom((cur) => clampPan({ z, x: (cur.x * z) / cur.z, y: (cur.y * z) / cur.z })), [clampPan]);
  const zoomStep = useCallback(
    (dir: 1 | -1) =>
      setZoom((cur) => {
        const z = dir > 0 ? ZOOMS.find((v) => v > cur.z + 0.01) ?? cur.z : [...ZOOMS].reverse().find((v) => v < cur.z - 0.01) ?? 1;
        return clampPan({ z, x: (cur.x * z) / cur.z, y: (cur.y * z) / cur.z });
      }),
    [clampPan],
  );
  useEffect(() => {
    if (!active || tool) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || mod(e) || e.altKey || useStore.getState().slideshow) return;
      if (e.key === "ArrowUp" || e.key === "PageUp" || e.key === "+" || e.key === "=") zoomStep(1);
      else if (e.key === "ArrowDown" || e.key === "PageDown" || e.key === "-" || e.key === "_") zoomStep(-1);
      else if (e.key === "0") setZoom(FIT);
      else if (e.key === "1") zoomTo(Math.max(1, actual));
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, tool, zoomStep, zoomTo, actual]);
  const onWheel = (e: React.WheelEvent) => {
    if (tool) return;
    wheelAcc.current += e.deltaY;
    if (Math.abs(wheelAcc.current) < 60) return;
    zoomStep(wheelAcc.current < 0 ? 1 : -1);
    wheelAcc.current = 0;
  };
  const onPanStart = (e: React.MouseEvent) => {
    if (tool || zoom.z <= 1 || e.button !== 0) return;
    e.preventDefault();
    const start = { mx: e.clientX, my: e.clientY, ...zoom };
    setDragging(true);
    const move = (ev: MouseEvent) => setZoom(clampPan({ z: start.z, x: start.x + ev.clientX - start.mx, y: start.y + ev.clientY - start.my }));
    const up = () => {
      setDragging(false);
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  const frameClass = r.frame ? ` frame-${r.frame}` : "";
  const innerW = box ? (rot90 ? box.h : box.w) : 0;
  const innerH = box ? (rot90 ? box.w : box.h) : 0;
  const inner: React.CSSProperties = box
    ? {
        position: "absolute",
        left: "50%",
        top: "50%",
        width: innerW,
        height: innerH,
        overflow: "hidden",
        transform: `translate(-50%, -50%) rotate(${r.rotate}deg)`,
        filter: r.filter || undefined,
      }
    : {};
  const imgStyle: React.CSSProperties = {
    objectViewBox: cropViewBox(r.crop),
    transform: r.straighten ? `rotate(${r.straighten}deg) scale(${straightenScale(r.straighten, innerW / Math.max(1, innerH))})` : undefined,
  } as React.CSSProperties;

  return (
    <div
      className={`edit-stage${zoom.z > 1 ? " zoomed" : ""}${dragging ? " dragging" : ""}`}
      ref={stageRef}
      onDoubleClick={tool ? undefined : backToLibrary}
      onWheel={onWheel}
      onMouseDown={onPanStart}
    >
      <div className="zoom-layer" style={zoom.z > 1 ? { transform: `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.z})` } : undefined}>
      {before && pair == null && (
        <div className="edit-photo before" style={{ left: before.x, top: before.y, width: before.w, height: before.h }}>
          <img src={thumbUrl(id)} alt="" draggable={false} />
          <img className="full ready" src={photoUrl(id)} alt="" draggable={false} />
          <span className="compare-label">Before</span>
        </div>
      )}
      {pair != null && stage.w > 0 && (
        <div className="aa-pane" style={{ width: halfW }}>
          <img src={pinPreview ?? thumbUrl(pair)} alt="" draggable={false} />
          <span className="compare-label">Pinned</span>
        </div>
      )}
      {box && compare && (
        <span className="compare-label after" style={{ left: box.x + 8, top: box.y + box.h - 26 }}>
          {pair != null ? "This picture" : "After"}
        </span>
      )}
      {box && (
        <div ref={boxRef} className={`edit-photo${frameClass}`} style={{ left: box.x, top: box.y, width: box.w, height: box.h, transformOrigin: "0 0" }}>
          {preview ? (
            // Pixel effects: a canvas rendering of the whole edit stack (crop, rotation and filters included).
            <img className="pixel-preview" src={preview} alt="" draggable={false} />
          ) : (
            <div style={inner}>
              <img src={thumbUrl(id)} style={imgStyle} alt="" draggable={false} />
              <img key={id} className={`full${fullReady ? " ready" : ""}`} src={photoUrl(id)} style={imgStyle} onLoad={() => setFullReady(true)} alt="" draggable={false} />
            </div>
          )}
          {(!tool || PIXEL_TOOLS.has(tool.kind)) && <Overlays r={r} drawn={!!preview} />}
          {!tool && <FaceLayer id={id} r={r} />}
          {tool?.kind === "neutral" && (
            <div
              className="neutral-layer"
              onMouseDown={(e) => {
                e.stopPropagation();
                const b = e.currentTarget.getBoundingClientRect();
                onNeutral((e.clientX - b.left) / b.width, (e.clientY - b.top) / b.height);
              }}
            />
          )}
          {tool && PIXEL_TOOLS.has(tool.kind) && <PixelToolOverlay tool={tool as PixelTool} setTool={setTool} />}
          {tool?.kind === "straighten" && <div className="straighten-grid" />}
          {tool?.kind === "crop" && !tool.preview && <CropOverlay tool={tool} setTool={setTool} aspect={aspectNow ?? 1} />}
        </div>
      )}
      </div>
      {zoom.z > 1 && (
        <button className="zoom-badge" title="Fit to window (0)" onMouseDown={(e) => e.stopPropagation()} onClick={() => setZoom(FIT)}>
          {Math.round((zoom.z / actual) * 100)}% · Fit
        </button>
      )}
    </div>
  );
}

/**
 * People in Edit view: boxes and names on the faces while the People panel is open, and
 * "Add a person manually" — drag a box around a face Picaluma missed.
 */
function FaceLayer({ id, r }: { id: number; r: ReturnType<typeof render> }) {
  const show = useStore((s) => s.showProps && s.sidePanel === "people");
  const drawFace = useStore((s) => s.drawFace);
  const hover = useStore((s) => s.hoverFace);
  const faces = usePhotoFaces(show || drawFace ? id : null);
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  useEffect(() => () => useStore.getState().setDrawFace(false), [id]);
  // Face positions are on the uncropped, unrotated picture.
  const plain = r.rotate === 0 && !r.crop && !r.straighten;
  useEffect(() => {
    if (drawFace && !plain) {
      useStore.getState().setDrawFace(false);
      notify("Undo the crop, rotation or straightening first to tag faces in this picture.");
    }
  }, [drawFace, plain]);
  if (!plain || (!show && !drawFace)) return null;
  const pct = (v: number) => `${(v * 100).toFixed(3)}%`;
  const box = (x: number, y: number, w: number, h: number) => ({ left: pct(x), top: pct(y), width: pct(w), height: pct(h) });
  const onDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!drawFace || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget.getBoundingClientRect();
    const at = (ev: { clientX: number; clientY: number }) => ({
      x: Math.min(1, Math.max(0, (ev.clientX - el.left) / el.width)),
      y: Math.min(1, Math.max(0, (ev.clientY - el.top) / el.height)),
    });
    const a = at(e);
    setDrag({ x0: a.x, y0: a.y, x1: a.x, y1: a.y });
    const move = (ev: MouseEvent) => {
      const b = at(ev);
      setDrag({ x0: a.x, y0: a.y, x1: b.x, y1: b.y });
    };
    const up = async (ev: MouseEvent) => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      const b = at(ev);
      setDrag(null);
      const rect = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
      if (rect.w < 0.01 || rect.h < 0.01) return;
      const name = await askText("Who is this? (leave empty to name later)", "", "Add");
      if (name == null) return;
      await api.addFace(id, rect, name.trim() || null);
      useStore.getState().setDrawFace(false);
      await useStore.getState().loadSnapshot();
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };
  return (
    <div
      className={`face-layer${drawFace ? " drawing" : ""}`}
      onMouseDown={onDown}
      onDoubleClick={(e) => drawFace && e.stopPropagation()}
    >
      {show &&
        faces.map((f) => (
          <div key={f.id} className={`face-box${hover?.id === f.id ? " hot" : ""}${f.state === 2 ? " suggested" : ""}`} style={box(f.x, f.y, f.w, f.h)}>
            {f.name && <span>{f.state === 2 ? `${f.name}?` : f.name}</span>}
          </div>
        ))}
      {drag && <div className="face-box hot" style={box(Math.min(drag.x0, drag.x1), Math.min(drag.y0, drag.y1), Math.abs(drag.x1 - drag.x0), Math.abs(drag.y1 - drag.y0))} />}
      {drawFace && <div className="face-hint">Drag a box around the face · Esc to cancel</div>}
    </div>
  );
}

/** CSS overlays for display; `drawn` when the canvas preview already painted the vignette and tints. */
function Overlays({ r, drawn = false }: { r: ReturnType<typeof render>; drawn?: boolean }) {
  return (
    <>
      {!drawn && r.vignette > 0 && (
        <div className="fx-overlay" style={{ background: `radial-gradient(ellipse at center, rgba(0,0,0,0) 45%, rgba(0,0,0,${r.vignette}) 100%)` }} />
      )}
      {!drawn && r.overlays.includes("gradTint") && (
        <div className="fx-overlay" style={{ background: "linear-gradient(rgba(255,140,40,0.35), rgba(255,140,40,0) 60%)" }} />
      )}
      {!drawn && r.overlays.includes("cinemascope") && (
        <div className="fx-overlay" style={{ background: "linear-gradient(#000 12%, transparent 12%, transparent 88%, #000 88%)" }} />
      )}
      {r.overlays.includes("grain") && (
        <div
          className="fx-overlay"
          style={{
            opacity: 0.18,
            mixBlendMode: "overlay",
            backgroundImage:
              "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")",
          }}
        />
      )}
    </>
  );
}

function CaptionBar({ photo }: { photo: Photo | null }) {
  const [text, setText] = useState("");
  useEffect(() => setText(photo?.caption ?? ""), [photo]);
  return (
    <div className="caption-bar">
      <input
        value={text}
        placeholder="Make a caption!"
        onChange={(e) => setText(e.target.value)}
        onBlur={() => photo && text !== photo.caption && api.setCaption(photo.id, text).then(() => (photo.caption = text))}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      />
    </div>
  );
}

type Stack = ReturnType<typeof useEditStack>;

function EditPanel({
  id,
  photo,
  stack,
  onEffect,
  onNeutral,
  disabled,
}: {
  id: number;
  photo: Photo | null;
  stack: Stack;
  onEffect: (op: string) => void;
  onNeutral: () => void;
  disabled: boolean;
}) {
  // Remembered across tools (the panel is replaced while a tool is open).
  const [tab, setTabState] = useState(lastTab);
  const setTab = (t: string) => {
    lastTab = t;
    setTabState(t);
  };
  const tabIcons: Record<string, React.ReactNode> = {
    fixes: <WrenchIcon />,
    tuning: <SunIcon />,
    fx1: <BrushIcon />,
    fx2: <BrushIcon color="#3f8f2f" />,
    fx3: <BrushIcon color="#2f7fbf" />,
  };
  const t = TABS.find((x) => x.id === tab)!;
  const lastLabel = stack.edits.length ? labelFor(stack.edits[stack.edits.length - 1]) : "";

  return (
    <div className="edit-left">
      <div className="edit-tabs">
        {TABS.map((x) => (
          <div key={x.id} className={`edit-tab${tab === x.id ? " active" : ""}`} title={x.title} onClick={() => setTab(x.id)}>
            {tabIcons[x.id]}
          </div>
        ))}
      </div>
      {tab === "fixes" && (
        <>
          <div className="fixes-grid">
            {t.effects.map((e) => {
              const def = EFFECTS[e];
              return (
                <button
                  key={e}
                  className="fix-btn"
                  disabled={def.todo || disabled}
                  title={def.todo ? `${def.label} — coming soon` : def.label}
                  onClick={() => onEffect(e)}
                >
                  <span className="ico">
                    <img src={thumbUrl(id)} style={{ filter: def.filter?.(1, { op: e }) }} alt="" />
                  </span>
                  <span className="lbl">{def.label}</span>
                </button>
              );
            })}
          </div>
          <SliderRow label="Fill Light" op="fillLight" stack={stack} />
        </>
      )}
      {tab === "tuning" && (
        <div style={{ paddingTop: 10 }}>
          <SliderRow label="Fill Light" op="fillLight" stack={stack} />
          <SliderRow label="Highlights" op="highlights" stack={stack} />
          <SliderRow label="Shadows" op="shadows" stack={stack} />
          <SliderRow label="Color Temperature" op="temp" stack={stack} min={-1} />
          <div className="slider-block">
            <button className="tbtn" disabled={disabled} onClick={onNeutral} title="Click something grey or white to remove a colour cast">
              Neutral Color Picker…
            </button>
          </div>
        </div>
      )}
      {t.effects.length > 0 && tab !== "fixes" && (
        <div className="fx-grid">
          {t.effects.map((e) => {
            const def = EFFECTS[e];
            const r = render([{ op: e }]);
            const count = stack.edits.filter((x) => x.op === e).length;
            return (
              <div key={e} className={`fx-tile${def.todo ? " todo" : ""}`} title={def.todo ? `${def.label} — coming soon` : def.label} onClick={() => !def.todo && !disabled && onEffect(e)}>
                <div className="preview">
                  <img src={thumbUrl(id)} style={{ filter: r.filter || undefined }} alt="" />
                  <Overlays r={r} />
                </div>
                <span className="lbl">{def.label}</span>
                {count > 0 && <span className="count">{count}</span>}
              </div>
            );
          })}
        </div>
      )}
      <div className="undo-row">
        <button className="tbtn" disabled={!stack.edits.length} onClick={stack.undo} title="Ctrl+Z">
          {stack.edits.length ? `Undo ${lastLabel}` : "Undo"}
        </button>
        <button className="tbtn" disabled={!stack.canRedo} onClick={stack.redo} title="Ctrl+Y">
          Redo
        </button>
      </div>
      <Histogram id={id} photo={photo} edits={stack.edits} />
    </div>
  );
}

/** Picasa's colour choices for tints and filters, plus any colour. */
const SWATCHES = ["#5b8fd0", "#3fa34d", "#e2b13c", "#ff8c28", "#d9443a", "#a855c8", "#ffffff", "#000000"];

/** An effect's settings, previewed live on the picture until Apply (Picasa's effect panels). */
function EffectPanel({ edit, onChange, onApply, onCancel }: { edit: Edit; onChange: (e: Edit) => void; onApply: () => void; onCancel: () => void }) {
  const def = EFFECTS[edit.op];
  const set = (p: Param, value: number | string) => onChange({ ...edit, [p.key]: value });
  return (
    <div className="edit-left tool-panel">
      <div className="tool-title">
        <span className="ico" />
        {def.label}
      </div>
      {def.params?.map((p) =>
        p.key === "c" ? (
          <div key={p.key} className="tool-field">
            {p.label}
            <span className="swatches">
              {SWATCHES.map((c) => (
                <button key={c} className={`swatch${edit.c === c ? " on" : ""}`} style={{ background: c }} title={c} onClick={() => set(p, c)} />
              ))}
              <input type="color" className="color-pick" value={edit.c ?? p.def} title="Any colour" onChange={(e) => set(p, e.target.value)} />
            </span>
          </div>
        ) : (
          <label key={p.key} className="tool-field">
            {p.label}
            <input type="range" className="slider" min={p.min ?? 0} max={1} step={0.01} value={(edit[p.key] as number | undefined) ?? p.def} onChange={(e) => set(p, Number(e.target.value))} />
          </label>
        ),
      )}
      <div className="tool-buttons">
        <button
          className="tbtn"
          onClick={() => onChange({ op: edit.op, ...Object.fromEntries((def.params ?? []).map((p) => [p.key, p.def])) })}
        >
          Reset
        </button>
        <div className="row">
          <button className="tbtn apply" onClick={onApply}>
            Apply <span className="dot ok">✓</span>
          </button>
          <button className="tbtn" onClick={onCancel}>
            Cancel <span className="dot x">✕</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function labelFor(e: Edit) {
  if (e.op === "rotate") return "Rotate";
  return EFFECTS[e.op]?.label ?? e.op;
}

function SliderRow({ label, op, stack, min = 0 }: { label: string; op: string; stack: Stack; min?: number }) {
  const value = sliderValue(stack.edits, op, 0);
  return (
    <div className="slider-block">
      <label>{label}</label>
      <input type="range" min={min} max={1} step={0.01} value={value} onChange={(e) => stack.apply(op, Number(e.target.value))} />
    </div>
  );
}

function Histogram({ id, photo, edits }: { id: number; photo: Photo | null; edits: Edit[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const key = JSON.stringify(edits);

  useEffect(() => {
    let live = true;
    // The real rendering (pixel effects included) of the thumbnail: small, so it's quick.
    const timer = setTimeout(async () => {
      let data: Uint8ClampedArray;
      try {
        const src = await renderToCanvas(thumbUrl(id), edits, 128);
        data = src.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, src.width, src.height).data;
        src.width = 0;
      } catch {
        return;
      }
      const c = canvasRef.current;
      if (!live || !c) return;
      const bins = [new Array(64).fill(0), new Array(64).fill(0), new Array(64).fill(0)];
      for (let i = 0; i < data.length; i += 4) {
        bins[0][data[i] >> 2]++;
        bins[1][data[i + 1] >> 2]++;
        bins[2][data[i + 2] >> 2]++;
      }
      // Scale to the tallest bar between the ends, so clipped black or white doesn't flatten the rest.
      const max = Math.max(1, ...bins.flatMap((b) => b.slice(1, 63)));
      const ctx = c.getContext("2d")!;
      c.width = 256;
      c.height = 60;
      ctx.clearRect(0, 0, 256, 60);
      ctx.globalCompositeOperation = "multiply";
      const colors = ["rgba(240,90,90,0.75)", "rgba(90,200,90,0.75)", "rgba(100,120,240,0.75)"];
      bins.forEach((b, ci) => {
        ctx.fillStyle = colors[ci];
        ctx.beginPath();
        ctx.moveTo(0, 60);
        b.forEach((v, i) => ctx.lineTo(i * 4, 60 - Math.min(1, v / max) * 58));
        ctx.lineTo(256, 60);
        ctx.fill();
      });
    }, 120);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [id, key]); // eslint-disable-line react-hooks/exhaustive-deps

  const ex = new Map(photo?.exif ?? []);
  const camera = [ex.get("Camera Make"), ex.get("Camera Model")].filter(Boolean).join(" ");
  return (
    <div className="histo">
      <h4>Histogram &amp; Camera Information</h4>
      <canvas ref={canvasRef} />
      <div className="cam">
        <span>{camera || "No camera information"}</span>
        <span>{ex.get("Exposure Time") ?? ""}</span>
        <span>{ex.get("Focal Length") ? `Focal Length: ${ex.get("Focal Length")}` : ""}</span>
        <span>{ex.get("F Number") ?? ""}</span>
        <span>{ex.get("Focal Length in 35mm Film") ? `(35mm equivalent: ${ex.get("Focal Length in 35mm Film")})` : ""}</span>
        <span>{ex.get("ISO") ? `ISO: ${ex.get("ISO")}` : ""}</span>
      </div>
    </div>
  );
}
