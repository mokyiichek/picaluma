import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { api, Photo, thumbUrl } from "../api";
import { plural } from "../format";
import { isMac } from "../platform";
import { renderPicture } from "../share";
import { useStore } from "../store";
import { BackIcon, PrintIcon } from "./Icons";

// Page geometry is in inches. Layout sizes are portrait; cells turn landscape when more fit that way.
const PAPERS = { Letter: [8.5, 11], A4: [8.27, 11.69] } as const;
type Paper = keyof typeof PAPERS;
type LayoutId = "wallet" | "3.5x5" | "4x6" | "5x7" | "8x10" | "full" | "index" | "poster";
const LAYOUTS: { id: LayoutId; label: string; size?: [number, number] }[] = [
  { id: "wallet", label: "Wallet", size: [2.5, 3.5] },
  { id: "3.5x5", label: "3.5 x 5", size: [3.5, 5] },
  { id: "4x6", label: "4 x 6", size: [4, 6] },
  { id: "5x7", label: "5 x 7", size: [5, 7] },
  { id: "8x10", label: "8 x 10", size: [8, 10] },
  { id: "full", label: "Full Page" },
  { id: "index", label: "Index Print" },
  { id: "poster", label: "Poster" },
];
const BORDERS = { none: "No border", thinWhite: "Thin white border", thickWhite: "Thick white border", thinBlack: "Thin black border" } as const;
type Border = keyof typeof BORDERS;

const MARGIN = 0.25;
const GAP = 0.125;
const CAPTION = 0.24;

interface Cell {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Poster: this page shows column c, row r of an n×n enlargement. */
  tile?: { c: number; r: number; n: number };
}

function slots(layout: LayoutId, pw: number, ph: number): { w: number; h: number; pos: [number, number][] } {
  const uw = pw - 2 * MARGIN;
  const uh = ph - 2 * MARGIN;
  if (layout === "full" || layout === "poster") return { w: uw, h: uh, pos: [[MARGIN, MARGIN]] };
  let w: number, h: number, cols: number, rows: number;
  if (layout === "index") {
    cols = 5;
    w = (uw - GAP * (cols - 1)) / cols;
    h = w * 0.75 + CAPTION;
    rows = Math.floor((uh + GAP) / (h + GAP));
  } else {
    const [cw, ch] = LAYOUTS.find((l) => l.id === layout)!.size!;
    const fit = (a: number, b: number) => [Math.floor((uw + GAP) / (a + GAP)), Math.floor((uh + GAP) / (b + GAP))];
    const [pc, pr] = fit(cw, ch);
    const [lc, lr] = fit(ch, cw);
    if (lc * lr > pc * pr) [w, h, cols, rows] = [ch, cw, lc, lr];
    else [w, h, cols, rows] = [cw, ch, pc, pr];
    if (cols * rows === 0) {
      // Bigger than the printable area (8x10 on A4): shrink to fit, keeping the proportions.
      const k = Math.min(uw / cw, uh / ch);
      [w, h, cols, rows] = [cw * k, ch * k, 1, 1];
    }
  }
  const x0 = (pw - (cols * w + (cols - 1) * GAP)) / 2;
  const y0 = layout === "index" ? MARGIN : (ph - (rows * h + (rows - 1) * GAP)) / 2;
  const pos: [number, number][] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) pos.push([x0 + c * (w + GAP), y0 + r * (h + GAP)]);
  return { w, h, pos };
}

function paginate(layout: LayoutId, [pw, ph]: number[], ids: number[], copies: number, tiles: number): Cell[][] {
  const { w, h, pos } = slots(layout, pw, ph);
  if (layout === "poster") {
    const pages: Cell[][] = [];
    for (let r = 0; r < tiles; r++) for (let c = 0; c < tiles; c++) pages.push([{ id: ids[0], x: pos[0][0], y: pos[0][1], w, h, tile: { c, r, n: tiles } }]);
    return pages;
  }
  const items = ids.flatMap((id) => Array(layout === "index" ? 1 : copies).fill(id) as number[]);
  const pages: Cell[][] = [];
  for (let i = 0; i < items.length; i += pos.length) {
    pages.push(items.slice(i, i + pos.length).map((id, j) => ({ id, x: pos[j][0], y: pos[j][1], w, h })));
  }
  return pages;
}

interface Rendered {
  url: string;
  w: number;
  h: number;
}

