import { invoke } from "@tauri-apps/api/core";

export interface Folder {
  id: number;
  name: string;
  path: string;
  description: string;
  dateMin: number;
  dateMax: number;
  updated: number;
  bytes: number;
  /** Sort Folder By: "" (date taken), "modified", "name" or "size". */
  sort: string;
  /** Sort Folder By › Reverse order. */
  reverse?: boolean;
  /** Folder Properties: date set by hand (dateMin/dateMax hold it), place taken, slideshow music. */
  dateSet?: boolean;
  place?: string;
  music?: string;
  photos: number[];
}

export interface Album {
  id: number;
  name: string;
  description: string;
  created: number;
  /** Sort Album By: "" (as arranged), "date", "modified", "name" or "size". */
  sort: string;
  reverse?: boolean;
  photos: number[];
}

/** Projects: a collage or movie that was made, with the pictures and options it used. */
export interface Project {
  id: number;
  kind: "collage" | "movie";
  name: string;
  created: number;
  output: string;
  photos: number[];
  settings: string;
}

/** A person album (People). */
export interface Person {
  id: number;
  name: string;
  /** Face shown as the person's picture. */
  cover: number | null;
  photos: number[];
  /** Faces waiting for "Is this …?" confirmation. */
  suggestions: number;
}

/** A face, as fractions of the upright picture. State: 0 unnamed, 1 named, 2 suggested. */
export interface Face {
  id: number;
  photoId: number;
  x: number;
  y: number;
  w: number;
  h: number;
  personId: number | null;
  name: string | null;
  state: number;
}

export interface FaceGroup {
  group: number;
  count: number;
  faces: Face[];
}

export interface FaceProgress {
  running: boolean;
  done: number;
  total: number;
}

/** The People face models: downloaded once, with the user's permission. */
export interface FaceModels {
  ready: boolean;
  downloading: boolean;
  received: number;
  total: number;
  error: string | null;
}

export interface Snapshot {
  folders: Folder[];
  albums: Album[];
  starred: number[];
  geotagged: number[];
  edits: [number, string][];
  totalPhotos: number;
  libraryId: string;
  videos: number[];
  hidden: number[];
  recent: number[];
  projects: Project[];
  people: Person[];
  /** Photos with faces (Faces filter). */
  faced: number[];
  unnamed: number;
}

export interface Photo {
  id: number;
  folderId: number;
  folderName: string;
  path: string;
  name: string;
  size: number;
  mtime: number;
  taken: number | null;
  width: number;
  height: number;
  exif: [string, string][];
  caption: string;
  starred: boolean;
  edits: string;
  /** Tools › Adjust Date and Time moved its date. */
  dateAdjusted: boolean;
}

export interface LibraryStats {
  pictures: number;
  videos: number;
  bytes: number;
  folders: number;
  starred: number;
  edited: number;
  hidden: number;
  geotagged: number;
  people: number;
  namedFaces: number;
  first: number;
  last: number;
  years: [number, number][];
  cameras: [string, number][];
  types: [string, number, number][];
}

export interface LibraryInfo {
  folder: string;
  databaseBytes: number;
  thumbBytes: number;
  thumbFiles: number;
}

export interface BackupPlan {
  files: number;
  bytes: number;
  newFiles: number;
  newBytes: number;
  cloud: number;
}

export interface Root {
  path: string;
  excluded: boolean;
  /** Folder Manager: Scan Always, Scan Once or Remove from Picaluma. */
  mode: "always" | "once" | "excluded";
}

export interface DirEntry {
  name: string;
  path: string;
  hasChildren: boolean;
}

export interface ScanProgress {
  scanning: boolean;
  /** "listing" | "indexing" | "" */
  phase: string;
  foldersSeen: number;
  photosFound: number;
  indexed: number;
  toIndex: number;
  current: string;
}

export interface PicasaScanlist {
  found: boolean;
  include: string[];
  exclude: string[];
}

