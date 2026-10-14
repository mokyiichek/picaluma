import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { api, PicasaScanlist, Root } from "../api";
import { useStore } from "../store";
import { FolderIcon } from "./Icons";

/** Tools › Folder Manager, also shown as the first-run welcome when no folders are watched. */
export default function FolderManager() {
  const openState = useStore((s) => s.folderManager);
  const setOpen = useStore((s) => s.setFolderManager);
  const [roots, setRoots] = useState<Root[]>([]);
  const [picasa, setPicasa] = useState<PicasaScanlist | null>(null);

  const refresh = () => api.listRoots().then(setRoots);
  useEffect(() => {
    if (!openState) return;
    refresh();
    api.picasaScanlist().then(setPicasa);
  }, [openState]);

  if (!openState) return null;

  const add = async (excluded: boolean) => {
    const dir = await open({ directory: true, multiple: true, title: excluded ? "Exclude folder from Picaluma" : "Watch folder for pictures" });
    if (!dir) return;
    for (const d of Array.isArray(dir) ? dir : [dir]) await api.addRoot(d, excluded);
    refresh();
  };

  const importPicasa = async () => {
    await api.importPicasa();
    refresh();
  };

  const watched = roots.filter((r) => !r.excluded);
  const excluded = roots.filter((r) => r.excluded);

  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <div className="modal">
        <h3>{watched.length ? "Folder Manager" : "Welcome to Picaluma"}</h3>
        <div className="body">
          {!watched.length && (
            <p style={{ marginTop: 0 }}>
              Picaluma finds the pictures on your computer and keeps them organised by folder. Your originals are never modified — edits are stored separately.
            </p>
          )}
          <div className="welcome-opts">
            {picasa?.found && (
              <button className="tbtn" onClick={importPicasa}>
                <FolderIcon size={18} /> Import my Picasa folder list ({picasa.include.length} watched, {picasa.exclude.length} excluded)
              </button>
            )}
            <button className="tbtn" onClick={() => add(false)}>
              <FolderIcon size={18} /> Watch a folder for pictures…
            </button>
            <button className="tbtn" onClick={() => add(true)}>
              <FolderIcon size={18} /> Exclude a folder…
            </button>
          </div>
          {roots.length > 0 && (
            <div className="roots">
              {[...watched, ...excluded].map((r) => (
                <div className="r" key={r.path}>
                  <FolderIcon />
                  <span className="p" title={r.path}>
                    {r.path}
                  </span>
                  <span className={`badge${r.excluded ? " x" : ""}`}>{r.excluded ? "Excluded" : "Scan always"}</span>
                  <button className="tbtn" onClick={() => api.removeRoot(r.path).then(refresh)}>
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="foot">
          <button className="tbtn" onClick={() => api.rescan()}>
            Rescan now
          </button>
          <button className="tbtn" onClick={() => setOpen(false)}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
