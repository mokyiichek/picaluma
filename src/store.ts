import { create } from "zustand";
import { Album, api, Folder, ScanProgress, setLibraryTag, Snapshot } from "./api";
import { Edit, parseEdits } from "./effects";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A thumbnail "flying" between the grid and the editor — Picasa's zoom transition. */
export interface Flight {
  photoId: number;
  src: string;
  from: Rect;
  filter: string;
  rotate: number;
  nonce: number;
}

export interface VisibleFolder {
  folder: Folder;
  photos: number[];
}

export type Section = "albums" | "people" | "folders";
export type FolderSort = "updated" | "created" | "name" | "size";

interface State {
  snapshot: Snapshot | null;
  folderById: Map<number, Folder>;
  folderOfPhoto: Map<number, number>;
  starred: Set<number>;
  geotagged: Set<number>;
  /** Videos in the library (play badge, player instead of the editor). */
  videos: Set<number>;
  edits: Map<number, Edit[]>;

  view: "library" | "edit";
  currentFolderId: number | null;
  selected: Set<number>;
  anchor: number | null;
  editId: number | null;
  thumbSize: number;
  showProps: boolean;
  /** Tools › Options › Special effects: animated transitions and smooth scrolling. */
  effects: boolean;
  optionsOpen: boolean;
  sidePanel: "props" | "tags";
  contextMenu: { x: number; y: number; kind: "photo" | "folder" | "album"; folderId?: number; albumId?: number } | null;
  leftWidth: number;
  /** Left-panel sections, each opened/closed independently like Picasa's. */
  openSections: Record<Section, boolean>;
  query: string;
  search: { ids: Set<number>; seconds: number } | null;
  starredOnly: boolean;
  /** Filters › geotagged: only pictures with GPS coordinates. */
  geoOnly: boolean;
  /** Folder list: Picasa's flat (grouped by date) or tree (disk hierarchy) view. */
  folderView: "flat" | "tree";
  folderSort: FolderSort;
  sortReverse: boolean;
  /** Edit › Copy All Effects. */
  copiedEdits: Edit[] | null;
  scan: ScanProgress;
  flight: Flight | null;
  slideshow: { photos: number[]; index: number } | null;
  folderManager: boolean;
  scrollTarget: { folderId: number; photoId?: number; nonce: number } | null;
  /** Album shown instead of the folder list (Picasa's album view). */
  albumView: number | null;
  /** Photos waiting for an album choice in the Add to Album dialog. */
  albumPicker: number[] | null;
  /** Export / E-mail dialog and the photos it acts on. */
  share: { kind: "export" | "email"; ids: number[] } | null;
  /** Print screen and the photos (and starting layout) it prints. */
  print: { ids: number[]; layout?: string } | null;
  /** Create › Picture Collage dialog. */
  collage: number[] | null;
  /** Help › Keyboard Shortcuts dialog. */
  shortcutsOpen: boolean;
  /** Help › About Picaluma. */
  aboutOpen: boolean;
  /** Open confirmation dialog (confirmAsk) and text prompt (askText). */
  confirmReq: { title: string; text: string; ok: string; danger: boolean; dontAskKey?: string; resolve: (yes: boolean) => void } | null;
  textPrompt: { label: string; value: string; ok: string; resolve: (value: string | null) => void } | null;

