import { useEditor, EditorContent } from "@tiptap/react";
import type { Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import TextAlign from "@tiptap/extension-text-align";
import { Color } from "@tiptap/extension-color";
import { TextStyle } from "@tiptap/extension-text-style";
import { FontFamily } from "@tiptap/extension-font-family";
import Link from "@tiptap/extension-link";
import { useEffect, useState } from "react";

const FONT_FAMILIES = [
  "Times New Roman, serif",
  "Arial, sans-serif",
  "Calibri, sans-serif",
  "Georgia, serif",
  "Verdana, sans-serif",
  "Courier New, monospace",
];

const FONT_SIZES = ["10pt", "11pt", "12pt", "14pt", "16pt", "18pt", "24pt"];

const COMMON_PLACEHOLDERS: { name: string; label: string }[] = [
  { name: "kozseg", label: "Község" },
  { name: "kituzendo_hrsz", label: "Hrsz." },
  { name: "kituzes_datuma", label: "Kitűzés dátuma" },
  { name: "ora_perc", label: "Óra:Perc" },
  { name: "keltezes", label: "Keltezés" },
  { name: "tulajdonos_neve", label: "Címzett neve" },
  { name: "tulajdonos_cime", label: "Címzett címe" },
];

type Props = {
  open: boolean;
  initialHtml?: string;
  initialName?: string;
  onCancel: () => void;
  onSave: (data: { name: string; html: string }) => void;
};

export default function RichEditor({ open, initialHtml, initialName, onCancel, onSave }: Props) {
  const [name, setName] = useState(initialName ?? "");

  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      TextStyle,
      Color,
      FontFamily,
      Link.configure({ openOnClick: false }),
    ],
    content: initialHtml ?? "<p></p>",
    editorProps: {
      attributes: {
        class: "rich-editor-content",
        spellcheck: "true",
      },
    },
  });

  useEffect(() => {
    if (open) {
      setName(initialName ?? "");
      editor?.commands.setContent(initialHtml ?? "<p></p>");
    }
  }, [open, initialHtml, initialName, editor]);

  if (!open || !editor) {
    return null;
  }

  const insertPlaceholder = (name: string) => {
    editor.chain().focus().insertContent(`[[${name}]]`).run();
  };

  const insertCustomPlaceholder = () => {
    const raw = window.prompt(
      "Add meg a változó nevét (ékezet nélkül, szóköz nélkül).\nPélda: 'sajat_mezo' → [[sajat_mezo]]",
    );
    if (!raw) return;
    const cleaned = raw.trim().replace(/\s+/g, "_");
    if (!cleaned) return;
    insertPlaceholder(cleaned);
  };

  const insertOnlyPersonalBlock = () => {
    editor
      .chain()
      .focus()
      .insertContent(
        '<div data-only-personal="true" class="only-personal-block">' +
          '<p><em>[Ez a blokk csak személyes átadásnál jelenik meg]</em></p>' +
          '<p>(írd ide a személyes átadáshoz tartozó szöveget)</p>' +
          '</div><p></p>',
      )
      .run();
  };

  const setFontFamily = (family: string) => {
    if (family) editor.chain().focus().setFontFamily(family).run();
    else editor.chain().focus().unsetFontFamily().run();
  };

  const setFontSize = (size: string) => {
    if (!size) {
      editor.chain().focus().unsetMark("textStyle", { extendEmptyMarkRange: true }).run();
      return;
    }
    // A TextStyle mark style attribútumát manuálisan állítjuk:
    editor.chain().focus().setMark("textStyle", { style: `font-size: ${size}` } as any).run();
    const html = editor.getHTML();
    editor.commands.setContent(html);
  };

  const setColor = (color: string) => {
    editor.chain().focus().setColor(color).run();
  };

  const handleSave = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      window.alert("A sablonnak adj nevet.");
      return;
    }
    onSave({ name: trimmed, html: editor.getHTML() });
  };

  return (
    <div className="modal-backdrop">
      <div className="modal-window">
        <header className="modal-header">
          <label className="template-name">
            <span>Sablon neve:</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="pl. Hivatalos kiértesítés"
              autoFocus
            />
          </label>
          <div className="modal-actions">
            <button type="button" onClick={onCancel}>Mégse</button>
            <button type="button" className="primary" onClick={handleSave}>Mentés</button>
          </div>
        </header>

        <Toolbar
          editor={editor}
          onInsertPlaceholder={insertPlaceholder}
          onInsertCustomPlaceholder={insertCustomPlaceholder}
          onInsertOnlyPersonal={insertOnlyPersonalBlock}
          onFontFamily={setFontFamily}
          onFontSize={setFontSize}
          onColor={setColor}
        />

        <div className="rich-editor-wrap">
          <EditorContent editor={editor} />
        </div>

        <footer className="modal-footer">
          <p className="muted small">
            <strong>Tipp:</strong> A változókat <code>[[név]]</code> formában szúrd be — a
            generálásnál ezek lesznek lecserélve a címzett vagy a kitűzés adataira.
            A „Csak személyes" blokk postai kézbesítésnél automatikusan kimarad.
          </p>
        </footer>
      </div>
    </div>
  );
}

