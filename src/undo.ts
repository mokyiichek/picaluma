/**
 * Edit › Undo (Ctrl+Z / ⌘Z) in the library, as in Picasa: takes back the last move, hide or
 * delete. Deleted pictures come back out of the Recycle Bin / Trash with their stars, captions,
 * albums and faces. Edit view keeps its own undo for picture edits. The steps last until the
 * app quits.
 */
import { useStore } from "./store";
import { notify } from "./dialogs";

export interface UndoStep {
  /** "Move", "Hide", "Delete"… shown as "Undo Move". */
  label: string;
  run: () => Promise<void>;
}

const steps: UndoStep[] = [];
const MAX_STEPS = 30;
let running = false;

function publish() {
  useStore.setState({ undoLabel: steps.length ? steps[steps.length - 1].label : null });
}

export function pushUndo(step: UndoStep) {
  steps.push(step);
  if (steps.length > MAX_STEPS) steps.shift();
  publish();
}

export async function undoLast() {
  if (running) return;
  const step = steps.pop();
  publish();
  if (!step) return;
  running = true;
  try {
    await step.run();
  } catch (e) {
    notify(`Couldn't undo: ${e}`, "error");
  } finally {
    running = false;
    await useStore.getState().loadSnapshot();
  }
}
