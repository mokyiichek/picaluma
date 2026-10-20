# Changelog

## 0.7.6 — 2026-10-21

- **Steady while scanning** — clicking a folder mid-scan no longer makes the highlight jump to
  another folder. As folders above grow or move during a scan, the view stays on what you're
  looking at, and a glide to a clicked folder follows it to its new position.
- **Scanning priority** — the folder you open is listed and indexed straight away, ahead of the
  running scan, as in Picasa.

## 0.7.5 — 2026-10-20

- **Runs on older computers** — Picaluma now draws its window on the CPU by default instead of
  the graphics card. On a 3 GB graphics card with an older driver, a 700,000-photo library could
  exhaust graphics memory and crash Windows (VIDEO_TDR_FAILURE). Measured: graphics memory used
  by Picaluma fell from 56 MB with only six photos on screen (growing with every thumbnail) to
  0 MB. Recent graphics cards can turn it back on in *Tools › Options*. Thumbnails no longer get
  a graphics layer each.
- **32-bit Windows** installer, and the Mac version now runs on macOS 10.15 Catalina or later
  (Intel and Apple Silicon).
- **New effects** — Redeye (drag a box around each eye), Retouch (click blemishes), Text,
  Pixelate and Focal Zoom, included in export, print, e-mail and collages.

## 0.7.4 — 2026-10-20

- **Delete waits for your answer on Mac** — macOS deleted the picture before the confirmation
  could be answered, so Cancel did nothing. All confirmations, messages and name prompts are now
  Picaluma's own dialogs, which wait on every platform.
- **Delete like Picasa** — Delete Picture / Delete Pictures with "Don't ask again"; permanent
  delete is red and starts on Cancel; removing from an album asks too; when a delete empties a
  folder, Picaluma offers to delete the folder.
- **Live folder watching** — new, changed or removed photos in watched folders appear within
  about two seconds, like Picasa's "Scan Always". No polling.
- **Shortcuts** — Mac permanent delete also accepts ⇧⌫ and ⌥⌫ (besides ⌥⌘⌫); Ctrl+A selects
  the folder wherever the focus is; Ctrl+I inverts the selection (⇧⌘I on Mac, where ⌘I is Get
  Info); ⇧⌘Z redoes on Mac.

## 0.7.3 — 2026-10-19

- **Faster indexing on hard disks and NAS** — dates and camera details now come from the first
  256 KB of each file instead of the whole photo. On a 712,000-photo library the disk, not the
  CPU, was the limit (1% CPU, disk 100% busy). Thumbnails are made as you scroll and by the
  background warmer afterwards.
- **Thumbnail cache cleans itself** — thumbnails no picture uses any more (removed folders,
  changed files, the old cache layout) are deleted after each scan. One library had collected
  31 GB of them.
- **About Picaluma** — a proper window with the app icon, the website's description and
  clickable links.

## 0.7.2 — 2026-10-19

- **Much smaller library file** — the search index kept every replaced entry, so a library of
  11,000 photos had grown to 2 GB. It's now compacted after each scan: that library shrank to
  13 MB, and searches stay at ~2 ms.

## 0.7.1 — 2026-10-19

- **Cloud drives without the downloads** — online-only files in OneDrive, Synology Drive and
  Dropbox, and everything on a Google Drive streaming drive (Windows) or a macOS File Provider
  drive, are listed in seconds but never read in the background, so scanning no longer downloads
  your whole cloud library. Their thumbnails are fetched only when you scroll to them. A file
  you make available offline is indexed on the next scan.
- **Log file** — `picaluma.log` in the library folder (the previous run's is kept), with per-folder
  listing times, for diagnosing slow drives.

## 0.7.0 — 2026-10-19

- **E-mail** — resized copies with your edits, attached to a new message in your mail program
  (Outlook, Thunderbird… on Windows; Mail on macOS; your Linux mail app), or saved to a folder
  for Gmail and other web mail.
- **Export to Folder** — Picasa's dialog: new folder name, original size or resize, quality
  (Automatic / Normal / Maximum / Minimum / Custom), watermark. Unedited JPEGs are copied
  untouched, keeping their camera data.
- **Print** — a print screen with Wallet, 3.5×5, 4×6, 5×7, 8×10, Full Page and Index Print
  (contact sheet) layouts, Shrink or Crop to Fit, borders, copies, Letter/A4 and page previews.
- **Create** — Picture Collage (mosaic or grid), Make a Poster (2×2 to 4×4 pages), Set as
  Desktop, and Folder › Export as HTML Page.
- **Folder views** — Flat or Tree view, and sort by creation date, recent changes, size or name
  (toolbar ▾). Geotagged-photos filter.
- **Editing** — Rename (F2), Save a Copy (Ctrl+S), Copy Picture, Copy / Paste All Effects,
  Picture › Batch Edit.
- **Menus** — every Picasa menu entry that doesn't depend on a Google service now works;
  Google-only entries (Share, web album upload, uploaded filter, Places, Timeline) are gone.
  Help › Keyboard Shortcuts and Check for Updates.
- **New app icon** — simpler: eight tiles on a square grid.
- **macOS** — builds are signed with an Apple Developer ID. One-line Terminal install:
  `curl -fsSL https://ahmok.com/picaluma/install.sh | bash`. Apple notarization (no prompt at
  all) switches on automatically once the developer account's agreement is accepted.

## 0.6.2 — 2026-10-18

- **macOS** — the app is now signed (ad-hoc), so macOS no longer reports it as *damaged*;
  first launch needs one *Open Anyway* in System Settings › Privacy & Security. Build pipeline
  ready for Developer ID signing + Apple notarization (no prompt at all) once the Apple
  certificate is added. Minimum macOS 11.

- **Linux build** — AppImage and .deb (x86-64). Watching / or a whole disk skips /proc, /sys and
  other system trees.

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
