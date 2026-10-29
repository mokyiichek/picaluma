import { useEffect, useState } from "react";
import { api, Photo, thumbUrl } from "../api";
import { fmtBytes, fmtDateTime } from "../format";
import { useStore } from "../store";
import { CloseIcon } from "./Icons";

export function usePhoto(id: number | null): Photo | null {
  const [photo, setPhoto] = useState<Photo | null>(null);
  // Fetched again when the library changes (an adjusted date, a rename, a Save).
  const snapshot = useStore((s) => s.snapshot);
  useEffect(() => {
    if (id == null) {
      setPhoto(null);
      return;
    }
    let live = true;
    api.getPhoto(id).then((p) => live && setPhoto(p)).catch(() => live && setPhoto(null));
    return () => {
      live = false;
    };
  }, [id, snapshot]);
  return photo;
}

export default function PropertiesPanel() {
  const toggleProps = useStore((s) => s.toggleProps);
  const id = useStore((s) => (s.view === "edit" ? s.editId : s.selected.size === 1 ? s.anchor : null));
  const photo = usePhoto(id);

  return (
    <div className="props">
      <div className="props-head">
        Properties
        <button onClick={toggleProps} title="Close">
          <CloseIcon />
        </button>
      </div>
      {photo ? (
        <>
          <div className="props-thumb">
            <img src={thumbUrl(photo.id)} alt="" draggable={false} onError={(e) => (e.currentTarget.style.visibility = "hidden")} />
          </div>
          <div className="props-title">Properties of {photo.name}:</div>
          <div className="props-list">
            <Prop k="Location" v={photo.path} />
            <Prop k="File Size" v={fmtBytes(photo.size)} />
            {photo.width > 0 && <Prop k="Dimensions" v={`${photo.width} x ${photo.height} pixels`} />}
            {photo.dateAdjusted && photo.taken != null && <Prop k="Adjusted Date" v={fmtDateTime(photo.taken)} />}
            {photo.exif.map(([k, v]) => (
              <Prop key={k} k={k} v={v} />
            ))}
            <Prop k="File Date" v={fmtDateTime(photo.mtime)} />
            {photo.caption && <Prop k="Caption" v={photo.caption} />}
          </div>
        </>
      ) : (
        <div className="props-title" style={{ fontWeight: 400 }}>
          Select an item to show the properties.
        </div>
      )}
    </div>
  );
}

function Prop({ k, v }: { k: string; v: string }) {
  return (
    <div className="prop">
      <div className="k">{k}</div>
      <div className="v">{v}</div>
    </div>
  );
}
