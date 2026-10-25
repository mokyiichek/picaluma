import { useEffect, useRef, useState } from "react";
import { pictureDir } from "@tauri-apps/api/path";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { api, thumbUrl } from "../api";
import { plural } from "../format";
import { joinPath, renderPicture } from "../share";
import { useStore } from "../store";
import { confirmAsk, notify } from "../dialogs";
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
/** Picasa's collage styles (Frame Mosaic aside). */
const STYLES = { pile: "Picture Pile", mosaic: "Mosaic", grid: "Picture Grid", contact: "Contact Sheet", exposure: "Multiple Exposure" } as const;
type Style = keyof typeof STYLES;
type Img = CanvasImageSource & { width: number; height: number };

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

/** The same "random" layout every time (preview and final match). */
function seeded(seed: number) {
  let s = seed * 9301 + 49297;
  return () => ((s = (s * 9301 + 49297) % 233280) / 233280);
}

/** Picture Pile: prints with white borders and shadows, tossed onto the page. */
function drawPile(ctx: CanvasRenderingContext2D, imgs: Img[], w: number, h: number) {
  const n = imgs.length;
  const cols = Math.max(1, Math.round(Math.sqrt((n * w) / h)));
  const rows = Math.ceil(n / cols);
  const cell = Math.min(w / cols, h / rows);
  const rnd = seeded(n);
  imgs.forEach((img, i) => {
    const edge = cell * 1.25;
    const k = edge / Math.max(img.width, img.height);
    const pw = img.width * k;
    const ph = img.height * k;
    const border = edge * 0.04;
    const cx = ((i % cols) + 0.5) * (w / cols) + (rnd() - 0.5) * (w / cols) * 0.35;
    const cy = (Math.floor(i / cols) + 0.5) * (h / rows) + (rnd() - 0.5) * (h / rows) * 0.35;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(((rnd() - 0.5) * 24 * Math.PI) / 180);
    ctx.shadowColor = "rgba(0,0,0,0.45)";
    ctx.shadowBlur = edge * 0.04;
    ctx.shadowOffsetX = ctx.shadowOffsetY = edge * 0.012;
    ctx.fillStyle = "#fff";
    ctx.fillRect(-pw / 2 - border, -ph / 2 - border, pw + border * 2, ph + border * 2);
    ctx.shadowColor = "transparent";
    ctx.drawImage(img, -pw / 2, -ph / 2, pw, ph);
    ctx.restore();
  });
}

/** Contact Sheet: every picture whole, in a grid, with its file name underneath. */
function drawContact(ctx: CanvasRenderingContext2D, imgs: Img[], names: string[], w: number, h: number, gap: number, ink: string) {
  for (const t of grid(imgs.length, w, h, Math.max(gap, w * 0.01))) {
    const img = imgs[t.i];
    const label = t.h * 0.14;
    const k = Math.min(t.w / img.width, (t.h - label) / img.height);
    const iw = img.width * k;
    const ih = img.height * k;
    ctx.drawImage(img, t.x + (t.w - iw) / 2, t.y + (t.h - label - ih) / 2, iw, ih);
    ctx.fillStyle = ink;
    ctx.font = `${Math.max(8, label * 0.55)}px Tahoma, Segoe UI, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    let text = names[t.i] ?? "";
    while (text.length > 4 && ctx.measureText(text).width > t.w) text = text.slice(0, -2);
    if (text !== (names[t.i] ?? "")) text = text.slice(0, -1) + "…";
    ctx.fillText(text, t.x + t.w / 2, t.y + t.h - label / 2);
  }
}

/** Multiple Exposure: every picture blended into one frame. */
function drawExposure(ctx: CanvasRenderingContext2D, imgs: Img[], w: number, h: number) {
  imgs.forEach((img, i) => {
    ctx.globalAlpha = 1 / (i + 1);
    drawCover(ctx, img, { i, x: 0, y: 0, w, h });
  });
  ctx.globalAlpha = 1;
}

function drawCover(ctx: CanvasRenderingContext2D, img: Img, t: Tile) {
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

/** Create › Picture Collage: the selected pictures as one JPEG (pile, mosaic, grid, contact sheet or multiple exposure). */
export default function CollageDialog() {
  const ids = useStore((s) => s.collage);
  const [style, setStyle] = useState<Style>("mosaic");
  const [format, setFormat] = useState<Format>("Screen (16:9)");
  const [bg, setBg] = useState<keyof typeof BACKGROUNDS>("White");
  const [spacing, setSpacing] = useState(12);
  const [thumbs, setThumbs] = useState<HTMLImageElement[]>([]);
  const [names, setNames] = useState<string[]>([]);
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
    api
      .photoLabels(ids, "filename")
      .then((rows) => {
        const byId = new Map(rows);
        setNames(ids.map((id) => byId.get(id) ?? ""));
      })
      .catch(() => setNames([]));
  }, [ids]);

  /** Paints the collage at any size: the preview and the final picture use the same layout. */
  const paint = (ctx: CanvasRenderingContext2D, imgs: Img[], w: number, h: number) => {
    const gap = (spacing / 1000) * Math.max(w, h);
    ctx.fillStyle = BACKGROUNDS[bg];
    ctx.fillRect(0, 0, w, h);
    if (style === "pile") return drawPile(ctx, imgs, w, h);
    if (style === "exposure") return drawExposure(ctx, imgs, w, h);
    if (style === "contact") return drawContact(ctx, imgs, names, w, h, gap, bg === "White" ? "#222" : "#eee");
    const tiles = style === "grid" ? grid(imgs.length, w, h, gap) : mosaic(imgs.map((p) => p.width / p.height), w, h, gap);
    for (const t of tiles) drawCover(ctx, imgs[t.i], t);
  };

  useEffect(() => {
    const c = preview.current;
    if (!c || !thumbs.length) return;
    const ratio = FORMATS[format];
    c.width = ratio >= 1 ? 460 : Math.round(330 * ratio);
    c.height = Math.round(c.width / ratio);
    paint(c.getContext("2d")!, thumbs, c.width, c.height);
  }, [thumbs, names, style, format, bg, spacing]); // eslint-disable-line react-hooks/exhaustive-deps

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
      paint(ctx, pics, W, H);
      const url = c.toDataURL("image/jpeg", 0.9);
      const data = url.slice(url.indexOf(",") + 1);
      if (desktop) await api.setWallpaper(data);
      const stamp = new Date().toISOString().slice(0, 16).replace("T", " ").replace(":", "");
      const dir = joinPath(joinPath(await pictureDir(), "Picaluma"), "Collages");
      const out = await api.exportPicture(joinPath(dir, `Collage ${stamp}.jpg`), data);
      api.addProject("collage", `Collage ${stamp}`, out, ids, { style, format, bg, spacing }).then(() => useStore.getState().loadSnapshot());
      useStore.getState().setCollage(null);
      if (!desktop && (await confirmAsk(`Collage saved:
${out}`, { title: "Picture Collage", ok: "Show in Folder", cancel: "OK" }))) revealItemInDir(out).catch(() => {});
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
              {(Object.keys(STYLES) as Style[]).map((k) => (
                <label key={k} className="opt-radio">
                  <input type="radio" checked={style === k} onChange={() => setStyle(k)} /> {STYLES[k]}
                </label>
              ))}
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
              <input type="range" className="slider" min={0} max={40} value={spacing} onChange={(e) => setSpacing(Number(e.target.value))} disabled={busy || style === "pile" || style === "exposure"} />
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
