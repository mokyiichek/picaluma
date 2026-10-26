import { create } from "zustand";
import { Album, api, Face, FaceModels, FaceProgress, Folder, Person, Project, ScanProgress, setLibraryTag, Snapshot } from "./api";
import { Edit, parseEdits } from "./effects";
import { getPref, reopenLastFolder, setPref } from "./prefs";
import { loadSlideshowOpts } from "./slideshowOpts";

/** Options › General › Open the last folder: tried once, on the first library load. */
let reopenTried = false;

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

export type Section = "albums" | "people" | "projects" | "folders";
const DAY = 86400;
/** Filters date slider, like Picasa's: show only photos newer than… */
export const DATE_STEPS: [string, number][] = [
  ["Show all", 0],
  ["Last 20 years", 7305 * DAY],
  ["Last 10 years", 3653 * DAY],
  ["Last 5 years", 1826 * DAY],
  ["Last 2 years", 730 * DAY],
  ["Last year", 365 * DAY],
  ["Last 6 months", 183 * DAY],
  ["Last 3 months", 91 * DAY],
  ["Last month", 30 * DAY],
  ["Last week", 7 * DAY],
];

/** Person albums are shown through the folder grid with ids at or below this. */
export const PERSON_BASE = -1_000_000;
export const isPersonId = (id: number) => id <= PERSON_BASE && id > PROJECT_BASE;
/** Projects are shown through the folder grid with ids at or below this. */
export const PROJECT_BASE = -2_000_000;
export const isProjectId = (id: number) => id <= PROJECT_BASE;

export type FolderSort = "updated" | "created" | "name" | "size";

