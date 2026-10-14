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

export interface Snapshot {
  folders: Folder[];
  starred: number[];
  geotagged: number[];
  edits: [number, string][];
  totalPhotos: number;
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
  foldersSeen: number;
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

export const thumbUrl = (id: number) => `${THUMB}${id}`;
export const photoUrl = (id: number) => `${PHOTO}${id}`;

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
};

export interface TagCount {
  tag: string;
  count: number;
}

/** Debug helper: forwards a message to the Rust log. */
export const uiLog = (message: string) => void invoke("ui_log", { message }).catch(() => {});
