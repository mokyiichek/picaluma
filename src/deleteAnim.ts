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

/** Library: the deleted thumbnails shrink away and the rest glide together. */
export function animateGridDelete(ids: number[]) {
  if (!on()) return;
  const imgs = ids
    .slice(0, 200)
    .map((id) => document.querySelector<HTMLElement>(`.grid-scroll img[data-photo="${id}"]`))
    .filter((e): e is HTMLElement => !!e);
  ghost(imgs);
  reflowBus.dispatchEvent(new Event("reflow"));
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
