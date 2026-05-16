import { useState } from "react";
import {
  getPat,
  setPat,
  verifyPat,
  REPO_OWNER,
  REPO_NAME,
} from "./githubStorage";

type Props = {
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
};

export default function SettingsModal({ open, onClose, onSaved }: Props) {
  const [token, setToken] = useState<string>(() => getPat() ?? "");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  if (!open) return null;

  const handleSave = async () => {
    const trimmed = token.trim();
    if (!trimmed) {
      setPat(null);
      setFeedback("Token törölve.");
      onSaved?.();
      return;
    }

    setBusy(true);
    setFeedback("Token ellenőrzése…");
    try {
      const ok = await verifyPat(trimmed);
      if (!ok) {
        setFeedback("A token nem érvényes vagy nincs jogosultsága a repóhoz.");
        return;
      }
      setPat(trimmed);
      setFeedback("Token mentve és ellenőrizve.");
      onSaved?.();
      setTimeout(() => {
        onClose();
        setFeedback(null);
      }, 800);
    } catch (err) {
      setFeedback(`Hiba: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const handleClear = () => {
    setPat(null);
    setToken("");
    setFeedback("Token törölve.");
    onSaved?.();
  };

  const newTokenUrl =
    `https://github.com/settings/personal-access-tokens/new` +
    `?name=Kiertesites%20webapp` +
    `&description=A%20webapp%20a%20${encodeURIComponent(REPO_OWNER + "/" + REPO_NAME)}%20repoba%20menti%20a%20sablonokat` +
    `&target_name=${encodeURIComponent(REPO_OWNER)}` +
    `&repositories=${encodeURIComponent(REPO_NAME)}` +
    `&contents=write`;

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-window modal-window--small" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <h2 style={{ margin: 0, fontSize: 16 }}>Beállítások — GitHub token</h2>
          <div className="modal-actions">
            <button type="button" onClick={onClose}>Bezár</button>
          </div>
        </header>

        <div className="settings-body">
          <p className="muted small" style={{ marginTop: 0 }}>
            A saját sablonok a <code>{REPO_OWNER}/{REPO_NAME}</code> repo
            <code> data/templates.json</code> fájljába mentődnek, így minden böngészőből
            ugyanazok lesznek elérhetők. <strong>Olvasáshoz nem kell token</strong>, csak
            mentéshez. A token a böngésződ local storage-ében marad, nem küldjük el sehova.
          </p>

          <ol className="muted small" style={{ paddingLeft: 20 }}>
            <li>
              <a href={newTokenUrl} target="_blank" rel="noreferrer">
                Új fine-grained token készítése
              </a>{" "}
              (a link előre kitölti a beállításokat).
            </li>
            <li>
              Repository access → Only select repositories →{" "}
              <code>{REPO_OWNER}/{REPO_NAME}</code>
            </li>
            <li>
              Repository permissions → <strong>Contents: Read and write</strong>
            </li>
            <li>Generate token, másold ki és illeszd be ide.</li>
          </ol>

          <label className="field">
            <span>GitHub Personal Access Token</span>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="github_pat_… vagy ghp_…"
              autoComplete="off"
              spellCheck={false}
            />
          </label>

          {feedback && (
            <div className="muted small" style={{ marginTop: 4 }}>
              {feedback}
            </div>
          )}

          <div className="actions" style={{ marginTop: 8 }}>
            <button type="button" className="primary" onClick={handleSave} disabled={busy}>
              {busy ? "Ellenőrzés…" : "Mentés és ellenőrzés"}
            </button>
            <button type="button" onClick={handleClear} disabled={busy}>
              Token törlése
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
