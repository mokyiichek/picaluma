import { useRef } from "react";
import { thumbUrl } from "../api";
import { askText, notify } from "../dialogs";
import { aspectCache } from "../aspect";
import { CropRect, cropViewBox, type Edit } from "../effects";
import type { PixelTool } from "./PixelTools";

export type Tool =
  /** `aspect`: the crop's width ÷ height as it will look (portrait < 1), or null for Manual. */
  | { kind: "crop"; rect: CropRect; aspect: number | null; preview?: boolean }
  | { kind: "straighten"; angle: number }
  | PixelTool
  /** An effect's settings panel (Sharpen amount, Tint colour...), previewed live until Apply. */
  | { kind: "effect"; edit: Edit }
  /** Neutral Color Picker: click something that should be grey or white. */
  | { kind: "neutral" }
  | null;
type CropTool = Extract<Tool, { kind: "crop" }>;
type StraightenTool = Extract<Tool, { kind: "straighten" }>;

/** Picasa's crop presets (width:height, landscape orientation). */
const PRESETS: { label: string; hint?: string; ratio: number | null }[] = [
  { label: "Manual", ratio: null },
  { label: "4 x 6", hint: "Small print", ratio: 6 / 4 },
  { label: "5 x 7", hint: "Large print", ratio: 7 / 5 },
  { label: "8.5 x 11", hint: "Letter paper", ratio: 11 / 8.5 },
  { label: "8 x 10", ratio: 10 / 8 },
  { label: "Square", hint: "CD Cover", ratio: 1 },
  { label: "4:3", hint: "Standard screen", ratio: 4 / 3 },
  { label: "16:10", hint: "Widescreen monitor", ratio: 16 / 10 },
  { label: "16:9", hint: "HDTV", ratio: 16 / 9 },
  { label: "5:3", hint: "Widescreen Photo Frame", ratio: 5 / 3 },
];

/** Largest centred rect with the given display ratio (width ÷ height), as image fractions. */
function fitRect(r: number, imgAspect: number, scale = 1): CropRect {
  let w = 1;
  let h = imgAspect / r;
  if (h > 1) {
    h = 1;
    w = r / imgAspect;
  }
  w *= scale;
  h *= scale;
  return [(1 - w) / 2, (1 - h) / 2, w, h];
}

