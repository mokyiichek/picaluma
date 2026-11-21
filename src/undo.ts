/**
 * Edit › Undo / Redo (Ctrl+Z / Ctrl+Y, ⌘Z / ⇧⌘Z on a Mac) in the library: moves, copies, hides,
 * deletes (back out of the Recycle Bin / Trash) and edits made from the library (rotate, batch
 * effects, paste effects, revert). Edit view keeps its own per-picture history, reached through
 * `editHistory`. The history lasts until the app quits.
 */
import { useStore } from "./store";
import { notify } from "./dialogs";

export interface UndoAction {
  /** "Move", "Copy", "Hide", "Delete", "Rotate"… shown as "Undo Move" / "Redo Move". */
  label: string;
  undo: () => Promise<unknown> | void;
  redo: () => Promise<unknown> | void;
}

const done: UndoAction[] = [];
const undone: UndoAction[] = [];
const MAX_STEPS = 50;
let running = false;

function publish() {
  useStore.setState({
    undoLabel: done.length ? done[done.length - 1].label : null,
    redoLabel: undone.length ? undone[undone.length - 1].label : null,
  });
}

/** Records something just done. A new action clears what could be redone. */
export function pushUndo(action: UndoAction) {
  done.push(action);
  if (done.length > MAX_STEPS) done.shift();
  undone.length = 0;
  publish();
}

async function step(from: UndoAction[], to: UndoAction[], which: "undo" | "redo") {
  if (running) return;
  const action = from.pop();
  if (!action) return publish();
  running = true;
  try {
    await action[which]();
    to.push(action);
  } catch (e) {
    notify(`Couldn't ${which}: ${e}`, "error");
  } finally {
    running = false;
    publish();
    await useStore.getState().loadSnapshot();
  }
}

export const undoLast = () => step(done, undone, "undo");
export const redoLast = () => step(undone, done, "redo");

/** Edit view's own history (the current picture's edits), registered by the editor. */
export const editHistory = { undo: () => {}, redo: () => {} };

/**
 * Runs an edit made from the library (rotate, effects, revert) and records it, so Undo puts
 * the pictures' previous edits back and Redo applies them again.
 */
export function recordEdits(label: string, ids: number[], change: () => void) {
  const s = useStore.getState();
  const before = new Map(ids.map((id) => [id, [...(s.edits.get(id) ?? [])]]));
  change();
  const now = useStore.getState();
  const after = new Map(ids.map((id) => [id, [...(now.edits.get(id) ?? [])]]));
  if (ids.every((id) => JSON.stringify(before.get(id)) === JSON.stringify(after.get(id)))) return;
  const put = (m: typeof before) => {
    const st = useStore.getState();
    for (const [id, list] of m) st.setPhotoEdits(id, [...list]);
  };
  pushUndo({ label, undo: () => put(before), redo: () => put(after) });
}
