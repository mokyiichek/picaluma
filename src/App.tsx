import { lazy, Suspense, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { api, FaceModels, FaceProgress, ScanProgress } from "./api";
import { offerFaceModels, reportModelError } from "./faceModels";
import { selectEditorSequence, useStore } from "./store";
import { addFiles, deletePhotos, removeFromAlbum, emailPhotos, exportPhotos, printPhotos, renamePhoto, saveCopies } from "./actions";
import { copyPicture, folderIds, trayIds } from "./share";
import { isDeleteKey, isMac, isPermanentDelete, mod } from "./platform";
import MenuBar from "./components/MenuBar";
import LibraryToolbar from "./components/LibraryToolbar";
import LeftPanel, { Splitter } from "./components/LeftPanel";
import LibraryGrid from "./components/LibraryGrid";
import PropertiesPanel from "./components/PropertiesPanel";
import StatusBar from "./components/StatusBar";
import Tray from "./components/Tray";
import EditView, { EditToolbar } from "./components/EditView";
import FlightOverlay from "./components/FlightOverlay";
import Slideshow from "./components/Slideshow";
import FolderManager from "./components/FolderManager";
import TagsPanel from "./components/TagsPanel";
import PeoplePanel from "./components/PeoplePanel";
// The map (Leaflet) loads only when Places is opened.
const PlacesPanel = lazy(() => import("./components/PlacesPanel"));
import ScanNotifier from "./components/ScanNotifier";
import OptionsDialog from "./components/OptionsDialog";
import AlbumPicker from "./components/AlbumPicker";
import ExportDialog from "./components/ExportDialog";
import EmailDialog from "./components/EmailDialog";
import PrintView from "./components/PrintView";
import CollageDialog from "./components/CollageDialog";
import ShortcutsDialog from "./components/ShortcutsDialog";
import AboutDialog from "./components/AboutDialog";
import ConfirmDialog from "./components/ConfirmDialog";
import TextPrompt from "./components/TextPrompt";
import ContextMenu, { rotateSelected } from "./components/ContextMenu";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { getCurrentWindow } from "@tauri-apps/api/window";

export default function App() {
  const view = useStore((s) => s.view);
  const showProps = useStore((s) => s.showProps);
  const sidePanel = useStore((s) => s.sidePanel);

  useEffect(() => {
    const s = useStore.getState();
    s.loadSnapshot();
    api.scanStatus().then(s.setScan);
    api.listRoots().then((roots) => roots.every((r) => r.excluded) && s.setFolderManager(true));

    // Scans emit library-changed in bursts; coalesce reloads.
    let timer: number | undefined;
    const unChanged = listen("library-changed", () => {
      clearTimeout(timer);
      timer = window.setTimeout(() => useStore.getState().loadSnapshot(), 300);
    });
    const unProgress = listen<ScanProgress>("scan-progress", (e) => useStore.getState().setScan(e.payload));
    const unFaces = listen<FaceProgress>("faces-progress", (e) => useStore.getState().setFaceProgress(e.payload));
    api.faceProgress().then(s.setFaceProgress).catch(() => {});
    const unModels = listen<FaceModels>("face-models", (e) => {
      const was = useStore.getState().faceModels;
      useStore.getState().setFaceModels(e.payload);
      if (was?.downloading && !e.payload.downloading) reportModelError(e.payload.error);
    });
    api.faceModelsStatus().then(s.setFaceModels).catch(() => {});
    // Offer the face models once, a moment after startup (People needs them).
    const offer = window.setTimeout(() => {
      api
        .getSettings()
        .then((set) => {
          if (set.faceRecognition && !set.faceModelsDeclined) offerFaceModels(true);
        })
        .catch(() => {});
    }, 2500);

    const onKey = (e: KeyboardEvent) => {
      const st = useStore.getState();
      const typing = (e.target as HTMLElement).tagName === "INPUT" && (e.target as HTMLInputElement).type !== "range";
      if (typing || st.slideshow || st.print || st.share || st.collage || st.shortcutsOpen || st.aboutOpen || st.confirmReq || st.textPrompt) return;
      const sel = [...st.selected];
      if (e.key === "F11") {
        e.preventDefault();
        const win = getCurrentWindow();
        win.isFullscreen().then((full) => win.setFullscreen(!full)).catch(() => {});
      } else if (e.key === "F1") {
        e.preventDefault();
        st.setShortcutsOpen(true);
      } else if (mod(e) && e.shiftKey && (e.key === "8" || e.key === "*")) {
        e.preventDefault();
        st.toggleStar(sel);
      } else if (mod(e) && e.key === "3" && sel.length === 1) {
        e.preventDefault();
        st.openEditor(sel[0]);
      } else if (mod(e) && e.key === "4") {
        e.preventDefault();
        const f = st.currentFolderId != null ? st.folderById.get(st.currentFolderId) : undefined;
        if (f) st.startSlideshow(f.photos);
      } else if (mod(e) && e.key === "1") {
        e.preventDefault();
        st.setThumbSize(100);
      } else if (mod(e) && e.key === "2") {
        e.preventDefault();
        st.setThumbSize(150);
      } else if (mod(e) && !e.shiftKey && e.key.toLowerCase() === "a") {
        // Select All: the pictures of the current folder or album, wherever the focus is.
        e.preventDefault();
        st.selectOnly(folderIds());
      } else if ((mod(e) && e.key.toLowerCase() === "i" && (isMac ? e.shiftKey : !e.shiftKey)) || (isMac && e.ctrlKey && !e.metaKey && e.key.toLowerCase() === "i")) {
        // Invert Selection: Ctrl+I on Windows; ⇧⌘I or Control-I on Mac, where ⌘I is Get Info.
        e.preventDefault();
        const folder = folderIds();
        st.selectOnly(folder.filter((p) => !st.selected.has(p)));
      } else if (mod(e) && e.key.toLowerCase() === "d") {
        e.preventDefault();
        st.clearSelection();
      } else if (e.altKey && e.key === "Enter") {
        e.preventDefault();
        st.toggleProps();
      } else if (isMac && e.metaKey && e.key.toLowerCase() === "i") {
        e.preventDefault(); // Picasa for Mac: Get Info
        st.toggleProps();
      } else if (isMac && e.metaKey && e.key === ",") {
        e.preventDefault(); // Mac convention: Preferences
        st.setOptionsOpen(true);
      } else if (isDeleteKey(e) && sel.length) {
        e.preventDefault();
        const permanent = isPermanentDelete(e);
        // In an album, plain Delete takes pictures out of the album; elsewhere it deletes from disk.
        if (st.albumView != null && st.view === "library" && !permanent) {
          removeFromAlbum(st.albumView, sel);
        } else if (st.view === "edit" && st.editId != null) {
          const seq = selectEditorSequence(st);
          const i = seq.indexOf(st.editId);
          const next = seq[i + 1] ?? seq[i - 1];
          deletePhotos([st.editId], permanent).then((deleted) => {
            const now = useStore.getState();
            if (!deleted || now.folderOfPhoto.has(st.editId!)) return; // cancelled or failed
            if (next != null) now.setEditId(next);
            else now.closeEditor();
          });
        } else {
          deletePhotos(sel, permanent);
        }
      } else if ((e.key === "F2" || (isMac && e.key === "F3")) && trayIds().length === 1) {
        e.preventDefault();
        renamePhoto(trayIds()[0]);
      } else if (mod(e) && !e.shiftKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        const ids = trayIds().filter((id) => st.edits.has(id));
        if (ids.length) saveCopies(ids);
      } else if (mod(e) && !e.shiftKey && e.key.toLowerCase() === "c" && !window.getSelection()?.toString() && trayIds().length === 1) {
        e.preventDefault();
        copyPicture(trayIds()[0]);
      } else if (mod(e) && e.key.toLowerCase() === "o" && !e.shiftKey) {
        e.preventDefault();
        addFiles();
      } else if (mod(e) && e.shiftKey && e.key.toLowerCase() === "m") {
        e.preventDefault();
        st.setPeopleManager({ tab: "unnamed" });
      } else if (mod(e) && e.key.toLowerCase() === "m") {
        e.preventDefault();
        st.setImportOpen(true);
      } else if (mod(e) && e.key.toLowerCase() === "p") {
        e.preventDefault();
        const ids = e.shiftKey ? folderIds() : trayIds();
        if (ids.length) printPhotos(ids, e.shiftKey ? "index" : undefined); // Ctrl+Shift+P: Print Contact Sheet
      } else if (mod(e) && !e.shiftKey && e.key.toLowerCase() === "e") {
        e.preventDefault();
        const ids = trayIds();
        if (ids.length) emailPhotos(ids);
      } else if (mod(e) && e.shiftKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        const ids = trayIds();
        if (ids.length) exportPhotos(ids);
      } else if (mod(e) && e.key.toLowerCase() === "n") {
        e.preventDefault();
        st.setAlbumPicker(sel);
      } else if (mod(e) && e.key.toLowerCase() === "t") {
        e.preventDefault();
        st.toggleTags();
      } else if (mod(e) && e.key.toLowerCase() === "r" && sel.length) {
        e.preventDefault();
        rotateSelected(e.shiftKey ? -90 : 90);
      } else if (mod(e) && !e.shiftKey && e.key === "Enter" && sel.length === 1) {
        e.preventDefault();
        api.getPhoto(sel[0]).then((p) => revealItemInDir(p.path));
      } else if (mod(e) && e.shiftKey && e.key.toLowerCase() === "o" && sel.length === 1) {
        e.preventDefault();
        api.getPhoto(sel[0]).then((p) => api.openInDefaultApp(p.path));
      }
    };
    window.addEventListener("keydown", onKey);
    // Block the webview's own context menu; Picaluma will add its own later.
    const noMenu = (e: MouseEvent) => e.preventDefault();
    window.addEventListener("contextmenu", noMenu);

    return () => {
      unChanged.then((f) => f());
      unProgress.then((f) => f());
      unFaces.then((f) => f());
      unModels.then((f) => f());
      clearTimeout(offer);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("contextmenu", noMenu);
    };
  }, []);

  return (
    <div className="app">
      <MenuBar />
      {view === "library" ? <LibraryToolbar /> : <EditToolbar />}
      <div className="main">
        <div className="layers">
          {/* The library stays mounted under the editor so scroll position survives the round trip. */}
          <div className={`layer${view === "library" ? "" : " hidden"}`}>
            <LeftPanel />
            <Splitter />
            <LibraryGrid />
          </div>
          <div className={`layer${view === "edit" ? "" : " hidden"}`}>
            <EditView active={view === "edit"} />
          </div>
        </div>
        {showProps &&
          (sidePanel === "tags" ? <TagsPanel /> : sidePanel === "people" ? <PeoplePanel /> : sidePanel === "places" ? (
            <Suspense fallback={null}>
              <PlacesPanel />
            </Suspense>
          ) : <PropertiesPanel />)}
      </div>
      <StatusBar />
      <Tray />
      <FlightOverlay />
      <Slideshow />
      <FolderManager />
      <ContextMenu />
      <ScanNotifier />
      <OptionsDialog />
      <AlbumPicker />
      <ExportDialog />
      <EmailDialog />
      <PrintView />
      <CollageDialog />
      <ShortcutsDialog />
      <AboutDialog />
      <ConfirmDialog />
      <TextPrompt />
    </div>
  );
}