  loadSnapshot: () => Promise<void>;
  setScan: (p: ScanProgress) => void;
  selectFolder: (id: number, scroll?: boolean) => void;
  setCurrentFolder: (id: number) => void;
  clickPhoto: (id: number, mods: { ctrl: boolean; shift: boolean }, ordered: number[]) => void;
  selectOnly: (ids: number[]) => void;
  clearSelection: () => void;
  openEditor: (id: number, flight?: Omit<Flight, "nonce">) => void;
  closeEditor: (flight?: Omit<Flight, "nonce">) => void;
  setEditId: (id: number) => void;
  endFlight: () => void;
  setThumbSize: (n: number) => void;
  toggleProps: () => void;
  toggleTags: () => void;
  setEffects: (on: boolean) => void;
  setOptionsOpen: (open: boolean) => void;
  openContextMenu: (m: State["contextMenu"]) => void;
  setLeftWidth: (w: number) => void;
  toggleSection: (s: Section) => void;
  /** Opens a section (no-op if already open). */
  setLeftSection: (s: Section) => void;
  runSearch: (q: string) => Promise<void>;
  clearSearch: () => void;
  setStarredOnly: (on: boolean) => void;
  setGeoOnly: (on: boolean) => void;
  setFolderView: (v: "flat" | "tree") => void;
  setFolderSort: (sort: FolderSort, reverse: boolean) => void;
  setCopiedEdits: (edits: Edit[] | null) => void;
  toggleStar: (ids: number[]) => Promise<void>;
  setPhotoEdits: (id: number, edits: Edit[]) => void;
  startSlideshow: (photos: number[], index?: number) => void;
  setSlideshowIndex: (i: number) => void;
  stopSlideshow: () => void;
  setFolderManager: (open: boolean) => void;
  setFolderDescription: (id: number, text: string) => void;
  openAlbum: (id: number | null) => void;
  setAlbumPicker: (ids: number[] | null) => void;
  setShare: (share: State["share"]) => void;
  setPrint: (print: State["print"]) => void;
  setCollage: (ids: number[] | null) => void;
  setShortcutsOpen: (open: boolean) => void;
  setAboutOpen: (open: boolean) => void;
  setConfirmReq: (req: State["confirmReq"]) => void;
  setTextPrompt: (req: State["textPrompt"]) => void;
  createAlbum: (name: string, ids: number[]) => Promise<number>;
  addToAlbum: (albumId: number, ids: number[]) => Promise<void>;
  removeFromAlbum: (albumId: number, ids: number[]) => Promise<void>;
  renameAlbum: (albumId: number, name: string) => Promise<void>;
  deleteAlbum: (albumId: number) => Promise<void>;
}

let searchSeq = 0;
let flightSeq = 0;