type ToolbarProps = {
  editor: Editor;
  onInsertPlaceholder: (name: string) => void;
  onInsertCustomPlaceholder: () => void;
  onInsertOnlyPersonal: () => void;
  onFontFamily: (family: string) => void;
  onFontSize: (size: string) => void;
  onColor: (color: string) => void;
};

function Toolbar({
  editor,
  onInsertPlaceholder,
  onInsertCustomPlaceholder,
  onInsertOnlyPersonal,
  onFontFamily,
  onFontSize,
  onColor,
}: ToolbarProps) {
  const isActive = (name: string) => editor.isActive(name);
  const isAlign = (value: string) =>
    editor.isActive({ textAlign: value } as any);

  const btn = (active: boolean, label: string, onClick: () => void, title?: string) => (
    <button
      type="button"
      className={`tb-btn ${active ? "is-active" : ""}`}
      title={title ?? label}
      onClick={onClick}
    >
      {label}
    </button>
  );

  return (
    <div className="rich-toolbar">
      <div className="tb-group">
        {btn(isActive("bold"), "B", () => editor.chain().focus().toggleBold().run(), "Félkövér")}
        {btn(isActive("italic"), "I", () => editor.chain().focus().toggleItalic().run(), "Dőlt")}
        {btn(isActive("underline"), "U", () => editor.chain().focus().toggleUnderline().run(), "Aláhúzott")}
        {btn(isActive("strike"), "S", () => editor.chain().focus().toggleStrike().run(), "Áthúzott")}
      </div>

      <div className="tb-group">
        <select
          className="tb-select"
          defaultValue=""
          onChange={(e) => {
            const v = e.target.value;
            if (v === "p") {
              editor.chain().focus().setParagraph().run();
            } else if (v.startsWith("h")) {
              const level = Number(v.slice(1)) as 1 | 2 | 3;
              editor.chain().focus().toggleHeading({ level }).run();
            }
            e.target.value = "";
          }}
        >
          <option value="">Stílus…</option>
          <option value="p">Bekezdés</option>
          <option value="h1">Címsor 1</option>
          <option value="h2">Címsor 2</option>
          <option value="h3">Címsor 3</option>
        </select>

        <select
          className="tb-select"
          defaultValue=""
          onChange={(e) => {
            onFontFamily(e.target.value);
            e.target.value = "";
          }}
          title="Betűtípus"
        >
          <option value="">Betűtípus…</option>
          {FONT_FAMILIES.map((f) => (
            <option key={f} value={f}>{f.split(",")[0]}</option>
          ))}
        </select>

        <select
          className="tb-select"
          defaultValue=""
          onChange={(e) => {
            onFontSize(e.target.value);
            e.target.value = "";
          }}
          title="Betűméret"
        >
          <option value="">Méret…</option>
          {FONT_SIZES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>

        <input
          type="color"
          className="tb-color"
          title="Betűszín"
          onChange={(e) => onColor(e.target.value)}
          defaultValue="#000000"
        />
      </div>

      <div className="tb-group">
        {btn(isActive("bulletList"), "•", () => editor.chain().focus().toggleBulletList().run(), "Felsorolás")}
        {btn(isActive("orderedList"), "1.", () => editor.chain().focus().toggleOrderedList().run(), "Számozott lista")}
        {btn(isActive("blockquote"), "“", () => editor.chain().focus().toggleBlockquote().run(), "Idézet")}
      </div>

      <div className="tb-group">
        {btn(
          isAlign("left"),
          "⯇",
          () => editor.chain().focus().setTextAlign("left").run(),
          "Balra zár",
        )}
        {btn(
          isAlign("center"),
          "≡",
          () => editor.chain().focus().setTextAlign("center").run(),
          "Középre",
        )}
        {btn(
          isAlign("right"),
          "⯈",
          () => editor.chain().focus().setTextAlign("right").run(),
          "Jobbra zár",
        )}
        {btn(
          isAlign("justify"),
          "≣",
          () => editor.chain().focus().setTextAlign("justify").run(),
          "Sorkizárt",
        )}
      </div>

      <div className="tb-group">
        {btn(false, "↶", () => editor.chain().focus().undo().run(), "Vissza")}
        {btn(false, "↷", () => editor.chain().focus().redo().run(), "Előre")}
      </div>

      <div className="tb-group tb-group--placeholders">
        <span className="tb-label">Változó:</span>
        {COMMON_PLACEHOLDERS.map((p) => (
          <button
            key={p.name}
            type="button"
            className="tb-btn tb-btn--ph"
            title={`[[${p.name}]]`}
            onClick={() => onInsertPlaceholder(p.name)}
          >
            {p.label}
          </button>
        ))}
        <button type="button" className="tb-btn" onClick={onInsertCustomPlaceholder} title="Egyedi változó">
          + Egyedi…
        </button>
        <button type="button" className="tb-btn" onClick={onInsertOnlyPersonal} title="Csak személyesnél jelenik meg">
          ✎ Csak személyes blokk
        </button>
      </div>
    </div>
  );
}
