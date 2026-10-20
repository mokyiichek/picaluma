import { useRef } from "react";
import type { Edit } from "../effects";

/** Edit-view tools for the pixel effects. Positions are fractions of the photo shown on stage. */
export type PixelTool =
  | { kind: "redeye"; rects: number[][]; drag: number[] | null }
  | { kind: "retouch"; spots: number[][]; size: number }
  | { kind: "text"; text: string; pos: [number, number] | null; size: number; color: string }
  | { kind: "focal"; pos: [number, number]; amount: number };

export const PIXEL_TOOLS = new Set(["redeye", "retouch", "text", "focal"]);

export function newPixelTool(kind: PixelTool["kind"]): PixelTool {
  if (kind === "redeye") return { kind, rects: [], drag: null };
  if (kind === "retouch") return { kind, spots: [], size: 0.025 };
  if (kind === "text") return { kind, text: "", pos: null, size: 0.07, color: "#ffffff" };
  return { kind, pos: [0.5, 0.5], amount: 1 };
}

/** The edit a finished tool adds to the stack, or null when there's nothing to apply. */
export function toolEdit(t: PixelTool): Edit | null {
  if (t.kind === "redeye") return t.rects.length ? { op: "redeye", pts: t.rects } : null;
  if (t.kind === "retouch") return t.spots.length ? { op: "retouch", pts: t.spots } : null;
  if (t.kind === "text") return t.text.trim() && t.pos ? { op: "text", t: t.text.trim(), p: t.pos, v: t.size, c: t.color } : null;
  return { op: "focalZoom", p: t.pos, v: t.amount };
}

/** Red-eye and Retouch work on the uncropped original, so the stage shows it while they're open. */
export const worksOnOriginal = (t: PixelTool) => t.kind === "redeye" || t.kind === "retouch";

const TITLES: Record<PixelTool["kind"], [string, string]> = {
  redeye: ["Redeye Repair", "Drag a box around each red eye. Picaluma fixes only the red inside the boxes."],
  retouch: ["Retouch", "Click a blemish or dust spot. Picaluma covers it with the best-matching area next to it. Click more spots as needed."],
  text: ["Add Text", "Type your text, then click the photo where it should go. Choose a size and colour."],
  focal: ["Focal Zoom", "Click the part of the photo that should stay sharp. Everything around it gets a zoom blur."],
};

