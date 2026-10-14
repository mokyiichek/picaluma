import { useEffect, useRef } from "react";
import { useStore } from "../store";
import { ClearIcon, ImportIcon, ListFlatIcon, ListTreeIcon, PersonIcon, PinIcon, SearchIcon, StarIcon, MovieIcon, PicturesIcon } from "./Icons";

export default function LibraryToolbar() {
  const query = useStore((s) => s.query);
  const runSearch = useStore((s) => s.runSearch);
  const clearSearch = useStore((s) => s.clearSearch);
  const starredOnly = useStore((s) => s.starredOnly);
  const setStarredOnly = useStore((s) => s.setStarredOnly);
  const scanning = useStore((s) => s.scan.scanning);
  const setFolderManager = useStore((s) => s.setFolderManager);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const focus = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        input.current?.focus();
        input.current?.select();
      }
    };
    window.addEventListener("keydown", focus);
    return () => window.removeEventListener("keydown", focus);
  }, []);

  return (
    <div className="toolbar">
      <button className="tbtn" onClick={() => setFolderManager(true)} title="Add folders to Picaluma">
        <ImportIcon /> Import
      </button>
      <span className="tgroup">
        <button className="tbtn icon pressed" title="Flat folder view">
          <ListFlatIcon />
        </button>
        <button className="tbtn icon" title="Tree folder view (coming soon)" disabled>
          <ListTreeIcon />
        </button>
      </span>
      <div className="filters">
        <span className="label">Filters</span>
        <span className="row">
          <button className={`tbtn${starredOnly ? " pressed" : ""}`} title="Show only starred photos" onClick={() => setStarredOnly(!starredOnly)}>
            <StarIcon size={14} />
          </button>
          <button className="tbtn" title="Show only uploaded photos (coming soon)" disabled>
            <PicturesIcon size={14} />
          </button>
          <button className="tbtn" title="Show only photos with faces (coming soon)" disabled>
            <PersonIcon size={14} />
          </button>
          <button className="tbtn" title="Show only movies (coming soon)" disabled>
            <MovieIcon size={14} />
          </button>
          <button className="tbtn" title="Show only geotagged items (coming soon)" disabled>
            <PinIcon size={14} />
          </button>
        </span>
      </div>
      <div className="searchbox">
        <SearchIcon size={15} />
        <input
          ref={input}
          value={query}
          spellCheck={false}
          placeholder=""
          onChange={(e) => runSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              clearSearch();
              input.current?.blur();
            }
          }}
        />
        {query && (
          <button className="clear" onClick={clearSearch} title="Clear search">
            <ClearIcon />
          </button>
        )}
      </div>
      <div style={{ width: 22, display: "flex", justifyContent: "center" }} title={scanning ? "Scanning folders…" : ""}>
        {scanning && <div className="spinner" />}
      </div>
    </div>
  );
}
