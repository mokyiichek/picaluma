import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";

/**
 * Picaluma's confirmation dialog (used by confirmAsk). It waits for an answer on every platform
 * and, like Picasa's "Confirm Delete", can offer "Don't ask again".
 */
export default function ConfirmDialog() {
  const req = useStore((s) => s.confirmReq);
  const [dontAsk, setDontAsk] = useState(false);
  const okBtn = useRef<HTMLButtonElement>(null);
  const cancelBtn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!req) return;
    setDontAsk(false);
    // Permanent actions start on Cancel, so Enter can't destroy anything by accident.
    setTimeout(() => (req.danger ? cancelBtn : okBtn).current?.focus(), 20);
  }, [req]);

  if (!req) return null;
  const finish = (yes: boolean) => {
    if (yes && dontAsk && req.dontAskKey) {
      try {
        localStorage.setItem(req.dontAskKey, "1");
      } catch {
        /* not remembered */
      }
    }
    useStore.getState().setConfirmReq(null);
    req.resolve(yes);
  };

  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && finish(false)} onKeyDown={(e) => e.key === "Escape" && finish(false)}>
      <div className="modal confirm" role="alertdialog" aria-labelledby="confirm-title">
        <h3 id="confirm-title">{req.title}</h3>
        <div className="body">
          <p>{req.text}</p>
          {req.dontAskKey && (
            <label className="opt-radio">
              <input type="checkbox" checked={dontAsk} onChange={(e) => setDontAsk(e.target.checked)} /> Don't ask again
            </label>
          )}
        </div>
        <div className="foot">
          <button ref={okBtn} className={`tbtn default${req.danger ? " danger" : ""}`} onClick={() => finish(true)}>
            {req.ok}
          </button>
          <button ref={cancelBtn} className="tbtn" onClick={() => finish(false)}>
            {req.cancel ?? "Cancel"}
          </button>
        </div>
      </div>
    </div>
  );
}
