import { useEffect, useRef, useState } from "react";
import { thumbUrl } from "../api";
import { plural } from "../format";
import { useStore } from "../store";
import { PicturesIcon } from "./Icons";

/** "Add to Album" — pick an existing album or name a new one for the waiting photos. */
export default function AlbumPicker() {
  const ids = useStore((s) => s.albumPicker);
  const albums = useStore((s) => s.snapshot?.albums ?? EMPTY);
  const close = () => useStore.getState().setAlbumPicker(null);
  const [name, setName] = useState("");
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!ids) return;
    setName("");
    // With no albums yet, go straight to naming a new one.
    if (!albums.length) setTimeout(() => input.current?.focus(), 30);
  }, [ids]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!ids) return null;
  const s = useStore.getState();
  const createNew = async () => {
    const n = name.trim();
    if (!n) return input.current?.focus();
    close();
    await s.createAlbum(n, ids);
  };
  const addTo = async (albumId: number) => {
    close();
    await s.addToAlbum(albumId, ids);
  };

  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && close()} onKeyDown={(e) => e.key === "Escape" && close()}>
      <div className="modal album-picker">
        <h3>Add {plural(ids.length, "picture")} to an album</h3>
        <div className="body">
          {albums.length > 0 && (
            <div className="album-list">
              {albums.map((a) => (
                <button key={a.id} className="album-choice" onClick={() => addTo(a.id)} title={`Add to "${a.name}"`}>
                  {a.photos[0] != null ? <img src={thumbUrl(a.photos[0])} alt="" /> : <PicturesIcon size={28} />}
                  <span className="n">{a.name}</span>
                  <span className="muted">{plural(a.photos.length, "picture")}</span>
                </button>
              ))}
            </div>
          )}
          <label className="new-album">
            New album:
            <input ref={input} value={name} placeholder="Album name" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && createNew()} />
            <button className="tbtn" onClick={createNew} disabled={!name.trim()}>
              Create
            </button>
          </label>
        </div>
        <div className="foot">
          <button className="tbtn" onClick={close}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

const EMPTY: never[] = [];
