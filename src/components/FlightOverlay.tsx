import { useLayoutEffect, useRef } from "react";
import { useStore } from "../store";

/** Leaving the editor: the photo shrinks back into its grid thumbnail. */
export default function FlightOverlay() {
  const flight = useStore((s) => s.flight);
  const view = useStore((s) => s.view);
  const endFlight = useStore((s) => s.endFlight);
  const ref = useRef<HTMLImageElement>(null);
  const active = flight != null && view === "library";

  useLayoutEffect(() => {
    if (!active || !flight) return;
    const el = ref.current!;
    let target: HTMLElement | null = null;
    let anim: Animation | null = null;
    // Two frames: let the grid scroll to the photo and render its row first.
    const raf = requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        target = document.querySelector(`.grid-scroll img[data-photo="${flight.photoId}"]`);
        const from = flight.from;
        const to = target?.getBoundingClientRect();
        const start = `translate(${from.x}px, ${from.y}px)`;
        if (to && to.width > 0) {
          target!.style.visibility = "hidden";
          anim = el.animate(
            [
              { transform: `${start} scale(1, 1)` },
              { transform: `translate(${to.left}px, ${to.top}px) scale(${to.width / from.w}, ${to.height / from.h})` },
            ],
            { duration: 210, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)", fill: "forwards" },
          );
        } else {
          anim = el.animate([{ transform: start, opacity: 1 }, { transform: start, opacity: 0 }], { duration: 160, fill: "forwards" });
        }
        anim.onfinish = anim.oncancel = () => {
          if (target) target.style.visibility = "";
          endFlight();
        };
      }),
    );
    return () => {
      cancelAnimationFrame(raf);
      anim?.cancel();
      if (target) target.style.visibility = "";
    };
  }, [flight?.nonce, active]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!active || !flight) return null;
  return (
    <img
      ref={ref}
      className="flight"
      src={flight.src}
      alt=""
      style={{
        width: flight.from.w,
        height: flight.from.h,
        transform: `translate(${flight.from.x}px, ${flight.from.y}px)`,
        filter: flight.filter || undefined,
        objectFit: "fill",
      }}
    />
  );
}