export const useStore = create<State>((set, get) => ({
  snapshot: null,
  folderById: new Map(),
  folderOfPhoto: new Map(),
  starred: new Set(),
  geotagged: new Set(),
  videos: new Set(),
  edits: new Map(),

  view: "library",
  currentFolderId: null,
  selected: new Set(),
  anchor: null,
  editId: null,
  thumbSize: Number(localStorageGet("thumbSize")) || 150,
  showProps: localStorageGet("showProps") !== "0",
  effects: applyEffectsClass(localStorageGet("effects") !== "0"),
  optionsOpen: false,
  sidePanel: "props",
  contextMenu: null,
  leftWidth: Number(localStorageGet("leftWidth")) || 420,
  openSections: loadSections(),
  query: "",
  search: null,
  starredOnly: false,
  geoOnly: false,
  folderView: localStorageGet("folderView") === "tree" ? "tree" : "flat",
  folderSort: (["updated", "created", "name", "size"].includes(localStorageGet("folderSort") ?? "") ? localStorageGet("folderSort") : "updated") as FolderSort,
  sortReverse: localStorageGet("sortReverse") === "1",
  copiedEdits: null,
  scan: { scanning: false, phase: "", foldersSeen: 0, photosFound: 0, indexed: 0, toIndex: 0, current: "" },
  flight: null,
  slideshow: null,
  folderManager: false,
  scrollTarget: null,
  albumView: null,
  albumPicker: null,
  share: null,
  print: null,
  collage: null,
  shortcutsOpen: false,
  aboutOpen: false,
  confirmReq: null,
  textPrompt: null,

  loadSnapshot: async () => {
    const snapshot = await api.snapshot();
    setLibraryTag(snapshot.libraryId);
    const folderById = new Map<number, Folder>();
    const folderOfPhoto = new Map<number, number>();
    for (const f of snapshot.folders) {
      folderById.set(f.id, f);
      for (const p of f.photos) folderOfPhoto.set(p, f.id);
    }
    const edits = new Map<number, Edit[]>();
    for (const [id, json] of snapshot.edits) edits.set(id, parseEdits(json));
    const cur = get().currentFolderId;
    const albumView = get().albumView;
    const albumAlive = albumView != null && snapshot.albums.some((a) => a.id === albumView);
    set({
      snapshot,
      folderById,
      folderOfPhoto,
      starred: new Set(snapshot.starred),
      geotagged: new Set(snapshot.geotagged),
      videos: new Set(snapshot.videos ?? []),
      edits,
      albumView: albumAlive ? albumView : null,
      currentFolderId: albumAlive ? -albumView! : cur != null && folderById.has(cur) ? cur : snapshot.folders[0]?.id ?? null,
    });
    // Re-run an active search so results reflect newly scanned photos.
    const q = get().query;
    if (q) get().runSearch(q);
  },

  setScan: (scan) => set({ scan }),

  selectFolder: (id, scroll = true) => {
    // Mid-scan, the folder the user opens jumps the queue (Picasa's scanning priority).
    if (get().scan.scanning && id > 0) api.prioritizeFolder(id).catch(() => {});
    set({
      albumView: id < 0 ? get().albumView : null,
      currentFolderId: id,
      selected: new Set(),
      anchor: null,
      scrollTarget: scroll ? { folderId: id, nonce: Date.now() } : get().scrollTarget,
    });
  },

  setCurrentFolder: (id) => {
    if (get().currentFolderId !== id) set({ currentFolderId: id });
  },

  clickPhoto: (id, { ctrl, shift }, ordered) => {
    const { selected, anchor } = get();
    let next: Set<number>;
    if (shift && anchor != null) {
      const a = ordered.indexOf(anchor);
      const b = ordered.indexOf(id);
      next = new Set(ctrl ? selected : []);
      if (a >= 0 && b >= 0) for (let i = Math.min(a, b); i <= Math.max(a, b); i++) next.add(ordered[i]);
      else next.add(id);
      set({ selected: next });
      return;
    }
    if (ctrl) {
      next = new Set(selected);
      next.has(id) ? next.delete(id) : next.add(id);
    } else {
      next = new Set([id]);
    }
    set({ selected: next, anchor: id, currentFolderId: homeFolder(get(), id) });
  },

  selectOnly: (ids) => set({ selected: new Set(ids), anchor: ids[ids.length - 1] ?? null }),
  clearSelection: () => set({ selected: new Set(), anchor: null }),

  openEditor: (id, flight) =>
    set({
      view: "edit",
      editId: id,
      selected: new Set([id]),
      anchor: id,
      currentFolderId: homeFolder(get(), id),
      flight: flight && get().effects ? { ...flight, nonce: ++flightSeq } : null,
    }),

  closeEditor: (flight) => {
    const id = get().editId;
    const folderId = id != null ? homeFolder(get(), id) ?? undefined : undefined;
    set({
      view: "library",
      flight: flight && get().effects ? { ...flight, nonce: ++flightSeq } : null,
      scrollTarget: folderId != null ? { folderId, photoId: id ?? undefined, nonce: Date.now() } : get().scrollTarget,
    });
  },

  setEditId: (id) => set({ editId: id, selected: new Set([id]), anchor: id }),
  endFlight: () => set({ flight: null }),

  setThumbSize: (n) => {
    localStorageSet("thumbSize", String(n));
    set({ thumbSize: n });
  },

  toggleProps: () => {
    const { showProps, sidePanel } = get();
    const v = !(showProps && sidePanel === "props");
    localStorageSet("showProps", v ? "1" : "0");
    set({ showProps: v, sidePanel: "props" });
  },

  toggleTags: () => {
    const { showProps, sidePanel } = get();
    set({ showProps: !(showProps && sidePanel === "tags"), sidePanel: "tags" });
  },

  openContextMenu: (contextMenu) => set({ contextMenu }),

  setEffects: (on) => {
    localStorageSet("effects", on ? "1" : "0");
    set({ effects: applyEffectsClass(on) });
  },

  setOptionsOpen: (optionsOpen) => set({ optionsOpen }),

  setLeftWidth: (leftWidth) => {
    localStorageSet("leftWidth", String(Math.round(leftWidth)));
    set({ leftWidth });
  },

  toggleSection: (id) => {
    const openSections = { ...get().openSections, [id]: !get().openSections[id] };
    localStorageSet("sections", JSON.stringify(openSections));
    set({ openSections });
  },

  setLeftSection: (id) => {
    if (!get().openSections[id]) get().toggleSection(id);
  },

  runSearch: async (q) => {
    set({ query: q });
    const seq = ++searchSeq;
    if (!q.trim()) {
      set({ search: null });
      return;
    }
    const res = await api.search(q);
    if (seq !== searchSeq) return; // a newer keystroke won
    set({ search: { ids: new Set(res.ids), seconds: res.seconds } });
  },

  clearSearch: () => {
    searchSeq++;
    set({ query: "", search: null });
  },

  setStarredOnly: (starredOnly) => set({ starredOnly }),
  setGeoOnly: (geoOnly) => set({ geoOnly }),
  setFolderView: (folderView) => {
    localStorageSet("folderView", folderView);
    set({ folderView });
  },
  setFolderSort: (folderSort, sortReverse) => {
    localStorageSet("folderSort", folderSort);
    localStorageSet("sortReverse", sortReverse ? "1" : "0");
    set({ folderSort, sortReverse });
  },
  setCopiedEdits: (copiedEdits) => set({ copiedEdits }),

  toggleStar: async (ids) => {
    if (!ids.length) return;
    const starred = new Set(get().starred);
    const makeStarred = !ids.every((id) => starred.has(id));
    for (const id of ids) makeStarred ? starred.add(id) : starred.delete(id);
    set({ starred });
    await api.setStar(ids, makeStarred);
  },

  setPhotoEdits: (id, list) => {
    const edits = new Map(get().edits);
    if (list.length) edits.set(id, list);
    else edits.delete(id);
    set({ edits });
    api.setEdits(id, list.length ? JSON.stringify(list) : "");
  },

  startSlideshow: (photos, index = 0) => {
    // Slideshows show pictures only; movies are skipped.
    const videos = get().videos;
    const start = photos[index];
    const pics = videos.size ? photos.filter((p) => !videos.has(p)) : photos;
    if (pics.length) set({ slideshow: { photos: pics, index: Math.max(0, pics.indexOf(start)) } });
  },
  setSlideshowIndex: (index) => {
    const s = get().slideshow;
    if (s) set({ slideshow: { ...s, index } });
  },
  stopSlideshow: () => set({ slideshow: null }),
  setFolderManager: (folderManager) => set({ folderManager }),

  setFolderDescription: (id, text) => {
    // Negative ids are albums shown through the folder header.
    if (id < 0) {
      const a = get().snapshot?.albums.find((x) => x.id === -id);
      if (a) a.description = text;
      api.updateAlbum(-id, { description: text });
      return;
    }
    const f = get().folderById.get(id);
    if (f) f.description = text;
    api.setFolderDescription(id, text);
  },

  openAlbum: (id) =>
    set({
      albumView: id,
      openSections: id != null ? { ...get().openSections, albums: true } : get().openSections,
      starredOnly: false,
      selected: new Set(),
      anchor: null,
      currentFolderId: id != null ? -id : get().snapshot?.folders[0]?.id ?? null,
      scrollTarget: id != null ? { folderId: -id, nonce: Date.now() } : get().scrollTarget,
    }),

  setAlbumPicker: (albumPicker) => set({ albumPicker }),
  setShare: (share) => set({ share: share && share.ids.length ? share : null }),
  setPrint: (print) => set({ print: print && print.ids.length ? print : null }),
  setCollage: (ids) => set({ collage: ids && ids.length ? ids : null }),
  setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),
  setAboutOpen: (aboutOpen) => set({ aboutOpen }),
  setConfirmReq: (confirmReq) => set({ confirmReq }),
  setTextPrompt: (textPrompt) => set({ textPrompt }),

  createAlbum: async (name, ids) => {
    const id = await api.createAlbum(name, ids);
    await get().loadSnapshot();
    return id;
  },

  addToAlbum: async (albumId, ids) => {
    await api.albumAdd(albumId, ids);
    await get().loadSnapshot();
  },

  removeFromAlbum: async (albumId, ids) => {
    await api.albumRemove(albumId, ids);
    set({ selected: new Set(), anchor: null });
    await get().loadSnapshot();
  },

  renameAlbum: async (albumId, name) => {
    await api.updateAlbum(albumId, { name });
    await get().loadSnapshot();
  },

  deleteAlbum: async (albumId) => {
    await api.deleteAlbum(albumId);
    if (get().albumView === albumId) get().openAlbum(null);
    await get().loadSnapshot();
  },
}));

