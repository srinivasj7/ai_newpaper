import { useEffect, useRef, useState } from "react";
import { checkToken } from "../api/client.js";
import { setToken } from "../api/token.js";

/**
 * Asks for the passphrase that unlocks writing.
 *
 * It is checked against /api/session, which authorises and returns without reading or writing
 * anything — so a wrong passphrase is reported here and now rather than silently swallowing an
 * edit later. The value is kept in localStorage and sent as a header; it is never put in a URL.
 */
export default function UnlockDialog({ open, onClose, onUnlocked }) {
  const [value, setValue] = useState("");
  const [state, setState] = useState("idle"); // idle | checking | wrong | offline
  const input = useRef(null);

  useEffect(() => {
    if (open) {
      setValue("");
      setState("idle");
      input.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const submit = async (e) => {
    e.preventDefault();
    const candidate = value.trim();
    if (!candidate || state === "checking") return;

    setState("checking");
    // Stored before the check because the client reads it from storage when it signs the
    // request; cleared again if it turns out to be wrong, so a bad value never lingers.
    setToken(candidate);
    try {
      await checkToken();
      onUnlocked();
      onClose();
    } catch (err) {
      setToken("");
      setState(err?.unauthorized ? "wrong" : "offline");
    }
  };

  return (
    <div className="dc-modal-back" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="dc-modal" role="dialog" aria-modal="true" aria-labelledby="dc-unlock-h" onSubmit={submit}>
        <h3 id="dc-unlock-h">Unlock editing</h3>
        <p className="hint">
          Reading needs no passphrase. Changing the topics, sources, or story votes does — they steer what the pipeline
          writes tomorrow.
        </p>

        <input
          ref={input}
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Passphrase"
          autoComplete="current-password"
          spellCheck="false"
          aria-invalid={state === "wrong"}
        />

        {state === "wrong" && <p className="dc-note err">That passphrase was not accepted.</p>}
        {state === "offline" && <p className="dc-note err">Could not reach the server. Try again in a moment.</p>}

        <div className="dc-modal-foot">
          <button type="button" className="dc-btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="dc-btn" disabled={!value.trim() || state === "checking"}>
            {state === "checking" ? "Checking…" : "Unlock"}
          </button>
        </div>
      </form>
    </div>
  );
}
