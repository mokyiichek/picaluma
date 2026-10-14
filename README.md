# Picaluma

**A fast, open-source photo organizer and editor in the spirit of Picasa 3.**

Picasa 3 was the best desktop photo manager ever made — instant search, every folder
on one scrolling page, one-click fixes, and edits that never touched your originals.
Google retired it in 2016. Picaluma rebuilds that experience with a modern, native,
cross-platform stack.

> Picaluma is an independent clean-room project. It is not affiliated with or endorsed
> by Google. "Picasa" is a trademark of Google LLC.

## Features (v0.1)

- **Watched folders** — point Picaluma at folders or whole drives; it indexes every
  picture (JPEG, PNG, GIF, BMP, WebP, TIFF) and keeps the index up to date. Can import
  your old Picasa folder list (`scanlist.txt`) in one click.
- **Picasa-style library** — every folder on one continuous, virtualised page, newest
  first, grouped under "Updated *Month Year*", with folder descriptions.
- **Instant search** — SQLite FTS5 prefix search over file names, folder names,
  descriptions, captions and camera. 8,478 matches out of 12,219 photos in **0.003 s**
  (Picasa 3 took 0.697 s for the same query on the same library).
- **Zoom transitions** — double-click a thumbnail and it flies into the editor; Esc
  flies it back to the grid.
- **Non-destructive editing** — I'm Feeling Lucky, Auto Contrast/Color, Fill Light,
  Highlights, Shadows, Color Temperature and 30+ effects (Sepia, B&W, Warmify, Lomo,
  HDR-ish, Cinemascope, Vignette, Polaroid …) with live previews, full undo/redo and
  a live histogram. Originals are never modified.
- **Stars, captions, rotation, slideshow, properties (EXIF) panel, export with edits.**

Planned: face grouping (local), albums, places/map, timeline, collage, crop/straighten/
red-eye/retouch, `.picasa.ini` import, tags, macOS and Linux builds.

## Install

Download the latest Windows installer from
[Releases](https://github.com/mokyiichek/picaluma/releases).

## Build from source

Requirements: [Rust](https://rustup.rs) (stable), Node.js 20+, and on Windows the
Visual Studio C++ build tools + WebView2 (preinstalled on Windows 10/11).

```bash
npm install
npx tauri dev      # run with hot reload
npx tauri build    # produce installers in src-tauri/target/release/bundle
```

## How it's built

| Layer       | Technology                                                      |
|-------------|-----------------------------------------------------------------|
| Shell       | [Tauri 2](https://tauri.app) (small native installer, WebView2) |
| Core        | Rust — rusqlite (WAL + FTS5), walkdir, rayon, kamadak-exif      |
| Thumbnails  | DCT-scaled JPEG decoding, disk cache, `thumb://` URI scheme     |
| UI          | React 18, TypeScript, Zustand, TanStack Virtual, Vite           |
| CI          | GitHub Actions → Windows NSIS/MSI installers on every tag       |

The project is developed with AI coding agents (Claude Code). Agent guidance lives in
[`AGENTS.md`](AGENTS.md), [`CLAUDE.md`](CLAUDE.md) and [`.claude/rules`](.claude/rules);
the behaviour reference is [`docs/PICASA_SPEC.md`](docs/PICASA_SPEC.md).

## License

Dual-licensed under [Apache-2.0](LICENSE-APACHE) or [MIT](LICENSE-MIT), at your option.
