import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet.markercluster";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
import { api, thumbUrl } from "../api";
import { selectVisible, useStore } from "../store";
import { CloseIcon } from "./Icons";

type Mode = "folder" | "all";

/**
 * Places (the tray's pin button), Picasa's map panel: where the pictures were taken, from their
 * GPS positions. Map tiles come from OpenStreetMap; pictures never leave the computer.
 */
export default function PlacesPanel() {
  const close = useStore((s) => s.togglePlaces);
  const selected = useStore((s) => s.selected);
  const current = useStore((s) => s.currentFolderId);
  const visible = useStore(selectVisible);
  const snapshot = useStore((s) => s.snapshot);
  const [mode, setMode] = useState<Mode>("folder");
  const [count, setCount] = useState(0);
  const [offline, setOffline] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.MarkerClusterGroup | null>(null);
  const markers = useRef(new Map<number, L.CircleMarker>());

  useEffect(() => {
    const m = L.map(host.current!, { zoomControl: true, worldCopyJump: true }).setView([20, 0], 2);
    const tiles = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(m);
    let failed = 0;
    tiles.on("tileerror", () => ++failed > 3 && setOffline(true));
    tiles.on("tileload", () => setOffline(false));
    layer.current = L.markerClusterGroup({ showCoverageOnHover: false, maxClusterRadius: 50 }).addTo(m);
    map.current = m;
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(host.current!);
    return () => {
      ro.disconnect();
      m.remove();
      map.current = null;
    };
  }, []);

  // Pins for the current folder (or the whole library).
  useEffect(() => {
    const ids = mode === "folder" ? visible.find((v) => v.folder.id === current)?.photos ?? [] : null;
    let live = true;
    api.places(ids).then((list) => {
      const m = map.current;
      const group = layer.current;
      if (!live || !m || !group) return;
      group.clearLayers();
      markers.current.clear();
      for (const [id, lat, lon] of list) {
        const mk = L.circleMarker([lat, lon], { radius: 7, color: "#fff", weight: 2, fillColor: "#e2241b", fillOpacity: 1 });
        mk.bindTooltip(`<img src="${thumbUrl(id)}" style="max-width:120px;max-height:120px;display:block" />`, { direction: "top", offset: [0, -6] });
        mk.on("click", () => {
          const s = useStore.getState();
          const folder = s.folderOfPhoto.get(id);
          if (folder != null && folder !== s.currentFolderId && mode === "all") s.selectFolder(folder);
          s.selectOnly([id]);
        });
        markers.current.set(id, mk);
        group.addLayer(mk);
      }
      setCount(list.length);
      if (list.length) m.fitBounds(L.latLngBounds(list.map(([, lat, lon]) => [lat, lon] as [number, number])), { padding: [24, 24], maxZoom: 15 });
    });
    return () => {
      live = false;
    };
  }, [mode, current, snapshot]); // eslint-disable-line react-hooks/exhaustive-deps

  // Selected pictures stand out.
  useEffect(() => {
    for (const [id, mk] of markers.current) {
      const on = selected.has(id);
      mk.setStyle({ fillColor: on ? "#1a8cff" : "#e2241b", radius: on ? 9 : 7 });
      if (on) mk.bringToFront();
    }
  }, [selected, count]);

  return (
    <div className="props places-panel">
      <div className="props-head">
        Places
        <button onClick={close} title="Close">
          <CloseIcon />
        </button>
      </div>
      <div className="places-bar">
        <button className={`tbtn${mode === "folder" ? " pressed" : ""}`} onClick={() => setMode("folder")}>
          This folder
        </button>
        <button className={`tbtn${mode === "all" ? " pressed" : ""}`} onClick={() => setMode("all")}>
          All pictures
        </button>
        <span className="muted">{count ? `${count.toLocaleString()} with a location` : "No locations"}</span>
      </div>
      <div className="places-map" ref={host} />
      {offline && <p className="muted small places-note">The map needs an internet connection.</p>}
    </div>
  );
}
