import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { api, ScanProgress } from "./api";
import { useStore } from "./store";
import MenuBar from "./components/MenuBar";
import LibraryToolbar from "./components/LibraryToolbar";
import LeftPanel from "./components/LeftPanel";
import LibraryGrid from "./components/LibraryGrid";
import PropertiesPanel from "./components/PropertiesPanel";
import StatusBar from "./components/StatusBar";
import Tray from "./components/Tray";
import EditView, { EditToolbar } from "./components/EditView";
import FlightOverlay from "./components/FlightOverlay";
import Slideshow from "./components/Slideshow";
import FolderManager from "./components/FolderManager";

export default function App() {
  const view = useStore((s) => s.view);
  const showProps = useStore((s) => s.showProps);

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

    const onKey = (e: KeyboardEvent) => {
      const st = useStore.getState();
      const typing = (e.target as HTMLElement).tagName === "INPUT" && (e.target as HTMLInputElement).type !== "range";
      if (typing || st.slideshow) return;
      const sel = [...st.selected];
      if (e.ctrlKey && e.shiftKey && (e.key === "8" || e.key === "*")) {
        e.preventDefault();
        st.toggleStar(sel);
      } else if (e.ctrlKey && e.key === "3" && sel.length === 1) {
        e.preventDefault();
        st.openEditor(sel[0]);
      } else if (e.ctrlKey && e.key === "4") {
        e.preventDefault();
        const f = st.currentFolderId != null ? st.folderById.get(st.currentFolderId) : undefined;
        if (f) st.startSlideshow(f.photos);
      } else if (e.ctrlKey && e.key === "1") {
        e.preventDefault();
        st.setThumbSize(100);
      } else if (e.ctrlKey && e.key === "2") {
        e.preventDefault();
        st.setThumbSize(150);
      } else if (e.ctrlKey && e.key.toLowerCase() === "d") {
        e.preventDefault();
        st.clearSelection();
      } else if (e.altKey && e.key === "Enter") {
        e.preventDefault();
        st.toggleProps();
      }
    };
    window.addEventListener("keydown", onKey);
    // Block the webview's own context menu; Picaluma will add its own later.
    const noMenu = (e: MouseEvent) => e.preventDefault();
    window.addEventListener("contextmenu", noMenu);

    return () => {
      unChanged.then((f) => f());
      unProgress.then((f) => f());
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
            <LibraryGrid />
          </div>
          <div className={`layer${view === "edit" ? "" : " hidden"}`}>
            <EditView active={view === "edit"} />
          </div>
        </div>
        {showProps && <PropertiesPanel />}
      </div>
      <StatusBar />
      <Tray />
      <FlightOverlay />
      <Slideshow />
      <FolderManager />
    </div>
  );
}
