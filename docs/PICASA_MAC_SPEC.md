# Picasa for Mac — behaviour reference

Picasa shipped on Windows (2004), Linux (2006, Wine-based, discontinued 2012) and macOS
(beta January 2009, discontinued 2016; last Mac build 3.9.137.163, Intel-only, OS X 10.4+).
It cannot run on Apple Silicon or current macOS, so this reference was assembled from:

1. **The user's own copy of the Picasa 3.9 Mac installer** (`picasamac39.dmg`). Only the
   English **UI string tables** were read (menu titles, labels, messages) to learn the
   wording and structure of the interface. No program code was decompiled or copied, and no
   images, icons or other assets were taken (see `.claude/rules/clean-room.md`).
2. **Contemporary reviews**: [Macworld](https://www.macworld.com/article/194247/picasa_mac.html),
   [TechCrunch](https://techcrunch.com/2009/01/05/picasa-finally-hits-the-mac-squares-off-with-iphoto/),
   [MJ Tsai](https://mjtsai.com/blog/2009/01/05/picasa-for-mac/),
   [The Next Web](https://thenextweb.com/news/picasa-releases-a-mac-client-whats-your-verdict),
   [Neil Turner](https://neilturner.me.uk/?p=15979).

## Overall

The Mac version was a port of the Windows interface — same layout (folder tree, thumbnail
grid, tray, Edit view tabs), same effects. Reviewers called it near-identical to Windows and
"not Mac-like". The string tables confirm one shared set of labels with a small number of
`…Mac` / `…Win` variants. Picaluma follows the Windows design everywhere and applies the Mac
variants below on macOS. ✅ = implemented in Picaluma, ⬜ = planned.

## Mac-specific wording

| Windows Picasa | Picasa for Mac | Picaluma on macOS |
|----------------|----------------|-------------------|
| Locate on Disk | **Show in Finder** (and "Show Original in Finder") | ✅ |
| Properties (Alt+Enter) | **Get Info** | ✅ (⌘I) |
| Tools › Options | **Preferences…** | ✅ (⌘,) |
| File › Exit | **Close Window** (Quit in the app menu) | ✅ |
| My Documents / My Pictures / My Computer | **Documents / Pictures / On My Mac** | ✅ (Folder Manager) |
| Delete folder → Recycle Bin | "move the folder … to the **Bin**" (Trash) | ✅ (Trash) |
| First scan: "Only search My Documents, My Pictures and the Desktop" | "**Only search Documents, Pictures, the Desktop and iPhoto Library**" | ✅ "Watch my Pictures folder" |
| Ctrl shortcuts | ⌘ shortcuts | ✅ |
| Movies saved as WMV/AVI | Movies saved as **QuickTime** | ✅ MP4 (plays in QuickTime) |
| Music for movies: MP3/WMA | **MP3, M4A** | ✅ (also AAC, WAV, OGG, FLAC) |
| — | **File › Import from iPhoto…** — reads the iPhoto/Aperture library *in place* (read-only; editing a photo copies it out to `Picasa/Imported from iPhoto/`) | ⬜ modern equivalent: Photos library import |

Native Mac touches noted by reviewers: native scrollbars in the left panel (Windows used
custom ones), and an early beta had Import / Library tabs (single informal source).

## Folder views and sorting (both platforms)

From the View › Folder View menu and the toolbar dropdown:

- **Flat Folder View** — one list of folders, grouped by date (Picaluma's current view ✅).
- **Tree View** — the full disk hierarchy (Windows root: *My Computer*; Mac root: *On My Mac*,
  with *Documents* and *Pictures* shortcuts). ✅
- **Simplified Tree View** — the hierarchy limited to watched folders. ⬜
- **Sort by** Creation Date · Recent Changes · Size · Name, plus **Reverse sort**. ✅
- Folder › Sort By (photos inside a folder): Name · Date · Size · Reverse order. ✅

## Full menu structure (shared, with Mac variants)

- **File**: New Album… · Close Window *(Mac)* · Add Folder to Picasa… · Add File to Picasa… ·
  Import From… · Import from Picasa Web Albums… · Import from iPhoto… *(Mac)* · Open File(s)
  in an Editor · Move to New Folder… · Rename… · Save · Revert · Save As… · Save a Copy ·
  Export Picture to Folder… · Show in Finder *(Mac)* / Locate on Disk *(Win)* · Delete from
  Disk… · Print… · Email… · Order Prints… · Exit *(Win)*
- **Edit**: Undo · Redo · Cut · Copy · Paste · Copy All Effects · Paste All Effects · Copy Text ·
  Paste Text · Select All · Select Starred · Invert Selection · Clear Selection
- **View**: Library View · Edit View · Properties · Tags · People · Places · Show Edit Controls ·
  Slideshow · Timeline · Search Options · Small/Normal Thumbnails · Small Pictures · Hidden
  Pictures · Use Colour Management · Display Mode ▸ (Automatic, 24-bit, 16-bit, Remote
  Desktop, LCD Whitepoint, Projector, Mac Gamma 1.6, Linear Gamma 2.2, Sepia, B&W) ·
  Thumbnail Caption ▸ (None, Filename, Caption, Tags, Resolution) · Folder View ▸ (above)
- **Folder**: Edit Description… · View Slideshow · Refresh Thumbnails · Sort By ▸ · Hide ·
  Unhide · Print Contact Sheet… · Export as HTML Page… · Show in Finder *(Mac)* · Remove from
  Picasa… · Move… · Delete…
- **Picture**: View and Edit · Batch Edit ▸ (Rotate, Auto Contrast, Auto Colour, I'm Feeling
  Lucky, Sharpen, Sepia, B&W, Warmify, Film Grain, Auto Red Eye, Show/Hide Text) · Undo All
  Edits · Hide · Unhide · Reset Faces · Get Info *(Mac)* / Properties *(Win)*
- **Create**: Set as Desktop… · Make a Poster… · Picture Collage… · Add to Screensaver… ·
  Create a Gift CD… · Video ▸ (From Selection, From Faces in Selection, From People Albums) ·
  Publish to Blogger… · Export to TiVo DVR…
- **Tools**: Upload ▸ · Geotag ▸ · Experimental ▸ (Show Duplicate Files, Search for…, Save search
  results, Show tag as album, Passport photo, Choose database location, Write faces to XMP…) ·
  Folder Manager… · Upload Manager… · People Manager… · Configure Photo Viewer… · Configure
  Screensaver… · Back Up Pictures… · Batch Upload… · Adjust Date and Time… · Configure
  Buttons… · Options… / Preferences… *(Mac)*
- **Help**: Help Contents / Picasa Help *(Mac)* · Keyboard Shortcuts · Forums · Online ReadMe ·
  Release Notes · Privacy Policy · Terms · Uninstalling Picasa · Check for Updates · About Picasa

## Menu bar (decided 2026-10-23)

Picasa for Mac used the **system menu bar** (Picasa's own menus — File, Edit, View, Folder,
Picture, Create, Tools, Help — plus the standard app menu with About, Preferences… and Quit),
not a menu row inside the window. Picaluma does the same on macOS (`src/nativeMenu.ts`), built
from the same menu definitions as the in-window row on Windows and Linux. Picasa's own look —
toolbar, panels, buttons and dialogs — stays the same on every platform, as it did in Picasa.

