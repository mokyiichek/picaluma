import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { pictureDir } from "@tauri-apps/api/path";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { api } from "../api";
import { plural } from "../format";
import { RenderOptions, writePicture } from "../share";
import { useStore } from "../store";
import { notify } from "../dialogs";

const QUALITY = { Automatic: 0.85, Maximum: 0.97, Normal: 0.8, Minimum: 0.6 } as const;
type Quality = keyof typeof QUALITY | "Custom";

interface Settings {
  location: string;
  resize: boolean;
  edge: number;
  quality: Quality;
  custom: number;
  watermark: boolean;
  text: string;
}

const DEFAULTS: Settings = { location: "", resize: false, edge: 1600, quality: "Automatic", custom: 85, watermark: false, text: "" };

function load(): Settings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem("export") ?? "{}") };
  } catch {
    return DEFAULTS;
  }
}

/** File › Export Picture to Folder (Picasa's "Export to Folder"): resized, edited JPEG copies in a new folder. */
export default function ExportDialog() {
  const share = useStore((s) => s.share);
  const ids = share?.kind === "export" ? share.ids : null;
  const [cfg, setCfg] = useState<Settings>(load);
  const [name, setName] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const set = (patch: Partial<Settings>) => setCfg((c) => ({ ...c, ...patch }));

  useEffect(() => {
    if (!ids) return;
    setProgress(null);
    const s = useStore.getState();
    const cur = s.currentFolderId != null ? s.folderById.get(s.currentFolderId) : undefined;
    setName(cur?.name ?? "");
    if (!cur) api.getPhoto(ids[0]).then((p) => setName(p.folderName));
    if (!cfg.location) pictureDir().then((d) => set({ location: d })).catch(() => {});
  }, [ids]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!ids) return null;
  const close = () => progress == null && useStore.getState().setShare(null);
  const browse = async () => {
    const dir = await open({ directory: true, title: "Location of exported folder", defaultPath: cfg.location || undefined });
    if (typeof dir === "string") set({ location: dir });
  };
  const run = async () => {
    try {
      localStorage.setItem("export", JSON.stringify(cfg));
    } catch {
      /* settings just won't be remembered */
    }
    const opts: RenderOptions = {
      maxEdge: cfg.resize ? cfg.edge : 0,
      quality: cfg.quality === "Custom" ? cfg.custom / 100 : QUALITY[cfg.quality],
      watermark: cfg.watermark ? cfg.text : "",
    };
    setProgress(0);
    const failed: string[] = [];
    let first = "";
    try {
      const dir = await api.makeExportDir(cfg.location, name);
      for (let i = 0; i < ids.length; i++) {
        setProgress(i);
        const photo = await api.getPhoto(ids[i]);
        try {
          const out = await writePicture(photo, dir, opts);
          first ||= out;
        } catch (e) {
          failed.push(`${photo.name}: ${e}`);
        }
      }
    } catch (e) {
      failed.push(String(e));
    }
    setProgress(null);
    useStore.getState().setShare(null);
    if (failed.length) notify(`${plural(failed.length, "picture")} could not be exported:\n\n${failed.slice(0, 8).join("\n")}`);
    // Like Picasa, show the exported folder when done.
    if (first) revealItemInDir(first).catch(() => {});
  };

  const busy = progress != null;
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && close()} onKeyDown={(e) => e.key === "Escape" && close()}>
      <div className="modal share-dialog">
        <h3>Export to Folder</h3>
        <div className="body">
          <div className="field">
            <span>Location of exported folder:</span>
            <div className="row">
              <input value={cfg.location} onChange={(e) => set({ location: e.target.value })} disabled={busy} />
              <button className="tbtn" onClick={browse} disabled={busy}>
                Browse...
              </button>
            </div>
          </div>
          <label className="field">
            <span>Name of exported folder:</span>
            <input value={name} onChange={(e) => setName(e.target.value)} disabled={busy} />
          </label>
          <fieldset disabled={busy}>
            <legend>Image size</legend>
            <label className="opt-radio">
              <input type="radio" checked={!cfg.resize} onChange={() => set({ resize: false })} /> Use original size
            </label>
            <label className="opt-radio">
              <input type="radio" checked={cfg.resize} onChange={() => set({ resize: true })} /> Resize to:
              <input type="range" className="slider" min={320} max={4000} step={20} value={cfg.edge} onChange={(e) => set({ resize: true, edge: Number(e.target.value) })} />
              <b>{cfg.edge}</b> pixels
            </label>
          </fieldset>
          <fieldset disabled={busy}>
            <legend>Image quality</legend>
            <div className="row">
              <select value={cfg.quality} onChange={(e) => set({ quality: e.target.value as Quality })}>
                {[...Object.keys(QUALITY), "Custom"].map((q) => (
                  <option key={q}>{q}</option>
                ))}
              </select>
              {cfg.quality === "Custom" && (
                <>
                  <input type="range" className="slider" min={30} max={100} value={cfg.custom} onChange={(e) => set({ custom: Number(e.target.value) })} />
                  <b>{cfg.custom}%</b>
                </>
              )}
            </div>
          </fieldset>
          <fieldset disabled={busy}>
            <legend>Watermark</legend>
            <label className="opt-radio">
              <input type="checkbox" checked={cfg.watermark} onChange={(e) => set({ watermark: e.target.checked })} /> Add watermark
              <input value={cfg.text} placeholder="© Your name" onChange={(e) => set({ watermark: true, text: e.target.value })} />
            </label>
          </fieldset>
          <p className="muted">Originals are never changed. Pictures without edits at their original size are copied as they are.</p>
        </div>
        <div className="foot">
          {busy && <span className="progress-note">Exporting {Math.min(progress + 1, ids.length)} of {ids.length}...</span>}
          <button className="tbtn default" onClick={run} disabled={busy || !cfg.location.trim()}>
            Export {plural(ids.length, "picture")}
          </button>
          <button className="tbtn" onClick={close} disabled={busy}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