export function PixelToolPanel({ tool, setTool, onApply, onCancel }: { tool: PixelTool; setTool: (t: PixelTool) => void; onApply: () => void; onCancel: () => void }) {
  const [title, help] = TITLES[tool.kind];
  const ready = toolEdit(tool) != null;
  return (
    <div className="edit-left tool-panel">
      <div className="tool-title">
        <span className="ico" />
        {title}
      </div>
      <p className="tool-help">{help}</p>
      {tool.kind === "retouch" && (
        <label className="tool-field">
          Brush size
          <input type="range" className="slider" min={0.008} max={0.08} step={0.002} value={tool.size} onChange={(e) => setTool({ ...tool, size: Number(e.target.value) })} />
        </label>
      )}
      {tool.kind === "text" && (
        <>
          <label className="tool-field">
            Text
            <input className="tool-input" value={tool.text} autoFocus placeholder="Type here" onChange={(e) => setTool({ ...tool, text: e.target.value })} />
          </label>
          <label className="tool-field">
            Size
            <input type="range" className="slider" min={0.025} max={0.2} step={0.005} value={tool.size} onChange={(e) => setTool({ ...tool, size: Number(e.target.value) })} />
          </label>
          <div className="tool-field">
            Colour
            <span className="swatches">
              {["#ffffff", "#000000", "#ffd400", "#e2241b"].map((c) => (
                <button key={c} className={`swatch${tool.color === c ? " on" : ""}`} style={{ background: c }} title={c} onClick={() => setTool({ ...tool, color: c })} />
              ))}
            </span>
          </div>
        </>
      )}
      {tool.kind === "focal" && (
        <label className="tool-field">
          Blur amount
          <input type="range" className="slider" min={0.3} max={2.5} step={0.1} value={tool.amount} onChange={(e) => setTool({ ...tool, amount: Number(e.target.value) })} />
        </label>
      )}
      {(tool.kind === "redeye" || tool.kind === "retouch") && (
        <p className="tool-help">{tool.kind === "redeye" ? `${tool.rects.length} eye${tool.rects.length === 1 ? "" : "s"} marked` : `${tool.spots.length} spot${tool.spots.length === 1 ? "" : "s"} marked`}</p>
      )}
      <div className="tool-buttons">
        <button
          className="tbtn"
          onClick={() => setTool(tool.kind === "redeye" ? { ...tool, rects: [] } : tool.kind === "retouch" ? { ...tool, spots: [] } : tool.kind === "text" ? { ...tool, pos: null } : { ...tool, pos: [0.5, 0.5] })}
        >
          Reset
        </button>
        <div className="row">
          <button className="tbtn apply" onClick={onApply} disabled={!ready}>
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

/** Captures clicks and drags on the photo and shows what's been marked so far. */
export function PixelToolOverlay({ tool, setTool }: { tool: PixelTool; setTool: (t: PixelTool) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const at = (e: React.PointerEvent): [number, number] => {
    const r = ref.current!.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))];
  };
  const pct = (n: number) => `${n * 100}%`;
  const box = ref.current?.getBoundingClientRect();
  const minSide = box ? Math.min(box.width, box.height) : 0;

  const down = (e: React.PointerEvent) => {
    e.preventDefault();
    const [x, y] = at(e);
    if (tool.kind === "redeye") {
      ref.current!.setPointerCapture(e.pointerId);
      setTool({ ...tool, drag: [x, y, x, y] });
    } else if (tool.kind === "retouch") {
      // Radius as a fraction of the original's shorter side, which the stage shows uncropped.
      setTool({ ...tool, spots: [...tool.spots, [x, y, tool.size]] });
    } else {
      setTool({ ...tool, pos: [x, y] });
    }
  };
  const move = (e: React.PointerEvent) => {
    if (tool.kind !== "redeye" || !tool.drag) return;
    const [x, y] = at(e);
    setTool({ ...tool, drag: [tool.drag[0], tool.drag[1], x, y] });
  };
  const up = () => {
    if (tool.kind !== "redeye" || !tool.drag) return;
    const [x0, y0, x1, y1] = tool.drag;
    const rect = [Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0)];
    setTool({ ...tool, drag: null, rects: rect[2] > 0.004 && rect[3] > 0.004 ? [...tool.rects, rect] : tool.rects });
  };

  return (
    <div ref={ref} className={`pixel-overlay ${tool.kind}`} onPointerDown={down} onPointerMove={move} onPointerUp={up}>
      {tool.kind === "redeye" &&
        [...tool.rects, ...(tool.drag ? [[Math.min(tool.drag[0], tool.drag[2]), Math.min(tool.drag[1], tool.drag[3]), Math.abs(tool.drag[2] - tool.drag[0]), Math.abs(tool.drag[3] - tool.drag[1])]] : [])].map(
          ([x, y, w, h], i) => <div key={i} className="mark ellipse" style={{ left: pct(x), top: pct(y), width: pct(w), height: pct(h) }} />,
        )}
      {tool.kind === "retouch" &&
        tool.spots.map(([x, y, r], i) => (
          <div key={i} className="mark ellipse" style={{ left: `calc(${pct(x)} - ${r * minSide}px)`, top: `calc(${pct(y)} - ${r * minSide}px)`, width: r * minSide * 2, height: r * minSide * 2 }} />
        ))}
      {tool.kind === "text" && tool.pos && (
        <div
          className="mark text"
          style={{ left: pct(tool.pos[0]), top: pct(tool.pos[1]), fontSize: (box?.height ?? 0) * tool.size, color: tool.color }}
        >
          {tool.text || "Your text"}
        </div>
      )}
      {tool.kind === "focal" && <div className="mark focal" style={{ left: pct(tool.pos[0]), top: pct(tool.pos[1]), width: minSide * 0.6, height: minSide * 0.6 }} />}
    </div>
  );
}
