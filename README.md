# Picaluma

**A fast, open-source photo organizer and editor in the spirit of Picasa 3 — for Windows, macOS and Linux.**

Picasa 3 was the best desktop photo manager ever made — instant search, every folder
on one scrolling page, one-click fixes, and edits that never touched your originals.
Google retired it in 2016. Picaluma rebuilds that experience with a modern, native,
cross-platform stack.

> Picaluma is an independent clean-room project. It is not affiliated with or endorsed
> by Google. "Picasa" is a trademark of Google LLC. Like Picasa — which had Windows, Mac (2009) and Linux
> (2006) versions — Picaluma runs on all three, natively.

## Download

Get the latest version from **[Releases](https://github.com/mokyiichek/picaluma/releases)**:

| Platform | File | Notes |
|----------|------|-------|
| **Windows 10/11** (64-bit) | `Picaluma_x.y.z_x64-setup.exe` | Installs for your user only — no admin rights needed. If SmartScreen says *"Windows protected your PC"*, click **More info → Run anyway** (the installer isn't code-signed yet). |
| **Linux** (x86-64) | `Picaluma_x.y.z_amd64.AppImage` or `.deb` | AppImage: `chmod +x` then run. Debian/Ubuntu: `sudo apt install ./Picaluma_x.y.z_amd64.deb`. |
| **macOS 11+** (Apple Silicon & Intel) | `Picaluma_x.y.z_universal.dmg` | Open the .dmg and drag Picaluma to **Applications**. If macOS says it can't verify Picaluma, open ** → System Settings → Privacy & Security** and click **Open Anyway** (once). If it says the app is *damaged*, run `xattr -cr /Applications/Picaluma.app` in Terminal. (Notarized builds that open without any prompt are coming.) |

On first launch, add the folders you want Picaluma to watch. On Windows it can also
import your old Picasa folder list in one click.

## Features

**Library**
- **Watched folders** — point Picaluma at folders or whole drives. Scanning is
  progressive: every picture appears within seconds (23,588 photos in 277 folders listed
  in 4.7 s from a network drive), then dates, camera data and thumbnails fill in from the
  background, newest folders first. A progress panel shows what's happening.
- **Picasa-style library** — every folder on one continuous page, newest first, grouped
  under "Updated *Month Year*", with folder descriptions. Smooth, Picasa-tuned wheel
  scrolling and gliding folder-to-folder jumps (toggle in *Tools › Options › Special effects*).
- **Instant search** — searches file names, folders, descriptions, captions, tags and
  camera as you type: 8,478 matches out of 12,219 photos in **0.003 s** (Picasa 3 took
  0.697 s on the same library). Tag suggestions appear under the search box.
- **Albums** — collect pictures from any folders into albums (right-click › Add to Album,
  Ctrl+N). Albums never move or copy your files.
- **Tags, stars and captions** — Tags panel (Ctrl+T) with one-click Quick Tags.
- **File management** — Move to Folder, Copy to Folder, Move to New Folder, Delete from
  Disk, Rename / Move / Delete Folder. Delete sends pictures to the Recycle Bin / Trash;
  Shift+Delete (⌥⌘⌫ on Mac) deletes permanently. Moved pictures keep their stars, tags,
  captions, edits and albums.
- **Mac-native** — HEIC photos, ⌘ shortcuts, skips system folders and app libraries when you
  watch your whole home folder or disk. (The Photos app library itself isn't scanned — point
  Picaluma at the folders where you keep your pictures.)

**Editing** — non-destructive; originals are never modified
- Crop (with print and screen aspect presets) and Straighten.
- I'm Feeling Lucky, Auto Contrast, Auto Color, Fill Light, Highlights, Shadows,
  Color Temperature.
- 30+ effects — Sepia, B&W, Warmify, Film Grain, Lomo-ish, HDR-ish, Cinemascope, Vignette,
  Border, Polaroid and more — with live previews, full undo/redo and a live histogram.
- Export with edits applied, fullscreen slideshow, EXIF Properties panel.

**Reliability**
- The library database checks itself on start and repairs itself if it was damaged.

Planned: People (local face grouping), Places map, timeline, collage, red-eye/retouch,
`.picasa.ini` import, Folder Manager redesign, flat/tree folder views.

## Build from source

Requirements: [Rust](https://rustup.rs) (stable) and Node.js 20+.
- **Windows:** Visual Studio C++ build tools; WebView2 is preinstalled on Windows 10/11.
- **macOS:** Xcode Command Line Tools (`xcode-select --install`).
- **Linux:** `libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev patchelf`.

```bash
npm install
npx tauri dev                       # run with hot reload
npx tauri build --bundles nsis      # Windows installer
npx tauri build --bundles app,dmg   # macOS app + dmg
cargo test --manifest-path src-tauri/Cargo.toml   # Rust tests
```

## How it's built

| Layer       | Technology                                                           |
|-------------|----------------------------------------------------------------------|
| Shell       | [Tauri 2](https://tauri.app) — small native app (WebView2 / WKWebView) |
| Core        | Rust — rusqlite (WAL + FTS5), walkdir, rayon, kamadak-exif, trash      |
| Thumbnails  | DCT-scaled JPEG decoding, disk cache, `thumb://` URI scheme             |
| UI          | React 18, TypeScript, Zustand, TanStack Virtual, Vite                  |
| CI          | GitHub Actions → Windows setup.exe + macOS universal .dmg on every tag  |

The project is developed with AI coding agents (Claude Code). Agent guidance lives in
[`AGENTS.md`](AGENTS.md), [`CLAUDE.md`](CLAUDE.md) and [`.claude/rules`](.claude/rules);
the behaviour reference is [`docs/PICASA_SPEC.md`](docs/PICASA_SPEC.md). Release history
is in [`CHANGELOG.md`](CHANGELOG.md).

## License

Dual-licensed under [Apache-2.0](LICENSE-APACHE) or [MIT](LICENSE-MIT), at your option.
