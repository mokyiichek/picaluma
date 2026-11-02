import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { api } from "../api";
import { useStore } from "../store";

// One source for the app's description and links: the same wording as https://ahmok.com/picaluma/.
export const SITE_URL = "https://ahmok.com/picaluma/";
export const SOURCE_URL = "https://github.com/mokyiichek/picaluma";
export const ISSUES_URL = "https://github.com/mokyiichek/picaluma/issues";
export const RELEASES_URL = "https://github.com/mokyiichek/picaluma/releases";
export const TAGLINE =
  "A free, open-source photo organizer and editor for Windows, Mac and Linux. Every folder on one page, instant search, one-click fixes — and your originals are never touched.";

function Link({ href, children }: { href: string; children?: React.ReactNode }) {
  return (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault();
        openUrl(href);
      }}
    >
      {children ?? href}
    </a>
  );
}

type Update =
  | { s: "idle" | "checking" | "latest" }
  | { s: "available"; version: string; canInstall: boolean }
  | { s: "installing"; pct: number }
  | { s: "failed"; message: string };

let checkOnOpen = false;

/** Help › Check for Updates: the same check as the button in About. */
export function checkForUpdates() {
  checkOnOpen = true;
  useStore.getState().setAboutOpen(true);
}

function UpdateRow({ update, check, install }: { update: Update; check: () => void; install: () => void }) {
  switch (update.s) {
    case "idle":
      return <button className="tbtn" onClick={check}>Check for Updates</button>;
    case "checking":
      return <span>Checking for updates…</span>;
    case "latest":
      return <span>You have the latest version.</span>;
    case "available":
      return (
        <>
          <span>Version {update.version} is available.</span>{" "}
          {update.canInstall ? (
            <>
              <button className="tbtn" onClick={install}>Update Now</button>
              <div className="fine">Picaluma will restart. Your library and settings stay as they are.</div>
            </>
          ) : (
            <button className="tbtn" onClick={() => openUrl(SITE_URL)}>Open Download Page</button>
          )}
        </>
      );
    case "installing":
      return <span>{update.pct < 100 ? `Downloading… ${update.pct}%` : "Installing… Picaluma will restart."}</span>;
    case "failed":
      return (
        <>
          <span>Couldn't update: {update.message}</span> <Link href={SITE_URL}>Download page</Link>
        </>
      );
  }
}

/** Help › About Picaluma. */
export default function AboutDialog() {
  const open = useStore((s) => s.aboutOpen);
  const [version, setVersion] = useState("");
  const [update, setUpdate] = useState<Update>({ s: "idle" });
  const check = () => {
    setUpdate({ s: "checking" });
    api
      .updateCheck()
      .then((u) => setUpdate(u.newer ? { s: "available", version: u.latest, canInstall: u.canInstall } : { s: "latest" }))
      .catch((e) => setUpdate({ s: "failed", message: String(e) }));
  };
  const install = async () => {
    setUpdate({ s: "installing", pct: 0 });
    const stop = await listen<number>("update-progress", (e) => setUpdate({ s: "installing", pct: e.payload }));
    try {
      await api.updateInstall();
    } catch (e) {
      setUpdate({ s: "failed", message: String(e) });
    }
    stop();
  };
  useEffect(() => {
    if (!open) return;
    getVersion().then(setVersion).catch(() => {});
    if (checkOnOpen) check();
    else setUpdate({ s: "idle" });
    checkOnOpen = false;
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!open) return null;
  // Stays open while updating: it shows why Picaluma is about to restart.
  const close = () => update.s !== "installing" && useStore.getState().setAboutOpen(false);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && close()} onKeyDown={(e) => e.key === "Escape" && close()}>
      <div className="modal about">
        <div className="body">
          <img src="/logo.png" width={112} height={112} alt="" />
          <h2>Picaluma</h2>
          <div className="ver">Version {version}</div>
          <div className="update">
            <UpdateRow update={update} check={check} install={install} />
          </div>
          <p className="tagline">{TAGLINE}</p>
          <table className="links">
            <tbody>
              <tr>
                <td>Website</td>
                <td>
                  <Link href={SITE_URL} />
                </td>
              </tr>
              <tr>
                <td>Source code</td>
                <td>
                  <Link href={SOURCE_URL} />
                </td>
              </tr>
              <tr>
                <td>Report a problem</td>
                <td>
                  <Link href={ISSUES_URL} />
                </td>
              </tr>
              <tr>
                <td>All versions</td>
                <td>
                  <Link href={RELEASES_URL} />
                </td>
              </tr>
            </tbody>
          </table>
          <p className="fine">
            Free and open source (Apache-2.0 / MIT).
            <br />
            Picaluma is an independent project, not affiliated with or endorsed by Google. “Picasa” is a trademark of Google LLC.
          </p>
        </div>
        <div className="foot">
          <button className="tbtn default" onClick={close} autoFocus>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
