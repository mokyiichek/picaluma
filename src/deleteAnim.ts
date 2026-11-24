import { useStore } from "./store";

// Delete animations: the deleted pictures shrink away, the grid's other pictures glide into their
// new places, and in Edit view the next picture zooms in to take the deleted one's place.
// Off with Tools › Options › Special effects off.


/** The grid listens: it turns its glide transition on for a moment. */
export const reflowBus = new EventTarget();

/** Set just before Edit view moves on from a deleted picture: that picture zooms in. */
export const arrival: { id: number | null } = { id: null };

const on = () => useStore.getState().effects;

/**
 * Where the grid's pictures and folder headings were before a change. `gone`: pictures on their
 * way out (the ripple waits until they have left). `back`: pictures that Undo / Redo brought back
 * or changed: the grid shows them (scrolling there if needed), and `land` drops them in from above
 * (deleted or hidden ones coming back) or else gives them a little pop.
 */
export type FlipStart = {
  gone: Set<number>;
  cells: Map<number, DOMRect>;
  heads: Map<string, DOMRect>;
  back?: Set<number>;
  land?: boolean;
  at: number;
};

const DROP_MS = 460;
const SPRING = "cubic-bezier(0.34, 1.45, 0.64, 1)";

/** A deleted thumbnail: lifts, tilts and drops away, with a little burst where it was. */
function dropAway(img: HTMLElement, i: number, ms = DROP_MS) {
  const r = img.getBoundingClientRect();
  if (!r.width || r.bottom < 0 || r.top > window.innerHeight) return;
  const g = img.cloneNode(true) as HTMLElement;
  g.removeAttribute("data-photo");
  Object.assign(g.style, {
    position: "fixed",
    left: `${r.left}px`,
    top: `${r.top}px`,
    width: `${r.width}px`,
    height: `${r.height}px`,
    margin: "0",
    maxWidth: "none",
    maxHeight: "none",
    zIndex: "60",
    pointerEvents: "none",
    transformOrigin: "50% 60%",
    boxShadow: "1px 2px 4px rgba(0, 0, 0, 0.4)",
  });
  document.body.appendChild(g);
  const tilt = (i % 2 ? 1 : -1) * (10 + (i % 3) * 4);
  const delay = Math.min(i * 25, 200);
  const a = g.animate(
    [
      { transform: "none", opacity: 1, filter: "none", offset: 0 },
      { transform: "translateY(-10px) scale(1.12) rotate(" + -tilt / 3 + "deg)", opacity: 1, filter: "saturate(0.3) brightness(1.08)", boxShadow: "4px 10px 18px rgba(0,0,0,0.45)", offset: 0.28 },
      { transform: `translateY(${r.height * 0.9}px) scale(0.15) rotate(${tilt}deg)`, opacity: 0, filter: "saturate(0) brightness(1.2)", offset: 1 },
    ],
    { duration: ms, delay, easing: "cubic-bezier(0.5, 0, 0.75, 0)", fill: "both" },
  );
  a.onfinish = a.oncancel = () => g.remove();
  burst(r.left + r.width / 2, r.top + r.height / 2, Math.min(320, Math.max(r.width, r.height)), delay + ms * 0.45);
}

/** Small specks flying out from a point and fading. */
function burst(cx: number, cy: number, size: number, delay: number) {
  const n = 12;
  for (let k = 0; k < n; k++) {
    const d = document.createElement("div");
    const s = 3 + (k % 3) * 2;
    Object.assign(d.style, {
      position: "fixed",
      left: `${cx - s / 2}px`,
      top: `${cy - s / 2}px`,
      width: `${s}px`,
      height: `${s}px`,
      borderRadius: k % 2 ? "50%" : "1px",
      background: ["#4a7fb0", "#9cc3e6", "#c9c9c9", "#e07a5f"][k % 4],
      zIndex: "61",
      pointerEvents: "none",
    });
    document.body.appendChild(d);
    const ang = (k / n) * Math.PI * 2 + (k % 2) * 0.3;
    const dist = size * (0.35 + (k % 4) * 0.08);
    const a = d.animate(
      [
        { transform: "translate(0, 0) scale(1)", opacity: 0 },
        { transform: "translate(0, 0) scale(1)", opacity: 1, offset: 0.05 },
        { transform: `translate(${Math.cos(ang) * dist}px, ${Math.sin(ang) * dist + size * 0.15}px) scale(0.3) rotate(${k * 40}deg)`, opacity: 0 },
      ],
      { duration: 520, delay, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)", fill: "both" },
    );
    a.onfinish = a.oncancel = () => d.remove();
  }
}

