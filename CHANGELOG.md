# Changelog

## 0.6.1 — 2026-10-17

- **Delete permanently** — Shift+Delete or Ctrl+Delete on Windows (as in Picasa), ⌥⌘⌫ on Mac
  (as in Finder), with a clear warning. Plain Delete still uses the Recycle Bin / Trash. Also
  in the right-click menu.
- **macOS**
  - HEIC/HEIF pictures (iPhone, Mac camera) are scanned, thumbnailed and shown, using macOS's
    own image converter.
  - ⌘ replaces Ctrl for every shortcut, and menus show Mac key symbols.
  - Watching your home folder or a whole disk skips system folders (~/Library, /System …) and
    app packages (Photos / Lightroom libraries, .app).
  - Delete to Trash without the extra Finder permission prompt.
  - Clear explanations on the macOS prompts for Desktop, Documents, Downloads, external and
    network drives.
  - Accented folder names (stored differently by macOS) and CJK names are found by search.
- **Watch my Pictures folder** — one-click button on first launch (Windows and Mac).
- TIFF pictures now open in the editor on Windows.
- Automated tests run on both Windows and a real Mac in CI.

## 0.6.0 — 2026-10-17

First public-ready release, for **Windows and macOS**.

- **macOS build** — universal .dmg for Apple Silicon and Intel.
- **File management** — Move to Folder, Copy to Folder, Move to New Folder and Delete from
  Disk on pictures; Rename, Move and Delete Folder on folders. Deletes go to the Recycle
  Bin / Trash. Moved pictures keep their stars, tags, captions, edits and albums.
- **Delete key** — deletes the selected pictures (asks first); inside an album it removes
  them from the album; in the editor it deletes the current picture and moves to the next.
- **Left panel** — Albums, People and Folders now open and close independently, like Picasa.
- **Folder highlight** — clicking a folder highlights it immediately and keeps it
  highlighted while the grid glides there.
- Windows installer is now the per-user setup.exe only (the per-machine MSI is retired).

## 0.5.0

- **Albums** — create from a selection, add/remove pictures, rename, delete; album view
  with "Back to Folders".

## 0.4.0

- Gliding folder-to-folder scrolling.
- *Tools › Options › Special effects* switch for all animations.

## 0.3.x

- Progressive two-phase scanning (pictures appear in seconds, details fill in after).
- Picasa-tuned smooth wheel scrolling; scanning progress panel.
- Library database self-repair; thumbnail cache keyed by file path.

## 0.2.0

- Crop and Straighten, Tags panel with Quick Tags, search suggestions, right-click menus,
  Picasa-style scrollbars and controls, faster thumbnails, new app icon.

## 0.1.0

- First version: watched folders, Picasa-style library, instant search, zoom transitions,
  non-destructive editing with 30+ effects, slideshow, export.
