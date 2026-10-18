// Platform conventions: Ctrl on Windows becomes ⌘ on macOS, and menus show Mac key symbols.

export const isMac = navigator.userAgent.includes("Mac");

/** The "command" modifier: ⌘ on macOS, Ctrl elsewhere. */
export const mod = (e: { ctrlKey: boolean; metaKey: boolean }) => (isMac ? e.metaKey : e.ctrlKey);

/** Delete key: Delete on Windows; Delete (⌫, reported as Backspace) or Forward Delete on Mac. */
export const isDeleteKey = (e: KeyboardEvent) => e.key === "Delete" || (isMac && e.key === "Backspace");

/**
 * Permanent delete (skip the Recycle Bin / Trash): Shift+Del or Ctrl+Del on Windows, as in
 * Picasa and Explorer; ⌥⌘⌫ on Mac, as in Finder.
 */
export const isPermanentDelete = (e: KeyboardEvent) => (isMac ? e.metaKey && e.altKey : e.shiftKey || e.ctrlKey);

export const binName = navigator.userAgent.includes("Windows") ? "Recycle Bin" : "Trash";

/** "Ctrl+Shift+S" → "⇧⌘S" on Mac; unchanged elsewhere. */
export function fmtShortcut(s: string): string {
  if (!isMac) return s;
  const parts = s.split("+");
  const key = parts.pop()!;
  const sym: Record<string, string> = { Ctrl: "⌘", Shift: "⇧", Alt: "⌥" };
  const order = ["Alt", "Shift", "Ctrl"];
  const mods = order.filter((m) => parts.includes(m)).map((m) => sym[m]).join("");
  const keyName: Record<string, string> = { Delete: "⌫", Backspace: "⌫", Enter: "↩", Left: "←", Right: "→", Esc: "⎋" };
  return mods + (keyName[key] ?? key);
}

/**
 * Picasa for Mac's own wording for commands that differ from Windows
 * (taken from Picasa 3.9 Mac's menu tables — see docs/PICASA_MAC_SPEC.md).
 */
const MAC_LABELS: Record<string, string> = {
  "Locate on Disk": "Show in Finder",
  Properties: "Get Info",
  "Options...": "Preferences...",
  Exit: "Close Window",
};
const MAC_SHORTCUTS: Record<string, string> = {
  "Get Info": "Ctrl+I",
  "Preferences...": "Ctrl+,",
};

/** Menu label/shortcut as Picasa showed it on this platform. */
export function platformItem(label: string, shortcut?: string): { label: string; shortcut?: string } {
  if (!isMac) return { label, shortcut };
  const l = MAC_LABELS[label] ?? label;
  return { label: l, shortcut: MAC_SHORTCUTS[l] ?? shortcut };
}