import { mod } from "../platform";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { api, photoUrl, thumbUrl, Photo } from "../api";
import { CropRect, cropViewBox, displayAspect, Edit, EFFECTS, render, renderToCanvas, SLIDER_OPS, sliderValue, straightenScale, TABS } from "../effects";
import { hasPixelOps } from "../pixelfx";
import { newPixelTool, PIXEL_TOOLS, PixelTool, PixelToolOverlay, PixelToolPanel, toolEdit, worksOnOriginal } from "./PixelTools";
import { CropOverlay, CropPanel, StraightenBar, Tool } from "./Tools";
import { selectEditorSequence, useStore } from "../store";
import { ArrowIcon, BackIcon, BrushIcon, PlayIcon, SunIcon, WrenchIcon } from "./Icons";
import { usePhoto } from "./PropertiesPanel";

const STAGE_PAD = 14;

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
export const aspectCache = new Map<number, number>();

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
            <img key={p} src={thumbUrl(p)} className={p === id ? "cur" : ""} onClick={() => setEditId(p)} alt="" draggable={false} />
          ))}
        </div>
        <button className="arrow" onClick={() => idx < seq.length - 1 && setEditId(seq[idx + 1])} title="Next (→)">
          <ArrowIcon dir="right" />
        </button>
      </div>
      <div style={{ width: 150 }} />
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

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" && (t as HTMLInputElement).type !== "range") return;
      const s = useStore.getState();
      if (s.slideshow) return;
      const seq = selectEditorSequence(s);
      const i = s.editId != null ? seq.indexOf(s.editId) : -1;
      if (e.key === "Escape") backToLibrary();
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
    setTool(null);
  };

  return (
    <>
      {tool?.kind === "crop" ? (
        <CropPanel id={id} tool={tool} setTool={setTool} onApply={applyTool} onCancel={() => setTool(null)} />
      ) : tool && PIXEL_TOOLS.has(tool.kind) ? (
        <PixelToolPanel tool={tool as PixelTool} setTool={setTool} onApply={applyTool} onCancel={() => setTool(null)} />
      ) : (
        <EditPanel id={id} photo={photo} stack={stack} onTool={startTool} disabled={tool != null} />
      )}
      <div className="edit-center">
        <Stage id={id} photo={photo} edits={stack.edits} active={active} tool={tool} setTool={setTool} />
        {tool?.kind === "straighten" && <StraightenBar tool={tool} setTool={setTool} onApply={applyTool} onCancel={() => setTool(null)} />}
        <CaptionBar photo={photo} />
      </div>
    </>
  );
}

/** While a tool is open the stage previews the photo without the edit being changed. */
function previewEdits(edits: Edit[], tool: Tool): Edit[] {
  if (!tool) return edits;
  const original = tool.kind === "crop" || (PIXEL_TOOLS.has(tool.kind) && worksOnOriginal(tool as PixelTool));
  if (original) return edits.filter((e) => e.op !== "crop" && e.op !== "rotate" && e.op !== "straighten");
  if (tool.kind !== "straighten") return edits;
  return [...edits.filter((e) => e.op !== "straighten"), { op: "straighten", v: tool.angle }];
}

function Stage({ id, photo, edits, active, tool, setTool }: { id: number; photo: Photo | null; edits: Edit[]; active: boolean; tool: Tool; setTool: (t: Tool) => void }) {
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
  const box = useMemo(() => {
    if (!aspectNow || !stage.w) return null;
    const aspect = displayAspect(aspectNow, r);
    const maxW = stage.w - STAGE_PAD * 2;
    const maxH = stage.h - STAGE_PAD * 2;
    // Don't upscale small images past their real pixel size.
    const natW = photo && photo.width ? Math.max(photo.width, photo.height) * (aspect >= 1 ? 1 : aspect) : Infinity;
    let w = Math.min(maxW, natW);
    let h = w / aspect;
    if (h > maxH) {
      h = maxH;
      w = h * aspect;
    }
    return { x: (stage.w - w) / 2, y: (stage.h - h) / 2, w, h };
  }, [aspectNow, stage, rot90, photo, cropKey]); // eslint-disable-line react-hooks/exhaustive-deps

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
    <div className="edit-stage" ref={stageRef} onDoubleClick={tool ? undefined : backToLibrary}>
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
          {tool && PIXEL_TOOLS.has(tool.kind) && <PixelToolOverlay tool={tool as PixelTool} setTool={setTool} />}
          {tool?.kind === "straighten" && <div className="straighten-grid" />}
          {tool?.kind === "crop" && <CropOverlay tool={tool} setTool={setTool} aspect={aspectNow ?? 1} />}
        </div>
      )}
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
  onTool,
  disabled,
}: {
  id: number;
  photo: Photo | null;
  stack: Stack;
  onTool: (t: ToolName) => void;
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
                  onClick={() => (TOOL_EFFECTS[e] ? onTool(TOOL_EFFECTS[e]) : stack.apply(e))}
                >
                  <span className="ico">
                    <img src={thumbUrl(id)} style={{ filter: def.filter?.(1) }} alt="" />
                  </span>
                  {def.label}
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
        </div>
      )}
      {t.effects.length > 0 && tab !== "fixes" && (
        <div className="fx-grid">
          {t.effects.map((e) => {
            const def = EFFECTS[e];
            const r = render([{ op: e }]);
            const count = stack.edits.filter((x) => x.op === e).length;
            return (
              <div key={e} className={`fx-tile${def.todo ? " todo" : ""}`} title={def.todo ? `${def.label} — coming soon` : def.label} onClick={() => !def.todo && (TOOL_EFFECTS[e] ? onTool(TOOL_EFFECTS[e]) : stack.apply(e, e === "pixelate" ? 1 : undefined))}>
                <div className="preview">
                  <img src={thumbUrl(id)} style={{ filter: r.filter || undefined }} alt="" />
                  <Overlays r={r} />
                </div>
                {def.label}
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
  const filter = render(edits).filter;

  useEffect(() => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const c = canvasRef.current;
      if (!c) return;
      const sw = 96;
      const sh = Math.max(1, Math.round((96 * img.naturalHeight) / img.naturalWidth));
      const tmp = document.createElement("canvas");
      tmp.width = sw;
      tmp.height = sh;
      const tctx = tmp.getContext("2d", { willReadFrequently: true })!;
      tctx.filter = filter || "none";
      tctx.drawImage(img, 0, 0, sw, sh);
      let data: Uint8ClampedArray;
      try {
        data = tctx.getImageData(0, 0, sw, sh).data;
      } catch {
        return;
      }
      const bins = [new Array(64).fill(0), new Array(64).fill(0), new Array(64).fill(0)];
      for (let i = 0; i < data.length; i += 4) {
        bins[0][data[i] >> 2]++;
        bins[1][data[i + 1] >> 2]++;
        bins[2][data[i + 2] >> 2]++;
      }
      const max = Math.max(...bins.flat());
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
        b.forEach((v, i) => ctx.lineTo(i * 4, 60 - (v / max) * 58));
        ctx.lineTo(256, 60);
        ctx.fill();
      });
    };
    img.src = thumbUrl(id);
  }, [id, filter]);

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