/** Where the visible pictures (their cells) and folder headings are now. */
function capture(canvas: Element, gone: Set<number>): FlipStart {
  const cells = new Map<number, DOMRect>();
  canvas.querySelectorAll<HTMLImageElement>("img[data-photo]").forEach((img) => {
    const id = Number(img.dataset.photo);
    if (!gone.has(id) && img.parentElement) cells.set(id, img.parentElement.getBoundingClientRect());
  });
  const heads = new Map<string, DOMRect>();
  canvas.querySelectorAll<HTMLElement>(".folder-head[data-folder]").forEach((h) => heads.set(h.dataset.folder!, h.getBoundingClientRect()));
  return { gone, cells, heads, at: performance.now() };
}

const gridCanvas = () => document.querySelector(".grid-scroll .grid-canvas");

/**
 * Library: the deleted thumbnails drop away; the grid then ripples the rest into place. With
 * `hide`, the thumbnails themselves are hidden at once (Redo Delete: the grid reloads later).
 */
export function animateGridDelete(ids: number[], hide = false) {
  if (!on()) return;
  const canvas = gridCanvas();
  if (!canvas) return;
  const start = capture(canvas, new Set(ids));
  let i = 0;
  for (const id of ids.slice(0, 120)) {
    const img = canvas.querySelector<HTMLElement>(`img[data-photo="${id}"]`);
    if (!img) continue;
    dropAway(img, i++);
    if (hide) img.style.visibility = "hidden";
  }
  reflowBus.dispatchEvent(new CustomEvent<FlipStart>("reflow", { detail: start }));
}

/**
 * Edit › Undo / Redo in the library, before the step runs: where everything is now; pictures
 * about to leave (Redo Delete, Redo Hide…) drop away.
 */
export function beforeUndoStep(ids: number[], leaving: boolean): FlipStart | null {
  if (useStore.getState().view !== "library") return null;
  if (leaving) {
    animateGridDelete(ids, true);
    return null;
  }
  const canvas = gridCanvas();
  return canvas && on() ? capture(canvas, new Set()) : null;
}

/**
 * After the step: the pictures it brought back or changed are selected and shown (scrolled to
 * when off-screen); they drop back in (`land`) or pop, while the others make room.
 */
export function afterUndoStep(start: FlipStart | null, ids: number[], leaving: boolean, land: boolean) {
  gridCanvas()
    ?.querySelectorAll<HTMLElement>("img[data-photo]")
    .forEach((img) => {
      if (img.style.visibility === "hidden") img.style.visibility = "";
    });
  const s = useStore.getState();
  if (s.view !== "library" || leaving) return;
  const present = ids.filter((id) => s.folderOfPhoto.has(id));
  if (!present.length) return;
  s.selectOnly(present);
  const detail: FlipStart = {
    gone: new Set(),
    cells: on() && start ? start.cells : new Map(),
    heads: on() && start ? start.heads : new Map(),
    back: new Set(present),
    land,
    at: performance.now(),
  };
  reflowBus.dispatchEvent(new CustomEvent<FlipStart>("reflow", { detail }));
}

/** A picture coming back: falls in from above and lands with a little bounce and a puff of dust. */
export function landIn(cell: HTMLElement, k: number) {
  const own = cell.style.transform;
  const h = cell.offsetHeight;
  const delay = 120 + Math.min(k * 40, 320);
  cell.animate(
    [
      { transform: `${own} translateY(${-h * 0.9}px) scale(0.35) rotate(-14deg)`, opacity: 0 },
      { transform: `${own} translateY(${-h * 0.15}px) scale(1.12) rotate(3deg)`, opacity: 1, offset: 0.55 },
      { transform: `${own} translateY(3px) scale(1.04, 0.96)`, opacity: 1, offset: 0.78 },
      { transform: own, opacity: 1 },
    ],
    { duration: 560, delay, easing: "cubic-bezier(0.25, 0.8, 0.3, 1)", fill: "backwards" },
  );
  const r = cell.getBoundingClientRect();
  dust(r.left + r.width / 2, r.top + r.height * 0.82, Math.min(240, r.width), delay + 400);
}

/** A picture Undo / Redo changed in place, or brought from somewhere off-screen: a quick pop. */
export function popIn(cell: HTMLElement, k: number) {
  const own = cell.style.transform;
  cell.animate(
    [{ transform: own }, { transform: `${own} scale(1.14)`, offset: 0.4 }, { transform: own }],
    { duration: 380, delay: 60 + Math.min(k * 30, 240), easing: SPRING },
  );
}

