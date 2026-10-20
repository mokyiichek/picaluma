import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { fmtShortcut, isMac } from "../platform";
import { useStore } from "../store";

import { ISSUES_URL, SITE_URL } from "./AboutDialog";
import { confirmAsk, notify } from "../dialogs";

const LATEST = "https://api.github.com/repos/mokyiichek/picaluma/releases/latest";

const GROUPS: [string, [string, string][]][] = [
  [
    "Library",
    [
      ["Search", "Ctrl+F"],
      ["Select all pictures in the folder", "Ctrl+A"],
      ["Invert selection", isMac ? "Ctrl+Shift+I" : "Ctrl+I"],
      ["Clear selection", "Ctrl+D"],
      ["Add / remove star", "Ctrl+Shift+8"],
      ["Rotate clockwise / counterclockwise", "Ctrl+R / Ctrl+Shift+R"],
      ["Small / normal thumbnails", "Ctrl+1 / Ctrl+2"],
      ["Slideshow", "Ctrl+4"],
      ["Tags panel", "Ctrl+T"],
      [isMac ? "Get Info" : "Properties", isMac ? "Ctrl+I" : "Alt+Enter"],
      ["New album from selection", "Ctrl+N"],
    ],
  ],
  [
    "Pictures",
    [
      ["View and edit", "Enter / Ctrl+3"],
      ["Rename", "F2"],
      ["Save a copy with edits", "Ctrl+S"],
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

const newer = (a: string, b: string) => {
  const pa = a.replace(/^v/, "").split(".").map(Number);
  const pb = b.replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  return false;
};

/** Help › Check for Updates: compares with the latest release on GitHub. */
export async function checkForUpdates() {
  const current = await getVersion();
  try {
    const res = await fetch(LATEST, { headers: { Accept: "application/vnd.github+json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const latest = (await res.json()).tag_name as string;
    if (newer(latest, current)) {
      if (await confirmAsk(`Picaluma ${latest.replace(/^v/, "")} is available (you have ${current}).\n\nOpen the download page?`, { ok: "Open Download Page" })) openUrl(SITE_URL);
    } else {
      notify(`You have the latest version of Picaluma (${current}).`);
    }
  } catch (e) {
    if (await confirmAsk(`Couldn't check for updates (${e}).\n\nOpen the Picaluma website instead?`, { ok: "Open Website" })) openUrl(SITE_URL);
  }
}

export const openWebsite = () => openUrl(SITE_URL);
export const reportProblem = () => openUrl(`${ISSUES_URL}/new`);
