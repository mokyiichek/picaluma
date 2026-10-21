# Picasa 3 behaviour reference

Observed on Picasa 3.9 (Windows, 1920×1080, library of ~4,700 folders) on 2026-10-14.
This is a description of *behaviour and layout* for clean-room reimplementation —
no code, assets or artwork were taken. Status column: ✅ in Picaluma, 🟡 partial, ⬜ planned.

## 1. Window layout (Library view)

Top to bottom:

| Region            | Height | Contents                                                                                     | Status |
|-------------------|--------|----------------------------------------------------------------------------------------------|--------|
| Menu bar          | 22     | File · Edit · View · Folder · Picture · Create · Tools · Help; account link at right          | ✅      |
| Toolbar           | 38     | Import · flat/tree view toggle · ▾ · people icon · **Filters** (☆, uploaded, faces, movies, geotag) + date-range slider · search box · busy spinner | 🟡 (flat/tree, ▾ sort, ☆, faces, movies, geotag and date slider ✅; uploaded dropped — Google Web Albums) |
| Main              | flex   | Left tree (≈505 px, resizable) · splitter · thumbnail grid · Properties panel (≈278 px, toggle) | ✅ |
| Status bar        | 17     | Blue `#568FB7`, white bold 11 px, centered: `252 pictures   Apr 12, 2013 to Aug 4, 2026   92.7MB on disk` | ✅ |
| Tray              | 88     | Selection holding area · hold/clear/add-to-album buttons · ☆ ⟲ ⟳ · green **Share** · Email · Print · Export · thumbnail-size slider · People/Places/Tags/Info toggles | ✅ Email/Print/Export (Hold ✅; Share and Places dropped — Google+ and Google Maps) |

### Palette (sampled)

| Token            | Hex       |
|------------------|-----------|
| Toolbar          | `#E8E8E8` |
| Tree / panels    | `#F3F3F3` |
| Section header   | `#E5E6E8` |
| Grid background  | `#F2F2F2` |
| Folder header    | `#F8F8F8` |
| Tree selection   | dark blue, white text |
| Status bar       | `#568FB7` |
| Properties header| `#B1B6BC` |
| Share button     | `#3B8F00` |
| Edit canvas      | `#808080` |
| Divider          | `#C8C8C8` |

## 2. Left tree

- Collapsible sections: **Albums (n)**, **People (n)**, **Projects (n)**, **Folders (n)**. Each header
  toggles its own section open/closed independently; a collapsed Folders header shows the current
  folder name in grey. ✅ (Projects ⬜)
