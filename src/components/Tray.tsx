import { thumbUrl } from "../api";
import { Edit } from "../effects";
import { emailPhotos, exportPhotos, printPhotos } from "../actions";
import { plural } from "../format";
import { selectVisible, useStore } from "../store";
import { ClearSelIcon, EmailIcon, ExportIcon, HoldIcon, InfoIcon, PersonIcon, PicturesIcon, PrintIcon, RotateIcon, StarIcon, TagIcon } from "./Icons";

export default function Tray() {
  const selected = useStore((s) => s.selected);
  const visible = useStore(selectVisible);
  const current = useStore((s) => s.currentFolderId);
  const view = useStore((s) => s.view);
  const thumbSize = useStore((s) => s.thumbSize);
  const setThumbSize = useStore((s) => s.setThumbSize);
  const toggleProps = useStore((s) => s.toggleProps);
  const showProps = useStore((s) => s.showProps);
  const sidePanel = useStore((s) => s.sidePanel);
  const toggleTags = useStore((s) => s.toggleTags);
  const clearSelection = useStore((s) => s.clearSelection);
  const toggleStar = useStore((s) => s.toggleStar);
  const allStarred = useStore((s) => s.selected.size > 0 && [...s.selected].every((id) => s.starred.has(id)));

  const folderPhotos = visible.find((v) => v.folder.id === current)?.photos ?? [];
  const ids = selected.size ? [...selected] : [];
  // Email / Print / Export act on the selection, or the whole folder when nothing is selected (as in Picasa).
  const targets = ids.length ? ids : folderPhotos;
  const stack = targets.slice(0, 3);
  const kind = current != null && current < 0 ? "Album" : "Folder";
  const label = ids.length ? `${plural(ids.length, "photo")} selected` : folderPhotos.length ? `${kind} Selected - ${plural(folderPhotos.length, "photo")}` : "";

  const rotate = (deg: number) => {
    const s = useStore.getState();
    for (const id of ids) {
      const list: Edit[] = [...(s.edits.get(id) ?? []), { op: "rotate", v: deg }];
      s.setPhotoEdits(id, list);
    }
  };

  return (
    <div className="tray">
      <div className="holding">
        <div className="stack">
          {stack.map((id, i) => (
            <img key={id} src={thumbUrl(id)} style={{ left: 4 + i * 6, top: 4 + i * 2, transform: `rotate(${(i - 1) * 6}deg)` }} alt="" />
          ))}
        </div>
        {label ? <span className="tag">{label}</span> : <span className="label">Selection</span>}
        <span className="label" />
      </div>
      <div className="side-btns">
        <button className="tbtn" title="Hold selected items in the tray (coming soon)" disabled>
          <HoldIcon />
        </button>
        <button className="tbtn" title="Clear selection" onClick={clearSelection} disabled={!ids.length}>
          <ClearSelIcon />
        </button>
        <button className="tbtn" title="Add selected pictures to an album" disabled={!ids.length} onClick={() => useStore.getState().setAlbumPicker(ids)}>
          <PicturesIcon size={14} />
        </button>
      </div>
      <div className="mid">
        <div className="row">
          <button className={`tbtn icon${allStarred ? " pressed" : ""}`} title="Star / unstar" disabled={!ids.length} onClick={() => toggleStar(ids)}>
            <StarIcon filled={allStarred} />
          </button>
          <button className="tbtn icon" title="Rotate counterclockwise" disabled={!ids.length} onClick={() => rotate(-90)}>
            <RotateIcon dir="left" />
          </button>
          <button className="tbtn icon" title="Rotate clockwise" disabled={!ids.length} onClick={() => rotate(90)}>
            <RotateIcon dir="right" />
          </button>
        </div>
        <div className="row">
          <button className="tray-action" disabled={!targets.length} title={`E-mail ${plural(targets.length, "picture")}`} onClick={() => emailPhotos(targets)}>
            <EmailIcon />
            Email
          </button>
          <button className="tray-action" disabled={!targets.length} title={`Print ${plural(targets.length, "picture")}`} onClick={() => printPhotos(targets)}>
            <PrintIcon />
            Print
          </button>
          <button className="tray-action" disabled={!targets.length} title={`Export ${plural(targets.length, "picture")} with edits applied`} onClick={() => exportPhotos(targets)}>
            <ExportIcon />
            Export
          </button>
        </div>
      </div>
      <div className="right">
        {view === "library" && (
          <span style={{ display: "flex", alignItems: "center", gap: 6 }} title="Thumbnail size">
            <PicturesIcon size={16} />
            <input className="slider" type="range" min={70} max={330} value={thumbSize} onChange={(e) => setThumbSize(Number(e.target.value))} />
          </span>
        )}
        <span className="tgroup">
          <button className="tbtn icon" disabled title="People (coming soon)">
            <PersonIcon size={16} />
          </button>
          <button className={`tbtn icon${showProps && sidePanel === "tags" ? " pressed" : ""}`} title="Tags (Ctrl+T)" onClick={toggleTags}>
            <TagIcon size={16} />
          </button>
          <button className={`tbtn icon${showProps && sidePanel === "props" ? " pressed" : ""}`} title="Properties (Alt+Enter)" onClick={toggleProps}>
            <InfoIcon size={16} />
          </button>
        </span>
      </div>
    </div>
  );
}
