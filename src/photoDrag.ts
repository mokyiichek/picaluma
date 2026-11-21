/**
 * Click-hold-drag pictures from the library onto a folder (moves the files) or an album (adds
 * them), as in Picasa. Mouse events rather than HTML drag and drop, which the window's own
 * file-drop handling swallows on Windows. Esc cancels a drag.
 */
import { thumbUrl } from "./api";
import { useStore } from "./store";
import { dropOnFolder } from "./actions";
import { isMac } from "./platform";

const THRESHOLD = 5;

/** Called on mousedown over a thumbnail. `deferred` runs on mouseup if no drag happened. */
export function startPhotoDrag(e: React.MouseEvent, id: number, deferred?: () => void) {
  const x0 = e.clientX;
  const y0 = e.clientY;
  let ghost: HTMLDivElement | null = null;
  let target: HTMLElement | null = null;
  let ids: number[] = [];
  // Ctrl (Option on a Mac) held: copy instead of move, shown by a "+" on the dragged pictures.
  let copy = false;
  const copyKey = (ev: MouseEvent | KeyboardEvent) => (isMac ? ev.altKey : ev.ctrlKey);
  const setCopy = (on: boolean) => {
    copy = on;
    ghost?.classList.toggle("copy", on);
    document.body.classList.toggle("copy-drag", !!ghost && on);
  };

  const setTarget = (el: HTMLElement | null) => {
    if (el === target) return;
    target?.classList.remove("drop-target");
    target = el;
    target?.classList.add("drop-target");
  };

  const move = (ev: MouseEvent) => {
    if (!ghost) {
      if (Math.abs(ev.clientX - x0) < THRESHOLD && Math.abs(ev.clientY - y0) < THRESHOLD) return;
      const sel = useStore.getState().selected;
      ids = sel.has(id) ? [...sel] : [id];
      ghost = document.createElement("div");
      ghost.className = "drag-ghost";
      const img = document.createElement("img");
      img.src = thumbUrl(id);
      ghost.appendChild(img);
      if (ids.length > 1) {
        const n = document.createElement("span");
        n.textContent = String(ids.length);
        ghost.appendChild(n);
      }
      const plus = document.createElement("b");
      plus.textContent = "+";
      ghost.appendChild(plus);
      document.body.appendChild(ghost);
      document.body.classList.add("dragging-photos");
    }
    setCopy(copyKey(ev));
    ghost.style.transform = `translate(${ev.clientX + 12}px, ${ev.clientY + 12}px)`;
    const under = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null;
    setTarget(under?.closest<HTMLElement>("[data-drop-folder], [data-drop-album]") ?? null);
    // Near the top or bottom of the folder list: scroll it, to reach folders out of view.
    const list = under?.closest<HTMLElement>(".section-body");
    if (list) {
      const r = list.getBoundingClientRect();
      if (ev.clientY < r.top + 28) list.scrollTop -= 14;
      else if (ev.clientY > r.bottom - 28) list.scrollTop += 14;
    }
  };

  const finish = (drop: boolean) => {
    window.removeEventListener("mousemove", move);
    window.removeEventListener("mouseup", up);
    window.removeEventListener("keydown", key, true);
    window.removeEventListener("keyup", key, true);
    const wasDrag = !!ghost;
    ghost?.remove();
    document.body.classList.remove("dragging-photos", "copy-drag");
    const el = target;
    setTarget(null);
    if (!wasDrag) return deferred?.();
    if (!drop || !el) return;
    const folder = el.dataset.dropFolder;
    const album = el.dataset.dropAlbum;
    if (folder) dropOnFolder(ids, Number(folder), copy);
    else if (album) useStore.getState().addToAlbum(Number(album), ids);
  };
  const up = (ev: MouseEvent) => {
    setCopy(copyKey(ev));
    finish(true);
  };
  const key = (ev: KeyboardEvent) => {
    if (!ghost) return;
    if (ev.key === "Control" || ev.key === "Alt") {
      setCopy(copyKey(ev));
      ev.preventDefault();
    } else if (ev.type === "keydown" && ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      finish(false);
    }
  };
  window.addEventListener("mousemove", move);
  window.addEventListener("mouseup", up);
  window.addEventListener("keydown", key, true);
  window.addEventListener("keyup", key, true);
}