- Folders sorted newest-first and grouped under headings `Updated <Month Year>` (by the
  folder's most recent file modification). ✅
- Row: folder icon · `Name (count)`. Selected row: dark-blue fill, white text. ✅
- Scrolling the grid moves the tree highlight to the folder at the top of the grid. ✅
- Albums include "Starred Photos", "Recently Updated", "Search results for 'x'" and user albums. ✅ (Recently Updated ✅ — files changed in the last 30 days)
- People rows: face crop · `<Unknown Person> (0)` · orange "?" badge. ✅ (Picaluma: "Unnamed (n)" first, then people A–Z; the "?" badge opens that person's suggestions)

## 3. Thumbnail grid

- One continuous scrolling page of *all* folders (not one folder at a time). ✅
- Folder header: large folder icon, serif title (Georgia-like ~19 px), date (serif ~12 px),
  action buttons [▶ Play] [Collage] [Movie] [☆] [💾] [Share ▾], editable "Add a description",
  "Sync to Web" toggle at right. 🟡 (Share/Sync omitted)
- Thumbnails: aspect-preserved, drop shadow, generous gaps, centered in cells; red map-pin
  badge bottom-right for geotagged; star badge for starred. ✅
- Selection: light-blue cell with blue ring; Ctrl/Shift multi-select. ✅
- Thumbnail-size slider in tray resizes live. ✅

## 4. Search

- Search-as-you-type over the whole library; no Enter needed. ✅
- Results replace the grid; a **green banner** appears above it:
  `[Back to View All]  Displaying 13,023 pictures in 155 albums (0.697 seconds) 11.3GB` ✅
- The tree shrinks to only matching folders. ✅
- A suggestion dropdown under the box lists matching tags/labels with counts
  (`household (3)`, `house (3)`). ⬜
- Measured: "h" → 74,009 pictures in 1,427 albums (0.756 s); "house" → 13,023 in 155 (0.697 s).
- Esc or the red ⊗ clears the search. ✅

## 5. Transitions

- Thumbnail → Edit view: on this hardware Picasa switches in ~100 ms (single paint).
  Picaluma uses a 230 ms zoom from the thumbnail rect to the fitted photo (FLIP), showing
  the cached thumbnail immediately and cross-fading in the full image. ✅
- Edit → Library ("Back to Library" / Esc / double-click photo): reverse zoom into the grid
  thumbnail, grid scroll position preserved. ✅
- Search banner slides in; Properties panel slides in. ✅
- Slideshow: cross-fade between photos, controls appear on mouse move. ✅

## 6. Edit view

Toolbar: `[← Back to Library]` · `[▶ Play]` · ◀ filmstrip (≈7 thumbs, current outlined) ▶ ·
compare modes `[A] [AB] [AA]` (A and AB ✅; AA ⬜). Status bar: `Folder > file.jpg  date  WxH pixels  size  (10 of 252)` ✅

Left panel (≈282 px), five tabs (icons: wrench, sun, brush, green brush, blue brush): ✅

1. **Basic fixes** — Crop, Straighten, Redeye, I'm Feeling Lucky, Auto Contrast, Auto Color,
   Retouch, Text; Fill Light slider; Undo / Redo. (Crop/Straighten/Redeye/Retouch/Text ⬜)
2. **Tuning** — Fill Light, Highlights, Shadows (with magic-wand auto), Color Temperature,
   Neutral Color Picker. ✅
3. **Effects 1** — Sharpen, Sepia, B&W, Warmify, Film Grain, Tint, Saturation, Soft Focus,
   Glow, Filtered B&W, Focal B&W, Graduated Tint.
4. **Effects 2** — Infrared Film, Lomo-ish, Holga-ish, HDR-ish, Cinemascope, Orton-ish,
   1960's, Invert Colors, Heat Map, Cross Process, Posterize, Duo-Tone.
5. **Effects 3** — Boost, Soften, Vignette, Pixelate, Focal Zoom, Pencil Sketch, Neon,
   Comic Book, Border, Drop Shadow, Museum Matte, Polaroid. (Pixelate/Focal Zoom ⬜)

Effect tiles show a live preview of the *current photo* with that effect; a blue counter
badge shows how many times it is applied. Undo button names the last edit ("Undo B&W"). ✅

Bottom of panel: **Histogram & Camera Information** (RGB histogram, camera, focal length,
35 mm equivalent, shutter, aperture, ISO). ✅
Below the photo: "Make a caption!" bar. ✅

## 7. Properties panel

Header "Properties" with close ⊗. Title `Properties of IMG_9368.JPG:` then label/value rows:
Location, File Size, Dimensions, Camera Make, Camera Model, Camera Date, Digitized Date,
Modified Date, File Date, Orientation, Flash, Focal Length, Focal Length in 35mm Film,
Exposure Time, Aperture, F Number, ISO, White Balance, Metering Mode, Exposure Program,
Color Space, Thumbnail. ✅ (embedded thumbnail preview ⬜)

## 8. Menus (with shortcuts)

- **File**: New Album… Ctrl+N · Add Folder to Picasa… · Add File… Ctrl+O · Import From… Ctrl+M ·
  Import from Web Albums… · Open File(s) in an Editor Ctrl+Shift+O · Move to New Folder… ·
  Rename… F2 · Save Ctrl+S · Revert · Save As… · Save a Copy · Export Picture to Folder…
  Ctrl+Shift+S · Locate on Disk Ctrl+Enter · Delete from Disk Del · Print… Ctrl+P ·
  E-Mail… Ctrl+E · Order Prints… · Exit
- **Edit**: Cut/Copy/Paste · Copy All Effects · Paste All Effects · Copy Text · Paste Text ·
  Select All Ctrl+A · Select Starred · Invert Selection Ctrl+I · Clear Selection Ctrl+D
- **View**: Library View · Small Thumbnails Ctrl+1 · Normal Thumbnails Ctrl+2 · Edit View Ctrl+3 ·
  Properties · Tags Ctrl+T · People · Places · Show Edit Controls · Slideshow Ctrl+4 ·
  Timeline Ctrl+5 · Search Options · Small Pictures · Hidden Pictures · Use Color Management ·
  Display Mode ▸ · Thumbnail Caption ▸ · Folder View ▸
- **Folder**: Edit Description… · View Slideshow Ctrl+4 · Refresh Thumbnails · Sort By ▸ · Hide ·
  Unhide · Print Contact Sheet… Ctrl+Shift+P · Export as HTML Page… · Locate on Disk Ctrl+Enter ·
  Remove from Picasa… · Move… · Delete…
- **Picture**: View and Edit Ctrl+3 · Batch Edit ▸ · Undo All Edits · Hide · Unhide · Reset Faces ·
  Properties Alt+Enter
- **Create**: Set as Desktop… · Make a Poster… · Picture Collage… · Add to Screensaver… ·
  Create a Gift CD… · Movie ▸ · Publish to Blogger… · Export to TiVo DVR…
- **Tools**: Folder Manager… · Upload Manager… · People Manager… · Configure Photo Viewer… ·
  Configure Screensaver… · Back Up Pictures… · Batch Upload… · Adjust Date and Time… ·
  Download Name Tags… · Upload ▸ · Geotag ▸ · Experimental ▸ · Configure Buttons… · Options…

Picaluma keeps the same menu structure without Picasa's Google services (Import from Web
Albums, Order Prints, Publish to Blogger, Upload/Batch Upload, Download Name Tags, Gift CD, TiVo).
Implemented: every File entry (Save writes a *copy*, originals are never changed), Copy Picture,
Copy/Paste All Effects, Flat/Tree Folder View, Batch Edit ▸, Print Contact Sheet, Export as
HTML Page, Set as Desktop, Make a Poster, Picture Collage, Help › Keyboard Shortcuts / Check for
Updates. Still disabled: Movie, Timeline, Places. Hide/Unhide ✅. People Manager ✅ (Unnamed groups with "Add a name", Suggestions with ✔/✖).

## 9. Controls, cursors and selection

- **Library scrollbar is a jog shuttle**: buttons at the top (⤒ jump to top, ▲ up) and bottom
  (▼ down, ⤓ jump to bottom); the grip in the middle carries ▲/▼ arrows, rests at the centre,
  scrolls continuously while dragged (speed grows with distance) and springs back. ✅
- Panel scrollbars (tree, properties): light-grey track, white gradient thumb, blue ▲/▼ arrows. ✅
- Thumbnail-size slider: grooved rounded track, pill-shaped grip with a vertical line. ✅
- Square 28×26 gradient buttons in folder headers; wide "Share ▾" split button. ✅
- **Selection**: a 2 px bright-blue (`#1A8CFF`) frame hugging the photo, no cell fill. ✅
- No hover highlight or tooltip on thumbnails. ✅
- **Cursors** (probed with GetCursorInfo): hand over thumbnails and clickable buttons
  (Play, Share, Import); I-beam in search and description fields; ↔ on the tree/grid splitter;
  arrow on tree rows, section headers, menus, sliders, status bar and empty grid. ✅

## 10. Context menus

**Photo** (right-click thumbnail): **View and Edit** Enter · Add to Album ▸ · Rotate Clockwise
Ctrl+R · Rotate Counterclockwise Ctrl+Shift+R · Undo all Edits · Hide · Move to New Folder… ·
Split Folder Here… · Open File Ctrl+Shift+O · Open With ▸ · Save Ctrl+S · Revert · Locate on Disk
Ctrl+Enter · Delete from Disk Ctrl+Delete · Copy Full Path · Upload… · Block from Uploading ·
Reset Faces · Properties Alt+Enter. ✅ Move/Copy to Folder, Move to New Folder, Delete from Disk (Recycle Bin) ✅; Picaluma adds Add/Remove Star and Tags…

**Folder** (right-click tree row or folder header): Edit Folder Description… · Select All
Pictures Ctrl+A · Clear Selection Ctrl+D · Invert Selection Ctrl+I · Move to Collection ▸ ·
Refresh Thumbnails · Sort Folder By ▸ · Hide Folder · Locate on Disk Ctrl+Enter · Remove from
Picasa… · Move Folder… · Delete Folder… · Upload… · Export as HTML Page… · Add name tags. ✅ (Rename/Move/Delete Folder, HTML export, Print Contact Sheet ✅; sorting lives in the toolbar ▾; Hide ⬜)

## 11. Crop and Straighten

- **Crop** replaces the Basic Fixes panel with "Crop Photo": instructions, an aspect dropdown
  (Manual · Current ratio · 4×6 Small print · 5×7 Large print · 8.5×11 Letter paper · 8×10 ·
  Square CD Cover · 4:3 Standard screen · 16:10 Widescreen monitor · 16:9 HDTV · 5:3 Widescreen
  Photo Frame · Add Custom Aspect Ratio…), three suggested crops, Rotate · Preview · Reset ·
  Apply ✓ · Cancel ✕. The rest of the UI greys out while cropping. ✅ (Rotate and custom ratio ✅; Preview ⬜)
- **Straighten** overlays a dashed grid on the photo and shows a dark rounded bar below it with
  an angle slider, APPLY and CANCEL. ✅

## 12. Tags panel (Ctrl+T)

Replaces the Properties panel: "Type in a tag to add:" + green ➕, "Tags in IMG_xxxx.JPG:" list,
and **Quick Tags** — a grid of configurable one-click tag buttons ("?" when unset). ✅
Search suggestions show matching tags with counts, bold prefix (`house`hold (3)). ✅

## 13. Folder Manager / watched folders

Dialog: folder tree on the left; for the current folder Scan Once / Remove from Picasa /
Scan Always (+ Face Detection toggle); Watched Folders list; OK · Cancel · Help. 🟡

Picasa stores its scan list in `<AppLocalDataPath>\Google\Picasa2\db3\scanlist.txt`
(`AppLocalDataPath` from `HKCU\Software\Google\Picasa\Picasa2\Preferences`, default
`%LOCALAPPDATA%`). Lines prefixed `+` are "Scan Always" roots (often whole drives); plain
lines are excluded folders. Picaluma imports this file verbatim. ✅

## 14. Export, E-mail, Print and Create

- **Export to Folder** (tray Export, Ctrl+Shift+S): location + Browse, name of the new folder
  (defaults to the current folder's name), Image size (Use original size / Resize to *n*
  pixels slider), Image quality (Automatic · Normal · Maximum · Minimum · Custom %), Watermark
  (bottom-right text). Opens the exported folder when done. ✅
- **E-mail** (Ctrl+E): Picasa asked which mail service to use. Picaluma sends resized copies
  (640 / 1024 / 1600 / original) to the system mail program (Simple MAPI on Windows for Outlook,
  Thunderbird…; Mail on macOS; `xdg-email` on Linux) or saves them to a folder for web mail. ✅
- **Print** (Ctrl+P) replaces the window with a print screen: layouts Wallet · 3.5×5 · 4×6 ·
  5×7 · 8×10 · Full Page · Index Print (contact sheet, Ctrl+Shift+P); Shrink to Fit / Crop to
  Fit; borders; copies per picture; Letter or A4; live page previews; system print dialog. ✅
- **Make a Poster**: one picture enlarged across 2×2, 3×3 or 4×4 pages. ✅
- **Picture Collage**: Mosaic or Picture Grid, page format, background, spacing; saved to
  *Pictures/Picaluma/Collages* or set as the desktop. ✅ (Picasa's Picture Pile, Frame Mosaic
  and Contact Sheet collage styles ⬜)
- **Set as Desktop** (Windows, macOS, GNOME/KDE). ✅

## People (name tags)

Picasa found faces in the background, grouped similar unnamed faces, and let you name a group in
one go; named faces became person albums in the People section, and faces that looked like a named
person were offered as suggestions ("Is this …?" ✔ ✖). The tray's People button showed who is in
the selected picture (with "Add a name" and "Add a person manually"); Tools › People Manager listed
the unnamed groups; Picture › Reset Faces looked again; names were searchable; Options › Name Tags
turned face recognition on or off. Name tags were saved in each folder's `.picasa.ini`
(`faces=rect64(…),contact` plus a `[Contacts2]` section). ✅ All of these, with Picasa's name tags
imported. Picaluma's detection (YuNet) and recognition (SFace) run on the computer; nothing is
uploaded. Not copied: contact sync with Google, web album face sync, movies from faces.

