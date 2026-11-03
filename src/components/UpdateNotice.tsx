import { useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { checkUpdates } from "../prefs";
import { useStore } from "../store";
import { SITE_URL, useUpdater } from "./AboutDialog";
import { CloseIcon } from "./Icons";

/**
 * A little after Picaluma starts, it looks for a new version (Options › General can turn this off).
 * When there is one, a small panel offers it: one click downloads it, installs it and restarts.
 */
export default function UpdateNotice() {
  const { update, check, install } = useUpdater();
  const [hidden, setHidden] = useState(false);
  const aboutOpen = useStore((s) => s.aboutOpen);
  useEffect(() => {
    if (!checkUpdates()) return;
    const t = window.setTimeout(() => check(true), 10_000);
    return () => clearTimeout(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // About has its own update button; two at once would be confusing.
  const shown = update.s === "available" || update.s === "installing" || update.s === "failed";
  if (hidden || !shown || (aboutOpen && update.s === "available")) return null;
  return (
    <div className="scan-notifier update-notice">
      {update.s !== "installing" && (
        <button className="close" title="Later" onClick={() => setHidden(true)}>
          <CloseIcon size={12} />
        </button>
      )}
      <img className="logo" src="/logo.png" width={44} height={44} alt="" />
      <div className="txt">
        {update.s === "available" && (
          <>
            <b>Picaluma {update.version} is available</b>
            <span>Your library and settings stay as they are.</span>
            <div className="btns">
              {update.canInstall ? (
                <button className="tbtn default" onClick={install}>
                  Update Now
                </button>
              ) : (
                <button className="tbtn default" onClick={() => openUrl(SITE_URL)}>
                  Open Download Page
                </button>
              )}
              <button className="tbtn" onClick={() => setHidden(true)}>
                Later
              </button>
            </div>
          </>
        )}
        {update.s === "installing" && (
          <>
            <b>{update.pct < 100 ? "Downloading the update…" : "Installing… Picaluma will restart."}</b>
            <div className="bar">
              <div style={{ width: `${update.pct}%` }} />
            </div>
          </>
        )}
        {update.s === "failed" && (
          <>
            <b>Couldn't update</b>
            <span className="cur">{update.message}</span>
            <div className="btns">
              <button className="tbtn" onClick={() => openUrl(SITE_URL)}>
                Open Download Page
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
