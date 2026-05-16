import { useState } from "react";
import type { CustomTemplate, TemplateSelection } from "./templates";
import {
  deleteTemplate,
  loadTemplates,
  newTemplateId,
  upsertTemplate,
} from "./templates";
import RichEditor from "./RichEditor";

type Props = {
  selection: TemplateSelection;
  onSelectionChange: (sel: TemplateSelection) => void;
};

export default function TemplateManager({ selection, onSelectionChange }: Props) {
  const [templates, setTemplates] = useState<CustomTemplate[]>(() => loadTemplates());
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const editingTpl = editingId ? templates.find((t) => t.id === editingId) ?? null : null;

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

  const handleSave = (data: { name: string; html: string }) => {
    const id = editingTpl?.id ?? newTemplateId();
    const tpl: CustomTemplate = {
      id,
      name: data.name,
      html: data.html,
      createdAt: editingTpl?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
    };
    const list = upsertTemplate(tpl);
    setTemplates(list);
    setEditorOpen(false);
    setEditingId(null);
    onSelectionChange({ kind: "custom", id });
  };

  const handleDelete = () => {
    if (selection.kind !== "custom") return;
    const tpl = templates.find((t) => t.id === selection.id);
    if (!tpl) return;
    if (!window.confirm(`Biztosan törlöd ezt a sablont?\n\n${tpl.name}`)) return;
    const list = deleteTemplate(selection.id);
    setTemplates(list);
    onSelectionChange({ kind: "default" });
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
          <button type="button" onClick={openNew}>+ Új sablon</button>
          <button type="button" onClick={openEdit} disabled={!isCustom}>Szerkesztés</button>
          <button type="button" onClick={handleDelete} disabled={!isCustom}>Törlés</button>
        </div>
      </div>

      <RichEditor
        open={editorOpen}
        initialHtml={editingTpl?.html}
        initialName={editingTpl?.name}
        onCancel={() => {
          setEditorOpen(false);
          setEditingId(null);
        }}
        onSave={handleSave}
      />
    </div>
  );
}
