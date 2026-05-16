import { useEffect, useState } from "react";
import type { CustomTemplate, TemplateSelection } from "./templates";
import { newTemplateId } from "./templates";
import {
  fetchRemoteTemplates,
  readCachedTemplates,
  saveRemoteTemplates,
  getPat,
} from "./githubStorage";
import RichEditor from "./RichEditor";

type Props = {
  selection: TemplateSelection;
  onSelectionChange: (sel: TemplateSelection) => void;
  onOpenSettings: () => void;
  reloadKey?: number;
};

export default function TemplateManager({
  selection,
  onSelectionChange,
  onOpenSettings,
  reloadKey,
}: Props) {
  const cached = readCachedTemplates();
  const [templates, setTemplates] = useState<CustomTemplate[]>(cached.templates);
  const [remoteSha, setRemoteSha] = useState<string | null>(cached.sha);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  const editingTpl = editingId ? templates.find((t) => t.id === editingId) ?? null : null;

  const reload = async () => {
    setLoading(true);
    setLastError(null);
    try {
      const state = await fetchRemoteTemplates();
      setTemplates(state.templates);
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

  const openNew = () => {
    setEditingId(null);
    setEditorOpen(true);
  };

  const openEdit = () => {
    if (selection.kind !== "custom") return;
    setEditingId(selection.id);
    setEditorOpen(true);
  };

  const handleSave = async (data: { name: string; html: string }) => {
    if (!getPat()) {
      const proceed = window.confirm(
        "A mentéshez GitHub token kell. Megnyitod a Beállításokat?",
      );
      if (proceed) onOpenSettings();
      return;
    }

    const id = editingTpl?.id ?? newTemplateId();
    const now = Date.now();
    const next: CustomTemplate = {
      id,
      name: data.name,
      html: data.html,
      createdAt: editingTpl?.createdAt ?? now,
      updatedAt: now,
    };

    let updated: CustomTemplate[];
    if (editingTpl) {
      updated = templates.map((t) => (t.id === id ? next : t));
    } else {
      updated = [next, ...templates];
    }

    setLoading(true);
    setLastError(null);
    try {
      const state = await saveRemoteTemplates(
        updated,
        remoteSha,
        editingTpl
          ? `Sablon frissítése: ${data.name}`
          : `Új sablon: ${data.name}`,
      );
      setTemplates(state.templates);
      setRemoteSha(state.sha);
      setEditorOpen(false);
      setEditingId(null);
      onSelectionChange({ kind: "custom", id });
    } catch (err) {
      const message = (err as Error).message;
      if (message.includes("409") || message.toLowerCase().includes("does not match")) {
        // Konfliktus: a remote oldalon közben változott
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

  const handleDelete = async () => {
    if (selection.kind !== "custom") return;
    const tpl = templates.find((t) => t.id === selection.id);
    if (!tpl) return;
    if (!window.confirm(`Biztosan törlöd ezt a sablont?\n\n${tpl.name}`)) return;

    if (!getPat()) {
      const proceed = window.confirm(
        "A törléshez GitHub token kell. Megnyitod a Beállításokat?",
      );
      if (proceed) onOpenSettings();
      return;
    }

    const updated = templates.filter((t) => t.id !== selection.id);
    setLoading(true);
    setLastError(null);
    try {
      const state = await saveRemoteTemplates(
        updated,
        remoteSha,
        `Sablon törlése: ${tpl.name}`,
      );
      setTemplates(state.templates);
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
                    {t.name}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </label>
        <div className="template-buttons">
          <button type="button" onClick={openNew} disabled={loading}>+ Új sablon</button>
          <button type="button" onClick={openEdit} disabled={!isCustom || loading}>
            Szerkesztés
          </button>
          <button type="button" onClick={handleDelete} disabled={!isCustom || loading}>
            Törlés
          </button>
          <button type="button" onClick={() => void reload()} disabled={loading} title="Frissítés a webről">
            ↻
          </button>
        </div>
      </div>

      {loading && <div className="muted small">Művelet folyamatban…</div>}
      {lastError && <div className="error-text small">⚠ {lastError}</div>}

      <RichEditor
        open={editorOpen}
        initialHtml={editingTpl?.html}
        initialName={editingTpl?.name}
        onCancel={() => {
          setEditorOpen(false);
          setEditingId(null);
        }}
        onSave={(data) => void handleSave(data)}
      />
    </div>
  );
}
