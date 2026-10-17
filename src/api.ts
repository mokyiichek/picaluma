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
  photos: number[];
}

export interface Album {
  id: number;
  name: string;
  description: string;
  created: number;
  photos: number[];
}

export interface Snapshot {
  folders: Folder[];
  albums: Album[];
  starred: number[];
  geotagged: number[];
  edits: [number, string][];
  totalPhotos: number;
  libraryId: string;
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
}

export interface Root {
  path: string;
  excluded: boolean;
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

// Library id in the URL keeps the webview's HTTP cache from mixing up ids across libraries.
let libraryTag = "";
export const setLibraryTag = (id: string) => (libraryTag = id);
export const thumbUrl = (id: number) => `${THUMB}${id}?l=${libraryTag}`;
export const photoUrl = (id: number) => `${PHOTO}${id}?l=${libraryTag}`;

export const api = {
  snapshot: () => invoke<Snapshot>("library_snapshot"),
  listRoots: () => invoke<Root[]>("list_roots"),
  addRoot: (path: string, excluded = false) => invoke<void>("add_root", { path, excluded }),
  removeRoot: (path: string) => invoke<void>("remove_root", { path }),
  rescan: () => invoke<void>("rescan"),
  scanStatus: () => invoke<ScanProgress>("scan_status"),
  picasaScanlist: () => invoke<PicasaScanlist>("picasa_scanlist"),
  importPicasa: () => invoke<number>("import_picasa_scanlist"),
  search: (query: string) => invoke<{ ids: number[]; seconds: number }>("search", { query }),
  getPhoto: (id: number) => invoke<Photo>("get_photo", { id }),
  setStar: (ids: number[], starred: boolean) => invoke<void>("set_star", { ids, starred }),
  setCaption: (id: number, caption: string) => invoke<void>("set_caption", { id, caption }),
  setFolderDescription: (id: number, description: string) =>
    invoke<void>("set_folder_description", { id, description }),
  setEdits: (id: number, edits: string) => invoke<void>("set_edits", { id, edits }),
  exportPicture: (path: string, dataBase64: string) => invoke<void>("export_picture", { path, dataBase64 }),
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
  deletePhotos: (ids: number[]) => invoke<OpResult>("delete_photos", { ids }),
  transferPhotos: (ids: number[], dest: string, copy: boolean) => invoke<OpResult>("transfer_photos", { ids, dest, copy }),
  renameFolder: (id: number, name: string) => invoke<string>("rename_folder", { id, name }),
  moveFolder: (id: number, destParent: string) => invoke<string>("move_folder", { id, destParent }),
  deleteFolder: (id: number) => invoke<void>("delete_folder", { id }),
};

export interface OpResult {
  done: number;
  failed: string[];
}

export interface TagCount {
  tag: string;
  count: number;
}

/** Debug helper: forwards a message to the Rust log. */
export const uiLog = (message: string) => void invoke("ui_log", { message }).catch(() => {});