// Custom URI schemes: Windows WebView2 exposes them as http://<scheme>.localhost/.
const isWindows = navigator.userAgent.includes("Windows");
const schemeBase = (scheme: string) => (isWindows ? `http://${scheme}.localhost/` : `${scheme}://localhost/`);
const THUMB = schemeBase("thumb");
const PHOTO = schemeBase("photo");
const FACE = schemeBase("face");

// Library id in the URL keeps the webview's HTTP cache from mixing up ids across libraries.
let libraryTag = "";
export const setLibraryTag = (id: string) => (libraryTag = id);
// Pictures rewritten by Save / Undo Save get a new version, so the cached image isn't reused.
const VERSIONS_KEY = "picaluma.photoVersions";
const versions: Record<number, number> = (() => {
  try {
    return JSON.parse(localStorage.getItem(VERSIONS_KEY) ?? "{}");
  } catch {
    return {};
  }
})();
export function bumpPhoto(id: number) {
  versions[id] = Date.now();
  try {
    localStorage.setItem(VERSIONS_KEY, JSON.stringify(versions));
  } catch {
    /* ignore */
  }
}
const ver = (id: number) => (versions[id] ? `&v=${versions[id]}` : "");
/** Changes when Save / Undo Save rewrites the picture (its shape may have changed). */
export const photoVersion = (id: number) => versions[id] ?? 0;
export const thumbUrl = (id: number) => `${THUMB}${id}?l=${libraryTag}${ver(id)}`;
export const photoUrl = (id: number) => `${PHOTO}${id}?l=${libraryTag}${ver(id)}`;
export const faceUrl = (id: number) => `${FACE}${id}?l=${libraryTag}`;
/** A folder's slideshow music (Folder Properties). */
export const musicUrl = (folderId: number) => `${PHOTO}music/${folderId}?l=${libraryTag}&t=${Date.now()}`;
/** Thumbnail of a file being imported (not in the library yet). */
export const importThumbUrl = (path: string) => `${THUMB}file?p=${encodeURIComponent(path)}`;

export interface ImportSource {
  path: string;
  label: string;
}

export interface ImportItem {
  path: string;
  name: string;
  size: number;
  date: number;
  duplicate: boolean;
  video: boolean;
}

