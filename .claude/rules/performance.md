# Performance rules

- Measure, don't guess: search timings are shown in the green results banner; keep them under 0.05 s.
- Lists over ~200 items must be virtualised (`@tanstack/react-virtual`).
- Image work (decode, resize, EXIF) runs on rayon threads, never on the Tauri main thread.
- Batch DB writes in a transaction per folder during scans.
- Emit `library-changed` at most every 750 ms during scans; the UI coalesces reloads.
- Transitions are 160–230 ms with `cubic-bezier(0.2, 0.8, 0.2, 1)`; animate `transform`/`opacity` only.
