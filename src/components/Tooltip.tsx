import { useEffect, useRef, useState } from "react";

// Hover tooltips for every button and control with a title, drawn by the app (a pale box with
// a bold heading and a short description) instead of the system's plain tooltip. A title with a
// line break shows its first line as the heading. Special effects off only drops its fade.

const DELAY = 550; // first tooltip
const QUICK = 60; // moving on to the next control while one is showing
const GRACE = 400; // how long "showing" lasts after one hides

interface Tip {
  text: string;
  x: number;
  y: number;
}

/** The control's tooltip text: its title (moved to data-tip so the system's doesn't show too). */
function tipOf(el: Element): string | null {
  const t = el.getAttribute("title");
  if (t != null) {
    el.removeAttribute("title");
    if (t) el.setAttribute("data-tip", t);
    else el.removeAttribute("data-tip");
    return t || null;
  }
  return el.getAttribute("data-tip");
}

export default function Tooltip() {
  const [tip, setTip] = useState<Tip | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => {
    let target: Element | null = null;
    let timer = 0;
    let lastHidden = 0;
    let shown = false;
    let mouse = { x: 0, y: 0 };
    const hide = () => {
      window.clearTimeout(timer);
      if (shown) lastHidden = performance.now();
      shown = false;
      target = null;
      setTip(null);
    };
    const over = (e: MouseEvent) => {
      mouse = { x: e.clientX, y: e.clientY };
      const el = (e.target as Element | null)?.closest?.("[title], [data-tip]") ?? null;
      if (el === target) return;
      const wasShown = shown || performance.now() - lastHidden < GRACE;
      hide();
      if (!el) return;
      const text = tipOf(el);
      if (!text) return;
      target = el;
      timer = window.setTimeout(
        () => {
          if (target !== el || !el.isConnected) return;
          shown = true;
          setTip({ text: el.getAttribute("data-tip") ?? text, x: mouse.x, y: mouse.y });
        },
        wasShown ? QUICK : DELAY,
      );
    };
    const move = (e: MouseEvent) => {
      if (!shown) mouse = { x: e.clientX, y: e.clientY };
    };
    const leaveWindow = (e: MouseEvent) => {
      if (!e.relatedTarget) hide();
    };
    // Pointer events reach disabled buttons too ("coming soon"); mouse events may not.
    window.addEventListener("pointerover", over, true);
    window.addEventListener("mouseover", over, true);
    window.addEventListener("pointermove", move, true);
    window.addEventListener("mouseout", leaveWindow, true);
    window.addEventListener("mousedown", hide, true);
    window.addEventListener("wheel", hide, true);
    window.addEventListener("keydown", hide, true);
    window.addEventListener("blur", hide);
    return () => {
      hide();
      window.removeEventListener("pointerover", over, true);
      window.removeEventListener("mouseover", over, true);
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("mouseout", leaveWindow, true);
      window.removeEventListener("mousedown", hide, true);
      window.removeEventListener("wheel", hide, true);
      window.removeEventListener("keydown", hide, true);
      window.removeEventListener("blur", hide);
    };
  }, []);

  // Below and right of the pointer, kept inside the window (above the pointer near the bottom).
  useEffect(() => {
    const el = box.current;
    if (!tip || !el) return setPos(null);
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let left = tip.x + 2;
    let top = tip.y + 22;
    if (left + w > window.innerWidth - 4) left = Math.max(4, window.innerWidth - 4 - w);
    if (top + h > window.innerHeight - 4) top = Math.max(4, tip.y - h - 8);
    setPos({ left, top });
  }, [tip]);

  if (!tip) return null;
  const [head, ...rest] = tip.text.split("\n");
  const body = rest.join("\n").trim();
  return (
    <div
      ref={box}
      className={`app-tip${pos ? " in" : ""}`}
      role="tooltip"
      style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999 }}
    >
      {body ? (
        <>
          <b>{head}</b>
          <span>{body}</span>
        </>
      ) : (
        <span>{head}</span>
      )}
    </div>
  );
}
