# AGENTS.md

Guidance for coding agents (Claude Code, Codex, Cursor, Gemini CLI…) working on Picaluma.

## Project Overview

Picaluma is an open-source desktop photo organizer and editor that recreates the
workflow, layout, transitions and speed of Picasa 3. It is a Tauri 2 app: a Rust
core (scanning, indexing, thumbnails, search) and a React + TypeScript UI.

It is a clean-room reimplementation. Behaviour and layout are matched by observing
Picasa 3; no Picasa code, binaries, icons or artwork are used. Never add Google or
Picasa trademarks, logos or assets. `docs/PICASA_SPEC.md` is the behaviour reference.

## Project Structure

```
picaluma/
├── src-tauri/                 # Rust core + Tauri shell
│   ├── src/lib.rs             # App setup, state, URI schemes, command registry
│   ├── src/db.rs              # SQLite schema (WAL + FTS5), aggregates, reindexing
│   ├── src/scanner.rs         # Watched-folder walker, EXIF extraction (rayon)
│   ├── src/thumbs.rs          # thumb:// and photo:// schemes, DCT-scaled JPEG thumbs
│   ├── src/commands.rs        # #[tauri::command] API used by the UI
│   ├── capabilities/          # Tauri permissions
│   └── tauri.conf.json
├── src/                       # React UI
│   ├── store.ts               # Zustand store + memoised selectors
│   ├── api.ts                 # Typed wrappers for Tauri commands, scheme URLs
│   ├── effects.ts             # Non-destructive edit stack → CSS filters / canvas
│   └── components/            # MenuBar, LibraryGrid, LeftPanel, EditView, …
├── docs/PICASA_SPEC.md        # Screen-by-screen reference captured from Picasa 3
└── .github/workflows/         # Windows release build
```

## Commands

- `npm install` — frontend deps
- `npx tauri dev` — run the app with hot reload
- `npx tauri build` — release installer (NSIS + MSI) in `src-tauri/target/release/bundle`
- `npx tsc --noEmit` — type-check UI
- `cargo clippy --manifest-path src-tauri/Cargo.toml` — lint Rust

## Performance Rules (the point of the project)

- The library grid and folder tree are virtualised. Never render all photos.
- Search is SQLite FTS5 prefix search, executed on every keystroke. Keep it < 50 ms
  on 100k photos; never move it to the UI thread or add debouncing that's noticeable.
- Thumbnails are served over the `thumb://` scheme and cached on disk. JPEGs use DCT
  scaling (`jpeg-decoder` `scale`) — do not replace with full decodes.
- Never hold the DB mutex while doing file I/O or image decoding.
- The editor opens instantly with the cached thumbnail, then fades in the full image.

## Data Rules

- Originals are only changed by File › Save, which first keeps them in the folder's
  `.picalumaoriginals` (Undo Save restores them). Edits are a JSON stack recorded in each
  folder's `.picaluma.ini` (`src-tauri/src/folderini.rs`) and mirrored in `photos.edits`.
- Timestamps are stored as naive-local epoch seconds; the UI formats them as UTC.
- Schema changes must stay backward compatible (`CREATE … IF NOT EXISTS`, additive
  `ALTER TABLE`), because users keep their library database across upgrades.

## Code Style

- Rust: `log` macros only (no `println!` outside tests); return `Result<_, String>`
  from commands; keep modules focused.
- TypeScript: strict mode, two-space indent, functional React components, Zustand for
  shared state, `useStore(selector)` to avoid re-renders.
- Match Picasa's look: palette tokens live in `src/styles.css` `:root`.
- Features not yet implemented are shown disabled (greyed, "coming soon"), never hidden,
  so the UI keeps Picasa's familiar layout.