function Sheet({ cells, dims, unit, layout, fit, border, src, names }: {
  cells: Cell[];
  dims: number[];
  unit: (inches: number) => string;
  layout: LayoutId;
  fit: "shrink" | "crop";
  border: Border;
  src: Map<number, Rendered>;
  names: Map<number, string>;
}) {
  const [pw, ph] = dims;
  const pad = border === "thickWhite" ? 0.2 : border === "none" ? 0 : 0.06;
  const index = layout === "index";
  return (
    <div className="sheet" style={{ width: unit(pw), height: unit(ph) }}>
      {cells.map((c, i) => {
        const r = src.get(c.id);
        const bw = c.w - 2 * pad;
        const bh = c.h - 2 * pad - (index ? CAPTION : 0);
        // Turn the picture to match the cell (a landscape photo in a portrait 4x6), as Picasa does.
        const turn = !index && !c.tile && r != null && r.w > r.h !== bw > bh && Math.abs(r.w - r.h) > 2;
        const objectFit = index || fit === "shrink" ? "contain" : "cover";
        return (
          <div key={i} className="pcell" style={{ left: unit(c.x), top: unit(c.y), width: unit(c.w), height: unit(c.h), padding: unit(pad) }}>
            <div className={`pbox${border === "thinBlack" ? " black" : ""}`} style={{ width: unit(bw), height: unit(bh) }}>
              <img
                src={r?.url ?? thumbUrl(c.id)}
                alt=""
                style={
                  c.tile
                    ? { position: "absolute", width: unit(bw * c.tile.n), height: unit(bh * c.tile.n), left: unit(-c.tile.c * bw), top: unit(-c.tile.r * bh), objectFit: "cover" }
                    : turn
                    ? { width: unit(bh), height: unit(bw), objectFit, position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%) rotate(90deg)" }
                    : { width: "100%", height: "100%", objectFit }
                }
              />
            </div>
            {index && (
              <div className="pcap" style={{ fontSize: unit(0.1), height: unit(CAPTION), lineHeight: unit(CAPTION) }}>
                {names.get(c.id) ?? ""}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Picasa's Print screen: layouts from wallet to full page, index prints, borders, copies. */
export default function PrintView() {
  const print = useStore((s) => s.print);
  const [layout, setLayout] = useState<LayoutId>(() => (localStorage.getItem("printLayout") as LayoutId) ?? "4x6");
  const [paper, setPaper] = useState<Paper>(() => (localStorage.getItem("printPaper") as Paper) ?? (/^en-(US|CA)/.test(navigator.language) ? "Letter" : "A4"));
  const [fit, setFit] = useState<"shrink" | "crop">("shrink");
  const [border, setBorder] = useState<Border>("none");
  const [copies, setCopies] = useState(1);
  const [tiles, setTiles] = useState(2);
  const [src, setSrc] = useState<Map<number, Rendered>>(new Map());
  const [names, setNames] = useState<Map<number, string>>(new Map());
  const [done, setDone] = useState(0);
  const [printing, setPrinting] = useState(false);
  const ids = print?.ids;

  useEffect(() => {
    if (print?.layout) setLayout(print.layout as LayoutId);
  }, [print]);

  // Render each picture once with its edits; large enough for 300 dpi on an 8x10.
  useEffect(() => {
    if (!ids) return;
    let cancelled = false;
    const urls: string[] = [];
    setSrc(new Map());
    setDone(0);
    const edge = ids.length > 60 ? 1200 : 2400;
    (async () => {
      const nm = new Map<number, string>();
      for (const id of ids) {
        if (cancelled) return;
        try {
          const photo: Photo = await api.getPhoto(id);
          nm.set(id, photo.caption || photo.name);
          const canvas = await renderPicture(id, { maxEdge: edge });
          const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/jpeg", 0.92));
          if (!blob || cancelled) continue;
          const url = URL.createObjectURL(blob);
          urls.push(url);
          setSrc((m) => new Map(m).set(id, { url, w: canvas.width, h: canvas.height }));
        } catch {
          /* falls back to the thumbnail */
        }
        if (!cancelled) setDone((d) => d + 1);
      }
      if (!cancelled) setNames(nm);
    })();
    return () => {
      cancelled = true;
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [ids]);

  // Posters print landscape pages for a landscape picture.
  const first = ids ? src.get(ids[0]) : undefined;
  const landscape = layout === "poster" && first != null && first.w > first.h;
  const dims = useMemo(() => (landscape ? [...PAPERS[paper]].reverse() : [...PAPERS[paper]]), [paper, landscape]);
  const pages = useMemo(() => (ids ? paginate(layout, dims, ids, copies, tiles) : []), [ids, layout, dims, copies, tiles]);

  if (!ids) return null;
  const close = () => useStore.getState().setPrint(null);
  const choose = (l: LayoutId) => {
    setLayout(l);
    localStorage.setItem("printLayout", l);
  };
  const doPrint = async () => {
    const [pw, ph] = dims;
    let style = document.getElementById("page-size") as HTMLStyleElement | null;
    if (!style) {
      style = document.createElement("style");
      style.id = "page-size";
      document.head.appendChild(style);
    }
    style.textContent = `@page { size: ${pw}in ${ph}in; margin: 0; }`;
    setPrinting(true);
    // Let the print copy render before the dialog snapshots the page.
    await new Promise((r) => setTimeout(r, 200));
    try {
      if (isMac) await api.printWindow();
      else window.print();
    } catch (e) {
      alert(`Printing failed: ${e}`);
    }
    setPrinting(false);
  };

  const ppi = Math.min(70, 560 / dims[0], 760 / dims[1]);
  const sheetProps = { dims, layout, fit, border, src, names };
  const single = layout === "index" || layout === "poster";
  const perPage = pages[0]?.length ?? 0;

  return (
    <div className="print-view">
      <div className="print-left">
        <section>
          <h4>Print Layout</h4>
          <div className="layouts">
            {LAYOUTS.map((l) => (
              <button key={l.id} className={`layout-btn${layout === l.id ? " active" : ""}`} onClick={() => choose(l.id)}>
                <LayoutGlyph id={l.id} />
                {l.label}
              </button>
            ))}
          </div>
        </section>
        {layout === "poster" && (
          <section>
            <h4>Poster Size</h4>
            <select value={tiles} onChange={(e) => setTiles(Number(e.target.value))}>
              {[2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  {n} x {n} pages ({plural(n * n, "page")})
                </option>
              ))}
            </select>
            <p className="muted">Prints the first picture enlarged across several pages to tape together.</p>
          </section>
        )}
        <section>
          <h4>Image Options</h4>
          <div className="tgroup">
            <button className={`tbtn${fit === "shrink" ? " pressed" : ""}`} onClick={() => setFit("shrink")} disabled={single}>
              Shrink to Fit
            </button>
            <button className={`tbtn${fit === "crop" ? " pressed" : ""}`} onClick={() => setFit("crop")} disabled={single}>
              Crop to Fit
            </button>
          </div>
        </section>
        <section>
          <h4>Borders</h4>
          <select value={border} onChange={(e) => setBorder(e.target.value as Border)}>
            {Object.entries(BORDERS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </section>
        <section>
          <h4>Printer Settings</h4>
          <label className="prow">
            Paper size
            <select
              value={paper}
              onChange={(e) => {
                setPaper(e.target.value as Paper);
                localStorage.setItem("printPaper", e.target.value);
              }}
            >
              {Object.keys(PAPERS).map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </label>
          <label className="prow">
            Copies per picture
            <span className="stepper">
              <button className="tbtn" onClick={() => setCopies((c) => Math.max(1, c - 1))} disabled={single || copies <= 1}>
                −
              </button>
              <b>{single ? 1 : copies}</b>
              <button className="tbtn" onClick={() => setCopies((c) => Math.min(99, c + 1))} disabled={single}>
                +
              </button>
            </span>
          </label>
          <p className="muted">
            {plural(ids.length, "picture")} · {perPage} per page · {plural(pages.length, "page")}
            {done < ids.length && ` · preparing ${done}/${ids.length}`}
          </p>
        </section>
        <div className="print-actions">
          <button className="tbtn" onClick={close}>
            <BackIcon /> Back to Library
          </button>
          <button className="tbtn default" onClick={doPrint} disabled={printing}>
            <PrintIcon /> Print...
          </button>
        </div>
      </div>
      <div className="print-preview">
        {pages.map((cells, i) => (
          <div key={i} className="page-wrap">
            <Sheet cells={cells} unit={(v) => `${v * ppi}px`} {...sheetProps} />
            <span className="muted">
              Page {i + 1} of {pages.length}
            </span>
          </div>
        ))}
      </div>
      {printing &&
        createPortal(
          <div className="print-root">
            {pages.map((cells, i) => (
              <Sheet key={i} cells={cells} unit={(v) => `${v}in`} {...sheetProps} />
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}

/** Small page diagram for each layout button. */
function LayoutGlyph({ id }: { id: LayoutId }) {
  const { w, h, pos } = slots(id, 8.5, 11);
  const k = 2.6;
  if (id === "poster")
    return (
      <svg width={8.5 * k} height={11 * k} viewBox={`0 0 ${8.5 * k} ${11 * k}`}>
        <rect x="0.5" y="0.5" width={8.5 * k - 1} height={11 * k - 1} fill="#7fa7d1" stroke="#999" />
        <path d={`M${4.25 * k} 1V${11 * k - 1}M1 ${5.5 * k}H${8.5 * k - 1}`} stroke="#fff" strokeDasharray="2 2" />
      </svg>
    );
  return (
    <svg width={8.5 * k} height={11 * k} viewBox={`0 0 ${8.5 * k} ${11 * k}`}>
      <rect x="0.5" y="0.5" width={8.5 * k - 1} height={11 * k - 1} fill="#fff" stroke="#999" />
      {pos.map(([x, y], i) => (
        <rect key={i} x={x * k} y={y * k} width={w * k} height={(id === "index" ? h - CAPTION : h) * k} fill="#7fa7d1" />
      ))}
    </svg>
  );
}
