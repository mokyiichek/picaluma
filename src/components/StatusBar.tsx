import { useStore, selectVisible, selectEditorSequence } from "../store";
import { fmtBytes, fmtDate, fmtDateTime, plural } from "../format";
import { usePhoto } from "./PropertiesPanel";

export default function StatusBar() {
  const view = useStore((s) => s.view);
  return <div className="statusbar">{view === "edit" ? <EditStatus /> : <LibraryStatus />}</div>;
}

function LibraryStatus() {
  const visible = useStore(selectVisible);
  const current = useStore((s) => s.currentFolderId);
  const selectedCount = useStore((s) => s.selected.size);
  const one = useStore((s) => (s.selected.size === 1 ? s.anchor : null));
  const photo = usePhoto(one);
  const vf = visible.find((v) => v.folder.id === current);

  if (photo) {
    return (
      <>
        <span>{photo.name}</span>
        <span>{fmtDateTime(photo.taken ?? photo.mtime)}</span>
        {photo.width > 0 && <span>{`${photo.width}x${photo.height} pixels`}</span>}
        <span>{fmtBytes(photo.size)}</span>
      </>
    );
  }
  if (!vf) return <span>&nbsp;</span>;
  const f = vf.folder;
  return (
    <>
      <span>{selectedCount > 1 ? `${plural(selectedCount, "picture")} selected` : plural(vf.photos.length, "picture")}</span>
      <span>
        {fmtDate(f.dateMin)}
        {f.dateMax && fmtDate(f.dateMax) !== fmtDate(f.dateMin) ? ` to ${fmtDate(f.dateMax)}` : ""}
      </span>
      <span>{fmtBytes(f.bytes)} on disk</span>
    </>
  );
}

function EditStatus() {
  const id = useStore((s) => s.editId);
  const seq = useStore(selectEditorSequence);
  const photo = usePhoto(id);
  if (!photo) return <span>&nbsp;</span>;
  return (
    <>
      <span>
        {photo.folderName} &gt; {photo.name}
      </span>
      <span>{fmtDateTime(photo.taken ?? photo.mtime)}</span>
      {photo.width > 0 && <span>{`${photo.width}x${photo.height} pixels`}</span>}
      <span>{fmtBytes(photo.size)}</span>
      <span>
        ({seq.indexOf(photo.id) + 1} of {seq.length})
      </span>
    </>
  );
}
