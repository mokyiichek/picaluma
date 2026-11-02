import { openUrl } from "@tauri-apps/plugin-opener";
import { fmtShortcut, isMac } from "../platform";
import { useStore } from "../store";

import { ISSUES_URL, SITE_URL } from "./AboutDialog";

const GROUPS: [string, [string, string][]][] = [
  [
    "Library",
    [
      ["Search", "Ctrl+F"],
      ["Select all pictures in the folder", "Ctrl+A"],
      ["Invert selection", isMac ? "Ctrl+Shift+I / Control-I" : "Ctrl+I"],
      ["Clear selection", "Ctrl+D"],
      ["Add / remove star", "Ctrl+Shift+8"],
      ["Rotate clockwise / counterclockwise", "Ctrl+R / Ctrl+Shift+R"],
      ["Small / normal thumbnails", "Ctrl+1 / Ctrl+2"],
      ["Slideshow", "Ctrl+4"],
      ["Timeline", "Ctrl+5"],
      ["Tags panel", "Ctrl+T"],
      [isMac ? "Get Info" : "Properties", isMac ? "Ctrl+I" : "Alt+Enter"],
      ["New album from selection", "Ctrl+N"],
      ["Full screen", "F11"],
      ["Keyboard shortcuts", "F1"],
    ],
  ],
  [
    "Pictures",
    [
      ["View and edit", "Enter / Ctrl+3"],
      ["Rename", isMac ? "F2 / F3" : "F2"],
      ["Save edits into the picture (original kept)", "Ctrl+S"],
      ["Export to folder", "Ctrl+Shift+S"],
      ["Print", "Ctrl+P"],
      ["Print contact sheet", "Ctrl+Shift+P"],
      ["E-mail", "Ctrl+E"],
      [isMac ? "Show in Finder" : "Locate on disk", "Ctrl+Enter"],
      ["Open in default program", "Ctrl+Shift+O"],
      [`Delete (to the ${isMac ? "Trash" : "Recycle Bin"})`, isMac ? "Backspace / Ctrl+Backspace" : "Delete"],
      ["Delete permanently", isMac ? "Alt+Ctrl+Backspace / Shift+Backspace" : "Shift+Delete / Ctrl+Delete"],
    ],
  ],
  [
    "Edit view",
    [
      ["Previous / next picture", "Left / Right"],
      ["Zoom in / out (also Page Up / Down, + / − and the mouse wheel)", "Up / Down"],
      ["Fit to window / actual size", "0 / 1"],
      ["Drag to move around a zoomed picture", ""],
      ["Movie: play / pause", "/"],
      ["Movie: back / forward 5 seconds", ", / ."],
      ["Undo / redo", isMac ? "Ctrl+Z / Ctrl+Shift+Z" : "Ctrl+Z / Ctrl+Y"],
      ["Back to library", "Esc"],
    ],
  ],
];

/** Help › Keyboard Shortcuts. */
export default function ShortcutsDialog() {
  const open = useStore((s) => s.shortcutsOpen);
  if (!open) return null;
  const close = () => useStore.getState().setShortcutsOpen(false);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && close()} onKeyDown={(e) => e.key === "Escape" && close()}>
      <div className="modal shortcuts">
        <h3>Keyboard Shortcuts</h3>
        <div className="body">
          {GROUPS.map(([title, rows]) => (
            <section key={title}>
              <h4>{title}</h4>
              <table>
                <tbody>
                  {rows.map(([what, keys]) => (
                    <tr key={what}>
                      <td>{what}</td>
                      <td className="keys">
                        {keys
                          .split(" / ")
                          .map((k) => fmtShortcut(k))
                          .join("  /  ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}
        </div>
        <div className="foot">
          <button className="tbtn default" onClick={close} autoFocus>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export const openWebsite = () => openUrl(SITE_URL);
export const reportProblem = () => openUrl(`${ISSUES_URL}/new`);
