import { useEffect, useState } from "react";
import { api, Face } from "../api";
import { useStore } from "../store";
import { CloseIcon } from "./Icons";
import { FaceTile, PeopleNames, refreshPeople } from "./PeopleManager";

/** Faces in a picture, refreshed when the library changes. */
export function usePhotoFaces(photoId: number | null): Face[] {
  const snapshot = useStore((s) => s.snapshot);
  const [faces, setFaces] = useState<Face[]>([]);
  useEffect(() => {
    if (photoId == null) return setFaces([]);
    let live = true;
    api.facesInPhoto(photoId).then((f) => live && setFaces(f));
    return () => {
      live = false;
    };
  }, [photoId, snapshot]);
  return faces;
}

/** The People panel (tray's person button): who is in the selected picture, Picasa style. */
export default function PeoplePanel() {
  const view = useStore((s) => s.view);
  const editId = useStore((s) => s.editId);
  const selSet = useStore((s) => s.selected);
  const progress = useStore((s) => s.faceProgress);
  const photoId = view === "edit" ? editId : selSet.size === 1 ? [...selSet][0] : null;
  const faces = usePhotoFaces(photoId);
  const close = useStore((s) => s.togglePeople);

  const addManually = () => {
    const s = useStore.getState();
    if (photoId == null) return;
    if (s.view !== "edit") s.openEditor(photoId);
    s.setDrawFace(true);
  };

  return (
    <div className="props people-panel">
      <div className="props-head">
        People
        <button onClick={close} title="Close">
          <CloseIcon />
        </button>
      </div>
      <div className="tags-body">
        {photoId == null ? (
          <label>Select one picture to see the people in it.</label>
        ) : (
          <>
            <label>{faces.length ? `People in this picture (${faces.length}):` : "No faces found in this picture."}</label>
            {faces.map((f) => (
              <FaceRow key={f.id} face={f} />
            ))}
            <button className="tbtn add-person" onClick={addManually} title="Draw a box around a face Picaluma missed">
              Add a person manually
            </button>
          </>
        )}
        {progress.running && (
          <p className="muted small">
            Finding faces… {progress.done.toLocaleString()} of {progress.total.toLocaleString()} pictures
          </p>
        )}
      </div>
      <PeopleNames />
    </div>
  );
}

function FaceRow({ face }: { face: Face }) {
  const [name, setName] = useState("");
  const setHover = useStore((s) => s.setHoverFace);
  const run = async (fn: () => Promise<unknown>) => {
    await fn();
    await refreshPeople();
  };
  return (
    <div className="face-row" onMouseEnter={() => setHover(face)} onMouseLeave={() => setHover(null)}>
      <FaceTile face={face} size={48} />
      <div className="face-info">
        {face.state === 1 ? (
          <>
            <b>{face.name}</b>
            <button className="link" title="Remove this name tag" onClick={() => run(() => api.rejectFaces([face.id]))}>
              Remove name
            </button>
          </>
        ) : face.state === 2 ? (
          <>
            <span>Is this {face.name}?</span>
            <span>
              <button className="tbtn mini" title="Yes" onClick={() => run(() => api.confirmFaces([face.id]))}>
                ✔
              </button>
              <button className="tbtn mini" title="No" onClick={() => run(() => api.rejectFaces([face.id]))}>
                ✖
              </button>
            </span>
          </>
        ) : (
          <>
            <input
              list="people-names"
              placeholder="Add a name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && name.trim() && run(() => api.nameFaces([face.id], [], name))}
            />
            <button className="link" title="Hide this face from People" onClick={() => run(() => api.ignoreFaces([face.id]))}>
              Ignore
            </button>
          </>
        )}
      </div>
    </div>
  );
}
