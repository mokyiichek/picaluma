import { useEffect, useState } from "react";
import { api, Face, faceUrl, FaceGroup, Person } from "../api";
import { useStore } from "../store";
import { confirmAsk, notify } from "../dialogs";

const NO_PEOPLE: Person[] = [];
const PAGE = 30;

/** Reload the library (People list, counts) after a change. */
export const refreshPeople = () => useStore.getState().loadSnapshot();

/** Names typed so far, for autocomplete in every "Add a name" box. */
export function PeopleNames() {
  const people = useStore((s) => s.snapshot?.people ?? NO_PEOPLE);
  return (
    <datalist id="people-names">
      {people.map((p) => (
        <option key={p.id} value={p.name} />
      ))}
    </datalist>
  );
}

/** A face close-up. Double-click opens its picture. */
export function FaceTile({ face, size = 64, dim, onClick, children }: { face: Face; size?: number; dim?: boolean; onClick?: () => void; children?: React.ReactNode }) {
  return (
    <div
      className={`face-tile${dim ? " dim" : ""}`}
      style={{ width: size, height: size }}
      title={face.name ?? "Double-click to open the picture"}
      onClick={onClick}
      onDoubleClick={() => useStore.getState().openEditor(face.photoId)}
    >
      <img src={faceUrl(face.id)} alt="" draggable={false} loading="lazy" />
      {children}
    </div>
  );
}

/**
 * Tools › People Manager, Picasa's way: unnamed faces grouped by likeness, each group named in
 * one go ("Add a name"), and suggested faces to confirm ✔ or reject ✖ for each person.
 */
export default function PeopleManager() {
  const pm = useStore((s) => s.peopleManager);
  const people = useStore((s) => s.snapshot?.people ?? NO_PEOPLE);
  const unnamed = useStore((s) => s.snapshot?.unnamed ?? 0);
  const snapshot = useStore((s) => s.snapshot);
  const progress = useStore((s) => s.faceProgress);
  const [groups, setGroups] = useState<FaceGroup[]>([]);
  const [limit, setLimit] = useState(PAGE);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (pm?.tab !== "unnamed") return;
    let live = true;
    api.unnamedGroups(0, limit).then((g) => {
      if (!live) return;
      setGroups(g);
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, [pm?.tab, limit, snapshot]);

  useEffect(() => {
    if (!pm) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && useStore.getState().view === "library" && !(e.target as HTMLElement).closest("input")) useStore.getState().setPeopleManager(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pm != null]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!pm) return null;
  const suggesting = people.filter((p) => p.suggestions > 0 && (pm.person == null || p.id === pm.person));
  const totalSuggestions = people.reduce((n, p) => n + p.suggestions, 0);
  const setTab = (tab: "unnamed" | "suggestions") => useStore.getState().setPeopleManager({ tab });

  return (
    <div className="people-manager">
      <div className="pm-head">
        <h2>People Manager</h2>
        <div className="pm-tabs">
          <button className={`opt-tab${pm.tab === "unnamed" ? " active" : ""}`} onClick={() => setTab("unnamed")}>
            Unnamed ({unnamed.toLocaleString()})
          </button>
          <button className={`opt-tab${pm.tab === "suggestions" ? " active" : ""}`} onClick={() => setTab("suggestions")}>
            Suggestions ({totalSuggestions.toLocaleString()})
          </button>
        </div>
        <span className="pm-status">
          {progress.running ? `Finding faces… ${progress.done.toLocaleString()} of ${progress.total.toLocaleString()} pictures` : ""}
        </span>
        <button className="tbtn" onClick={() => useStore.getState().setPeopleManager(null)}>
          Back to Library
        </button>
      </div>
      <div className="pm-body">
        {pm.tab === "unnamed" ? (
          <>
            {!loading && !groups.length && (
              <p className="pm-empty">
                {progress.running ? "Faces will appear here as Picaluma finds them." : "No unnamed faces. Everyone has a name!"}
              </p>
            )}
            {groups.map((g) => (
              <GroupRow key={g.group} group={g} />
            ))}
            {groups.length >= limit && (
              <button className="tbtn pm-more" onClick={() => setLimit(limit + PAGE)}>
                Show more groups
              </button>
            )}
          </>
        ) : (
          <>
            {!suggesting.length && <p className="pm-empty">No suggestions to review. Name more faces and Picaluma will suggest who else looks like them.</p>}
            {suggesting.map((p) => (
              <SuggestionBlock key={p.id} person={p} />
            ))}
          </>
        )}
      </div>
      <PeopleNames />
    </div>
  );
}

/** One group of faces that look alike, with a name box. Click a face to leave it out. */
function GroupRow({ group }: { group: FaceGroup }) {
  const [left, setLeft] = useState<Set<number>>(new Set());
  const [all, setAll] = useState(false);
  const [name, setName] = useState("");
  const shown = all ? group.faces : group.faces.slice(0, 16);
  const toggle = (id: number) => {
    const next = new Set(left);
    next.has(id) ? next.delete(id) : next.add(id);
    setLeft(next);
  };
  const save = async () => {
    const n = name.trim();
    if (!n) return;
    try {
      if (left.size) {
        await api.nameFaces(group.faces.filter((f) => !left.has(f.id)).map((f) => f.id), [], n);
        await api.rejectFaces([...left]); // they start groups of their own
      } else {
        await api.nameFaces([], [group.group], n);
      }
      await refreshPeople();
    } catch (e) {
      notify(String(e), "error");
    }
  };
  const ignore = async () => {
    const ids = group.faces.filter((f) => !left.has(f.id)).map((f) => f.id);
    await api.ignoreFaces(ids);
    await refreshPeople();
  };
  return (
    <div className="pm-group">
      <div className="pm-faces">
        {shown.map((f) => (
          <FaceTile key={f.id} face={f} dim={left.has(f.id)} onClick={() => toggle(f.id)}>
            {left.has(f.id) && <span className="face-x">✕</span>}
          </FaceTile>
        ))}
        {!all && group.faces.length > shown.length && (
          <button className="face-more" onClick={() => setAll(true)}>
            +{(group.count - shown.length).toLocaleString()}
          </button>
        )}
      </div>
      <div className="pm-name">
        <span className="muted">
          {group.count.toLocaleString()} face{group.count === 1 ? "" : "s"}
          {left.size ? ` · ${left.size} left out` : ""}
        </span>
        <input list="people-names" placeholder="Add a name" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} />
        <button className="tbtn" disabled={!name.trim()} onClick={save}>
          OK
        </button>
        <button className="tbtn" title="Hide these faces from People" onClick={ignore}>
          Ignore
        </button>
      </div>
    </div>
  );
}

