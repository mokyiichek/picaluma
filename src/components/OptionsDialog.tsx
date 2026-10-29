import { useEffect, useState } from "react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { api, FileTypes, LibraryInfo } from "../api";
import { confirmAsk, notify, NO_CONFIRM_DELETE, NO_CONFIRM_REMOVE } from "../dialogs";
import { fmtMB, offerFaceModels } from "../faceModels";
import { fmtBytes } from "../format";
import { getPref, reopenLastFolder, setPref, setReopenLastFolder, setStripGps, stripGps } from "../prefs";
import { loadSlideshowOpts, saveSlideshowOpts, SlideshowOpts } from "../slideshowOpts";
import { useStore } from "../store";

const TABS = ["General", "E-mail", "Export", "Slideshow", "File Types", "Name Tags", "Privacy", "Library"] as const;
type Tab = (typeof TABS)[number];

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

const EMAIL_SIZES = [
  ["Small (640 pixels)", 640],
  ["Medium (1024 pixels)", 1024],
  ["Large (1600 pixels)", 1600],
  ["Original size", 0],
] as const;
const MIN_SIZES = [
  ["Keep every picture", 0],
  ["Smaller than 10 KB (icons)", 10],
  ["Smaller than 30 KB", 30],
  ["Smaller than 100 KB (web thumbnails)", 100],
] as const;
const QUALITIES = ["Automatic", "Maximum", "Normal", "Minimum"] as const;

interface ExportCfg {
  resize: boolean;
  edge: number;
  quality: string;
}
const readExport = (): ExportCfg => {
  try {
    return { resize: false, edge: 1600, quality: "Automatic", ...JSON.parse(getPref("export") ?? "{}") };
  } catch {
    return { resize: false, edge: 1600, quality: "Automatic" };
  }
};