export function CropPanel({
  id,
  tool,
  setTool,
  onApply,
  onCancel,
}: {
  id: number;
  tool: CropTool;
  setTool: (t: Tool) => void;
  onApply: () => void;
  onCancel: () => void;
}) {
  const aspect = imgAspectOf(id);
  // Three suggested crops at different tightness, like Picasa's preview strip.
  const suggestions: CropRect[] = [0.92, 0.75, 0.58].map((s) => fitRect(tool.aspect ?? aspect, aspect, s));
  const same = (a: number, b: number) => Math.abs(a - b) < 1e-6;
  const preset = tool.aspect == null ? "Manual" : PRESETS.find((p) => p.ratio && (same(p.ratio, tool.aspect!) || same(1 / p.ratio, tool.aspect!)))?.label ?? "Custom";
  // A preset follows the photo's orientation: portrait photos get portrait crops.
  const choose = (ratio: number | null) =>
    setTool({ ...tool, aspect: ratio, rect: ratio ? fitRect(ratio, aspect, 0.9) : tool.rect });
  const custom = async () => {
    const text = await askText("Width × height of the crop (for example 3 x 2 or 1.91 x 1):", "3 x 2", "OK");
    const m = text?.match(/([\d.]+)\s*[x×:*\/]\s*([\d.]+)/i);
    if (!text) return;
    if (!m || !(Number(m[1]) > 0) || !(Number(m[2]) > 0)) return void notify("Type two numbers, like 3 x 2.");
    choose(Number(m[1]) / Number(m[2]));
  };
  return (
    <div className="edit-left tool-panel">
      <div className="tool-title">
        <span className="ico" />
        Crop Photo
      </div>
      <p className="tool-help">Select a dimension below and then click and drag on the image to select the portion of the image you wish to crop.</p>
      <select
        className="pselect"
        value={preset}
        onChange={(e) => {
          if (e.target.value === "Custom") return void custom();
          const p = PRESETS.find((x) => x.label === e.target.value)!;
          choose(p.ratio ? (aspect < 1 ? 1 / p.ratio : p.ratio) : null);
        }}
      >
        {PRESETS.map((p) => (
          <option key={p.label} value={p.label}>
            {p.label}
            {p.hint ? `: ${p.hint}` : ""}
          </option>
        ))}
        <option value="Custom">Custom...</option>
      </select>
      <button
        className="tbtn crop-rotate"
        disabled={tool.aspect == null || same(tool.aspect, 1)}
        title="Switch the crop between landscape and portrait"
        onClick={() => tool.aspect && choose(1 / tool.aspect)}
      >
        Rotate {tool.aspect != null && tool.aspect < 1 ? "to landscape" : "to portrait"}
      </button>
      <div className="crop-suggest">
        {suggestions.map((r, i) => (
          <button key={i} className="fx-tile" onClick={() => setTool({ ...tool, rect: r })} title="Use this crop">
            <span className="preview">
              <img src={thumbUrl(id)} style={{ objectViewBox: cropViewBox(r), objectFit: "contain" } as React.CSSProperties} alt="" />
            </span>
          </button>
        ))}
      </div>
      <div className="tool-buttons">
        <span className="row">
          <button className="tbtn" onClick={() => setTool({ ...tool, rect: [0, 0, 1, 1], aspect: null, preview: false })}>
            Reset
          </button>
          <button className={`tbtn${tool.preview ? " pressed" : ""}`} title="See the picture cropped (click again to keep adjusting)" onClick={() => setTool({ ...tool, preview: !tool.preview })}>
            Preview
          </button>
        </span>
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

function imgAspectOf(id: number): number {
  const known = aspectCache.get(id);
  if (known) return known;
  const img = document.querySelector(`img[data-photo="${id}"]`) as HTMLImageElement | null;
  if (img?.naturalWidth) return img.naturalWidth / img.naturalHeight;
  const stage = document.querySelector(".edit-photo") as HTMLElement | null;
  return stage ? stage.clientWidth / Math.max(1, stage.clientHeight) : 1.5;
}

type Handle = "move" | "nw" | "ne" | "sw" | "se" | "new";

/** Drag to draw a crop box, drag inside to move it, drag corners to resize. */
export function CropOverlay({ tool, setTool, aspect }: { tool: CropTool; setTool: (t: Tool) => void; aspect: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [x, y, w, h] = tool.rect;

  const onDown = (handle: Handle) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const box = ref.current!.getBoundingClientRect();
    const px = (ev: PointerEvent | React.PointerEvent) => Math.max(0, Math.min(1, (ev.clientX - box.left) / box.width));
    const py = (ev: PointerEvent | React.PointerEvent) => Math.max(0, Math.min(1, (ev.clientY - box.top) / box.height));
    const sx = px(e);
    const sy = py(e);
    const start = tool.rect;
    // Display ratio → fraction ratio: w_frac / h_frac = ratio / imageAspect.
    const fr = tool.aspect ? tool.aspect / aspect : null;

    const move = (ev: PointerEvent) => {
      const cx = px(ev);
      const cy = py(ev);
      let r: CropRect;
      if (handle === "move") {
        const nx = Math.max(0, Math.min(1 - start[2], start[0] + cx - sx));
        const ny = Math.max(0, Math.min(1 - start[3], start[1] + cy - sy));
        r = [nx, ny, start[2], start[3]];
      } else {
        // Anchor is the corner opposite the one being dragged (or the press point for a new box).
        const ax = handle === "new" ? sx : handle.includes("w") ? start[0] + start[2] : start[0];
        const ay = handle === "new" ? sy : handle.includes("n") ? start[1] + start[3] : start[1];
        let nw = Math.abs(cx - ax);
        let nh = Math.abs(cy - ay);
        if (fr) {
          if (nw / nh > fr) nw = nh * fr;
          else nh = nw / fr;
        }
        const nx = cx < ax ? ax - nw : ax;
        const ny = cy < ay ? ay - nh : ay;
        r = [Math.max(0, nx), Math.max(0, ny), Math.min(nw, 1 - Math.max(0, nx)), Math.min(nh, 1 - Math.max(0, ny))];
      }
      if (r[2] > 0.01 && r[3] > 0.01) setTool({ ...tool, rect: r });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const pct = (n: number) => `${n * 100}%`;
  return (
    <div className="crop-layer" ref={ref} onPointerDown={onDown("new")}>
      <div className="crop-box" style={{ left: pct(x), top: pct(y), width: pct(w), height: pct(h) }} onPointerDown={onDown("move")}>
        {(["nw", "ne", "sw", "se"] as const).map((c) => (
          <span key={c} className={`crop-handle ${c}`} onPointerDown={onDown(c)} />
        ))}
      </div>
    </div>
  );
}

export function StraightenBar({
  tool,
  setTool,
  onApply,
  onCancel,
}: {
  tool: StraightenTool;
  setTool: (t: Tool) => void;
  onApply: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="straighten-bar">
      <input type="range" min={-20} max={20} step={0.1} value={tool.angle} onChange={(e) => setTool({ ...tool, angle: Number(e.target.value) })} />
      <button className="dark-btn" onClick={onApply}>
        APPLY
      </button>
      <button className="dark-btn" onClick={onCancel}>
        CANCEL
      </button>
    </div>
  );
}