/** The grid section a photo belongs to: the open album, else its folder. */
function homeFolder(s: State, photoId: number): number | null {
  if (s.albumView != null) return -s.albumView;
  return s.folderOfPhoto.get(photoId) ?? s.currentFolderId;
}

/** An album presented with the Folder shape so the grid can render it like a folder. */
export function albumAsFolder(a: Album): Folder {
  return { id: -a.id, name: a.name, path: "Album", description: a.description, dateMin: a.created, dateMax: a.created, updated: a.created, bytes: 0, sort: a.sort, photos: a.photos };
}

export function selectAlbum(s: State): Album | undefined {
  return s.albumView != null ? s.snapshot?.albums.find((a) => a.id === s.albumView) : undefined;
}

// Memoised: folders + photos after applying search and the starred filter.
let visCache: { key: unknown[]; value: VisibleFolder[] } | null = null;
export function selectVisible(s: State): VisibleFolder[] {
  const key = [s.snapshot, s.search, s.starredOnly, s.starredOnly ? s.starred : null, s.albumView, s.geoOnly, s.folderView, s.folderSort, s.sortReverse];
  if (visCache && visCache.key.every((k, i) => k === key[i])) return visCache.value;
  const album = selectAlbum(s);
  const folders = album ? [albumAsFolder(album)] : sortFolders(s.snapshot?.folders ?? [], s.folderView, s.folderSort, s.sortReverse);
  const ids = s.search?.ids;
  const value: VisibleFolder[] = [];
  for (const folder of folders) {
    let photos = folder.photos;
    if (ids || s.starredOnly || s.geoOnly) {
      photos = photos.filter((p) => (!ids || ids.has(p)) && (!s.starredOnly || s.starred.has(p)) && (!s.geoOnly || s.geotagged.has(p)));
      if (!photos.length) continue;
    }
    value.push({ folder, photos });
  }
  visCache = { key, value };
  return value;
}

