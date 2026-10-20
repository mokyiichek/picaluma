import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";

/** Picaluma's own text input dialog (rename, new folder, album name), used by askText(). */
export default function TextPrompt() {
  const req = useStore((s) => s.textPrompt);
  const [value, setValue] = useState("");
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!req) return;
    setValue(req.value);
    setTimeout(() => {
      input.current?.focus();
      input.current?.select();
    }, 20);
  }, [req]);

  if (!req) return null;
  const finish = (result: string | null) => {
    useStore.getState().setTextPrompt(null);
    req.resolve(result);
  };
  const ok = () => finish(value.trim());

  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && finish(null)}>
      <div className="modal text-prompt">
        <div className="body">
          <label>
            {req.label}
            <input
              ref={input}
              value={value}
              spellCheck={false}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") ok();
                if (e.key === "Escape") finish(null);
              }}
            />
          </label>
        </div>
        <div className="foot">
          <button className="tbtn default" onClick={ok}>
            {req.ok}
          </button>
          <button className="tbtn" onClick={() => finish(null)}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
