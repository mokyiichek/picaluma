import { useEffect, useRef, useState } from "react";
import { api, TagCount } from "../api";
import { mod } from "../platform";
import { DATE_STEPS, FolderSort, useStore } from "../store";
import { ClearIcon, ImportIcon, ListFlatIcon, ListTreeIcon, MovieIcon, PersonIcon, PinIcon, SearchIcon, StarIcon, TagIcon } from "./Icons";

const SORTS: [FolderSort, string][] = [
  ["created", "Creation Date"],
  ["updated", "Recent Changes"],
  ["size", "Size"],
  ["name", "Name"],
];

/** The ▾ next to the view buttons: Picasa's folder sort order. */
function SortMenu() {
  const [open, setOpen] = useState(false);
  const sort = useStore((s) => s.folderSort);
  const reverse = useStore((s) => s.sortReverse);
  const view = useStore((s) => s.folderView);
  const setSort = useStore((s) => s.setFolderSort);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);
  return (
    <span ref={ref} style={{ position: "relative" }}>
      <button className={`tbtn icon caret${open ? " pressed" : ""}`} title="Sort folders" onClick={() => setOpen(!open)}>
        ▾
      </button>
      {open && (
        <div className="menu-drop sort-menu">
          {view === "tree" && <div className="menu-item disabled">Tree view is in disk order</div>}
          {SORTS.map(([id, label]) => (
            <div
              key={id}
              className={`menu-item${sort === id && view === "flat" ? " checked" : ""}${view === "tree" ? " disabled" : ""}`}
              onMouseDown={() => view === "flat" && (setSort(id, reverse), setOpen(false))}
            >
              {label}
            </div>
          ))}
          <div className="menu-sep" />
          <div className={`menu-item${reverse ? " checked" : ""}`} onMouseDown={() => (setSort(sort, !reverse), setOpen(false))}>
            Reverse Order
          </div>
        </div>
      )}
    </span>
  );
}

const lastToken = (q: string) => (q.endsWith(" ") ? "" : q.split(/\s+/).pop() ?? "");

export default function LibraryToolbar() {
  const query = useStore((s) => s.query);
  const runSearch = useStore((s) => s.runSearch);
  const clearSearch = useStore((s) => s.clearSearch);
  const starredOnly = useStore((s) => s.starredOnly);
  const setStarredOnly = useStore((s) => s.setStarredOnly);
  const geoOnly = useStore((s) => s.geoOnly);
  const setGeoOnly = useStore((s) => s.setGeoOnly);
  const videoOnly = useStore((s) => s.videoOnly);
  const facesOnly = useStore((s) => s.facesOnly);
  const setFacesOnly = useStore((s) => s.setFacesOnly);
  const setVideoOnly = useStore((s) => s.setVideoOnly);
  const dateStep = useStore((s) => s.dateStep);
  const setDateStep = useStore((s) => s.setDateStep);
  const folderView = useStore((s) => s.folderView);
  const setFolderView = useStore((s) => s.setFolderView);
  const scanning = useStore((s) => s.scan.scanning);
  const input = useRef<HTMLInputElement>(null);
  const [suggestions, setSuggestions] = useState<TagCount[]>([]);
  const [active, setActive] = useState(-1);
  const seq = useRef(0);

  const updateSuggestions = (q: string) => {
    const token = lastToken(q);
    const mine = ++seq.current;
    setActive(-1);
    if (!token) return setSuggestions([]);
    api.suggest(token).then((list) => mine === seq.current && setSuggestions(list));
  };
  const pick = (tag: string) => {
    const words = query.trimEnd().split(/\s+/);
    words[words.length - 1] = tag;
    const q = words.join(" ");
    runSearch(q);
    setSuggestions([]);
  };

  useEffect(() => {
    const focus = (e: KeyboardEvent) => {
      if (mod(e) && e.key.toLowerCase() === "f") {
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
      <button className="tbtn" onClick={() => useStore.getState().setImportOpen(true)} title="Import pictures from a camera, memory card or folder (Ctrl+M)">
        <ImportIcon /> Import
      </button>
      <span className="tgroup">
        <button className={`tbtn icon${folderView === "flat" ? " pressed" : ""}`} title="Flat folder view" onClick={() => setFolderView("flat")}>
          <ListFlatIcon />
        </button>
        <button className={`tbtn icon${folderView === "tree" ? " pressed" : ""}`} title="Tree folder view" onClick={() => setFolderView("tree")}>
          <ListTreeIcon />
        </button>
      </span>
      <SortMenu />
      <div className="filters">
        <span className="label">{dateStep ? `Filters · ${DATE_STEPS[dateStep][0].toLowerCase()}` : "Filters"}</span>
        <span className="row">
          <button className={`tbtn${starredOnly ? " pressed" : ""}`} title="Show only starred photos" onClick={() => setStarredOnly(!starredOnly)}>
            <StarIcon size={14} />
          </button>
          <button className={`tbtn${facesOnly ? " pressed" : ""}`} title="Show only photos with faces" onClick={() => setFacesOnly(!facesOnly)}>
            <PersonIcon size={14} />
          </button>
          <button className={`tbtn${videoOnly ? " pressed" : ""}`} title="Show only movies" onClick={() => setVideoOnly(!videoOnly)}>
            <MovieIcon size={14} />
          </button>
          <button className={`tbtn${geoOnly ? " pressed" : ""}`} title="Show only geotagged photos" onClick={() => setGeoOnly(!geoOnly)}>
            <PinIcon size={14} />
          </button>
          <input
            type="range"
            className="date-filter"
            min={0}
            max={DATE_STEPS.length - 1}
            step={1}
            value={dateStep}
            title={`Drag to show only recent photos: ${DATE_STEPS[dateStep][0]}`}
            onChange={(e) => setDateStep(Number(e.target.value))}
            onDoubleClick={() => setDateStep(0)}
          />
        </span>
      </div>
      <div className="searchbox" style={{ position: "relative" }}>
        <SearchIcon size={15} />
        <input
          ref={input}
          value={query}
          spellCheck={false}
          placeholder=""
          onChange={(e) => {
            runSearch(e.target.value);
            updateSuggestions(e.target.value);
          }}
          onBlur={() => setTimeout(() => setSuggestions([]), 150)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              if (suggestions.length) return setSuggestions([]);
              clearSearch();
              input.current?.blur();
            } else if (e.key === "ArrowDown" && suggestions.length) {
              e.preventDefault();
              setActive((a) => (a + 1) % suggestions.length);
            } else if (e.key === "ArrowUp" && suggestions.length) {
              e.preventDefault();
              setActive((a) => (a <= 0 ? suggestions.length - 1 : a - 1));
            } else if (e.key === "Enter" && active >= 0 && suggestions[active]) {
              pick(suggestions[active].tag);
            }
          }}
        />
        {suggestions.length > 0 && (
          <div className="suggest">
            {suggestions.map((s, i) => (
              <div key={s.tag} className={i === active ? "active" : ""} onMouseDown={() => pick(s.tag)}>
                <TagIcon size={13} />
                <span>
                  <b>{s.tag.slice(0, lastToken(query).length)}</b>
                  {s.tag.slice(lastToken(query).length)} ({s.count})
                </span>
              </div>
            ))}
          </div>
        )}
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
