import { useEffect, useState } from "react";
import { open as openFile } from "@tauri-apps/plugin-dialog";
import { api } from "../api";
import { useStore } from "../store";
import { notify } from "../dialogs";

const pad = (n: number) => String(n).padStart(2, "0");
/** Stored dates are local wall-clock seconds; the date input wants YYYY-MM-DD. */
const toInput = (secs: number) => {
  if (!secs) return "";
  const d = new Date(secs * 1000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};
const fromInput = (v: string) => (v ? Math.floor(Date.UTC(+v.slice(0, 4), +v.slice(5, 7) - 1, +v.slice(8, 10), 12) / 1000) : 0);

/**
 * Folder Properties, as in Picasa (double-click a folder, or Edit Folder Description): name
 * (renames the folder on disk), date (or the pictures' own dates), music for its slideshow, place
 * taken and description.
 */
export default function FolderProperties() {
  const id = useStore((s) => s.folderProps);
  const folder = useStore((s) => (s.folderProps != null ? s.folderById.get(s.folderProps) : undefined));
  const close = () => useStore.getState().setFolderProps(null);
  const [name, setName] = useState("");
  const [date, setDate] = useState("");
  const [auto, setAuto] = useState(true);
  const [useMusic, setUseMusic] = useState(false);
  const [music, setMusic] = useState("");
  const [place, setPlace] = useState("");
  const [desc, setDesc] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!folder) return;
    setName(folder.name);
    setDate(toInput(folder.dateMin));
    setAuto(!folder.dateSet);
    setUseMusic(!!folder.music);
    setMusic(folder.music ?? "");
    setPlace(folder.place ?? "");
    setDesc(folder.description);
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (id == null || !folder) return null;

  const browse = async () => {
    const f = await openFile({ title: "Music for the slideshow", filters: [{ name: "Music", extensions: ["mp3", "m4a", "aac", "wav", "ogg", "flac", "wma"] }] });
    if (typeof f === "string") {
      setMusic(f);
      setUseMusic(true);
    }
  };
  const save = async () => {
    setBusy(true);
    try {
      const s = useStore.getState();
      await api.setFolderProps(id, auto ? 0 : fromInput(date), place, useMusic ? music : "");
      if (desc !== folder.description) s.setFolderDescription(id, desc);
      const newName = name.trim();
      if (newName && newName !== folder.name) await api.renameFolder(id, newName);
      await s.loadSnapshot();
      close();
    } catch (e) {
      notify(String(e), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal folder-props" onKeyDown={(e) => e.key === "Escape" && close()}>
        <h3>Folder Properties</h3>
        <div className="fp-grid">
          <label htmlFor="fp-name">Name:</label>
          <input id="fp-name" value={name} autoFocus onFocus={(e) => e.target.select()} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} />

          <label htmlFor="fp-date">Date:</label>
          <span className="fp-row">
            <input
              id="fp-date"
              type="date"
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
                setAuto(false);
              }}
            />
            <button
              className="tbtn"
              title="Use the dates the pictures were taken"
              onClick={() => {
                setAuto(true);
                setDate("");
              }}
            >
              Automatic date
            </button>
            {auto && <span className="muted small">from the pictures</span>}
          </span>

          <span>Music:</span>
          <span className="fp-col">
            <label className="opt-check">
              <input type="checkbox" checked={useMusic} onChange={(e) => setUseMusic(e.target.checked)} />
              <span>Use music for the slideshow</span>
            </label>
            <span className="fp-row">
              <input className="fp-music" value={music} readOnly disabled={!useMusic} placeholder="No music chosen" />
              <button className="tbtn" onClick={browse}>
                Browse...
              </button>
            </span>
          </span>

          <label htmlFor="fp-place">Place taken (optional):</label>
          <input id="fp-place" value={place} onChange={(e) => setPlace(e.target.value)} />

          <label htmlFor="fp-desc">Description (optional):</label>
          <textarea id="fp-desc" rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} />
        </div>
        <div className="foot">
          <button className="tbtn default" disabled={busy} onClick={save}>
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
