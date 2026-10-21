import { useEffect, useState } from "react";
import { api, FileTypes } from "../api";
import { notify } from "../dialogs";
import { useStore } from "../store";

const TABS = ["General", "File Types", "Name Tags", "Slideshow", "Experimental"] as const;

const ALL_TYPES: FileTypes = { heif: true, avif: true, raw: true, psd: true, tga: true, videos: true };

/** Tools › Options › File Types, like Picasa's: which kinds of files Picaluma looks for. */
const TYPE_ROWS: [keyof FileTypes, string, string][] = [
  ["heif", "HEIC / HEIF", "iPhone, iPad and Mac photos (.heic, .heif)"],
  ["avif", "AVIF", "Modern web and phone photos (.avif)"],
  ["raw", "Camera RAW", "Canon, Nikon, Sony, Fujifilm, Olympus, Panasonic, Pentax, Leica, Adobe DNG and more"],
  ["psd", "Photoshop", "Photoshop documents (.psd)"],
  ["tga", "Targa", "Targa images (.tga)"],
  ["videos", "Movies", "MP4, MOV, AVI, MKV, WMV, MPEG, 3GP, AVCHD (.mts), WebM and more"],
];

/** Tools › Options. Mirrors Picasa's tabbed Options dialog; General holds Special effects. */
export default function OptionsDialog() {
  const open = useStore((s) => s.optionsOpen);
  const setOpen = useStore((s) => s.setOptionsOpen);
  const effects = useStore((s) => s.effects);
  const setEffects = useStore((s) => s.setEffects);
  const [tab, setTab] = useState<(typeof TABS)[number]>("General");
  const [draft, setDraft] = useState(effects);
  const [gpu, setGpu] = useState(false);
  const [gpuDraft, setGpuDraft] = useState(false);
  const [types, setTypes] = useState<FileTypes>(ALL_TYPES);
  const [typesDraft, setTypesDraft] = useState<FileTypes>(ALL_TYPES);
  const [faces, setFaces] = useState(true);
  const [facesDraft, setFacesDraft] = useState(true);
  const [importing, setImporting] = useState(false);
  useEffect(() => {
    if (!open) return;
    setDraft(useStore.getState().effects);
    api.getSettings().then((s) => {
      setGpu(s.hardwareAcceleration);
      setGpuDraft(s.hardwareAcceleration);
      const t = { ...ALL_TYPES, ...s.fileTypes };
      setTypes(t);
      setTypesDraft(t);
      setFaces(s.faceRecognition);
      setFacesDraft(s.faceRecognition);
    });
  }, [open]);

  if (!open) return null;
  const close = () => {
    setDraft(useStore.getState().effects);
    setOpen(false);
  };
  const apply = () => {
    setEffects(draft);
    if (gpuDraft !== gpu) {
      api.setHardwareAcceleration(gpuDraft).then(() => {
        setGpu(gpuDraft);
        notify("Restart Picaluma to apply the graphics setting.");
      });
    }
    if (facesDraft !== faces) api.setFaceRecognition(facesDraft).then(() => setFaces(facesDraft));
    if (TYPE_ROWS.some(([k]) => types[k] !== typesDraft[k])) {
      // Saving rescans: newly ticked types are found, unticked ones leave the library.
      api.setFileTypes(typesDraft).then(() => setTypes(typesDraft));
    }
  };

  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal options">
        <h3>Options</h3>
        <div className="opt-tabs">
          {TABS.map((t) => (
            <button key={t} className={`opt-tab${tab === t ? " active" : ""}`} onClick={() => setTab(t)}>
              {t}
            </button>
          ))}
        </div>
        <div className="body">
          {tab === "General" ? (
            <fieldset>
              <legend>Display</legend>
              <label className="opt-check">
                <input type="checkbox" checked={draft} onChange={(e) => setDraft(e.target.checked)} />
                <span>
                  <b>Special effects</b>
                  <br />
                  <span className="muted">
                    Animated transitions: smooth wheel scrolling, gliding folder-to-folder scrolling, zooming into and out of
                    photos, thumbnail resizing and panel slide-ins.
                  </span>
                </span>
              </label>
            </fieldset>
          ) : null}
          {tab === "General" && (
            <fieldset>
              <legend>Graphics</legend>
              <label className="opt-check">
                <input type="checkbox" checked={gpuDraft} onChange={(e) => setGpuDraft(e.target.checked)} />
                <span>
                  <b>Use the graphics card (hardware acceleration)</b>
                  <br />
                  <span className="muted">
                    Off by default, so Picaluma runs smoothly on older computers and small graphics cards. Turn it on only if
                    you have a recent graphics card. Takes effect after restarting Picaluma.
                  </span>
                </span>
              </label>
            </fieldset>
          )}
          {tab === "File Types" && (
            <fieldset>
              <legend>Look for these file types</legend>
              <label className="opt-check">
                <input type="checkbox" checked disabled />
                <span>
                  <b>JPEG, PNG, GIF, BMP, TIFF, WebP</b>
                  <br />
                  <span className="muted">Always included.</span>
                </span>
              </label>
              {TYPE_ROWS.map(([k, name, desc]) => (
                <label key={k} className="opt-check">
                  <input type="checkbox" checked={typesDraft[k]} onChange={(e) => setTypesDraft({ ...typesDraft, [k]: e.target.checked })} />
                  <span>
                    <b>{name}</b>
                    <br />
                    <span className="muted">{desc}</span>
                  </span>
                </label>
              ))}
              <p className="muted">
                HEIC, AVIF and movies use your computer's own codecs. On Windows, install the free HEIF and AV1 extensions from the
                Microsoft Store if their thumbnails stay blank.
              </p>
            </fieldset>
          )}
          {tab === "Name Tags" && (
            <fieldset>
              <legend>People</legend>
              <label className="opt-check">
                <input type="checkbox" checked={facesDraft} onChange={(e) => setFacesDraft(e.target.checked)} />
                <span>
                  <b>Enable face recognition</b>
                  <br />
                  <span className="muted">
                    Find faces in your pictures and group the ones that look alike, so you can name them once. It runs on this
                    computer in the background, after scanning — nothing is uploaded.
                  </span>
                </span>
              </label>
              <p>
                <button
                  className="tbtn"
                  disabled={importing}
                  onClick={async () => {
                    setImporting(true);
                    try {
                      const [people, tags] = await api.importPicasaFaces();
                      notify(tags ? `Imported ${tags.toLocaleString()} name tags for ${people.toLocaleString()} people from Picasa.` : "No new Picasa name tags were found in your folders.");
                      useStore.getState().loadSnapshot();
                    } finally {
                      setImporting(false);
                    }
                  }}
                >
                  {importing ? "Importing…" : "Import name tags from Picasa"}
                </button>
              </p>
              <p className="muted">Reads the names you gave in Picasa (saved in each folder's .picasa.ini). This happens once automatically.</p>
            </fieldset>
          )}
          {tab !== "General" && tab !== "File Types" && tab !== "Name Tags" && (
            <p className="muted">These settings will arrive in a later release.</p>
          )}
        </div>
        <div className="foot">
          <button
            className="tbtn"
            onClick={() => {
              apply();
              setOpen(false);
            }}
          >
            OK
          </button>
          <button className="tbtn" onClick={close}>
            Cancel
          </button>
          <button className="tbtn" onClick={apply}>
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
