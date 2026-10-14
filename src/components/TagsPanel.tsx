import { useEffect, useState } from "react";
import { api, TagCount } from "../api";
import { useStore } from "../store";
import { CloseIcon } from "./Icons";

const QUICK_KEY = "picaluma.quickTags";
const QUICK_SLOTS = 10;

function loadQuick(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(QUICK_KEY) ?? "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/** Picasa's Tags panel: add tags to the selection, see/remove existing ones, one-click Quick Tags. */
export default function TagsPanel() {
  const toggleTags = useStore((s) => s.toggleTags);
  const view = useStore((s) => s.view);
  const editId = useStore((s) => s.editId);
  const selSet = useStore((s) => s.selected);
  const selected = view === "edit" && editId != null ? [editId] : [...selSet];
  const key = selected.join(",");
  const [tags, setTags] = useState<TagCount[]>([]);
  const [text, setText] = useState("");
  const [quick, setQuick] = useState<string[]>(loadQuick);
  const [rev, setRev] = useState(0);

  useEffect(() => {
    if (!selected.length) return setTags([]);
    api.getTags(selected).then(setTags);
  }, [key, rev]); // eslint-disable-line react-hooks/exhaustive-deps

  const add = async (raw: string) => {
    const list = raw.split(",").map((t) => t.trim()).filter(Boolean);
    if (!list.length || !selected.length) return;
    await api.setTags(selected, list, []);
    setText("");
    setRev((r) => r + 1);
  };
  const remove = async (tag: string) => {
    await api.setTags(selected, [], [tag]);
    setRev((r) => r + 1);
  };
  const setSlot = (i: number) => {
    const v = prompt("Quick tag for this button:", quick[i] ?? "");
    if (v == null) return;
    const next = [...quick];
    next[i] = v.trim();
    setQuick(next);
    try {
      localStorage.setItem(QUICK_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };

  const title = selected.length === 1 ? "this picture" : `${selected.length} pictures`;
  return (
    <div className="props">
      <div className="props-head">
        Tags
        <button onClick={toggleTags} title="Close">
          <CloseIcon />
        </button>
      </div>
      <div className="tags-body">
        <label>Type in a tag to add:</label>
        <div className="tag-add">
          <input
            value={text}
            disabled={!selected.length}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add(text)}
          />
          <button className="plus" disabled={!text.trim() || !selected.length} onClick={() => add(text)} title="Add tag">
            +
          </button>
        </div>
        <label>{selected.length ? `Tags in ${title}:` : "Select pictures to see their tags."}</label>
        <div className="tag-list">
          {tags.map((t) => (
            <div className="tag-row" key={t.tag}>
              <span>
                {t.tag}
                {selected.length > 1 && <span className="muted"> ({t.count})</span>}
              </span>
              <button onClick={() => remove(t.tag)} title="Remove tag">
                ✕
              </button>
            </div>
          ))}
        </div>
        <label>Quick Tags:</label>
        <div className="quick-tags">
          {Array.from({ length: QUICK_SLOTS }, (_, i) => (
            <button
              key={i}
              className="tbtn"
              title={quick[i] ? `Add "${quick[i]}" (right-click to change)` : "Click to set a quick tag"}
              onClick={() => (quick[i] ? add(quick[i]) : setSlot(i))}
              onContextMenu={(e) => {
                e.preventDefault();
                setSlot(i);
              }}
            >
              {quick[i] || "?"}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