interface State {
  snapshot: Snapshot | null;
  folderById: Map<number, Folder>;
  folderOfPhoto: Map<number, number>;
  starred: Set<number>;
  geotagged: Set<number>;
  /** Videos in the library (play badge, player instead of the editor). */
  videos: Set<number>;
  /** Photos with faces (Faces filter). */
  faced: Set<number>;
  /** Picture › Hide, and View › Hidden Pictures. */
  hidden: Set<number>;
  showHidden: boolean;
  /** Albums › Recently Updated. */
  recent: Set<number>;
  recentOnly: boolean;
  /** Tray › Hold: pictures kept in the tray while you look elsewhere. */
  held: number[];
  /** Person album shown in the grid (People section). */
  personView: number | null;
  /** Project shown in the grid (Projects section): the pictures it was made from. */
  projectView: number | null;
  /** Reopen Collage / Movie with a project's options ("Make Again"). */
  remake: { kind: string; settings: string } | null;
  /** People Manager in place of the grid: unnamed face groups or suggestions to confirm. */
  peopleManager: { tab: "unnamed" | "suggestions"; person?: number } | null;
  /** Filters › faces: only photos with faces. */
  facesOnly: boolean;
  faceProgress: FaceProgress;
  faceModels: FaceModels | null;
  /** Edit view: drawing a face by hand ("Add a person manually"). */
  drawFace: boolean;
  /** Face highlighted on the picture (hovered in the People panel). */
  hoverFace: Face | null;
  /** Edit view compare mode: [A] the picture, [AB] before and after side by side, [AA] two
   *  pictures side by side — the one pinned when AA was chosen, and the one you move to. */
  compare: "a" | "ab" | "aa";
  comparePin: number | null;
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
  sidePanel: "props" | "tags" | "people" | "places";
  contextMenu: { x: number; y: number; kind: "photo" | "folder" | "album" | "person" | "project"; folderId?: number; albumId?: number; personId?: number; projectId?: number } | null;
  leftWidth: number;
  /** Left-panel sections, each opened/closed independently like Picasa's. */
  openSections: Record<Section, boolean>;
  query: string;
  search: { ids: Set<number>; seconds: number } | null;
  starredOnly: boolean;
  /** Filters › geotagged: only pictures with GPS coordinates. */
  geoOnly: boolean;
  /** Filters › movies: only movies. */
  videoOnly: boolean;
  /** Filters date slider: index into DATE_STEPS (0 = show all) and the matching photos. */
  dateStep: number;
  dateFilter: { ids: Set<number>; exclude: boolean } | null;
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
  /** File › Import From. */
  importOpen: boolean;
  /** View › Timeline. */
  timelineOpen: boolean;
  /** Create › Movie: the pictures to make a movie from. */
  movie: number[] | null;
  /** View › Thumbnail Caption. */
  thumbCaption: "none" | "filename" | "caption" | "tags" | "resolution";
  /** Folder Properties dialog (double-click a folder). */
  folderProps: number | null;
  /** Tools › Experimental › Show Duplicate Files: sets of identical pictures, shown in their folders. */
  dupGroups: number[][] | null;
  dupIds: Set<number> | null;
  /** What dupGroups holds: exact copies, or pictures that look alike. */
  dupKind: "duplicate" | "similar";
  /** A Tools job's dialog: the duplicate search, or Back Up Pictures. */
  toolDialog: "dups" | "similar" | "backup" | "stats" | null;
  /** Rename… with several pictures selected (Picasa's batch rename). */
  renameIds: number[] | null;
  /** Tools › Adjust Date and Time: the pictures to move. */
  adjustDate: number[] | null;
  /** The ▾ menu's Sort People by: "name", "amount" or "top" (the ten with most pictures). */
  peopleSort: "name" | "amount" | "top";
  /** A folder to open as soon as the scan finds it (after an import). */
  pendingFolderPath: string | null;
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
  confirmReq: { title: string; text: string; ok: string; cancel?: string; danger: boolean; dontAskKey?: string; resolve: (yes: boolean) => void } | null;
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
  togglePeople: () => void;
  togglePlaces: () => void;
  openPerson: (id: number | null) => void;
  openProject: (id: number | null) => void;
  setRemake: (r: { kind: string; settings: string } | null) => void;
  setPeopleManager: (pm: { tab: "unnamed" | "suggestions"; person?: number } | null) => void;
  setFacesOnly: (on: boolean) => void;
  setFaceProgress: (p: FaceProgress) => void;
  setFaceModels: (m: FaceModels) => void;
  setDrawFace: (on: boolean) => void;
  setHoverFace: (f: Face | null) => void;
  setCompare: (mode: "a" | "ab" | "aa") => void;
  setImportOpen: (on: boolean) => void;
  setTimelineOpen: (on: boolean) => void;
  setFolderProps: (id: number | null) => void;
  setDupGroups: (sets: number[][] | null, kind?: "duplicate" | "similar") => void;
  setToolDialog: (d: State["toolDialog"]) => void;
  setAdjustDate: (ids: number[] | null) => void;
  setRenameIds: (ids: number[] | null) => void;
  setThumbCaption: (k: State["thumbCaption"]) => void;
  setMovie: (ids: number[] | null) => void;
  setPeopleSort: (s: "name" | "amount" | "top") => void;
  selectFolderByPath: (path: string) => void;
  setShowHidden: (on: boolean) => void;
  setRecentOnly: (on: boolean) => void;
  holdSelection: () => void;
  clearHeld: () => void;
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
  setVideoOnly: (on: boolean) => void;
  setDateStep: (step: number) => Promise<void>;
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
  faced: new Set(),
  hidden: new Set(),
  showHidden: false,
  recent: new Set(),
  recentOnly: false,
  held: [],
  personView: null,
  projectView: null,
  remake: null,
  peopleManager: null,
  facesOnly: false,
  faceProgress: { running: false, done: 0, total: 0 },
  faceModels: null,
  drawFace: false,
  hoverFace: null,
  compare: "a",
  comparePin: null,
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
  videoOnly: false,
  dateStep: 0,
  dateFilter: null,
  folderView: localStorageGet("folderView") === "tree" ? "tree" : "flat",
  folderSort: (["updated", "created", "name", "size"].includes(localStorageGet("folderSort") ?? "") ? localStorageGet("folderSort") : "updated") as FolderSort,
  sortReverse: localStorageGet("sortReverse") === "1",
  copiedEdits: null,
  scan: { scanning: false, phase: "", foldersSeen: 0, photosFound: 0, indexed: 0, toIndex: 0, current: "" },
  flight: null,
  slideshow: null,
  folderManager: false,
  importOpen: false,
  timelineOpen: false,
  folderProps: null,
  dupGroups: null,
  dupIds: null,
  dupKind: "duplicate",
  toolDialog: null,
  adjustDate: null,
  renameIds: null,
  thumbCaption: (["filename", "caption", "tags", "resolution"].includes(localStorageGet("thumbCaption") ?? "") ? localStorageGet("thumbCaption") : "none") as State["thumbCaption"],
  movie: null,
  peopleSort: (localStorageGet("peopleSort") as "name" | "amount" | "top") || "name",
  pendingFolderPath: null,
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
    // The picture open in Edit view was deleted: go on to the next one (or back to the library).
    const editId = get().editId;
    let nextEdit: number | null | undefined;
    if (editId != null && !folderOfPhoto.has(editId)) {
      const seq = selectEditorSequence(get());
      const i = seq.indexOf(editId);
      nextEdit = [...seq.slice(i + 1), ...seq.slice(0, Math.max(0, i)).reverse()].find((p) => folderOfPhoto.has(p)) ?? null;
    }
    const cur = get().currentFolderId;
    const albumView = get().albumView;
    const albumAlive = albumView != null && snapshot.albums.some((a) => a.id === albumView);
    const personView = get().personView;
    const personAlive = personView != null && (snapshot.people ?? []).some((p) => p.id === personView);
    const projectView = get().projectView;
    const projectAlive = projectView != null && (snapshot.projects ?? []).some((p) => p.id === projectView);
    set({
      snapshot,
      folderById,
      folderOfPhoto,
      starred: new Set(snapshot.starred),
      geotagged: new Set(snapshot.geotagged),
      videos: new Set(snapshot.videos ?? []),
      faced: new Set(snapshot.faced ?? []),
      hidden: new Set(snapshot.hidden ?? []),
      recent: new Set(snapshot.recent ?? []),
      held: get().held.filter((id) => folderOfPhoto.has(id)),
      ...(nextEdit !== undefined
        ? nextEdit != null
          ? { editId: nextEdit, selected: new Set([nextEdit]), anchor: nextEdit }
          : { editId: null, view: "library" as const, selected: new Set<number>(), anchor: null }
        : {}),
      edits,
      albumView: albumAlive ? albumView : null,
      personView: personAlive ? personView : null,
      projectView: projectAlive ? projectView : null,
      currentFolderId: projectAlive
        ? PROJECT_BASE - projectView!
        : personAlive
        ? PERSON_BASE - personView!
        : albumAlive
          ? -albumView!
          : cur != null && folderById.has(cur)
            ? cur
            : snapshot.folders[0]?.id ?? null,
    });
    // Options › General: back to the folder you were looking at last time.
    if (!reopenTried) {
      reopenTried = true;
      const last = reopenLastFolder() ? getPref("lastFolderPath") : null;
      const f = last ? snapshot.folders.find((x) => x.path === last) : undefined;
      if (f && cur == null) get().selectFolder(f.id);
    }
    // Show Duplicate Files: a set whose copies were deleted down to one isn't a duplicate any more.
    const dups = get().dupGroups;
    if (dups) {
      const left = dups.map((g) => g.filter((id) => folderOfPhoto.has(id))).filter((g) => g.length > 1);
      if (left.length !== dups.length || left.some((g, i) => g.length !== dups[i].length)) get().setDupGroups(left.length ? left : null);
    }
    // An imported folder opens once the scan has found it.
    const pending = get().pendingFolderPath;
    if (pending) get().selectFolderByPath(pending);
    // Re-run an active search so results reflect newly scanned photos.
    const q = get().query;
    if (q) get().runSearch(q);
    // …and the date filter, so new photos within the range appear.
    const step = get().dateStep;
    if (step) get().setDateStep(step);
  },

  setScan: (scan) => set({ scan }),

  selectFolder: (id, scroll = true) => {
    const path = id > 0 ? get().folderById.get(id)?.path : undefined;
    if (path) setPref("lastFolderPath", path);
    // Mid-scan, the folder the user opens jumps the queue (Picasa's scanning priority).
    if (get().scan.scanning && id > 0) api.prioritizeFolder(id).catch(() => {});
    set({
      albumView: id < 0 ? get().albumView : null,
      personView: id < 0 ? get().personView : null,
      projectView: id < 0 ? get().projectView : null,
      peopleManager: null,
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

  togglePeople: () => {
    const { showProps, sidePanel } = get();
    set({ showProps: !(showProps && sidePanel === "people"), sidePanel: "people" });
  },

  togglePlaces: () => {
    const { showProps, sidePanel } = get();
    set({ showProps: !(showProps && sidePanel === "places"), sidePanel: "places" });
  },

  openProject: (id) =>
    set({
      projectView: id,
      personView: null,
      albumView: null,
      peopleManager: null,
      openSections: id != null ? { ...get().openSections, projects: true } : get().openSections,
      starredOnly: false,
      selected: new Set(),
      anchor: null,
      currentFolderId: id != null ? PROJECT_BASE - id : get().snapshot?.folders[0]?.id ?? null,
      scrollTarget: id != null ? { folderId: PROJECT_BASE - id, nonce: Date.now() } : get().scrollTarget,
    }),
  setRemake: (remake) => set({ remake }),
  openPerson: (id) =>
    set({
      projectView: null,
      personView: id,
      albumView: null,
      peopleManager: null,
      openSections: id != null ? { ...get().openSections, people: true } : get().openSections,
      starredOnly: false,
      selected: new Set(),
      anchor: null,
      currentFolderId: id != null ? PERSON_BASE - id : get().snapshot?.folders[0]?.id ?? null,
      scrollTarget: id != null ? { folderId: PERSON_BASE - id, nonce: Date.now() } : get().scrollTarget,
    }),
  setPeopleManager: (peopleManager) =>
    set({ peopleManager, openSections: peopleManager ? { ...get().openSections, people: true } : get().openSections }),
  setFacesOnly: (facesOnly) => set({ facesOnly }),
  setFaceProgress: (faceProgress) => set({ faceProgress }),
  setFaceModels: (faceModels) => set({ faceModels }),
  setDrawFace: (drawFace) => set({ drawFace }),
  setHoverFace: (hoverFace) => set({ hoverFace }),
  setCompare: (compare) => set({ compare, comparePin: compare === "aa" ? get().editId : null }),
  setTimelineOpen: (timelineOpen) => set({ timelineOpen }),
  // Albums and people have no folder properties.
  setDupGroups: (sets, kind) =>
    set({
      dupGroups: sets,
      dupKind: kind ?? get().dupKind,
      dupIds: sets ? new Set(sets.flat()) : null,
      albumView: sets ? null : get().albumView,
      personView: sets ? null : get().personView,
      projectView: sets ? null : get().projectView,
      selected: new Set(),
      anchor: null,
    }),
  setToolDialog: (toolDialog) => set({ toolDialog }),
  setAdjustDate: (ids) => set({ adjustDate: ids && ids.length ? ids : null }),
  setRenameIds: (ids) => set({ renameIds: ids && ids.length ? ids : null }),
  setFolderProps: (folderProps) => set({ folderProps: folderProps != null && folderProps > 0 ? folderProps : null }),
  setThumbCaption: (thumbCaption) => {
    localStorageSet("thumbCaption", thumbCaption);
    set({ thumbCaption });
  },
  setMovie: (ids) => set({ movie: ids && ids.length ? ids : null }),
  setPeopleSort: (peopleSort) => {
    localStorageSet("peopleSort", peopleSort);
    set({ peopleSort });
  },
  setImportOpen: (importOpen) => set({ importOpen, peopleManager: importOpen ? null : get().peopleManager }),
  selectFolderByPath: (path) => {
    const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/$/, "").toLowerCase();
    const f = get().snapshot?.folders.find((x) => norm(x.path) === norm(path));
    if (f) {
      set({ pendingFolderPath: null, albumView: null, personView: null });
      get().selectFolder(f.id);
    } else set({ pendingFolderPath: path });
  },
  setShowHidden: (showHidden) => set({ showHidden }),
  setRecentOnly: (recentOnly) => set({ recentOnly, albumView: recentOnly ? null : get().albumView, personView: recentOnly ? null : get().personView }),
  holdSelection: () => {
    const { held, selected } = get();
    const have = new Set(held);
    set({ held: [...held, ...[...selected].filter((id) => !have.has(id))] });
  },
  clearHeld: () => set({ held: [] }),

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
  setVideoOnly: (videoOnly) => set({ videoOnly }),
  setDateStep: async (dateStep) => {
    set({ dateStep });
    if (!dateStep) return set({ dateFilter: null });
    // Stored dates are local wall-clock seconds.
    const nowLocal = Date.now() / 1000 - new Date().getTimezoneOffset() * 60;
    const res = await api.photosSince(Math.floor(nowLocal - DATE_STEPS[dateStep][1]));
    if (get().dateStep === dateStep) set({ dateFilter: { ids: new Set(res.ids), exclude: res.exclude } });
  },
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
    let pics = videos.size ? photos.filter((p) => !videos.has(p)) : photos;
    // Options › Slideshow › Shuffle: random order, starting with the picture you chose.
    if (loadSlideshowOpts().shuffle && pics.length > 2) {
      const rest = pics.filter((p) => p !== start);
      for (let i = rest.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [rest[i], rest[j]] = [rest[j], rest[i]];
      }
      pics = pics.includes(start) ? [start, ...rest] : rest;
    }
    if (pics.length) set({ slideshow: { photos: pics, index: Math.max(0, pics.indexOf(start)) } });
  },
  setSlideshowIndex: (index) => {
    const s = get().slideshow;
    if (s) set({ slideshow: { ...s, index } });
  },
  stopSlideshow: () => set({ slideshow: null }),
  setFolderManager: (folderManager) => set({ folderManager }),

  setFolderDescription: (id, text) => {
    // Negative ids are albums shown through the folder header (people and projects have none).
    if (isPersonId(id) || isProjectId(id)) return;
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
      personView: null,
      projectView: null,
      peopleManager: null,
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
  if (s.projectView != null) return PROJECT_BASE - s.projectView;
  if (s.personView != null) return PERSON_BASE - s.personView;
  if (s.albumView != null) return -s.albumView;
  return s.folderOfPhoto.get(photoId) ?? s.currentFolderId;
}

/** An album presented with the Folder shape so the grid can render it like a folder. */
export function albumAsFolder(a: Album): Folder {
  return { id: -a.id, name: a.name, path: "Album", description: a.description, dateMin: a.created, dateMax: a.created, updated: a.created, bytes: 0, sort: a.sort, reverse: a.reverse, photos: a.photos };
}

/** A person album presented with the Folder shape. */
export function personAsFolder(p: Person): Folder {
  return { id: PERSON_BASE - p.id, name: p.name, path: "Person", description: "", dateMin: 0, dateMax: 0, updated: 0, bytes: 0, sort: "", photos: p.photos };
}

/** A project presented with the Folder shape. */
export function projectAsFolder(p: Project): Folder {
  return { id: PROJECT_BASE - p.id, name: p.name, path: p.output || "Project", description: "", dateMin: p.created, dateMax: p.created, updated: p.created, bytes: 0, sort: "", photos: p.photos };
}

export function selectProject(s: State): Project | undefined {
  return s.projectView != null ? s.snapshot?.projects?.find((p) => p.id === s.projectView) : undefined;
}

export function selectPerson(s: State): Person | undefined {
  return s.personView != null ? s.snapshot?.people?.find((p) => p.id === s.personView) : undefined;
}

export function selectAlbum(s: State): Album | undefined {
  return s.albumView != null ? s.snapshot?.albums.find((a) => a.id === s.albumView) : undefined;
}

// Memoised: folders + photos after applying search and the starred filter.
let visCache: { key: unknown[]; value: VisibleFolder[] } | null = null;
export function selectVisible(s: State): VisibleFolder[] {
  const key = [s.snapshot, s.search, s.starredOnly, s.starredOnly ? s.starred : null, s.albumView, s.personView, s.projectView, s.geoOnly, s.videoOnly, s.facesOnly, s.recentOnly, s.showHidden, s.hidden, s.dateFilter, s.folderView, s.folderSort, s.sortReverse, s.dupIds];
  if (visCache && visCache.key.every((k, i) => k === key[i])) return visCache.value;
  const album = selectAlbum(s);
  const person = selectPerson(s);
  const project = selectProject(s);
  const folders = project ? [projectAsFolder(project)] : person ? [personAsFolder(person)] : album ? [albumAsFolder(album)] : sortFolders(s.snapshot?.folders ?? [], s.folderView, s.folderSort, s.sortReverse);
  const ids = s.search?.ids;
  const dups = s.dupIds;
  const value: VisibleFolder[] = [];
  for (const folder of folders) {
    let photos = folder.photos;
    const df = s.dateFilter;
    const hide = !s.showHidden && s.hidden.size > 0;
    if (ids || dups || s.starredOnly || s.geoOnly || s.videoOnly || s.facesOnly || s.recentOnly || hide || df) {
      photos = photos.filter(
        (p) =>
          (!ids || ids.has(p)) &&
          (!dups || dups.has(p)) &&
          (!s.starredOnly || s.starred.has(p)) &&
          (!s.geoOnly || s.geotagged.has(p)) &&
          (!s.videoOnly || s.videos.has(p)) &&
          (!s.facesOnly || s.faced.has(p)) &&
          (!s.recentOnly || s.recent.has(p)) &&
          (!hide || !s.hidden.has(p)) &&
          (!df || df.ids.has(p) !== df.exclude),
      );
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
/** One shared empty list: a selector must not hand back a new [] each time, or the window
 *  redraws forever (this blanked the window after deleting the picture open in Edit view). */
const NO_PHOTOS: number[] = [];

export function selectEditorSequence(s: State): number[] {
  if (s.editId == null) return NO_PHOTOS;
  if (s.albumView != null || s.personView != null || s.projectView != null) return selectVisible(s)[0]?.photos ?? NO_PHOTOS;
  const fid = s.folderOfPhoto.get(s.editId);
  const vis = selectVisible(s).find((v) => v.folder.id === fid);
  return vis?.photos ?? (fid != null ? s.folderById.get(fid)?.photos ?? NO_PHOTOS : NO_PHOTOS);
}

/** With special effects off, a root class disables every CSS transition and animation. */
function applyEffectsClass(on: boolean): boolean {
  document.documentElement.classList.toggle("no-effects", !on);
  return on;
}

function loadSections(): Record<Section, boolean> {
  const fallback = { albums: true, people: false, projects: false, folders: true };
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
