import { useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { open as openDir } from "@tauri-apps/plugin-dialog";
import { useVirtualizer } from "@tanstack/react-virtual";
import { api, BackupPlan, thumbUrl } from "../api";
import { fmtBytes, fmtDateTime, plural } from "../format";
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
    else useStore.getState().setDupGroups(sets);
  } catch (e) {
    if (String(e) !== "cancelled") notify(`The duplicate search stopped: ${e}`, "error");
  } finally {
    useStore.getState().setToolDialog(null);
  }
}

function DuplicateSearch() {
  const on = useStore((s) => s.toolDialog === "dups");
  const p = useProgress(on);
  if (!on) return null;
  const cancel = () => {
    api.cancelTool();
    useStore.getState().setToolDialog(null);
  };
  return (
    <div className="modal-back">
      <div className="modal confirm" onKeyDown={(e) => e.key === "Escape" && cancel()}>
        <h3>Show Duplicate Files</h3>
        <div className="body">
          <p>Looking for pictures that are exact copies of each other…</p>
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

export default function ToolsDialogs() {
  return (
    <>
      <DuplicateSearch />
      <AdjustDate />
      <Backup />
    </>
  );
}
