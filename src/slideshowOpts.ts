/** Tools › Options › Slideshow (kept per computer, like the window layout). */
export interface SlideshowOpts {
  /** Seconds each picture stays on screen. */
  seconds: number;
  transition: "fade" | "zoom" | "none";
  /** Show each picture's caption at the bottom. */
  captions: boolean;
  /** Start again after the last picture. */
  loop: boolean;
  /** Play the pictures in random order. */
  shuffle: boolean;
}

const KEY = "picaluma.slideshow";
export const SLIDESHOW_DEFAULTS: SlideshowOpts = { seconds: 3.5, transition: "fade", captions: true, loop: false, shuffle: false };

export function loadSlideshowOpts(): SlideshowOpts {
  try {
    return { ...SLIDESHOW_DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
  } catch {
    return SLIDESHOW_DEFAULTS;
  }
}

export function saveSlideshowOpts(o: SlideshowOpts) {
  try {
    localStorage.setItem(KEY, JSON.stringify(o));
  } catch {
    /* private mode: keep the defaults */
  }
}
