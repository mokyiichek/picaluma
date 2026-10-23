import { useEffect, useRef, useState } from "react";
import { pictureDir } from "@tauri-apps/api/path";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { api, thumbUrl } from "../api";
import { plural } from "../format";
import { joinPath, renderPicture } from "../share";
import { useStore } from "../store";
import { notify } from "../dialogs";
import { takeRemake } from "../projects";

const FORMATS = {
  "Screen (16:9)": 16 / 9,
  "Screen (4:3)": 4 / 3,
  Square: 1,
  "4 x 6 print": 6 / 4,
  "Letter / A4 portrait": 8.5 / 11,
} as const;
type Format = keyof typeof FORMATS;
const BACKGROUNDS = { White: "#ffffff", Black: "#000000", Grey: "#808080" } as const;
type Style = "grid" | "mosaic";

interface Tile {
  i: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Justified rows that exactly fill w×h; pictures keep their shape apart from a slight crop. */
function mosaic(aspects: number[], w: number, h: number, gap: number): Tile[] {
  const n = aspects.length;
  let best: Tile[] = [];
  let bestErr = Infinity;
  for (let rows = 1; rows <= n; rows++) {
    // Split into `rows` runs with roughly equal total aspect (equal row widths at equal heights).
    const total = aspects.reduce((a, b) => a + b, 0);
    const runs: number[][] = [];
    let run: number[] = [];
    let acc = 0;
    aspects.forEach((a, i) => {
      run.push(i);
      acc += a;
      if (acc >= (total / rows) * (runs.length + 1) - a / 2 && runs.length < rows - 1) {
        runs.push(run);
        run = [];
      }
    });
    if (run.length) runs.push(run);
    const heights = runs.map((r) => (w - gap * (r.length + 1)) / r.reduce((s, i) => s + aspects[i], 0));
    const natural = heights.reduce((a, b) => a + b, 0) + gap * (runs.length + 1);
    const err = Math.abs(Math.log(natural / h));
    if (err < bestErr) {
      bestErr = err;
      const k = (h - gap * (runs.length + 1)) / (natural - gap * (runs.length + 1));
      const tiles: Tile[] = [];
      let y = gap;
      runs.forEach((r, j) => {
        const rh = heights[j] * k;
        let x = gap;
        const sum = r.reduce((s, i) => s + aspects[i], 0);
        for (const i of r) {
          const tw = ((w - gap * (r.length + 1)) * aspects[i]) / sum;
          tiles.push({ i, x, y, w: tw, h: rh });
          x += tw + gap;
        }
        y += rh + gap;
      });
      best = tiles;
    }
  }
  return best;
}

function grid(n: number, w: number, h: number, gap: number): Tile[] {
  const cols = Math.max(1, Math.round(Math.sqrt((n * w) / h)));
  const rows = Math.ceil(n / cols);
  const cw = (w - gap * (cols + 1)) / cols;
  const ch = (h - gap * (rows + 1)) / rows;
  return Array.from({ length: n }, (_, i) => ({ i, x: gap + (i % cols) * (cw + gap), y: gap + Math.floor(i / cols) * (ch + gap), w: cw, h: ch }));
}

function drawCover(ctx: CanvasRenderingContext2D, img: CanvasImageSource & { width: number; height: number }, t: Tile) {
  const k = Math.max(t.w / img.width, t.h / img.height);
  const sw = t.w / k;
  const sh = t.h / k;
  ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, t.x, t.y, t.w, t.h);
}

const loadThumb = (id: number) =>
  new Promise<HTMLImageElement>((ok, fail) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => ok(img);
    img.onerror = fail;
    img.src = thumbUrl(id);
  });

