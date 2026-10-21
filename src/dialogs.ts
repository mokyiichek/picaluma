// Dialogs that really wait for an answer. The webview's window.confirm() doesn't block in
// WKWebView on macOS — it returned straight away, so pictures were deleted before the user could
// press Cancel — and window.prompt() isn't available there at all. Everything goes through here.
import { message } from "@tauri-apps/plugin-dialog";
import { useStore } from "./store";

/** Options › "Delete from disk without confirmation" / "Remove from album without confirmation". */
export const NO_CONFIRM_DELETE = "noConfirmDelete";
export const NO_CONFIRM_REMOVE = "noConfirmRemoveFromAlbum";

export interface ConfirmOptions {
  title?: string;
  ok?: string;
  /** Label of the button that says no (default "Cancel"). */
  cancel?: string;
  /** Destructive and permanent: the dialog starts on Cancel. */
  danger?: boolean;
  /** Offer "Don't ask again", remembered under this localStorage key. */
  dontAskKey?: string;
}

export const skipsConfirm = (key: string) => {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
};

/** Yes/no question in Picaluma's own dialog; resolves true only when the user picks OK. */
export function confirmAsk(text: string, opts: ConfirmOptions = {}): Promise<boolean> {
  if (opts.dontAskKey && skipsConfirm(opts.dontAskKey)) return Promise.resolve(true);
  return new Promise((resolve) =>
    useStore.getState().setConfirmReq({
      title: opts.title ?? "Picaluma",
      text,
      ok: opts.ok ?? "OK",
      cancel: opts.cancel,
      danger: !!opts.danger,
      dontAskKey: opts.dontAskKey,
      resolve,
    }),
  );
}

/** Information or error message with a single OK button (native). */
export function notify(text: string, kind: "info" | "warning" | "error" = "info"): Promise<void> {
  return message(text, { title: "Picaluma", kind }).then(
    () => undefined,
    () => undefined,
  );
}

/** Asks for a line of text in Picaluma's own dialog. Resolves null when cancelled. */
export function askText(label: string, value = "", ok = "OK"): Promise<string | null> {
  return new Promise((resolve) => useStore.getState().setTextPrompt({ label, value, ok, resolve }));
}
