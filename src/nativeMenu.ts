// macOS: Picasa for Mac used the system menu bar (an app menu with About, Preferences and Quit;
// "Close Window" in File), not a menu row inside the window. Picaluma builds the same menus as
// the in-window menu bar into the native one.
import { Menu } from "@tauri-apps/api/menu";
import type { MenuEntry } from "./components/MenuBar";
import { platformItem } from "./platform";

type Opts = Record<string, unknown>;
const actions = new Map<string, () => void>();
/** ⌘ shortcuts the native menu answers ("meta+shift+s"), so key handlers don't run them twice. */
const owned = new Set<string>();
let active = false;
let synthetic = false;

const combo = (accel: string) =>
  accel
    .toLowerCase()
    .split("+")
    .map((k) => (k === "cmdorctrl" ? "meta" : k === "backspace" ? "backspace" : k))
    .sort()
    .join("+");

/** True when the native menu handles this key press (key handlers should then leave it alone). */
export function menuOwnsShortcut(e: KeyboardEvent): boolean {
  if (!active || synthetic || !e.metaKey) return false;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase();
  const parts = ["meta", e.shiftKey ? "shift" : "", e.altKey ? "alt" : "", k === "," ? "," : k].filter(Boolean).sort().join("+");
  return owned.has(parts);
}
let signature = "";
let busy: Promise<void> | null = null;

const inText = () => {
  const el = document.activeElement as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
};

/** "Ctrl+Shift+S" → "CmdOrCtrl+Shift+S". Only ⌘ shortcuts go in the menu: plain keys (Delete,
 *  F2, arrows) stay with the window, where they don't interfere with typing. */
function accelerator(shortcut?: string): string | undefined {
  if (!shortcut || !shortcut.includes("Ctrl")) return undefined;
  return shortcut
    .split("+")
    .map((k) => (k === "Ctrl" ? "CmdOrCtrl" : k === "Delete" ? "Backspace" : k))
    .join("+");
}

function item(e: MenuEntry, path: string): Opts {
  if (e.sep) return { item: "Separator" };
  const p = platformItem(e.label, e.shortcut);
  if (e.submenu) return { text: p.label, items: e.submenu.map((x, i) => item(x, `${path}/${i}`)) };
  const id = `${path}:${p.label}`;
  if (e.action) actions.set(id, e.action);
  const accel = accelerator(p.shortcut);
  if (accel) owned.add(combo(accel));
  const base: Opts = { id, text: p.label, enabled: !!e.action, accelerator: accel, action: (i: string) => actions.get(i)?.() };
  return e.checked != null ? { ...base, checked: !!e.checked } : base;
}

/** Edit menu for text fields (search box, captions, names) plus Picaluma's own Edit items. */
function editMenu(entries: MenuEntry[]): Opts[] {
  const own = entries.filter((e) => !(e.label === "Copy Picture" || e.label === "Select All"));
  const copyPicture = entries.find((e) => e.label === "Copy Picture");
  const selectAll = entries.find((e) => e.label === "Select All");
  // Undo / Redo: text fields first, otherwise the edit view's own undo (its key handler).
  const key = (k: string, shift: boolean) => () => {
    if (inText()) return void document.execCommand(shift ? "redo" : "undo");
    synthetic = true;
    try {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: k, metaKey: true, shiftKey: shift, bubbles: true }));
    } finally {
      synthetic = false;
    }
  };
  for (const a of ["CmdOrCtrl+Z", "CmdOrCtrl+Shift+Z", "CmdOrCtrl+A", "CmdOrCtrl+C", "CmdOrCtrl+X", "CmdOrCtrl+V", "CmdOrCtrl+,", "CmdOrCtrl+Q", "CmdOrCtrl+H"]) owned.add(combo(a));
  actions.set("edit:undo", key("z", false));
  actions.set("edit:redo", key("z", true));
  actions.set("edit:selectall", () => (inText() ? (document.activeElement as HTMLInputElement).select?.() : selectAll?.action?.()));
  actions.set("edit:copypicture", () => copyPicture?.action?.());
  const run = (i: string) => actions.get(i)?.();
  return [
    { id: "edit:undo", text: "Undo", accelerator: "CmdOrCtrl+Z", action: run },
    { id: "edit:redo", text: "Redo", accelerator: "CmdOrCtrl+Shift+Z", action: run },
    { item: "Separator" },
    { item: "Cut" },
    { item: "Copy" },
    { item: "Paste" },
    { id: "edit:selectall", text: "Select All", accelerator: "CmdOrCtrl+A", action: run },
    { item: "Separator" },
    { id: "edit:copypicture", text: "Copy Picture", enabled: !!copyPicture?.action, action: run },
    ...own.map((e) => item(e, `Edit/${entries.indexOf(e)}`)),
  ];
}