/** "Is this <name>?" — faces that look like a named person, to confirm or reject. */
function SuggestionBlock({ person }: { person: Person }) {
  const snapshot = useStore((s) => s.snapshot);
  const [faces, setFaces] = useState<Face[]>([]);
  useEffect(() => {
    api.personFaces(person.id, true).then(setFaces);
  }, [person.id, snapshot]);
  const act = async (fn: () => Promise<void>, ids: number[]) => {
    setFaces((f) => f.filter((x) => !ids.includes(x.id)));
    await fn();
    await refreshPeople();
  };
  if (!faces.length) return null;
  const ids = faces.map((f) => f.id);
  return (
    <div className="pm-group">
      <div className="pm-suggest-head">
        {person.cover != null && <img className="face-ico big" src={faceUrl(person.cover)} alt="" />}
        <b>Is this {person.name}?</b>
        <span className="muted">{faces.length.toLocaleString()} suggestions</span>
        <button className="tbtn" onClick={() => act(() => api.confirmFaces(ids), ids)}>
          ✔ Confirm all
        </button>
        <button
          className="tbtn"
          onClick={async () => {
            if (await confirmAsk(`None of these ${faces.length} faces are ${person.name}?`, { ok: "Reject all" })) act(() => api.rejectFaces(ids), ids);
          }}
        >
          ✖ Reject all
        </button>
      </div>
      <div className="pm-faces">
        {faces.map((f) => (
          <FaceTile key={f.id} face={f}>
            <span className="face-acts">
              <button title={`Yes, this is ${person.name}`} onClick={(e) => (e.stopPropagation(), act(() => api.confirmFaces([f.id]), [f.id]))}>
                ✔
              </button>
              <button title={`No, this isn't ${person.name}`} onClick={(e) => (e.stopPropagation(), act(() => api.rejectFaces([f.id]), [f.id]))}>
                ✖
              </button>
            </span>
          </FaceTile>
        ))}
      </div>
    </div>
  );
}
