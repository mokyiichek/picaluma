import { useEffect, useRef, useState } from "react";
import { thumbUrl } from "../api";
import { useStore } from "../store";
import { CloseIcon, FolderIcon } from "./Icons";

/**
 * Picasa's scanning notifier: a small panel that slides in at the bottom-right while folders
 * are being discovered and read, with the newest pictures fanned out, and slides away when done.
 */
export default function ScanNotifier() {
  const scan = useStore((s) => s.scan);
  const newestFolder = useStore((s) => s.snapshot?.folders[0]?.photos ?? EMPTY);
  const newest = newestFolder.slice(-3);
  const [visible, setVisible] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [finished, setFinished] = useState(false);
  const wasScanning = useRef(false);

  useEffect(() => {
    if (scan.scanning) {
      wasScanning.current = true;
      setFinished(false);
      if (!dismissed) setVisible(true);
      return;
    }
    if (!wasScanning.current) return;
    // Show "done" briefly, then slide away.
    wasScanning.current = false;
    setFinished(true);
    const t = window.setTimeout(() => {
      setVisible(false);
      setDismissed(false);
    }, 2200);
    return () => clearTimeout(t);
  }, [scan.scanning, dismissed]);

  if (!visible) return null;
  const indexing = scan.phase === "indexing" && scan.toIndex > 0;
  const pct = indexing ? Math.min(100, (scan.indexed / scan.toIndex) * 100) : 0;

  return (
    <div className={`scan-notifier${finished ? " done" : ""}`}>
      <button className="close" title="Hide" onClick={() => (setVisible(false), setDismissed(true))}>
        <CloseIcon size={12} />
      </button>
      <div className="fan">
        {newest.map((id, i) => (
          <img key={id} src={thumbUrl(id)} style={{ transform: `rotate(${(i - 1) * 8}deg)`, left: 6 + i * 10 }} alt="" />
        ))}
        {!newest.length && <FolderIcon size={36} />}
      </div>
      <div className="txt">
        <b>{finished ? "Picaluma is up to date" : indexing ? "Reading pictures…" : "Scanning for pictures…"}</b>
        {!finished && scan.current && <span className="cur">{scan.current}</span>}
        <span>
          {finished
            ? `${useStore.getState().snapshot?.totalPhotos.toLocaleString() ?? 0} pictures`
            : indexing
              ? `${scan.indexed.toLocaleString()} of ${scan.toIndex.toLocaleString()}`
              : `${scan.photosFound.toLocaleString()} pictures in ${scan.foldersSeen.toLocaleString()} folders`}
        </span>
        {indexing && !finished && (
          <div className="bar">
            <div style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>
    </div>
  );
}

const EMPTY: number[] = [];