/** Tools › Options: Picasa's tabbed Options, plus the settings Picasa never had (Privacy, Library). */
export default function OptionsDialog() {
  const open = useStore((s) => s.optionsOpen);
  const setOpen = useStore((s) => s.setOptionsOpen);
  const setEffects = useStore((s) => s.setEffects);
  const [tab, setTab] = useState<Tab>("General");
  const [draft, setDraft] = useState(true);
  const [gpu, setGpu] = useState(false);
  const [gpuDraft, setGpuDraft] = useState(false);
  const [reopen, setReopen] = useState(true);
  const [types, setTypes] = useState<FileTypes>(ALL_TYPES);
  const [typesDraft, setTypesDraft] = useState<FileTypes>(ALL_TYPES);
  const [minKb, setMinKb] = useState(0);
  const [minKbDraft, setMinKbDraft] = useState(0);
  const [faces, setFaces] = useState(true);
  const [facesDraft, setFacesDraft] = useState(true);
  const [importing, setImporting] = useState(false);
  const [show, setShow] = useState<SlideshowOpts>(loadSlideshowOpts);
  const [emailVia, setEmailVia] = useState("program");
  const [emailEdge, setEmailEdge] = useState(1024);
  const [exp, setExp] = useState<ExportCfg>(readExport);
  const [gps, setGps] = useState(false);
  useEffect(() => {
    if (!open) return;
    setDraft(useStore.getState().effects);
    setShow(loadSlideshowOpts());
    setReopen(reopenLastFolder());
    setEmailVia(getPref("emailVia") ?? "program");
    setEmailEdge(Number(getPref("emailEdge") ?? 1024));
    setExp(readExport());
    setGps(stripGps());
    api.getSettings().then((s) => {
      setGpu(s.hardwareAcceleration);
      setGpuDraft(s.hardwareAcceleration);
      const t = { ...ALL_TYPES, ...s.fileTypes };
      setTypes(t);
      setTypesDraft(t);
      setMinKb(s.minFileKb ?? 0);
      setMinKbDraft(s.minFileKb ?? 0);
      setFaces(s.faceRecognition);
      setFacesDraft(s.faceRecognition);
    });
  }, [open]);

  if (!open) return null;
  const close = () => setOpen(false);
  const apply = () => {
    setEffects(draft);
    if (gpuDraft !== gpu) {
      api.setHardwareAcceleration(gpuDraft).then(() => {
        setGpu(gpuDraft);
        notify("Restart Picaluma to apply the graphics setting.");
      });
    }
    setReopenLastFolder(reopen);
    saveSlideshowOpts(show);
    setPref("emailVia", emailVia);
    setPref("emailEdge", String(emailEdge));
    setPref("export", JSON.stringify({ ...JSON.parse(getPref("export") ?? "{}"), ...exp }));
    setStripGps(gps);
    if (facesDraft !== faces) api.setFaceRecognition(facesDraft).then(() => setFaces(facesDraft));
    if (TYPE_ROWS.some(([k]) => types[k] !== typesDraft[k])) {
      // Saving rescans: newly ticked types are found, unticked ones leave the library.
      api.setFileTypes(typesDraft).then(() => setTypes(typesDraft));
    }
    if (minKbDraft !== minKb) api.setMinFileKb(minKbDraft).then(() => setMinKb(minKbDraft));
  };

  const check = (on: boolean, set: (v: boolean) => void, title: string, note?: string) => (
    <label className="opt-check">
      <input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} />
      <span>
        <b>{title}</b>
        {note && (
          <>
            <br />
            <span className="muted">{note}</span>
          </>
        )}
      </span>
    </label>
  );

  // Every page is laid out in the same spot and only the current one shows, so the dialog keeps
  // the size of the tallest page instead of jumping between tabs.
  const page = (name: (typeof TABS)[number]) => `opt-page${tab === name ? "" : " off"}`;

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
          <div className={page("General")}>
            <>
              <fieldset>
                <legend>Display</legend>
                {check(
                  draft,
                  setDraft,
                  "Special effects",
                  "Animated transitions: smooth wheel scrolling, gliding folder-to-folder scrolling, zooming into and out of photos, thumbnail resizing and panel slide-ins.",
                )}
                {check(reopen, setReopen, "Open the last folder you looked at", "When Picaluma starts, it goes back to where you were.")}
              </fieldset>
              <fieldset>
                <legend>Graphics</legend>
                {check(
                  gpuDraft,
                  setGpuDraft,
                  "Use the graphics card (hardware acceleration)",
                  "Off by default, so Picaluma runs smoothly on older computers and small graphics cards. Turn it on only if you have a recent graphics card. Takes effect after restarting Picaluma.",
                )}
              </fieldset>
              <fieldset>
                <legend>Messages</legend>
                <p className="opt-row">
                  <span className="muted">Show again the questions you answered with "Don't ask again".</span>
                  <button
                    className="tbtn"
                    onClick={() => {
                      [NO_CONFIRM_DELETE, NO_CONFIRM_REMOVE].forEach((k) => setPref(k, "0"));
                      notify("Picaluma will ask again before deleting and removing pictures.");
                    }}
                  >
                    Reset
                  </button>
                </p>
              </fieldset>
            </>
          </div>
          <div className={page("E-mail")}>
            <fieldset>
              <legend>E-mail</legend>
              <label className="opt-radio">
                <input type="radio" checked={emailVia === "program"} onChange={() => setEmailVia("program")} /> Use my e-mail program
              </label>
              <label className="opt-radio">
                <input type="radio" checked={emailVia === "folder"} onChange={() => setEmailVia("folder")} /> Save the pictures to a folder (for Gmail and other web mail)
              </label>
              <label className="opt-row">
                Picture size
                <select value={emailEdge} onChange={(e) => setEmailEdge(Number(e.target.value))}>
                  {EMAIL_SIZES.map(([label, edge]) => (
                    <option key={edge} value={edge}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <p className="muted">These are the starting choices in File › E-Mail; you can still change them each time.</p>
            </fieldset>
          </div>
          <div className={page("Export")}>
            <fieldset>
              <legend>Export Picture to Folder</legend>
              <label className="opt-radio">
                <input type="radio" checked={!exp.resize} onChange={() => setExp({ ...exp, resize: false })} /> Use original size
              </label>
              <label className="opt-radio">
                <input type="radio" checked={exp.resize} onChange={() => setExp({ ...exp, resize: true })} /> Resize to
                <input type="number" className="opt-num" min={200} max={8000} step={100} value={exp.edge} onChange={(e) => setExp({ ...exp, edge: Number(e.target.value) || 1600, resize: true })} /> pixels
              </label>
              <label className="opt-row">
                Image quality
                <select value={exp.quality} onChange={(e) => setExp({ ...exp, quality: e.target.value })}>
                  {QUALITIES.map((q) => (
                    <option key={q}>{q}</option>
                  ))}
                  {exp.quality === "Custom" && <option>Custom</option>}
                </select>
              </label>
              <p className="muted">Exported and saved pictures keep their camera details (date taken, camera, exposure).</p>
            </fieldset>
          </div>
          <div className={page("Slideshow")}>
            <fieldset>
              <legend>Slideshow</legend>
              <label className="opt-row">
                Display each picture for
                <input type="range" className="slider" min={1} max={15} step={0.5} value={show.seconds} onChange={(e) => setShow({ ...show, seconds: Number(e.target.value) })} />
                <b>{show.seconds} s</b>
              </label>
              <label className="opt-row">
                Transition
                <select value={show.transition} onChange={(e) => setShow({ ...show, transition: e.target.value as SlideshowOpts["transition"] })}>
                  <option value="fade">Cross fade</option>
                  <option value="zoom">Pan and zoom</option>
                  <option value="none">None</option>
                </select>
              </label>
              {check(show.captions, (v) => setShow({ ...show, captions: v }), "Show captions")}
              {check(show.loop, (v) => setShow({ ...show, loop: v }), "Repeat (start again after the last picture)")}
              {check(show.shuffle, (v) => setShow({ ...show, shuffle: v }), "Shuffle (play the pictures in random order)")}
            </fieldset>
          </div>
          <div className={page("File Types")}>
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
              <label className="opt-row">
                Skip pictures
                <select value={minKbDraft} onChange={(e) => setMinKbDraft(Number(e.target.value))}>
                  {MIN_SIZES.map(([label, kb]) => (
                    <option key={kb} value={kb}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <p className="muted">
                HEIC, AVIF and movies use your computer's own codecs. On Windows, install the free HEIF and AV1 extensions from the
                Microsoft Store if their thumbnails stay blank.
              </p>
            </fieldset>
          </div>
          <div className={page("Name Tags")}>
            <fieldset>
              <legend>People</legend>
              {check(
                facesDraft,
                setFacesDraft,
                "Enable face recognition",
                "Find faces in your pictures and group the ones that look alike, so you can name them once. It runs on this computer in the background, after scanning — nothing is uploaded.",
              )}
              <ModelsLine />
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
          </div>
          <div className={page("Privacy")}>
            <fieldset>
              <legend>Privacy</legend>
              {check(
                gps,
                setGps,
                "Leave out where pictures were taken",
                "Exported and e-mailed pictures don't carry the GPS position, so the people you send them to can't see where they were taken. Your own pictures keep it.",
              )}
              <p className="muted">Picaluma never uploads anything: pictures, faces and places stay on this computer.</p>
            </fieldset>
          </div>
          <div className={page("Library")}>
            <LibraryTab />
          </div>
        </div>
        <div className="foot">
          <button
            className="tbtn default"
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

/** Options › Library: where the library lives, how much room it takes, and upkeep. */
function LibraryTab() {
  const [info, setInfo] = useState<LibraryInfo | null>(null);
  const [busy, setBusy] = useState("");
  const load = () => api.libraryInfo().then(setInfo);
  useEffect(() => void load(), []);
  const run = async (what: string, job: () => Promise<unknown>) => {
    setBusy(what);
    try {
      await job();
    } catch (e) {
      notify(String(e), "error");
    } finally {
      setBusy("");
      load();
    }
  };
  return (
    <fieldset>
      <legend>Library</legend>
      <p className="opt-row">
        <span className="opt-path" title={info?.folder}>
          {info?.folder ?? "…"}
        </span>
        <button className="tbtn" disabled={!info} onClick={() => info && revealItemInDir(`${info.folder}${info.folder.includes("\\") ? "\\" : "/"}library.db`).catch(() => {})}>
          Show
        </button>
      </p>
      <p className="muted">Your pictures stay where they are; this folder holds only Picaluma's index and thumbnails.</p>
      <div className="opt-lib">
        <span>Library index</span>
        <span>{info ? fmtBytes(info.databaseBytes) : "…"}</span>
        <button className="tbtn" disabled={!!busy} onClick={() => run("compact", () => api.compactLibrary())}>
          {busy === "compact" ? "Compacting…" : "Compact"}
        </button>
        <span>Thumbnails</span>
        <span>{info ? `${fmtBytes(info.thumbBytes)} (${info.thumbFiles.toLocaleString()})` : "…"}</span>
        <button
          className="tbtn"
          disabled={!!busy}
          onClick={async () => {
            if (await confirmAsk("Delete the saved thumbnails to free disk space?\n\nThey are made again as pictures come into view, which takes a while for a large library.", { title: "Clear Thumbnails", ok: "Clear" }))
              run("clear", () => api.clearThumbnailCache());
          }}
        >
          {busy === "clear" ? "Clearing…" : "Clear"}
        </button>
        <span>Folders</span>
        <span className="muted">Look again for new and changed pictures</span>
        <button className="tbtn" disabled={!!busy} onClick={() => api.rescan()}>
          Rescan
        </button>
      </div>
    </fieldset>
  );
}

/** Options › Name Tags: whether the face models are here, with a Download button. */
function ModelsLine() {
  const m = useStore((s) => s.faceModels);
  if (!m) return null;
  if (m.ready) return <p className="muted">Face models: installed.</p>;
  if (m.downloading) return <p className="muted">Downloading face models… {fmtMB(m.received)} of {fmtMB(m.total)} MB</p>;
  return (
    <p>
      <span className="muted">Face models: not downloaded yet ({fmtMB(m.total)} MB, once). </span>
      <button className="tbtn" onClick={() => offerFaceModels()}>
        Download…
      </button>
    </p>
  );
}