/**
 * Puts `menus` (the in-window menu bar's contents) into the macOS menu bar. Rebuilt only when a
 * label, checkmark or enabled state changes. Resolves false if the native menu isn't available.
 */
export async function setNativeMenu(menus: [string, MenuEntry[]][], appName = "Picaluma"): Promise<boolean> {
  const sig = JSON.stringify(menus.map(([n, es]) => [n, es.map((e) => [e.label, !!e.action, e.checked, e.submenu?.map((x) => [x.label, !!x.action, x.checked])])]));
  // Actions change on every render (they close over the current state): always refresh them.
  if (sig === signature) {
    const all = menus.flatMap(([, es]) => es);
    const set = (id: string, e?: MenuEntry) => e?.action && actions.set(id, e.action);
    set("app:about", all.find((e) => e.label === "About Picaluma"));
    set("app:prefs", all.find((e) => e.label === "Options..."));
    const edit = menus.find(([n]) => n === "Edit")?.[1] ?? [];
    const selectAll = edit.find((e) => e.label === "Select All");
    const copyPicture = edit.find((e) => e.label === "Copy Picture");
    actions.set("edit:selectall", () => (inText() ? (document.activeElement as HTMLInputElement).select?.() : selectAll?.action?.()));
    actions.set("edit:copypicture", () => copyPicture?.action?.());
    for (const [name, entries] of menus) {
      entries.forEach((e, i) => {
        const p = platformItem(e.label, e.shortcut);
        if (e.action) actions.set(`${name}/${i}:${p.label}`, e.action);
        e.submenu?.forEach((x, j) => x.action && actions.set(`${name}/${i}/${j}:${platformItem(x.label).label}`, x.action));
      });
    }
    return true;
  }
  signature = sig;
  if (busy) await busy;
  let ok = true;
  busy = (async () => {
    try {
      actions.clear();
      owned.clear();
      const about = menus.flatMap(([, es]) => es).find((e) => e.label === "About Picaluma");
      const prefs = menus.flatMap(([, es]) => es).find((e) => e.label === "Options...");
      if (about?.action) actions.set("app:about", about.action);
      if (prefs?.action) actions.set("app:prefs", prefs.action);
      const run = (i: string) => actions.get(i)?.();
      const app: Opts = {
        text: appName,
        items: [
          { id: "app:about", text: `About ${appName}`, action: run },
          { item: "Separator" },
          { id: "app:prefs", text: "Preferences…", accelerator: "CmdOrCtrl+,", action: run },
          { item: "Separator" },
          { item: "Services" },
          { item: "Separator" },
          { item: "Hide" },
          { item: "HideOthers" },
          { item: "ShowAll" },
          { item: "Separator" },
          { item: "Quit" },
        ],
      };
      const rest: Opts[] = menus.map(([name, entries]) => {
        if (name === "Edit") return { text: name, items: editMenu(entries) };
        // About and Preferences live in the app menu on a Mac.
        const kept = entries.filter((e) => e.label !== "About Picaluma" && e.label !== "Options...");
        // No separator at the end of a menu after moving those out.
        while (kept.length && kept[kept.length - 1].sep) kept.pop();
        const items = kept.map((e, i) => item(e, `${name}/${entries.indexOf(e) >= 0 ? entries.indexOf(e) : i}`));
        return { text: name, items };
      });
      const menu = await Menu.new({ items: [app, ...rest] as never });
      await menu.setAsAppMenu();
      active = true;
    } catch (e) {
      active = false;
      console.warn("native menu unavailable", e);
      signature = "";
      ok = false;
    }
  })();
  await busy;
  busy = null;
  return ok;
}
