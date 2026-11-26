// Quick Edit view animations: the picture slides out and the next one slides in (← / →, the arrows,
// the filmstrip, the wheel, a swipe), and a picture turns when it is rotated (also on Undo / Redo).
// Off with Tools › Options › Special effects off.
import { selectEditorSequence, useStore } from "./store";

const on = () => useStore.getState().effects;
const EASE = "cubic-bezier(0.2, 0.8, 0.2, 1)";
const SLIDE = 110;

/** The picture the editor is moving to, and from which side it comes in. */
const navArrival = { id: null as number | null, dir: 0 };

/** Move the editor to another picture; dir 1 = next (comes in from the right), -1 = previous. */
export function editorGo(next: number, dir?: number) {
  const s = useStore.getState();
  if (next === s.editId) return;
  if (dir == null) {
    const seq = selectEditorSequence(s);
    dir = s.editId != null ? Math.sign(seq.indexOf(next) - seq.indexOf(s.editId)) || 1 : 1;
  }
  const old = document.querySelector(".edit-photo:not(.before)") as HTMLElement | null;
  if (on() && old?.parentElement) {
    // The picture shown now leaves as a copy (the box itself is reused for the next one).
    const from = old.style.translate || "0px 0px";
    const ghost = old.cloneNode(true) as HTMLElement;
    ghost.style.pointerEvents = "none";
    old.style.translate = "";
    old.parentElement.appendChild(ghost);
    const a = ghost.animate(
      [
        { translate: from, opacity: 1 },
        { translate: `${-dir * SLIDE}px 0px`, opacity: 0 },
      ],
      { duration: 180, easing: "cubic-bezier(0.4, 0, 1, 1)", fill: "forwards" },
    );
    a.onfinish = a.oncancel = () => ghost.remove();
    navArrival.id = next;
    navArrival.dir = dir;
  } else if (old) old.style.translate = "";
  s.setEditId(next);
}

/** The editor's box shows a new picture: slide it in when editorGo sent it. */
export function slideInArrival(el: HTMLElement, id: number): boolean {
  if (navArrival.id !== id) return false;
  const dir = navArrival.dir;
  navArrival.id = null;
  el.animate(
    [
      { translate: `${dir * SLIDE}px 0px`, opacity: 0 },
      { translate: "0px 0px", opacity: 1 },
    ],
    { duration: 220, delay: 30, easing: EASE, fill: "backwards" },
  );
  return true;
}

/** The smallest turn from one rotation to another (−180…180). */
export function turnBetween(from: number, to: number): number {
  return ((((to - from) % 360) + 540) % 360) - 180;
}

/** The picture turns into its new rotation; scale makes it start at the size it had before. */
export function turnIn(el: HTMLElement, turn: number, scale = 1) {
  if (!on() || !turn) return;
  el.animate(
    [
      { rotate: `${-turn}deg`, scale: `${scale}`, transformOrigin: "50% 50%" },
      { rotate: "0deg", scale: "1", transformOrigin: "50% 50%" },
    ],
    { duration: 230, easing: EASE },
  );
}
