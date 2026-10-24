import { useEffect, useMemo, useState } from "react";
import { pictureDir } from "@tauri-apps/api/path";
import { api, DirEntry, PicasaScanlist, Root } from "../api";
import { useStore } from "../store";
import { FolderIcon } from "./Icons";
import { openWebsite } from "./ShortcutsDialog";

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

/** The marks Picasa draws on folders: green tick (Scan Once), red cross (Remove), blue circular
 *  arrow (Scan Always). Inherited marks are drawn lighter. */
function Mark({ mode, inherited }: { mode: Mode | null; inherited: boolean }) {
  const o = inherited ? 0.45 : 1;
  if (!mode) return <span className="fm-mark" />;
  return (
    <span className="fm-mark" style={{ opacity: o }} title={inherited ? "From the folder above" : undefined}>
      {mode === "once" ? (
        <svg viewBox="0 0 16 16" width="14" height="14"><path d="M2.5 8.5l3.5 3.5 7.5-8" fill="none" stroke="#2f9a2f" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
      ) : mode === "remove" ? (
        <svg viewBox="0 0 16 16" width="14" height="14"><path d="M3.5 3.5l9 9M12.5 3.5l-9 9" stroke="#d32f2f" strokeWidth="2.8" strokeLinecap="round" /></svg>
      ) : (
        <svg viewBox="0 0 16 16" width="14" height="14"><path d="M13 8a5 5 0 1 1-1.5-3.6" fill="none" stroke="#2a6db0" strokeWidth="2.2" strokeLinecap="round" /><path d="M12.6 1.6v3.6H9" fill="none" stroke="#2a6db0" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
      )}
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
  const [faces, setFaces] = useState(true);

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
    api.getSettings().then((st) => setFaces(st.faceRecognition)).catch(() => {});
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
            <span className="fm-twisty" onMouseDown={(e) => (e.stopPropagation(), d.hasChildren && toggle(d.path))}>
              {d.hasChildren ? (open ? "◢" : "▷") : ""}
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

  const toggleFaces = async () => {
    const next = !faces;
    setFaces(next);
    await api.setFaceRecognition(next).catch(() => setFaces(!next));
  };

  // Picasa's layout: Folder List on the left; on the right the explanation, "For the current
  // folder" options with the face detection switch, and the Watched Folders list.
  return (
    <div className="modal-back">
      <div className="modal folder-manager">
        <h3>Folder Manager</h3>
        <div className="fm-body">
          <div className="fm-left">
            <div className="fm-label">Folder List</div>
            <div className="fm-tree">{renderLevel("", 0)}</div>
          </div>
          <div className="fm-right">
            <p className="fm-intro">
              {first
                ? "Welcome! For each folder, you can choose whether or not to have Picaluma find pictures inside it. Start with the folders where you keep your pictures."
                : "For each folder, you can choose whether or not to have Picaluma find pictures inside it. You can also pick folders to watch for new pictures."}
            </p>
            {first && (picasa?.found || (pictures && !settings.has(norm(pictures)))) && (
              <div className="fm-quick">
                {picasa?.found && (
                  <button className="tbtn" onClick={() => api.importPicasa().then(() => api.listRoots().then(setRoots))}>
                    Use my Picasa folder list
                  </button>
                )}
                {pictures && !settings.has(norm(pictures)) && (
                  <button className="tbtn" onClick={() => setDraft(new Map(draft).set(pictures, "always"))}>
                    Watch my Pictures folder
                  </button>
                )}
              </div>
            )}
            <fieldset className="fm-group" disabled={!sel}>
              <legend>For the current folder:</legend>
              {(
                [
                  ["once", "Scan Once"],
                  ["remove", "Remove from Picaluma"],
                  ["always", "Scan Always"],
                ] as [Mode, string][]
              ).map(([m, label]) => (
                <label key={m} className="fm-radio">
                  <input type="radio" name="fm-mode" checked={!!sel && selMode?.mode === m} onChange={() => sel && setMode(sel, m)} />
                  <Mark mode={m} inherited={false} />
                  <span>{label}</span>
                </label>
              ))}
              <div className="fm-sep" />
              <button className={`fm-faces${faces ? " on" : ""}`} onClick={toggleFaces} title="Find faces in pictures (for all folders)">
                <span className="fm-faces-ico" />
                Face Detection {faces ? "On" : "Off"}
              </button>
            </fieldset>
            <div className="fm-label">Watched Folders</div>
            <div className="fm-watched">
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
          <span className="muted small fm-pending">{draft.size ? `${draft.size} change${draft.size === 1 ? "" : "s"}, applied when you click OK` : ""}</span>
          <button className="tbtn default" disabled={busy} onClick={ok}>
            OK
          </button>
          <button className="tbtn" onClick={() => setOpen(false)}>
            Cancel
          </button>
          <button className="tbtn" onClick={openWebsite}>
            Help
          </button>
        </div>
      </div>
    </div>
  );
}
