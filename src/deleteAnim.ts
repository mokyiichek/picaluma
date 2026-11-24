import { useStore } from "./store";

// Delete animations: the deleted pictures shrink away, the grid's other pictures glide into their
// new places, and in Edit view the next picture zooms in to take the deleted one's place.
// Off with Tools › Options › Special effects off.

const EASE = "cubic-bezier(0.2, 0.8, 0.2, 1)";
export const GHOST_MS = 200;

/** The grid listens: it turns its glide transition on for a moment. */
export const reflowBus = new EventTarget();

/** Set just before Edit view moves on from a deleted picture: that picture zooms in. */
export const arrival: { id: number | null } = { id: null };

const on = () => useStore.getState().effects;

/** Copies of the elements that shrink and fade where they were. */
function ghost(els: HTMLElement[]) {
  for (const el of els) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || r.bottom < 0 || r.top > window.innerHeight) continue;
    const g = el.cloneNode(true) as HTMLElement;
    g.removeAttribute("data-photo");
    if (el.tagName === "IMG") g.style.boxShadow = "1px 2px 4px rgba(0, 0, 0, 0.4)";
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
      transformOrigin: "50% 50%",
    });
    document.body.appendChild(g);
    const a = g.animate(
      [
        { opacity: 1, transform: "scale(1)" },
        { opacity: 0, transform: "scale(0.4)" },
      ],
      { duration: GHOST_MS, easing: EASE, fill: "forwards" },
    );
    a.onfinish = a.oncancel = () => g.remove();
  }
}

/** Where the grid's pictures and folder headings were before a delete. */
export type FlipStart = { gone: Set<number>; cells: Map<number, DOMRect>; heads: Map<string, DOMRect> };

const DROP_MS = 460;
const SPRING = "cubic-bezier(0.34, 1.45, 0.64, 1)";

/** A deleted thumbnail: lifts, tilts and drops away, with a little burst where it was. */
function dropAway(img: HTMLElement, i: number) {
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
    { duration: DROP_MS, delay, easing: "cubic-bezier(0.5, 0, 0.75, 0)", fill: "both" },
  );
  a.onfinish = a.oncancel = () => g.remove();
  burst(r.left + r.width / 2, r.top + r.height / 2, Math.max(r.width, r.height), delay + DROP_MS * 0.45);
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

/** Library: the deleted thumbnails drop away; the grid then ripples the rest into place. */
export function animateGridDelete(ids: number[]) {
  if (!on()) return;
  const canvas = document.querySelector(".grid-scroll .grid-canvas");
  if (!canvas) return;
  const gone = new Set(ids);
  const cells = new Map<number, DOMRect>();
  canvas.querySelectorAll<HTMLImageElement>("img[data-photo]").forEach((img) => {
    const id = Number(img.dataset.photo);
    if (!gone.has(id) && img.parentElement) cells.set(id, img.parentElement.getBoundingClientRect());
  });
  const heads = new Map<string, DOMRect>();
  canvas.querySelectorAll<HTMLElement>(".folder-head[data-folder]").forEach((h) => heads.set(h.dataset.folder!, h.getBoundingClientRect()));
  let i = 0;
  for (const id of ids.slice(0, 120)) {
    const img = canvas.querySelector<HTMLElement>(`img[data-photo="${id}"]`);
    if (img) dropAway(img, i++);
  }
  reflowBus.dispatchEvent(new CustomEvent<FlipStart>("reflow", { detail: { gone, cells, heads } }));
}

/**
 * After the delete has left the grid: every picture that moved slides from where it was, one
 * after another in reading order with a little bounce; pictures that came into view rise in.
 */
export function flipGrid(canvas: Element, start: FlipStart) {
  const vh = window.innerHeight;
  type Move = { el: HTMLElement; dx: number; dy: number; enter: boolean; top: number; left: number };
  const moves: Move[] = [];
  canvas.querySelectorAll<HTMLImageElement>("img[data-photo]").forEach((img) => {
    const cell = img.parentElement as HTMLElement | null;
    if (!cell) return;
    const a = cell.getBoundingClientRect();
    if (a.bottom < 0 || a.top > vh) return;
    const b = start.cells.get(Number(img.dataset.photo));
    if (!b) return moves.push({ el: cell, dx: 0, dy: a.height * 0.5, enter: true, top: a.top, left: a.left });
    const dx = b.left - a.left;
    const dy = b.top - a.top;
    if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) moves.push({ el: cell, dx, dy, enter: false, top: a.top, left: a.left });
  });
  moves.sort((p, q) => p.top - q.top || p.left - q.left);
  const base = DROP_MS * 0.35; // let the deleted picture start falling first
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
}

/** Edit view: the picture shrinks away; `next` (if any) zooms in next. */
export function animateEditorDelete(next: number | null) {
  if (!on()) return;
  const el = document.querySelector<HTMLElement>(".edit-stage .edit-photo:not(.before)");
  if (el) ghost([el]);
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
    { duration: 230, easing: EASE, delay: 60, fill: "backwards" },
  );
}
