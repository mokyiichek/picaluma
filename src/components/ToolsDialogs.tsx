import { useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { open as openDir } from "@tauri-apps/plugin-dialog";
import { useVirtualizer } from "@tanstack/react-virtual";
import { api, BackupPlan, LibraryStats, thumbUrl } from "../api";
import { fmtBytes, fmtDate, fmtDateTime, plural } from "../format";
import { useStore } from "../store";
import { notify } from "../dialogs";

function useProgress(active: boolean) {
  const [p, setP] = useState<{ done: number; total: number } | null>(null);
  useEffect(() => {
    if (!active) return setP(null);
    const un = listen<{ done: number; total: number }>("tool-progress", (e) => setP(e.payload));
    return () => void un.then((f) => f());
  }, [active]);
  return p;
}

function ProgressBar({ p }: { p: { done: number; total: number } | null }) {
  const pct = p && p.total ? Math.round((p.done / p.total) * 100) : 0;
  return (
    <div className="tool-progress">
      <div className="tool-progress-bar">
        <div style={{ width: `${pct}%` }} />
      </div>
      <span className="muted small">{p ? `${p.done.toLocaleString()} of ${p.total.toLocaleString()}` : "Starting…"}</span>
    </div>
  );
}

/** Tools › Experimental › Show Duplicate Files: the search, then the duplicates shown in the library. */
export async function showDuplicates() {
  const s = useStore.getState();
  s.setToolDialog("dups");
  try {
    const sets = await api.findDuplicates();
    if (useStore.getState().toolDialog !== "dups") return; // cancelled
    if (!sets.length) notify("No duplicate files were found.");
    else useStore.getState().setDupGroups(sets, "duplicate");
  } catch (e) {
    if (String(e) !== "cancelled") notify(`The duplicate search stopped: ${e}`, "error");
  } finally {
    useStore.getState().setToolDialog(null);
  }
}

/**
 * Tools › Experimental › Find Similar Pictures (not in Picasa): pictures that look the same even
 * when resized, re-saved or lightly edited. The first search fingerprints every picture.
 */
export async function showSimilar() {
  useStore.getState().setToolDialog("similar");
  try {
    const sets = await api.findSimilar();
    if (useStore.getState().toolDialog !== "similar") return; // cancelled
    if (!sets.length) notify("No similar pictures were found.");
    else useStore.getState().setDupGroups(sets, "similar");
  } catch (e) {
    if (String(e) !== "cancelled") notify(`The search stopped: ${e}`, "error");
  } finally {
    useStore.getState().setToolDialog(null);
  }
}

function DuplicateSearch() {
  const kind = useStore((s) => (s.toolDialog === "dups" || s.toolDialog === "similar" ? s.toolDialog : null));
  const on = kind != null;
  const p = useProgress(on);
  if (!on) return null;
  const cancel = () => {
    api.cancelTool();
    useStore.getState().setToolDialog(null);
  };
  return (
    <div className="modal-back">
      <div className="modal confirm" onKeyDown={(e) => e.key === "Escape" && cancel()}>
        <h3>{kind === "dups" ? "Show Duplicate Files" : "Find Similar Pictures"}</h3>
        <div className="body">
          <p>
            {kind === "dups"
              ? "Looking for pictures that are exact copies of each other…"
              : "Looking for pictures that look the same. The first time, every picture is looked at, which takes a while for a large library; you can stop and carry on later."}
          </p>
          <ProgressBar p={p} />
        </div>
        <div className="foot">
          <button className="tbtn" onClick={cancel} autoFocus>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

const pad = (n: number) => String(n).padStart(2, "0");
/** Stored dates are local wall-clock seconds; datetime-local wants YYYY-MM-DDTHH:MM:SS. */
const toInput = (secs: number) => {
  const d = new Date(secs * 1000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
};
const fromInput = (v: string) => {
  const m = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)(?::(\d\d))?/.exec(v);
  return m ? Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0)) / 1000) : null;
};
function describeShift(d: number) {
  if (!d) return "no change";
  const sign = d > 0 ? "later" : "earlier";
  let r = Math.abs(d);
  const parts: string[] = [];
  for (const [n, w] of [[86400, "day"], [3600, "hour"], [60, "minute"], [1, "second"]] as const) {
    const k = Math.floor(r / n);
    if (k) parts.push(plural(k, w));
    r -= k * n;
  }
  return `${parts.slice(0, 3).join(", ")} ${sign}`;
}

/**
 * Tools › Adjust Date and Time, as in Picasa: set the right date for the first picture and every
 * selected picture moves by the same amount (a camera clock that was wrong). The new dates are
 * kept in the folders' .picaluma.ini; the files are not changed.
 */
