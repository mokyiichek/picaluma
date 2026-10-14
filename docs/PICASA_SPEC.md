# Picasa 3 behaviour reference

Observed on Picasa 3.9 (Windows, 1920×1080, library of ~4,700 folders) on 2026-10-14.
This is a description of *behaviour and layout* for clean-room reimplementation —
no code, assets or artwork were taken. Status column: ✅ in Picaluma, 🟡 partial, ⬜ planned.

## 1. Window layout (Library view)

Top to bottom:

| Region            | Height | Contents                                                                                     | Status |
|-------------------|--------|----------------------------------------------------------------------------------------------|--------|
| Menu bar          | 22     | File · Edit · View · Folder · Picture · Create · Tools · Help; account link at right          | ✅      |
| Toolbar           | 38     | Import · flat/tree view toggle · ▾ · people icon · **Filters** (☆, uploaded, faces, movies, geotag) + date-range slider · search box · busy spinner | 🟡 |
| Main              | flex   | Left tree (≈505 px, resizable) · splitter · thumbnail grid · Properties panel (≈278 px, toggle) | ✅ |
| Status bar        | 17     | Blue `#568FB7`, white bold 11 px, centered: `252 pictures   Apr 12, 2013 to Aug 4, 2026   92.7MB on disk` | ✅ |
| Tray              | 88     | Selection holding area · hold/clear/add-to-album buttons · ☆ ⟲ ⟳ · green **Share** · Email · Print · Export · thumbnail-size slider · People/Places/Tags/Info toggles | 🟡 |

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

- Accordion sections: **Albums (n)**, **People (n)**, **Folders (n)**. Opening one collapses
  the others to header bars; a collapsed Folders header shows the current folder name in grey. ✅
- Folders sorted newest-first and grouped under headings `Updated <Month Year>` (by the
  folder's most recent file modification). ✅
- Row: folder icon · `Name (count)`. Selected row: dark-blue fill, white text. ✅
- Scrolling the grid moves the tree highlight to the folder at the top of the grid. ✅
- Albums include "Starred Photos", "Recently Updated", "Search results for 'x'". 🟡
- People rows: face crop · `<Unknown Person> (0)` · orange "?" badge. ⬜

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
compare modes `[A] [AB] [AA]` (⬜). Status bar: `Folder > file.jpg  date  WxH pixels  size  (10 of 252)` ✅

Left panel (≈282 px), five tabs (icons: wrench, sun, brush, green brush, blue brush): ✅

1. **Basic fixes** — Crop, Straighten, Redeye, I'm Feeling Lucky, Auto Contrast, Auto Color,
   Retouch, Text; Fill Light slider; Undo / Redo. (Crop/Straighten/Redeye/Retouch/Text ⬜)
2. **Tuning** — Fill Light, Highlights, Shadows (with magic-wand auto), Color Temperature,
   Neutral Color Picker. (pickers ⬜)
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

Picaluma keeps the same menu structure; unimplemented entries are shown disabled.

## 9. Folder Manager / watched folders

Picasa stores its scan list in `<AppLocalDataPath>\Google\Picasa2\db3\scanlist.txt`
(`AppLocalDataPath` from `HKCU\Software\Google\Picasa\Picasa2\Preferences`, default
`%LOCALAPPDATA%`). Lines prefixed `+` are "Scan Always" roots (often whole drives); plain
lines are excluded folders. Picaluma imports this file verbatim. ✅
