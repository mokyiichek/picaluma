import { useEffect, useMemo, useState } from "react";
import { pictureDir } from "@tauri-apps/api/path";
import { api, DirEntry, PicasaScanlist, Root } from "../api";
import { useStore } from "../store";
import { CollapseIcon, FolderIcon } from "./Icons";

type Mode = "always" | "once" | "remove";
const isWin = navigator.userAgent.includes("Windows");
const norm = (p: string) => {
  const s = p.replace(/[\\/]+$/, "");
  return isWin ? s.replace(/\//g, "\\").toLowerCase() : s;
};
const parentOf = (p: string) => {
  const s = p.replace(/[\\/]+$/, "");
  const i = Math.max(s.lastIndexOf("\\"), s.lastIndexOf("/"));
  return i <= 0 ? (s.startsWith("/") && s !== "/" ? "/" : null) : s.slice(0, i + (s[i - 1] === ":" ? 1 : 0)) || null;
};

/** The marks Picasa draws on folders: green tick (Scan Always), eye (Scan Once), red cross (Remove). */
function Mark({ mode, inherited }: { mode: Mode | null; inherited: boolean }) {
  if (!mode) return <span className="fm-mark" />;
  const c = mode === "always" ? "#2f9a2f" : mode === "once" ? "#2a6db0" : "#c8322a";
  const glyph = mode === "always" ? "✔" : mode === "once" ? "◉" : "✖";
  return (
    <span className="fm-mark" style={{ color: c, opacity: inherited ? 0.45 : 1 }} title={inherited ? "From the folder above" : undefined}>
      {glyph}
    </span>
  );
}

/**
 * Tools › Folder Manager, the Picasa way: the folders on disk as a tree; for the selected folder
 * Scan Once, Remove from Picaluma or Scan Always; the watched folders listed on the right.
 * Changes apply with OK. With nothing watched yet it doubles as the first-run welcome.
 */
export default function FolderManager() {
  const isOpen = useStore((s) => s.folderManager);
  const setOpen = useStore((s) => s.setFolderManager);
  const [roots, setRoots] = useState<Root[]>([]);
  const [draft, setDraft] = useState<Map<string, Mode | "none">>(new Map());
  const [children, setChildren] = useState<Map<string, DirEntry[]>>(new Map());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [sel, setSel] = useState<string | null>(null);
  const [picasa, setPicasa] = useState<PicasaScanlist | null>(null);
  const [pictures, setPictures] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async (path: string | null) => {
    const key = path ?? "";
    if (children.has(key)) return;
    const list = await api.listDirs(path);
    setChildren((m) => new Map(m).set(key, list));
  };

  useEffect(() => {
    if (!isOpen) return;
    setDraft(new Map());
    setChildren(new Map());
    setExpanded(new Set());
    setSel(null);
    api.listRoots().then(setRoots);
    api.picasaScanlist().then(setPicasa);
    pictureDir().then(setPictures).catch(() => setPictures(null));
    api.listDirs(null).then((list) => setChildren(new Map([["", list]])));
  }, [isOpen]);

  // Settings as they will be after OK: saved ones with this session's changes on top.
  const settings = useMemo(() => {
    const m = new Map<string, { path: string; mode: Mode }>();
    for (const r of roots) m.set(norm(r.path), { path: r.path, mode: r.mode === "excluded" ? "remove" : (r.mode as Mode) });
    for (const [p, mode] of draft) {
      if (mode === "none") m.delete(norm(p));
      else m.set(norm(p), { path: p, mode });
    }
    return m;
  }, [roots, draft]);

  if (!isOpen) return null;

  const modeOf = (path: string): { mode: Mode | null; inherited: boolean } => {
    const own = settings.get(norm(path));
    if (own) return { mode: own.mode, inherited: false };
    for (let p = parentOf(path); p; p = parentOf(p)) {
      const up = settings.get(norm(p));
      if (up) return { mode: up.mode, inherited: true };
    }
    return { mode: null, inherited: false };
  };
  const setMode = (path: string, mode: Mode) => {
    const next = new Map(draft);
    // Choosing what the folder above already gives just removes the folder's own setting.
    const up = (() => {
      for (let p = parentOf(path); p; p = parentOf(p)) {
        const s = settings.get(norm(p));
        if (s) return s.mode;
      }
      return null;
    })();
    next.set(path, up === mode ? "none" : mode);
    setDraft(next);
  };
  const toggle = (path: string) => {
    const next = new Set(expanded);
    if (next.has(path)) next.delete(path);
    else {
      next.add(path);
      load(path);
    }
    setExpanded(next);
  };
  const reveal = async (path: string) => {
    // Open the tree down to a watched folder.
    const chain: string[] = [];
    for (let p: string | null = path; p; p = parentOf(p)) chain.unshift(p);
    const next = new Set(expanded);
    for (const p of chain.slice(0, -1)) {
      next.add(p);
      await load(p);
    }
    setExpanded(next);
    setSel(path);
    setTimeout(() => document.querySelector(".fm-tree .fm-row.sel")?.scrollIntoView({ block: "center" }), 60);
  };
  const ok = async () => {
    setBusy(true);
    try {
      if (draft.size) await api.applyFolderManager([...draft.entries()]);
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  const renderLevel = (key: string, depth: number): React.ReactNode =>
    (children.get(key) ?? []).map((d) => {
      const m = modeOf(d.path);
      const open = expanded.has(d.path);
      return (
        <div key={d.path}>
          <div className={`fm-row${sel === d.path ? " sel" : ""}`} style={{ paddingLeft: 4 + depth * 16 }} onMouseDown={() => setSel(d.path)} onDoubleClick={() => d.hasChildren && toggle(d.path)}>
            <span className={`twisty${d.hasChildren ? "" : " leaf"}`} onMouseDown={(e) => (e.stopPropagation(), d.hasChildren && toggle(d.path))}>
              <CollapseIcon open={open} />
            </span>
            <Mark {...m} />
            <FolderIcon size={15} />
            <span className="name">{d.name}</span>
          </div>
          {open && renderLevel(d.path, depth + 1)}
        </div>
      );
    });

  const selMode = sel ? modeOf(sel) : null;
  const watched = [...settings.values()].filter((s) => s.mode !== "remove").sort((a, b) => a.path.localeCompare(b.path));
  const first = !roots.some((r) => r.mode !== "excluded");

  return (
    <div className="modal-back">
      <div className="modal folder-manager">
        <h3>{first ? "Welcome to Picaluma — Folder Manager" : "Folder Manager"}</h3>
        <p className="fm-intro">
          {first
            ? "Choose the folders where you keep your pictures. Picaluma finds them and keeps them organised — your originals are never changed."
            : "Choose which folders Picaluma scans. Scan Always watches a folder and everything in it for changes."}
        </p>
        {(picasa?.found || (pictures && !settings.has(norm(pictures)))) && (
          <div className="fm-quick">
            {picasa?.found && (
              <button className="tbtn" onClick={() => api.importPicasa().then(() => api.listRoots().then(setRoots))}>
                Use my Picasa folder list ({picasa.include.length} watched, {picasa.exclude.length} removed)
              </button>
            )}
            {pictures && !settings.has(norm(pictures)) && (
              <button className="tbtn" onClick={() => setDraft(new Map(draft).set(pictures, "always"))}>
                Scan my Pictures folder
              </button>
            )}
          </div>
        )}
        <div className="fm-body">
          <div className="fm-tree">
            <div className="fm-cap">Folders on disk</div>
            <div className="fm-scroll">{renderLevel("", 0)}</div>
          </div>
          <div className="fm-opts">
            <div className="fm-cap">{sel ? "This folder" : "Select a folder"}</div>
            {sel && (
              <>
                <p className="fm-path" title={sel}>
                  {sel}
                </p>
                {(
                  [
                    ["once", "Scan Once", "Look for pictures now, without watching for changes."],
                    ["remove", "Remove from Picaluma", "Leave this folder out (also inside watched folders)."],
                    ["always", "Scan Always", "Keep watching this folder and the folders in it."],
                  ] as [Mode, string, string][]
                ).map(([m, label, hint]) => (
                  <label key={m} className="fm-radio">
                    <input type="radio" name="fm-mode" checked={selMode?.mode === m} onChange={() => setMode(sel, m)} />
                    <span>
                      <b>
                        <Mark mode={m} inherited={false} /> {label}
                      </b>
                      <br />
                      <span className="muted small">{hint}</span>
                    </span>
                  </label>
                ))}
                {selMode?.inherited && <p className="muted small">Set by a folder above it.</p>}
                {settings.has(norm(sel)) && (
                  <button className="link" onClick={() => setDraft(new Map(draft).set(settings.get(norm(sel))!.path, "none"))}>
                    Clear this folder's setting
                  </button>
                )}
              </>
            )}
          </div>
          <div className="fm-watched">
            <div className="fm-cap">Watched folders</div>
            <div className="fm-scroll">
              {!watched.length && <p className="muted small">None yet.</p>}
              {watched.map((w) => (
                <div key={w.path} className={`fm-row${sel && norm(sel) === norm(w.path) ? " sel" : ""}`} onMouseDown={() => reveal(w.path)} title={w.path}>
                  <Mark mode={w.mode} inherited={false} />
                  <span className="name">{w.path}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="foot">
          <span className="muted small fm-pending">{draft.size ? `${draft.size} change${draft.size === 1 ? "" : "s"} — applied when you click OK` : ""}</span>
          <button className="tbtn default" disabled={busy} onClick={ok}>
            OK
          </button>
          <button className="tbtn" onClick={() => setOpen(false)}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
