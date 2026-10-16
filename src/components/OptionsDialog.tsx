import { useEffect, useState } from "react";
import { useStore } from "../store";

const TABS = ["General", "File Types", "Slideshow", "Experimental"] as const;

/** Tools › Options. Mirrors Picasa's tabbed Options dialog; General holds Special effects. */
export default function OptionsDialog() {
  const open = useStore((s) => s.optionsOpen);
  const setOpen = useStore((s) => s.setOptionsOpen);
  const effects = useStore((s) => s.effects);
  const setEffects = useStore((s) => s.setEffects);
  const [tab, setTab] = useState<(typeof TABS)[number]>("General");
  const [draft, setDraft] = useState(effects);
  useEffect(() => {
    if (open) setDraft(useStore.getState().effects);
  }, [open]);

  if (!open) return null;
  const close = () => {
    setDraft(useStore.getState().effects);
    setOpen(false);
  };
  const apply = () => setEffects(draft);

  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal options">
        <h3>Options</h3>
        <div className="opt-tabs">
          {TABS.map((t) => (
            <button key={t} className={`opt-tab${tab === t ? " active" : ""}`} onClick={() => setTab(t)}>
              {t}
            </button>
          ))}
        </div>
        <div className="body">
          {tab === "General" ? (
            <fieldset>
              <legend>Display</legend>
              <label className="opt-check">
                <input type="checkbox" checked={draft} onChange={(e) => setDraft(e.target.checked)} />
                <span>
                  <b>Special effects</b>
                  <br />
                  <span className="muted">
                    Animated transitions: smooth wheel scrolling, gliding folder-to-folder scrolling, zooming into and out of
                    photos, thumbnail resizing and panel slide-ins.
                  </span>
                </span>
              </label>
            </fieldset>
          ) : (
            <p className="muted">These settings will arrive in a later release.</p>
          )}
        </div>
        <div className="foot">
          <button
            className="tbtn"
            onClick={() => {
              apply();
              setOpen(false);
            }}
          >
            OK
          </button>
          <button className="tbtn" onClick={close}>
            Cancel
          </button>
          <button className="tbtn" onClick={apply}>
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
