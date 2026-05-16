import { useEffect, useRef, useState } from "react";
import type { CustomTemplate, TemplateSelection } from "./templates";
import { bytesToBase64, detectTemplateMime, newTemplateId } from "./templates";
import {
  fetchRemoteTemplates,
  readCachedTemplates,
  saveRemoteTemplates,
  getPat,
} from "./githubStorage";

type Props = {
  selection: TemplateSelection;
  onSelectionChange: (sel: TemplateSelection) => void;
  onOpenSettings: () => void;
  reloadKey?: number;
};

function readFileAsBytes(file: File): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.readAsArrayBuffer(file);
  });
}

export default function TemplateManager({
  selection,
  onSelectionChange,
  onOpenSettings,
  reloadKey,
}: Props) {
  const cached = readCachedTemplates();
  const [templates, setTemplates] = useState<CustomTemplate[]>(
    cached.templates.filter((t) => t.mime === "rtf" || t.mime === "docx"),
  );
  const [remoteSha, setRemoteSha] = useState<string | null>(cached.sha);
  const [loading, setLoading] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reload = async () => {
    setLoading(true);
    setLastError(null);
    try {
      const state = await fetchRemoteTemplates();
      setTemplates(state.templates.filter((t) => t.mime === "rtf" || t.mime === "docx"));
      setRemoteSha(state.sha);
    } catch (err) {
      setLastError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey]);

  const selectedValue: string =
    selection.kind === "default" ? "default" : `custom:${selection.id}`;

  const handleChange = (value: string) => {
    if (value === "default") {
      onSelectionChange({ kind: "default" });
    } else if (value.startsWith("custom:")) {
      onSelectionChange({ kind: "custom", id: value.slice("custom:".length) });
    }
  };

  const handleUploadClick = () => {
    if (!getPat()) {
      const proceed = window.confirm(
        "A sablon-mentéshez GitHub token kell. Megnyitod a Beállításokat?",
      );
      if (proceed) onOpenSettings();
      return;
    }
    fileInputRef.current?.click();
  };

  const handleFileChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    const mime = detectTemplateMime(file.name);
    if (!mime) {
      window.alert(
        "Csak .rtf vagy .docx fájl tölthető fel. A bináris .doc nem támogatott — a Word-ben mentsd 'RTF' vagy 'Word dokumentum (.docx)' formátumban.",
      );
      return;
    }

    const defaultName = file.name.replace(/\.(rtf|docx)$/i, "");
    const askedName = window.prompt("Add meg a sablon nevét:", defaultName);
    if (askedName === null) return;
    const name = askedName.trim() || defaultName;
    if (!name) {
      window.alert("A névnek nem szabad üresnek lennie.");
      return;
    }

    const bytes = await readFileAsBytes(file);

    const id = newTemplateId();
    const now = Date.now();
    const tpl: CustomTemplate = {
      id,
      name,
      filename: file.name,
      mime,
      data_b64: bytesToBase64(bytes),
      createdAt: now,
      updatedAt: now,
    };

    const updated = [tpl, ...templates];
    setLoading(true);
    setLastError(null);
    try {
      const state = await saveRemoteTemplates(updated, remoteSha, `Új sablon: ${name}`);
      setTemplates(state.templates.filter((t) => t.mime === "rtf" || t.mime === "docx"));
      setRemoteSha(state.sha);
      onSelectionChange({ kind: "custom", id });
    } catch (err) {
      const message = (err as Error).message;
      if (message.includes("409") || message.toLowerCase().includes("does not match")) {
        setLastError("A sablon-lista időközben módosult egy másik gépről. Újratöltöm…");
        await reload();
      } else {
        setLastError(message);
        window.alert(`Mentés hiba: ${message}`);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleRename = async () => {
    if (selection.kind !== "custom") return;
    const tpl = templates.find((t) => t.id === selection.id);
    if (!tpl) return;
    if (!getPat()) {
      const proceed = window.confirm("Az átnevezéshez GitHub token kell. Megnyitod a Beállításokat?");
      if (proceed) onOpenSettings();
      return;
    }
    const newName = window.prompt("Új név:", tpl.name);
    if (newName === null) return;
    const trimmed = newName.trim();
    if (!trimmed || trimmed === tpl.name) return;

    const updated = templates.map((t) => (t.id === tpl.id ? { ...t, name: trimmed, updatedAt: Date.now() } : t));
    setLoading(true);
    setLastError(null);
    try {
      const state = await saveRemoteTemplates(updated, remoteSha, `Sablon átnevezve: ${trimmed}`);
      setTemplates(state.templates.filter((t) => t.mime === "rtf" || t.mime === "docx"));
      setRemoteSha(state.sha);
    } catch (err) {
      setLastError((err as Error).message);
      window.alert(`Átnevezés hiba: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (selection.kind !== "custom") return;
    const tpl = templates.find((t) => t.id === selection.id);
    if (!tpl) return;
    if (!window.confirm(`Biztosan törlöd ezt a sablont?\n\n${tpl.name}`)) return;
    if (!getPat()) {
      const proceed = window.confirm("A törléshez GitHub token kell. Megnyitod a Beállításokat?");
      if (proceed) onOpenSettings();
      return;
    }
    const updated = templates.filter((t) => t.id !== tpl.id);
    setLoading(true);
    setLastError(null);
    try {
      const state = await saveRemoteTemplates(updated, remoteSha, `Sablon törölve: ${tpl.name}`);
      setTemplates(state.templates.filter((t) => t.mime === "rtf" || t.mime === "docx"));
      setRemoteSha(state.sha);
      onSelectionChange({ kind: "default" });
    } catch (err) {
      setLastError((err as Error).message);
      window.alert(`Törlés hiba: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  const isCustom = selection.kind === "custom";
  const selectedTpl = isCustom ? templates.find((t) => t.id === selection.id) : null;

  return (
    <div className="template-manager">
      <div className="template-row">
        <label className="field" style={{ flex: 1 }}>
          <span>Levélsablon:</span>
          <select value={selectedValue} onChange={(e) => handleChange(e.target.value)}>
            <option value="default">Alap RTF sablon (kiertesites4.rtf)</option>
            {templates.length > 0 && (
              <optgroup label="Saját sablonok">
                {templates.map((t) => (
                  <option key={t.id} value={`custom:${t.id}`}>
                    {t.name} ({t.mime.toUpperCase()})
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </label>
        <div className="template-buttons">
          <button type="button" onClick={handleUploadClick} disabled={loading}>
            + Sablon feltöltése (RTF / DOCX)
          </button>
          <button type="button" onClick={handleRename} disabled={!isCustom || loading}>
            Átnevezés
          </button>
          <button type="button" onClick={handleDelete} disabled={!isCustom || loading}>
            Törlés
          </button>
          <button type="button" onClick={() => void reload()} disabled={loading} title="Frissítés a webről">
            ↻
          </button>
          <input
            type="file"
            accept=".rtf,.docx,application/rtf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            onChange={handleFileChosen}
            style={{ display: "none" }}
            ref={fileInputRef}
          />
        </div>
      </div>

      {selectedTpl && (
        <div className="muted small">
          Eredeti fájl: <code>{selectedTpl.filename}</code> — formátum: {selectedTpl.mime.toUpperCase()}
        </div>
      )}

      <div className="muted small">
        A sablonban használható változók: <code>[[kozseg]]</code>, <code>[[kituzendo_hrsz]]</code>,
        <code> [[kituzes_datuma]]</code>, <code>[[ora_perc]]</code>, <code>[[keltezes]]</code>,
        <code> [[tulajdonos_neve]]</code>, <code>[[tulajdonos_cime]]</code>. A postai
        kézbesítésnél kihagyandó szakaszt a sablonban így jelöld:
        <code> [[csak_szemelyes]]</code> … <code>[[/csak_szemelyes]]</code>.
      </div>

      {loading && <div className="muted small">Művelet folyamatban…</div>}
      {lastError && <div className="error-text small">⚠ {lastError}</div>}
    </div>
  );
}
