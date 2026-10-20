import { useEffect, useState } from "react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { api } from "../api";
import { plural } from "../format";
import { isMac } from "../platform";
import { writePicture } from "../share";
import { useStore } from "../store";
import { notify } from "../dialogs";

const SIZES = [
  { label: "Small (640 pixels)", edge: 640 },
  { label: "Medium (1024 pixels)", edge: 1024 },
  { label: "Large (1600 pixels)", edge: 1600 },
  { label: "Original size", edge: 0 },
];

type Via = "program" | "folder";
const program = isMac ? "Mail" : navigator.userAgent.includes("Windows") ? "your email program (Outlook, Thunderbird…)" : "your email program";

/**
 * File › E-Mail (Picasa's "Select Email"): resized copies with edits applied, attached to a new
 * message in the user's mail program, or saved to a folder for web mail such as Gmail.
 */
export default function EmailDialog() {
  const share = useStore((s) => s.share);
  const ids = share?.kind === "email" ? share.ids : null;
  const [edge, setEdge] = useState(() => Number(localStorage.getItem("emailEdge") ?? 1024));
  const [via, setVia] = useState<Via>(() => (localStorage.getItem("emailVia") as Via) ?? "program");
  const [progress, setProgress] = useState<number | null>(null);

  useEffect(() => setProgress(null), [ids]);
  if (!ids) return null;
  const close = () => progress == null && useStore.getState().setShare(null);

  const send = async () => {
    try {
      localStorage.setItem("emailEdge", String(edge));
      localStorage.setItem("emailVia", via);
    } catch {
      /* not remembered */
    }
    setProgress(0);
    const paths: string[] = [];
    let first = "";
    try {
      const dir = await api.emailDir();
      for (let i = 0; i < ids.length; i++) {
        setProgress(i);
        const photo = await api.getPhoto(ids[i]);
        const out = await writePicture(photo, dir, { maxEdge: edge, quality: 0.85 });
        paths.push(out);
        first ||= photo.name;
      }
    } catch (e) {
      setProgress(null);
      notify(`The pictures could not be prepared:\n\n${e}`, "error");
      return;
    }
    setProgress(null);
    useStore.getState().setShare(null);
    const subject = ids.length === 1 ? first : `${ids.length} pictures`;
    if (via === "program") {
      try {
        await api.emailFiles(paths, subject);
        return;
      } catch (e) {
        await notify(`Picaluma couldn't open ${program} (${e}).\n\nThe pictures are in the folder that opens next — drag them into a new message.`);
      }
    }
    revealItemInDir(paths[0]).catch(() => {});
  };

  const busy = progress != null;
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && close()} onKeyDown={(e) => e.key === "Escape" && close()}>
      <div className="modal share-dialog">
        <h3>E-Mail {plural(ids.length, "picture")}</h3>
        <div className="body">
          <fieldset disabled={busy}>
            <legend>Send with</legend>
            <label className="opt-radio">
              <input type="radio" checked={via === "program"} onChange={() => setVia("program")} /> {program[0].toUpperCase() + program.slice(1)}
            </label>
            <label className="opt-radio">
              <input type="radio" checked={via === "folder"} onChange={() => setVia("folder")} /> Gmail or other web mail — save the pictures to a folder to attach
            </label>
          </fieldset>
          <fieldset disabled={busy}>
            <legend>Picture size</legend>
            <select value={edge} onChange={(e) => setEdge(Number(e.target.value))}>
              {SIZES.map((s) => (
                <option key={s.edge} value={s.edge}>
                  {s.label}
                </option>
              ))}
            </select>
            <span className="muted"> Smaller pictures send faster and fit mailbox limits.</span>
          </fieldset>
        </div>
        <div className="foot">
          {busy && <span className="progress-note">Preparing {Math.min(progress + 1, ids.length)} of {ids.length}...</span>}
          <button className="tbtn default" onClick={send} disabled={busy}>
            {via === "program" ? "Create Message" : "Save to Folder"}
          </button>
          <button className="tbtn" onClick={close} disabled={busy}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
