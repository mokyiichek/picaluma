# Changelog

## 0.7.12 — 2026-10-22

- **Timeline** (*View › Timeline*, Ctrl+5) — the library's folders in date order on a timeline,
  each shown as a fan of its pictures. ← / → or the mouse wheel to move, click the timeline to
  jump, Enter or *Play* for a slideshow of that folder (Esc comes back to the timeline),
  *Open Folder* to go to it.
- **Thumbnails show edits exactly** — pictures with auto fixes, tuning, Tint, Retouch and other
  pixel effects now show them in the library grid as they will export, instead of an
  approximation.

## 0.7.11 — 2026-10-22

- **Import** (toolbar *Import*, *File › Import From*, Ctrl+M) — pictures and movies from a
  camera, memory card or any folder, shown before copying. Pictures already in the library are
  marked and left out; the rest are copied (keeping their dates, never overwriting) into a new
  folder named after the date they were taken, and can be deleted from the card afterwards.
- **Places** (the tray's pin button, *View › Places*) — a map of where the pictures in the
  folder, or the whole library, were taken, from their GPS positions. Click a pin to select the
  picture. Map from OpenStreetMap (needs the internet); pictures never leave the computer.
- **Mac: Delete no longer freezes the app** — file and library work (delete, move, rename,
  export, People) now runs off the window's main thread, so moving pictures to the Trash can't
  lock up the window.
- **Slideshow options** (*Tools › Options › Slideshow*) — how long each picture shows, cross fade
  / pan and zoom / no transition, captions, and repeat.

## 0.7.10 — 2026-10-21

- **Real photo fixes** — the edits now work on the picture's pixels instead of fixed filters:
  - *I'm Feeling Lucky*, *Auto Contrast* and *Auto Color* measure each photo and stretch its
    levels (Auto Color also removes colour casts, like the orange of indoor lighting).
  - *Fill Light*, *Highlights* and *Shadows* are proper tone curves; *Color Temperature* warms
    or cools; the new **Neutral Color Picker** (Tuning tab) removes a colour cast when you click
    something that should be grey or white.
  - *Sharpen* is a real unsharp mask.
- **Effect settings, as in Picasa** — Sharpen, Saturation, Soft Focus, Glow, Tint, Filtered B&W,
  Focal B&W, Graduated Tint and Vignette open a panel with their sliders and colour pickers,
  previewed live, then *Apply* or *Cancel*. Film Grain, Tint and the blends are now included in
  exports, prints and e-mails exactly as shown.
- **Before and after** — the A / AB buttons in Edit view show the edited picture, or the
  original and the edited one side by side.
- **Crop** — *Rotate* switches the crop between landscape and portrait, and *Custom...* takes any
  ratio.
- **Hold** — the tray's Hold button keeps pictures in the tray while you select more in other
  folders; Email, Print and Export act on all of them.
- **Hide / Unhide** (Picture menu, right-click) and *View › Hidden Pictures*.
- **Recently Updated** in Albums: pictures changed or added in the last 30 days.
- **People's face models are downloaded on request** — the installer is small again (4 MB
  instead of 41 MB). Picaluma asks before downloading the face recognition models (39 MB, once);
  "Not now" is remembered, and the People section and *Tools › Options › Name Tags* keep a
  Download button. Picasa name tags are still imported without them.
- The histogram shows the picture with all its edits.

## 0.7.9 — 2026-10-21

- **People** — Picasa's face features, done on your computer (nothing is uploaded):
  - Faces are found in the background after scanning (the folder you're looking at first), and
    faces that look alike are grouped.
  - **People Manager** (*Tools › People Manager*, Ctrl+Shift+M, or *Unnamed* in the People
    section): type a name under a group to name all its faces at once; click faces to leave them
    out, or *Ignore* faces you don't want to name.
  - **Suggestions** — once someone has a name, faces that look like them are offered as
    "Is this …?" with ✔ and ✖ (or Confirm all). An orange **?** next to a person shows
    suggestions waiting.
  - **Person albums** in the People section, with the person's face; right-click to rename,
    delete (removes only the name tags), review suggestions, print a contact sheet or export.
  - **People panel** (the person button in the tray): who is in the selected picture, with
    "Add a name", ✔/✖ for suggestions and *Remove name*. In Edit view the faces are outlined and
    named, and **Add a person manually** lets you draw a box around a face that was missed.
  - Type a person's name in the search box to find their pictures; the toolbar **Faces** filter
    shows only pictures with people.
  - **Picasa's name tags are imported** from each folder's `.picasa.ini` (once, automatically;
    again from *Tools › Options › Name Tags*).
  - *Picture › Reset Faces* looks again; *Tools › Options › Name Tags* turns face recognition off.
  - Measured on Picasa-tagged family photos: 90% of the faces Picasa's users had tagged were found,
    and different people were rarely suggested as each other (0.6%).
- **Build checks** — pull requests no longer fail when Apple's notarization service is
  unavailable, and builds no longer warn about outdated GitHub Actions.

## 0.7.8 — 2026-10-21

- **Filters like Picasa's** — the toolbar Filters now include **Movies** (show only movies) and
  Picasa's **date slider**: drag it to show only photos from the last 20 years down to the last
  week; double-click it to show everything again. The chosen range appears above the filters.
- **Taskbar icon on Windows** — the taskbar and Alt+Tab showed a blank window icon instead of
  Picaluma's; they now show the Picaluma icon.

## 0.7.7 — 2026-10-21

- **More photo formats** — HEIC/HEIF (iPhone), AVIF, camera RAW from Canon, Nikon, Sony,
  Fujifilm, Olympus, Panasonic, Pentax, Leica, DNG and more (shown from the camera's own
  preview), Photoshop and Targa, alongside JPEG, PNG, GIF, BMP, TIFF and WebP. HEIC, AVIF and
  movie thumbnails come from the computer's own codecs (Windows thumbnails, macOS ImageIO and
  Quick Look).
- **Movies** — MP4, MOV, AVI, MKV, WMV, MPEG, 3GP, AVCHD and WebM appear in their folders with a
  play badge. Double-click to play in the viewer (streamed, so long clips start at once); `/`
  plays or pauses, `,` and `.` jump 5 seconds. Codecs the viewer can't play open in your default
  player. Movies are skipped by slideshows, prints and effects, and exported or e-mailed as they
  are.
- **Tools › Options › File Types** — choose which kinds of files Picaluma looks for, as in
  Picasa. Unticked types leave the library; ticking them again brings them back.
- **Sort Folder By / Sort Album By** — right-click a folder to order its pictures by date taken,
  recent changes, size or name, as in Picasa. Albums can also keep the order pictures were added.
- **Zoom in Edit view** — ↑/↓ (as in Picasa), Page Up/Down, +/− or the mouse wheel; 1 shows
  actual size, 0 fits the window; drag to move around.
- **Shortcuts** — F11 full screen, F1 keyboard shortcuts, and on Mac Control-I inverts the
  selection and F3 renames.

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