/** Dust puffing out sideways where a picture lands. */
function dust(cx: number, cy: number, size: number, delay: number) {
  const n = 10;
  for (let k = 0; k < n; k++) {
    const d = document.createElement("div");
    const s = 3 + (k % 3);
    Object.assign(d.style, {
      position: "fixed",
      left: `${cx - s / 2}px`,
      top: `${cy - s / 2}px`,
      width: `${s}px`,
      height: `${s}px`,
      borderRadius: "50%",
      background: ["#9cc3e6", "#4a7fb0", "#d8d8d8", "#f2c14e"][k % 4],
      zIndex: "61",
      pointerEvents: "none",
    });
    document.body.appendChild(d);
    const dx = (k % 2 ? 1 : -1) * size * (0.3 + (k % 5) * 0.07);
    const a = d.animate(
      [
        { transform: "translate(0, 0)", opacity: 0 },
        { transform: "translate(0, 0)", opacity: 1, offset: 0.05 },
        { transform: `translate(${dx}px, ${-size * (0.08 + (k % 3) * 0.06)}px) scale(0.3)`, opacity: 0 },
      ],
      { duration: 480, delay, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)", fill: "both" },
    );
    a.onfinish = a.oncancel = () => d.remove();
  }
}

/**
 * After the delete has left the grid: every picture that moved slides from where it was, one
 * after another in reading order with a little bounce; pictures that came into view rise in.
 */
export function flipGrid(canvas: Element, start: FlipStart): Set<number> {
  const vh = window.innerHeight;
  const movedIds = new Set<number>();
  type Move = { el: HTMLElement; dx: number; dy: number; enter: boolean; top: number; left: number };
  const moves: Move[] = [];
  canvas.querySelectorAll<HTMLImageElement>("img[data-photo]").forEach((img) => {
    const cell = img.parentElement as HTMLElement | null;
    if (!cell) return;
    const a = cell.getBoundingClientRect();
    if (a.bottom < 0 || a.top > vh) return;
    const id = Number(img.dataset.photo);
    const b = start.cells.get(id);
    if (!b) {
      // Brought back by Undo: landIn / popIn instead.
      if (!start.back?.has(id)) moves.push({ el: cell, dx: 0, dy: a.height * 0.5, enter: true, top: a.top, left: a.left });
      return;
    }
    const dx = b.left - a.left;
    const dy = b.top - a.top;
    if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
      moves.push({ el: cell, dx, dy, enter: false, top: a.top, left: a.left });
      movedIds.add(id);
    }
  });
  moves.sort((p, q) => p.top - q.top || p.left - q.left);
  const base = start.gone.size ? DROP_MS * 0.35 : 0; // let the deleted picture start falling first
  moves.forEach((m, k) => {
    const own = m.el.style.transform; // cells are placed with translate(x, y)
    const delay = base + Math.min(k * 22, 260);
    if (m.enter) {
      m.el.animate(
        [
          { transform: `translate(0px, ${m.dy}px) ${own}`, opacity: 0 },
          { transform: `translate(0px, 0px) ${own}`, opacity: 1 },
        ],
        { duration: 380, delay, easing: SPRING, fill: "backwards" },
      );
      return;
    }
    // A picture that changes rows hops along an arc instead of sliding through its neighbours.
    const hop = Math.abs(m.dy) > 1 ? -Math.min(24, Math.abs(m.dy) * 0.25) : -6;
    m.el.animate(
      [
        { transform: `translate(${m.dx}px, ${m.dy}px) ${own}`, zIndex: 2 },
        { transform: `translate(${m.dx * 0.45}px, ${m.dy * 0.45 + hop}px) ${own}`, zIndex: 2, offset: 0.45 },
        { transform: `translate(0px, 0px) ${own}`, zIndex: 2 },
      ],
      { duration: 420, delay, easing: SPRING, fill: "backwards" },
    );
  });
  // Folder headings below the delete move up with the pictures.
  canvas.querySelectorAll<HTMLElement>(".folder-head[data-folder]").forEach((h) => {
    const b = start.heads.get(h.dataset.folder!);
    if (!b) return;
    const a = h.getBoundingClientRect();
    const dy = b.top - a.top;
    if (Math.abs(dy) < 0.5 || a.bottom < 0 || a.top > vh) return;
    h.animate([{ transform: `translateY(${dy}px)` }, { transform: "none" }], { duration: 420, delay: base, easing: SPRING, fill: "backwards" });
  });
  return movedIds;
}

/** Edit view: the picture drops away as in the library; `next` (if any) zooms in to take its place. */
export function animateEditorDelete(next: number | null) {
  if (!on()) return;
  const el = document.querySelector<HTMLElement>(".edit-stage .edit-photo:not(.before)");
  if (el) dropAway(el, 0, 360);
  arrival.id = next;
}

/** Edit view: the picture that replaces a deleted one grows into place. */
export function zoomInArrival(el: HTMLElement, id: number) {
  if (arrival.id !== id) return;
  arrival.id = null;
  // The box turns about its top-left corner (for the zoom from the grid): keep this one centred.
  const dx = el.offsetWidth * 0.2;
  const dy = el.offsetHeight * 0.2;
  el.animate(
    [
      { opacity: 0, transform: `translate(${dx}px, ${dy}px) scale(0.6)` },
      { opacity: 1, transform: "none" },
    ],
    { duration: 280, easing: SPRING, delay: 140, fill: "backwards" },
  );
}