/** Create › Picture Collage: a grid or mosaic of the selected pictures saved as one JPEG. */
export default function CollageDialog() {
  const ids = useStore((s) => s.collage);
  const [style, setStyle] = useState<Style>("mosaic");
  const [format, setFormat] = useState<Format>("Screen (16:9)");
  const [bg, setBg] = useState<keyof typeof BACKGROUNDS>("White");
  const [spacing, setSpacing] = useState(12);
  const [thumbs, setThumbs] = useState<HTMLImageElement[]>([]);
  const [busy, setBusy] = useState(false);
  const preview = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!ids) return;
    setThumbs([]);
    // Make Again: the options this collage was made with.
    const r = takeRemake<{ style: Style; format: Format; bg: keyof typeof BACKGROUNDS; spacing: number }>("collage");
    if (r) {
      if (r.style) setStyle(r.style);
      if (r.format) setFormat(r.format);
      if (r.bg) setBg(r.bg);
      if (r.spacing != null) setSpacing(r.spacing);
    }
    Promise.all(ids.map((id) => loadThumb(id).catch(() => null))).then((list) => setThumbs(list.filter((x): x is HTMLImageElement => !!x)));
  }, [ids]);

  const layout = (w: number, h: number, aspects: number[]) => {
    const gap = (spacing / 1000) * Math.max(w, h);
    return style === "grid" ? grid(aspects.length, w, h, gap) : mosaic(aspects, w, h, gap);
  };

  useEffect(() => {
    const c = preview.current;
    if (!c || !thumbs.length) return;
    const ratio = FORMATS[format];
    c.width = ratio >= 1 ? 460 : Math.round(330 * ratio);
    c.height = Math.round(c.width / ratio);
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = BACKGROUNDS[bg];
    ctx.fillRect(0, 0, c.width, c.height);
    for (const t of layout(c.width, c.height, thumbs.map((t) => t.width / t.height))) drawCover(ctx, thumbs[t.i], t);
  }, [thumbs, style, format, bg, spacing]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!ids) return null;
  const close = () => !busy && useStore.getState().setCollage(null);

  const create = async (desktop: boolean) => {
    setBusy(true);
    try {
      const ratio = FORMATS[format];
      const W = ratio >= 1 ? 3600 : Math.round(3600 * ratio);
      const H = Math.round(W / ratio);
      const pics = [];
      for (const id of ids) pics.push(await renderPicture(id, { maxEdge: 1800 }));
      const c = document.createElement("canvas");
      c.width = W;
      c.height = H;
      const ctx = c.getContext("2d")!;
      ctx.imageSmoothingQuality = "high";
      ctx.fillStyle = BACKGROUNDS[bg];
      ctx.fillRect(0, 0, W, H);
      for (const t of layout(W, H, pics.map((p) => p.width / p.height))) drawCover(ctx, pics[t.i], t);
      const url = c.toDataURL("image/jpeg", 0.9);
      const data = url.slice(url.indexOf(",") + 1);
      if (desktop) await api.setWallpaper(data);
      const stamp = new Date().toISOString().slice(0, 16).replace("T", " ").replace(":", "");
      const dir = joinPath(joinPath(await pictureDir(), "Picaluma"), "Collages");
      const out = await api.exportPicture(joinPath(dir, `Collage ${stamp}.jpg`), data);
      api.addProject("collage", `Collage ${stamp}`, out, ids, { style, format, bg, spacing }).then(() => useStore.getState().loadSnapshot());
      useStore.getState().setCollage(null);
      if (!desktop) revealItemInDir(out).catch(() => {});
    } catch (e) {
      notify(`The collage couldn't be made: ${e}`, "error");
    }
    setBusy(false);
  };

  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && close()} onKeyDown={(e) => e.key === "Escape" && close()}>
      <div className="modal share-dialog collage">
        <h3>Picture Collage — {plural(ids.length, "picture")}</h3>
        <div className="body collage-body">
          <div className="collage-opts">
            <fieldset disabled={busy}>
              <legend>Style</legend>
              <label className="opt-radio">
                <input type="radio" checked={style === "mosaic"} onChange={() => setStyle("mosaic")} /> Mosaic
              </label>
              <label className="opt-radio">
                <input type="radio" checked={style === "grid"} onChange={() => setStyle("grid")} /> Picture grid
              </label>
            </fieldset>
            <label className="field">
              <span>Page format</span>
              <select value={format} onChange={(e) => setFormat(e.target.value as Format)} disabled={busy}>
                {Object.keys(FORMATS).map((f) => (
                  <option key={f}>{f}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Background</span>
              <select value={bg} onChange={(e) => setBg(e.target.value as keyof typeof BACKGROUNDS)} disabled={busy}>
                {Object.keys(BACKGROUNDS).map((b) => (
                  <option key={b}>{b}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Spacing</span>
              <input type="range" className="slider" min={0} max={40} value={spacing} onChange={(e) => setSpacing(Number(e.target.value))} disabled={busy} />
            </label>
          </div>
          <div className="collage-preview">{thumbs.length ? <canvas ref={preview} /> : <span className="muted">Loading pictures…</span>}</div>
        </div>
        <div className="foot">
          {busy && <span className="progress-note">Creating collage...</span>}
          <button className="tbtn" onClick={() => create(true)} disabled={busy}>
            Set as Desktop
          </button>
          <button className="tbtn default" onClick={() => create(false)} disabled={busy}>
            Create Collage
          </button>
          <button className="tbtn" onClick={close} disabled={busy}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
