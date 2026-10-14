import { useEffect, useRef, useState } from "react";
import { api, TagCount } from "../api";
import { useStore } from "../store";
import { ClearIcon, ImportIcon, ListFlatIcon, ListTreeIcon, PersonIcon, PinIcon, SearchIcon, StarIcon, MovieIcon, PicturesIcon, TagIcon } from "./Icons";

const lastToken = (q: string) => (q.endsWith(" ") ? "" : q.split(/\s+/).pop() ?? "");

export default function LibraryToolbar() {
  const query = useStore((s) => s.query);
  const runSearch = useStore((s) => s.runSearch);
  const clearSearch = useStore((s) => s.clearSearch);
  const starredOnly = useStore((s) => s.starredOnly);
  const setStarredOnly = useStore((s) => s.setStarredOnly);
  const scanning = useStore((s) => s.scan.scanning);
  const setFolderManager = useStore((s) => s.setFolderManager);
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
