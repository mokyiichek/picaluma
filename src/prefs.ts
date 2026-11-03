/** Per-computer preferences set in Tools › Options (kept in the window's storage). */

const get = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const set = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* private mode: the default stays */
  }
};

/** Options › Privacy: leave out where pictures were taken (GPS) when exporting or e-mailing. */
export const stripGps = () => get("privacy.stripGps") === "1";
export const setStripGps = (on: boolean) => set("privacy.stripGps", on ? "1" : "0");

/** Options › General: open the last folder you looked at when Picaluma starts. */
export const reopenLastFolder = () => get("general.reopenLast") !== "0";
export const setReopenLastFolder = (on: boolean) => set("general.reopenLast", on ? "1" : "0");

/** Options › General: look for a new version a little after Picaluma starts. */
export const checkUpdates = () => get("general.checkUpdates") !== "0";
export const setCheckUpdates = (on: boolean) => set("general.checkUpdates", on ? "1" : "0");

export { get as getPref, set as setPref };
