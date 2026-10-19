import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
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

/** Help › About Picaluma. */
export default function AboutDialog() {
  const open = useStore((s) => s.aboutOpen);
  const [version, setVersion] = useState("");
  useEffect(() => {
    if (open) getVersion().then(setVersion).catch(() => {});
  }, [open]);
  if (!open) return null;
  const close = () => useStore.getState().setAboutOpen(false);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && close()} onKeyDown={(e) => e.key === "Escape" && close()}>
      <div className="modal about">
        <div className="body">
          <img src="/logo.png" width={112} height={112} alt="" />
          <h2>Picaluma</h2>
          <div className="ver">Version {version}</div>
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