function AdjustDate() {
  const ids = useStore((s) => s.adjustDate);
  const [first, setFirst] = useState<number | null>(null);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!ids?.length) return;
    setFirst(null);
    api.getPhoto(ids[0]).then((p) => {
      const t = p.taken ?? p.mtime;
      setFirst(t);
      setValue(toInput(t));
    });
  }, [ids]);
  if (!ids?.length) return null;
  const close = () => !busy && useStore.getState().setAdjustDate(null);
  const next = fromInput(value);
  const delta = first != null && next != null ? next - first : 0;
  const run = async (reset: boolean) => {
    setBusy(true);
    try {
      await api.adjustDates(ids, reset ? 0 : delta, reset);
      await useStore.getState().loadSnapshot();
      useStore.getState().setAdjustDate(null);
    } catch (e) {
      notify(String(e), "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal adjust-date" onKeyDown={(e) => e.key === "Escape" && close()}>
        <h3>Adjust Date and Time</h3>
        <div className="body adjust-body">
          <img className="adjust-thumb" src={thumbUrl(ids[0])} alt="" />
          <div className="fp-grid">
            <span>Pictures:</span>
            <span className="fp-row">{plural(ids.length, "picture")}</span>
            <span>Current date:</span>
            <span className="fp-row">{first != null ? fmtDateTime(first) : "…"}</span>
            <label htmlFor="ad-new">Correct date:</label>
            <input id="ad-new" type="datetime-local" step={1} value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
            <span />
            <span className="fp-row muted small">
              {ids.length > 1 ? `All ${ids.length.toLocaleString()} pictures move ${describeShift(delta)}.` : describeShift(delta)}
            </span>
          </div>
        </div>
        <div className="foot">
          <button className="tbtn foot-left" disabled={busy} onClick={() => run(true)} title="Go back to the dates the camera recorded">
            Camera Dates
          </button>
          <button className="tbtn default" disabled={busy || !delta} onClick={() => run(false)}>
            OK
          </button>
          <button className="tbtn" onClick={close}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

const lsGet = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const lsSet = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* private mode */
  }
};

/**
 * Tools › Back Up Pictures: tick folders, pick a drive, and only what isn't backed up yet is
 * copied (Picasa's incremental backup sets, to a disk instead of CDs). The folders' edit files
 * go along, so the backup keeps edits, stars and dates.
 */
function Backup() {
  const on = useStore((s) => s.toolDialog === "backup");
  const folders = useStore((s) => s.snapshot?.folders);
  const [dest, setDest] = useState(() => lsGet("backupDest") ?? "");
  const [picked, setPicked] = useState<Set<string>>(() => new Set(JSON.parse(lsGet("backupFolders") ?? "[]") as string[]));
  const [filter, setFilter] = useState("");
  const [plan, setPlan] = useState<BackupPlan | null>(null);
  const [running, setRunning] = useState(false);
  const p = useProgress(running);
  const scrollRef = useRef<HTMLDivElement>(null);

  const list = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const all = [...(folders ?? [])].sort((a, b) => a.path.localeCompare(b.path));
    return f ? all.filter((x) => x.path.toLowerCase().includes(f)) : all;
  }, [folders, filter]);
  const ids = useMemo(() => (folders ?? []).filter((f) => picked.has(f.path)).map((f) => f.id), [folders, picked]);

  useEffect(() => {
    if (!on) return;
    setPlan(null);
    const t = setTimeout(() => api.backupPlan(ids, dest).then(setPlan).catch(() => setPlan(null)), 300);
    return () => clearTimeout(t);
  }, [on, ids, dest]);
  useEffect(() => {
    if (!on) return;
    lsSet("backupDest", dest);
    lsSet("backupFolders", JSON.stringify([...picked]));
  }, [on, dest, picked]);

  const v = useVirtualizer({ count: list.length, getScrollElement: () => scrollRef.current, estimateSize: () => 22, overscan: 20 });
  if (!on) return null;
  const close = () => !running && useStore.getState().setToolDialog(null);
  const toggle = (path: string) => {
    const n = new Set(picked);
    n.has(path) ? n.delete(path) : n.add(path);
    setPicked(n);
  };
  const browse = async () => {
    const d = await openDir({ directory: true, title: "Back up to" });
    if (typeof d === "string") setDest(d);
  };
  const run = async () => {
    if (!plan?.newFiles) return;
    setRunning(true);
    try {
      const r = await api.backupRun(ids, dest);
      const msg = `Backed up ${plural(r.copied, "file")} (${fmtBytes(r.bytes)}).`;
      if (r.failed.length) notify(`${msg}\n\n${plural(r.failed.length, "file")} couldn't be copied:\n${r.failed.slice(0, 8).join("\n")}`, "error");
      else notify(msg);
      setPlan(await api.backupPlan(ids, dest));
    } catch (e) {
      notify(String(e), "error");
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal backup" onKeyDown={(e) => e.key === "Escape" && close()}>
        <h3>Back Up Pictures</h3>
        <div className="body backup-body">
          <div className="backup-left">
            <div className="fp-row">
              <input className="backup-filter" placeholder="Filter folders" value={filter} onChange={(e) => setFilter(e.target.value)} />
              <button className="tbtn" disabled={running} onClick={() => setPicked(new Set([...picked, ...list.map((f) => f.path)]))}>
                Select All
              </button>
              <button className="tbtn" disabled={running} onClick={() => setPicked(new Set([...picked].filter((x) => !list.some((f) => f.path === x))))}>
                Clear All
              </button>
            </div>
            <div className="backup-list" ref={scrollRef}>
              <div style={{ height: v.getTotalSize(), position: "relative" }}>
                {v.getVirtualItems().map((it) => {
                  const f = list[it.index];
                  return (
                    <label key={f.id} className="backup-row" style={{ transform: `translateY(${it.start}px)` }} title={f.path}>
                      <input type="checkbox" checked={picked.has(f.path)} disabled={running} onChange={() => toggle(f.path)} />
                      <span className="backup-name">{f.name}</span>
                      <span className="muted small backup-count">{f.photos.length.toLocaleString()}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          </div>
          <div className="backup-right">
            <p className="muted small">Only pictures that aren't in the backup yet, or that changed since, are copied. Nothing in the backup is ever deleted.</p>
            <label className="field">
              <span>Back up to</span>
              <span className="fp-row">
                <input className="backup-dest" value={dest} readOnly placeholder="Choose a drive or folder" />
                <button className="tbtn" disabled={running} onClick={browse}>
                  Browse...
                </button>
              </span>
            </label>
            <div className="backup-sum">
              <div>Folders: {ids.length.toLocaleString()}</div>
              {plan && (
                <>
                  <div>
                    Pictures: {plan.files.toLocaleString()} ({fmtBytes(plan.bytes)})
                  </div>
                  {dest && (
                    <div>
                      <b>Not backed up yet: {plan.newFiles.toLocaleString()}</b> ({fmtBytes(plan.newBytes)})
                    </div>
                  )}
                  {plan.cloud > 0 && <div className="muted small">{plural(plan.cloud, "online-only cloud file")} left out</div>}
                </>
              )}
            </div>
            {running && <ProgressBar p={p} />}
          </div>
        </div>
        <div className="foot">
          {running ? (
            <button className="tbtn" onClick={() => api.cancelTool()}>
              Stop
            </button>
          ) : (
            <>
              <button className="tbtn default" disabled={!dest || !plan?.newFiles} onClick={run}>
                Back Up
              </button>
              <button className="tbtn" onClick={close}>
                Close
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** Tools › Library Statistics (not in Picasa): what the library holds, by year, camera and type. */
function Stats() {
  const on = useStore((s) => s.toolDialog === "stats");
  const [st, setSt] = useState<LibraryStats | null>(null);
  useEffect(() => {
    if (!on) return;
    setSt(null);
    api.libraryStats().then(setSt).catch((e) => notify(String(e), "error"));
  }, [on]);
  if (!on) return null;
  const close = () => useStore.getState().setToolDialog(null);
  const maxYear = st ? Math.max(1, ...st.years.map(([, n]) => n)) : 1;
  const maxCam = st ? Math.max(1, ...st.cameras.map(([, n]) => n)) : 1;
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal stats" onKeyDown={(e) => e.key === "Escape" && close()}>
        <h3>Library Statistics</h3>
        <div className="body stats-body">
          {!st ? (
            <p className="muted">Counting…</p>
          ) : (
            <>
              <div className="stats-sum">
                <div>
                  <b>{st.pictures.toLocaleString()}</b> pictures
                </div>
                <div>
                  <b>{st.videos.toLocaleString()}</b> movies
                </div>
                <div>
                  <b>{fmtBytes(st.bytes)}</b> on disk
                </div>
                <div>
                  <b>{st.folders.toLocaleString()}</b> folders
                </div>
                <div>
                  <b>{st.starred.toLocaleString()}</b> starred
                </div>
                <div>
                  <b>{st.edited.toLocaleString()}</b> edited
                </div>
                <div>
                  <b>{st.geotagged.toLocaleString()}</b> with places
                </div>
                <div>
                  <b>{st.people.toLocaleString()}</b> people · {st.namedFaces.toLocaleString()} name tags
                </div>
              </div>
              {st.first > 0 && (
                <p className="muted">
                  From {fmtDate(st.first)} to {fmtDate(st.last)}
                  {st.hidden ? ` · ${st.hidden.toLocaleString()} hidden` : ""}
                </p>
              )}
              <div className="stats-cols">
                <div>
                  <h4>Pictures by year</h4>
                  <div className="stats-bars">
                    {st.years.map(([y, n]) => (
                      <div key={y} className="stats-bar">
                        <span>{y}</span>
                        <i style={{ width: `${(n / maxYear) * 100}%` }} />
                        <em>{n.toLocaleString()}</em>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <h4>Cameras</h4>
                  <div className="stats-bars">
                    {st.cameras.map(([c, n]) => (
                      <div key={c} className="stats-bar wide">
                        <span title={c}>{c}</span>
                        <i style={{ width: `${(n / maxCam) * 100}%` }} />
                        <em>{n.toLocaleString()}</em>
                      </div>
                    ))}
                    {!st.cameras.length && <p className="muted">No camera details found yet.</p>}
                  </div>
                  <h4>File types</h4>
                  <div className="stats-types">
                    {st.types.map(([t, n, b]) => (
                      <span key={t}>
                        <b>{t || "?"}</b> {n.toLocaleString()} <span className="muted">({fmtBytes(b)})</span>
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}
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

/**
 * File › Rename with several pictures selected, as in Picasa: one name for all, numbered, with the
 * date taken and the picture size if you like. Extensions stay.
 */
function BatchRename() {
  const ids = useStore((s) => s.renameIds);
  const [name, setName] = useState("");
  const [withDate, setWithDate] = useState(false);
  const [withSize, setWithSize] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sample, setSample] = useState<{ taken: number; w: number; h: number; ext: string } | null>(null);
  useEffect(() => {
    if (!ids) return;
    setName("");
    api.getPhoto(ids[0]).then((p) => setSample({ taken: p.taken ?? p.mtime, w: p.width, h: p.height, ext: p.name.replace(/^.*(\.[^.]+)$/, "$1") }));
  }, [ids]);
  if (!ids) return null;
  const close = () => !busy && useStore.getState().setRenameIds(null);
  const pad = String(ids.length).length;
  const dateOf = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);
  const stem = (i: number, taken: number, w: number, h: number) =>
    [name.trim(), withDate ? dateOf(taken) : "", withSize && w ? `${w}x${h}` : "", String(i + 1).padStart(pad, "0")].filter(Boolean).join("-");
  const run = async () => {
    if (!name.trim()) return;
    setBusy(true);
    const failed: string[] = [];
    for (let i = 0; i < ids.length; i++) {
      const p = await api.getPhoto(ids[i]);
      try {
        await api.renamePhoto(ids[i], stem(i, p.taken ?? p.mtime, p.width, p.height));
      } catch (e) {
        failed.push(`${p.name}: ${e}`);
      }
    }
    await useStore.getState().loadSnapshot();
    setBusy(false);
    useStore.getState().setRenameIds(null);
    if (failed.length) notify(`${plural(failed.length, "picture")} couldn't be renamed:\n${failed.slice(0, 8).join("\n")}`, "error");
  };
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal confirm" onKeyDown={(e) => e.key === "Escape" && close()}>
        <h3>Rename Files</h3>
        <div className="body">
          <p>Rename {plural(ids.length, "picture")} to:</p>
          <input className="rename-input" value={name} autoFocus onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && run()} />
          <label className="opt-check">
            <input type="checkbox" checked={withDate} onChange={(e) => setWithDate(e.target.checked)} />
            <span>Include date</span>
          </label>
          <label className="opt-check">
            <input type="checkbox" checked={withSize} onChange={(e) => setWithSize(e.target.checked)} />
            <span>Include picture size</span>
          </label>
          <p className="muted small">Example: {sample && name.trim() ? `${stem(0, sample.taken, sample.w, sample.h)}${sample.ext}` : "type a name"}</p>
        </div>
        <div className="foot">
          <button className="tbtn default" disabled={busy || !name.trim()} onClick={run}>
            {busy ? "Renaming…" : "Rename"}
          </button>
          <button className="tbtn" onClick={close}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ToolsDialogs() {
  return (
    <>
      <DuplicateSearch />
      <AdjustDate />
      <Backup />
      <Stats />
      <BatchRename />
    </>
  );
}
