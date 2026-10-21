import { useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { api, importThumbUrl, ImportItem, ImportSource } from "../api";
import { useStore } from "../store";
import { confirmAsk, notify } from "../dialogs";
import { plural } from "../format";

const pad = (n: number) => String(n).padStart(2, "0");
/** Picasa names an import folder after the date: "2026-10-22". Stored dates are local seconds. */
const dayName = (secs: number) => {
  const d = new Date(secs * 1000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};
const todayName = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/**
 * File › Import From: pictures and movies on a camera, memory card or folder, shown before
 * copying. Pictures already in the library are marked and left out; the rest are copied into a
 * new dated folder, and can be cleared off the card afterwards.
 */
export default function ImportView() {
  const isOpen = useStore((s) => s.importOpen);
  const close = () => useStore.getState().setImportOpen(false);
  const [sources, setSources] = useState<ImportSource[]>([]);
  const [src, setSrc] = useState("");
  const [items, setItems] = useState<ImportItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [dest, setDest] = useState("");
  const [folder, setFolder] = useState(todayName());
  const [clearCard, setClearCard] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setItems(null);
    setProgress(null);
    api.importDefaultDest().then(setDest);
    api.importSources().then((list) => {
      setSources(list);
      if (list.length) setSrc(list[0].path);
    });
    const un = listen<{ done: number; total: number }>("import-progress", (e) => setProgress(e.payload));
    return () => {
      un.then((f) => f());
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !src) return;
    let live = true;
    setLoading(true);
    api
      .scanImport(src)
      .then((list) => {
        if (!live) return;
        setItems(list);
        setSel(new Set(list.filter((i) => !i.duplicate).map((i) => i.path)));
        const first = list.find((i) => !i.duplicate) ?? list[0];
        setFolder(first ? dayName(first.date) : todayName());
      })
      .catch((e) => notify(String(e), "error"))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [isOpen, src]);

  const dupes = useMemo(() => items?.filter((i) => i.duplicate).length ?? 0, [items]);
  if (!isOpen) return null;

  const browse = async () => {
    const dir = await open({ directory: true, title: "Import from folder" });
    if (typeof dir === "string") {
      if (!sources.some((s) => s.path === dir)) setSources([...sources, { path: dir, label: dir }]);
      setSrc(dir);
    }
  };
  const changeDest = async () => {
    const dir = await open({ directory: true, title: "Save imported pictures in", defaultPath: dest || undefined });
    if (typeof dir === "string") setDest(dir);
  };
  const toggle = (p: string) => {
    const next = new Set(sel);
    next.has(p) ? next.delete(p) : next.add(p);
    setSel(next);
  };
  const run = async (paths: string[]) => {
    if (!paths.length || !dest) return;
    if (
      clearCard &&
      !(await confirmAsk(`After copying, delete the ${plural(paths.length, "picture")} from ${sources.find((s) => s.path === src)?.label ?? src}?\n\nThis can't be undone; the copies in the library stay.`, {
        title: "Import",
        ok: "Import and Delete",
        danger: true,
      }))
    )
      return;
    setProgress({ done: 0, total: paths.length });
    try {
      const res = await api.importFiles(paths, dest, folder, clearCard);
      useStore.getState().selectFolderByPath(res.folder);
      close();
      const extra = [res.failed.length ? `${plural(res.failed.length, "file")} could not be copied:\n${res.failed.slice(0, 8).join("\n")}` : "", res.deleted ? `${plural(res.deleted, "file")} deleted from the card.` : ""]
        .filter(Boolean)
        .join("\n\n");
      notify(`Imported ${plural(res.copied, "file")} into "${folder}".${extra ? `\n\n${extra}` : ""}`);
    } catch (e) {
      notify(String(e), "error");
    } finally {
      setProgress(null);
    }
  };
  const busy = progress != null;

  return (
    <div className="people-manager import-view">
      <div className="pm-head">
        <h2>Import</h2>
        <label className="imp-from">
          From
          <select value={src} onChange={(e) => setSrc(e.target.value)} disabled={busy}>
            {!sources.length && <option value="">No camera or memory card found</option>}
            {sources.map((s) => (
              <option key={s.path} value={s.path}>
                {s.label}
              </option>
            ))}
          </select>
          <button className="tbtn" onClick={browse} disabled={busy}>
            Folder...
          </button>
          <button className="tbtn" onClick={() => api.importSources().then(setSources)} disabled={busy} title="Look again for cameras and cards">
            Refresh
          </button>
        </label>
        <span className="pm-status">
          {loading ? "Looking for pictures…" : items ? `${plural(items.length, "file")}${dupes ? ` · ${dupes} already in the library` : ""}` : ""}
        </span>
        <button className="tbtn" onClick={close} disabled={busy}>
          Cancel
        </button>
      </div>
      <div className="pm-body">
        {!src && <p className="pm-empty">Connect a camera or insert a memory card, or choose a folder to import from.</p>}
        {items && !items.length && !loading && <p className="pm-empty">No pictures or movies here.</p>}
        <div className="imp-grid">
          {items?.map((i) => (
            <div
              key={i.path}
              className={`imp-tile${sel.has(i.path) ? " on" : ""}${i.duplicate ? " dup" : ""}`}
              title={`${i.name}${i.duplicate ? " — already in the library" : ""}`}
              onClick={() => !busy && toggle(i.path)}
            >
              <img src={importThumbUrl(i.path)} alt="" loading="lazy" draggable={false} />
              {i.video && <span className="imp-play">▶</span>}
              {i.duplicate && <span className="imp-dup">In library</span>}
              <span className="imp-check">{sel.has(i.path) ? "✓" : ""}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="imp-foot">
        <span className="muted">
          {sel.size} of {items?.length ?? 0} selected ·{" "}
          <button className="link" onClick={() => setSel(new Set(items?.map((i) => i.path)))} disabled={busy}>
            all
          </button>{" "}
          ·{" "}
          <button className="link" onClick={() => setSel(new Set())} disabled={busy}>
            none
          </button>
        </span>
        <label>
          Folder name
          <input value={folder} onChange={(e) => setFolder(e.target.value)} disabled={busy} />
        </label>
        <label className="imp-dest" title={dest}>
          Save in <span className="path">{dest || "…"}</span>
          <button className="tbtn" onClick={changeDest} disabled={busy}>
            Change...
          </button>
        </label>
        <label>
          After copying
          <select value={clearCard ? "delete" : "keep"} onChange={(e) => setClearCard(e.target.value === "delete")} disabled={busy}>
            <option value="keep">Leave them on the card</option>
            <option value="delete">Delete them from the card</option>
          </select>
        </label>
        <span className="imp-go">
          {busy ? (
            <span className="muted">
              Copying {progress.done} of {progress.total}…
            </span>
          ) : (
            <>
              <button className="tbtn" disabled={!sel.size} onClick={() => run(items!.filter((i) => sel.has(i.path)).map((i) => i.path))}>
                Import Selected ({sel.size})
              </button>
              <button className="tbtn" disabled={!items?.length} onClick={() => run(items!.map((i) => i.path))}>
                Import All
              </button>
            </>
          )}
        </span>
      </div>
    </div>
  );
}