export const pathParts = (p: string) => p.split(/[\\/]+/).filter(Boolean);
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** Disk order, folder by folder ("2019" < "2019/Trip" < "2020"), as in Picasa's tree view. */
export function comparePaths(a: string, b: string): number {
  const pa = pathParts(a);
  const pb = pathParts(b);
  for (let i = 0; i < Math.min(pa.length, pb.length); i++) {
    const c = collator.compare(pa[i], pb[i]);
    if (c) return c;
  }
  return pa.length - pb.length;
}

let sortCache: { key: unknown[]; value: Folder[] } | null = null;

/** Folder order for the tree and grid. The snapshot arrives newest-updated first. */
function sortFolders(folders: Folder[], view: "flat" | "tree", sort: FolderSort, reverse: boolean): Folder[] {
  const key = [folders, view, sort, reverse];
  if (sortCache && sortCache.key.every((k, i) => k === key[i])) return sortCache.value;
  let out = folders;
  if (view === "tree") out = [...folders].sort((a, b) => comparePaths(a.path, b.path));
  else if (sort === "created") out = [...folders].sort((a, b) => b.dateMin - a.dateMin);
  else if (sort === "name") out = [...folders].sort((a, b) => collator.compare(a.name, b.name));
  else if (sort === "size") out = [...folders].sort((a, b) => b.bytes - a.bytes);
  if (reverse) out = [...out].reverse();
  sortCache = { key, value: out };
  return out;
}

/** Photos the editor's prev/next and filmstrip walk through: the current folder, filtered. */
export function selectEditorSequence(s: State): number[] {
  if (s.editId == null) return [];
  if (s.albumView != null) return selectVisible(s)[0]?.photos ?? [];
  const fid = s.folderOfPhoto.get(s.editId);
  const vis = selectVisible(s).find((v) => v.folder.id === fid);
  return vis?.photos ?? (fid != null ? s.folderById.get(fid)?.photos ?? [] : []);
}

/** With special effects off, a root class disables every CSS transition and animation. */
function applyEffectsClass(on: boolean): boolean {
  document.documentElement.classList.toggle("no-effects", !on);
  return on;
}

function loadSections(): Record<Section, boolean> {
  const fallback = { albums: true, people: false, folders: true };
  try {
    return { ...fallback, ...JSON.parse(localStorageGet("sections") ?? "{}") };
  } catch {
    return fallback;
  }
}

function localStorageGet(k: string): string | null {
  try {
    return localStorage.getItem(`picaluma.${k}`);
  } catch {
    return null;
  }
}

function localStorageSet(k: string, v: string) {
  try {
    localStorage.setItem(`picaluma.${k}`, v);
  } catch {
    /* ignore */
  }
}