export const api = {
  snapshot: () => invoke<Snapshot>("library_snapshot"),
  listRoots: () => invoke<Root[]>("list_roots"),
  addRoot: (path: string, excluded = false) => invoke<void>("add_root", { path, excluded }),
  removeRoot: (path: string) => invoke<void>("remove_root", { path }),
  listDirs: (path: string | null) => invoke<DirEntry[]>("list_dirs", { path }),
  applyFolderManager: (changes: [string, string][]) => invoke<void>("apply_folder_manager", { changes }),
  rescan: () => invoke<void>("rescan"),
  scanStatus: () => invoke<ScanProgress>("scan_status"),
  picasaScanlist: () => invoke<PicasaScanlist>("picasa_scanlist"),
  importPicasa: () => invoke<number>("import_picasa_scanlist"),
  search: (query: string) => invoke<{ ids: number[]; seconds: number }>("search", { query }),
  getPhoto: (id: number) => invoke<Photo>("get_photo", { id }),
  /** Tools menu jobs (tools.rs); progress arrives as "tool-progress" events. */
  cancelTool: () => invoke<void>("cancel_tool"),
  findSimilar: () => invoke<number[][]>("find_similar"),
  libraryStats: () => invoke<LibraryStats>("library_stats"),
  libraryInfo: () => invoke<LibraryInfo>("library_info"),
  clearThumbnailCache: () => invoke<number>("clear_thumbnail_cache"),
  compactLibrary: () => invoke<void>("compact_library"),
  setMinFileKb: (kb: number) => invoke<void>("set_min_file_kb", { kb }),
  findDuplicates: () => invoke<number[][]>("find_duplicates"),
  adjustDates: (ids: number[], delta: number, reset: boolean) => invoke<void>("adjust_dates", { ids, delta, reset }),
  backupPlan: (folders: number[], dest: string) => invoke<BackupPlan>("backup_plan", { folders, dest }),
  backupRun: (folders: number[], dest: string) => invoke<{ copied: number; bytes: number; failed: string[] }>("backup_run", { folders, dest }),
  setStar: (ids: number[], starred: boolean) => invoke<void>("set_star", { ids, starred }),
  setCaption: (id: number, caption: string) => invoke<void>("set_caption", { id, caption }),
  setFolderDescription: (id: number, description: string) =>
    invoke<void>("set_folder_description", { id, description }),
  setEdits: (id: number, edits: string) => invoke<void>("set_edits", { id, edits }),
  /** File › Save: the edited picture replaces the original (kept in .picalumaoriginals). */
  savePicture: (id: number, dataBase64: string) => invoke<void>("save_picture", { id, dataBase64 }),
  undoSave: (id: number) => invoke<string>("undo_save_picture", { id }),
  savedOriginals: (ids: number[]) => invoke<number[]>("saved_originals", { ids }),
  /** Writes a JPEG (never overwriting) and returns the path actually used. */
  /** `source`: the picture it was made from, whose camera details are kept (GPS left out with `stripGps`). */
  exportPicture: (path: string, dataBase64: string, source?: string, stripGps?: boolean) => invoke<string>("export_picture", { path, dataBase64, source, stripGps }),
  makeExportDir: (location: string, name: string) => invoke<string>("make_export_dir", { location, name }),
  copyInto: (src: string, dir: string, stripGps?: boolean) => invoke<string>("copy_into", { src, dir, stripGps }),
  emailDir: () => invoke<string>("email_dir"),
  emailFiles: (paths: string[], subject: string) => invoke<void>("email_files", { paths, subject }),
  printWindow: () => invoke<void>("print_window"),
  writeTextFile: (path: string, text: string) => invoke<void>("write_text_file", { path, text }),
  setWallpaper: (dataBase64: string) => invoke<void>("set_wallpaper", { dataBase64 }),
  renamePhoto: (id: number, name: string) => invoke<string>("rename_photo", { id, name }),
  removeEmptyFolder: (path: string) => invoke<void>("remove_empty_folder", { path }),
  prioritizeFolder: (id: number) => invoke<void>("prioritize_folder", { id }),
  getSettings: () =>
    invoke<{ hardwareAcceleration: boolean; fileTypes: FileTypes; faceRecognition: boolean; faceModelsDeclined: boolean; minFileKb: number }>("get_settings"),
  faceModelsStatus: () => invoke<FaceModels>("face_models_status"),
  downloadFaceModels: () => invoke<void>("download_face_models"),
  setFaceModelsDeclined: (declined: boolean) => invoke<void>("set_face_models_declined", { declined }),
  setFaceRecognition: (on: boolean) => invoke<void>("set_face_recognition", { on }),
  facesInPhoto: (photoId: number) => invoke<Face[]>("faces_in_photo", { photoId }),
  personFaces: (personId: number, suggested: boolean) => invoke<Face[]>("person_faces", { personId, suggested }),
  unnamedGroups: (offset: number, limit: number) => invoke<FaceGroup[]>("unnamed_groups", { offset, limit }),
  nameFaces: (faces: number[], groups: number[], name: string) => invoke<number>("name_faces", { faces, groups, name }),
  confirmFaces: (faces: number[]) => invoke<void>("confirm_faces", { faces }),
  rejectFaces: (faces: number[]) => invoke<void>("reject_faces", { faces }),
  ignoreFaces: (faces: number[], ignore = true) => invoke<void>("ignore_faces", { faces, ignore }),
  renamePerson: (id: number, name: string) => invoke<number>("rename_person", { id, name }),
  deletePerson: (id: number) => invoke<void>("delete_person", { id }),
  setPersonCover: (id: number, face: number) => invoke<void>("set_person_cover", { id, face }),
  addFace: (photoId: number, r: { x: number; y: number; w: number; h: number }, name: string | null) =>
    invoke<number>("add_face", { photoId, rect: r, name }),
  resetFaces: (ids: number[]) => invoke<void>("reset_faces", { ids }),
  faceProgress: () => invoke<FaceProgress>("face_progress"),
  importPicasaFaces: () => invoke<[number, number]>("import_picasa_faces"),
  setFileTypes: (types: FileTypes) => invoke<void>("set_file_types", { types }),
  /** Folder or album (negative id) sort order. */
  setSort: (id: number, sort: string, reverse = false) => invoke<void>("set_sort", { id, sort, reverse }),
  addProject: (kind: string, name: string, output: string, photos: number[], settings: object) =>
    invoke<number>("add_project", { kind, name, output, photos, settings: JSON.stringify(settings) }),
  updateProject: (id: number, patch: { name?: string; delete?: boolean }) => invoke<void>("update_project", { id, name: patch.name ?? null, delete: patch.delete ?? null }),
  photoLabels: (ids: number[], kind: string) => invoke<[number, string][]>("photo_labels", { ids, kind }),
  allowMedia: (path: string) => invoke<void>("allow_media", { path }),
  setFolderProps: (id: number, date: number, place: string, music: string) => invoke<void>("set_folder_props", { id, date, place, music }),
  importSources: () => invoke<ImportSource[]>("import_sources"),
  scanImport: (path: string) => invoke<ImportItem[]>("scan_import", { path }),
  importDefaultDest: () => invoke<string>("import_default_dest"),
  importFiles: (files: string[], dest: string, folder: string, deleteAfter: boolean) =>
    invoke<{ folder: string; copied: number; failed: string[]; deleted: number }>("import_files", { files, dest, folder, deleteAfter }),
  places: (ids: number[] | null) => invoke<[number, number, number][]>("places", { ids }),
  setHidden: (ids: number[], hidden: boolean) => invoke<void>("set_hidden", { ids, hidden }),
  photosSince: (since: number) => invoke<{ ids: number[]; exclude: boolean }>("photos_since", { since }),
  setHardwareAcceleration: (on: boolean) => invoke<void>("set_hardware_acceleration", { on }),
  setTags: (ids: number[], add: string[], remove: string[]) => invoke<void>("set_tags", { ids, add, remove }),
  getTags: (ids: number[]) => invoke<TagCount[]>("get_tags", { ids }),
  suggest: (prefix: string) => invoke<TagCount[]>("suggest", { prefix }),
  openInDefaultApp: (path: string) => invoke<void>("open_in_default_app", { path }),
  excludeFolder: (path: string) => invoke<void>("exclude_folder", { path }),
  createAlbum: (name: string, ids: number[]) => invoke<number>("create_album", { name, ids }),
  albumAdd: (id: number, ids: number[]) => invoke<void>("album_add", { id, ids }),
  albumRemove: (id: number, ids: number[]) => invoke<void>("album_remove", { id, ids }),
  updateAlbum: (id: number, patch: { name?: string; description?: string }) =>
    invoke<void>("update_album", { id, name: patch.name ?? null, description: patch.description ?? null }),
  deleteAlbum: (id: number) => invoke<void>("delete_album", { id }),
  deletePhotos: (ids: number[], permanent = false) => invoke<OpResult>("delete_photos", { ids, permanent }),
  transferPhotos: (ids: number[], dest: string, copy: boolean) => invoke<OpResult>("transfer_photos", { ids, dest, copy }),
  renameFolder: (id: number, name: string) => invoke<string>("rename_folder", { id, name }),
  moveFolder: (id: number, destParent: string) => invoke<string>("move_folder", { id, destParent }),
  deleteFolder: (id: number) => invoke<void>("delete_folder", { id }),
};

/** Tools › Options › File Types: optional formats (JPEG, PNG, GIF, BMP, TIFF, WebP are always on). */
export interface FileTypes {
  heif: boolean;
  avif: boolean;
  raw: boolean;
  psd: boolean;
  tga: boolean;
  videos: boolean;
}

export interface OpResult {
  done: number;
  failed: string[];
  /** Folders the operation left empty on disk. */
  emptyFolders?: string[];
}

export interface TagCount {
  tag: string;
  count: number;
}

/** Debug helper: forwards a message to the Rust log. */
export const uiLog = (message: string) => void invoke("ui_log", { message }).catch(() => {});
