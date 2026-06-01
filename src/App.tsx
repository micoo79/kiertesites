import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePyodide } from "./usePyodide";
import type { PyodideInterface } from "./pyodide.d";
import TemplateManager from "./TemplateManager";
import SettingsModal from "./SettingsModal";
import type { TemplateSelection } from "./templates";
import { base64ToBytes } from "./templates";
import { readCachedTemplates } from "./githubStorage";
import {
  downloadBytes,
  downloadText,
  huDateToIso,
  isoDateToHu,
  timestamp,
  todayHu,
  todayIso,
} from "./utils";

type Recipient = {
  name: string;
  address: string;
  role: string;
  source_file: string;
  settlement: string;
};

type GeneratedFile = {
  bytes?: Uint8Array;
  text?: string;
  filename: string;
  mime: string;
};

const ROLE_OPTIONS = [
  "tulajdonos",
  "haszonélvező",
  "vagyonkezelő",
  "tartási jog jogosultja",
  "özvegyi jog jogosultja",
];

const RTF_MIME = "application/rtf";
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const MIME_BY_EXTENSION: Record<string, string> = {
  rtf: RTF_MIME,
  docx: DOCX_MIME,
};

const ONLY_PERSONAL_PLACEHOLDER_START = "csak_szemelyes";
const ONLY_PERSONAL_PLACEHOLDER_END = "/csak_szemelyes";

async function fetchAsBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Nem sikerült letölteni: ${url} (${res.status})`);
  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}

function readFileAsBytes(file: File): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const buf = reader.result as ArrayBuffer;
      resolve(new Uint8Array(buf));
    };
    reader.readAsArrayBuffer(file);
  });
}

function callPython<T>(pyodide: PyodideInterface, fnName: string, arg: unknown): T {
  const fn = pyodide.runPython(`kiertesites_core.${fnName}`) as (a: unknown) => unknown;
  const pyArg = pyodide.toPy(arg);
  try {
    const result = fn(pyArg);
    if (result && typeof (result as any).toJs === "function") {
      const js = (result as any).toJs({ dict_converter: Object.fromEntries });
      (result as any).destroy?.();
      return js as T;
    }
    return result as T;
  } finally {
    (pyArg as any).destroy?.();
  }
}

function dedupeRecipients(list: Recipient[]): Recipient[] {
  const seen = new Set<string>();
  const out: Recipient[] = [];
  for (const r of list) {
    const key = `${r.name.trim().toLowerCase()}||${r.address.trim().toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

export default function App() {
  const { pyodide, status, error } = usePyodide();

  const [templateBytes, setTemplateBytes] = useState<Uint8Array | null>(null);
  const [envelopeBytes, setEnvelopeBytes] = useState<Uint8Array | null>(null);
  const [customDefaultName, setCustomDefaultName] = useState<string | null>(null);
  const [customEnvelopeName, setCustomEnvelopeName] = useState<string | null>(null);

  const [templateSelection, setTemplateSelection] = useState<TemplateSelection>({ kind: "default" });

  const [inputFiles, setInputFiles] = useState<{ name: string; bytes: Uint8Array }[]>([]);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [defaultSettlement, setDefaultSettlement] = useState("");

  const [kozseg, setKozseg] = useState("");
  const [kituzendoHrsz, setKituzendoHrsz] = useState("");
  const [kituzesIso, setKituzesIso] = useState("");
  const [oraPerc, setOraPerc] = useState("");
  const [keltezesIso, setKeltezesIso] = useState(todayIso());

  const [deliveryMode, setDeliveryMode] = useState<"posta" | "személyes">("posta");
  const [makeEnvelope, setMakeEnvelope] = useState(true);

  const [logLines, setLogLines] = useState<string[]>([
    "Indulásra kész. A Pyodide betöltése után tölthetsz fel tulajdoni lapokat.",
  ]);

  const [outputs, setOutputs] = useState<GeneratedFile[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [templatesReloadKey, setTemplatesReloadKey] = useState(0);

  const [previewText, setPreviewText] = useState<string>("");
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const logRef = useRef<HTMLPreElement>(null);

  const appendLog = useCallback((line: string) => {
    setLogLines((prev) => [...prev, line]);
  }, []);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logLines]);

  // Default sablonok betöltése
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [tpl, env] = await Promise.all([
          fetchAsBytes(new URL("templates/kiertesites4.rtf", document.baseURI).toString()),
          fetchAsBytes(new URL("templates/boritek.xlsx", document.baseURI).toString()),
        ]);
        if (cancelled) return;
        setTemplateBytes(tpl);
        setEnvelopeBytes(env);
        appendLog("Alapértelmezett sablonok betöltve.");
      } catch (err) {
        appendLog(`Sablonok betöltése sikertelen: ${(err as Error).message}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [appendLog]);

  // Bemeneti fájlok automatikus parse-olása
  const parseFiles = useCallback(
    async (files: { name: string; bytes: Uint8Array }[]) => {
      if (!pyodide || files.length === 0) return;
      setBusy("Címzettek kinyerése…");
      try {
        const payload = files.map((f) => ({ name: f.name, data: f.bytes }));
        const result = callPython<{
          recipients: Recipient[];
          default_settlement: string;
          log: string[];
        }>(pyodide, "parse_uploaded_sheets", payload);

        for (const line of result.log) appendLog(line);

        const ds = result.default_settlement || "";
        if (ds) {
          setDefaultSettlement(ds);
          setKozseg((prev) => (prev.trim() ? prev : ds));
        }

        const newRecipients = result.recipients.map((r) => ({
          ...r,
          settlement: r.settlement || ds || "",
        }));

        setRecipients((prev) => {
          const merged = dedupeRecipients([...prev, ...newRecipients]);
          appendLog(
            `Hozzáadva ${newRecipients.length} címzett (összes egyedi: ${merged.length}).`,
          );
          return merged;
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        appendLog(`Hiba a feldolgozás közben: ${message}`);
      } finally {
        setBusy(null);
      }
    },
    [pyodide, appendLog],
  );

  const onAddInputs = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    const newOnes: { name: string; bytes: Uint8Array; file: File }[] = [];
    for (const f of files) {
      const lower = f.name.toLowerCase();
      if (!lower.endsWith(".pdf") && !lower.endsWith(".txt")) {
        appendLog(`Kihagyom (nem PDF/TXT): ${f.name}`);
        continue;
      }
      const bytes = await readFileAsBytes(f);
      newOnes.push({ name: f.name, bytes, file: f });
    }
    e.target.value = "";
    if (newOnes.length === 0) return;
    setInputFiles((prev) => [...prev, ...newOnes.map((n) => ({ name: n.name, bytes: n.bytes }))]);
    // Automatikus parse-olás csak az ÚJ fájlokra (a régiek már fel vannak véve).
    await parseFiles(newOnes.map((n) => ({ name: n.name, bytes: n.bytes })));
  };

  const onEnvelopeFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const bytes = await readFileAsBytes(file);
    setEnvelopeBytes(bytes);
    setCustomEnvelopeName(file.name);
    appendLog(`Saját boríték sablon betöltve: ${file.name} (${bytes.length} bájt)`);
  };

  const resetEnvelope = async () => {
    try {
      const env = await fetchAsBytes(
        new URL("templates/boritek.xlsx", document.baseURI).toString(),
      );
      setEnvelopeBytes(env);
      setCustomEnvelopeName(null);
      appendLog("Boríték sablon visszaállítva az alapra.");
    } catch (err) {
      appendLog(`Visszaállítás sikertelen: ${(err as Error).message}`);
    }
  };

  const onDefaultTemplateFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const bytes = await readFileAsBytes(file);
    setTemplateBytes(bytes);
    setCustomDefaultName(file.name);
    appendLog(`Saját RTF alap-sablon betöltve: ${file.name} (${bytes.length} bájt)`);
  };

  const resetDefaultTemplate = async () => {
    try {
      const tpl = await fetchAsBytes(
        new URL("templates/kiertesites4.rtf", document.baseURI).toString(),
      );
      setTemplateBytes(tpl);
      setCustomDefaultName(null);
      appendLog("Alap RTF sablon visszaállítva.");
    } catch (err) {
      appendLog(`Visszaállítás sikertelen: ${(err as Error).message}`);
    }
  };

  const clearInputs = () => {
    setInputFiles([]);
    appendLog("Bemeneti fájl-lista törölve. (A már felvett címzettek a táblázatban maradnak.)");
  };

  const removeInput = (index: number) => {
    setInputFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const updateRecipient = (index: number, patch: Partial<Recipient>) => {
    setRecipients((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };

  const removeRecipient = (index: number) => {
    setRecipients((prev) => prev.filter((_, i) => i !== index));
  };

  const addRecipient = () => {
    setRecipients((prev) => [
      ...prev,
      {
        name: "",
        address: "",
        role: "tulajdonos",
        source_file: "",
        settlement: kozseg || defaultSettlement,
      },
    ]);
  };

  const clearRecipients = () => {
    if (!window.confirm("Biztosan törlöd az összes címzettet?")) return;
    setRecipients([]);
  };

  const validateCommon = (): Record<string, string> | null => {
    if (!kozseg.trim()) {
      appendLog("Hiányzik a település/község.");
      return null;
    }
    if (!kituzendoHrsz.trim()) {
      appendLog("Hiányzik a kitűzendő helyrajzi szám.");
      return null;
    }
    if (!kituzesIso) {
      appendLog("Hiányzik a kitűzés dátuma.");
      return null;
    }
    if (!oraPerc.trim()) {
      appendLog("Hiányzik a kitűzés időpontja.");
      return null;
    }
    if (recipients.length === 0) {
      appendLog("Nincs címzett a listában.");
      return null;
    }
    for (let i = 0; i < recipients.length; i++) {
      const r = recipients[i];
      if (!r.name.trim() || !r.address.trim()) {
        appendLog(`A(z) ${i + 1}. címzettnél hiányzik a név vagy a cím.`);
        return null;
      }
    }

    return {
      kozseg: kozseg.trim(),
      kituzendo_hrsz: kituzendoHrsz.trim(),
      kituzes_datuma: isoDateToHu(kituzesIso),
      ora_perc: oraPerc.trim(),
      keltezes: keltezesIso ? isoDateToHu(keltezesIso) : todayHu(),
    };
  };

  const askExtras = (
    py: PyodideInterface,
    tplBytes: Uint8Array,
    knownKeys: Set<string>,
  ): Record<string, string> | null => {
    const info = callPython<{ extras: string[]; codepage: string }>(
      py,
      "list_extra_template_fields",
      tplBytes,
    );
    const unknownExtras = info.extras.filter((e) => !knownKeys.has(e));
    const extraValues: Record<string, string> = {};
    for (const name of unknownExtras) {
      const value = window.prompt(
        `A sablonban találtam egy további mezőt:\n\n[[${name}]]\n\nAdd meg az értékét:`,
      );
      if (value === null) return null;
      if (!value.trim()) {
        alert(`A(z) [[${name}]] mező nem maradhat üresen.`);
        return null;
      }
      extraValues[name] = value.trim();
    }
    return extraValues;
  };

  const askExtrasForCustom = (
    html: string,
    knownKeys: Set<string>,
  ): Record<string, string> | null => {
    // Egyszerű regex alapú placeholder extraction
    const div = document.createElement("div");
    div.innerHTML = html;
    const text = div.textContent || "";
    const re = /\[\s*\[?\s*([0-9A-Za-zÁÉÍÓÖŐÚÜŰáéíóöőúüű_]+(?:\s*[0-9A-Za-zÁÉÍÓÖŐÚÜŰáéíóöőúüű_]+)*)\s*\]\s*\]/gu;
    const starRe = /\[\s*\*\s*([^*]+?)\s*\*\s*\]/gu;
    const names = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) names.add(m[1].replace(/\s+/g, ""));
    while ((m = starRe.exec(text)) !== null) names.add(m[1].replace(/\s+/g, ""));
    const RECIPIENT_KNOWN = [
      "tulajdonos_neve", "tulajdonos_cime", "tulajdonos_címe",
      "cimzett_neve", "címzett_neve",
      "cimzett_cime", "címzett_cime", "cimzett_címe", "címzett_címe",
    ];
    const extras: Record<string, string> = {};
    for (const name of names) {
      if (knownKeys.has(name) || RECIPIENT_KNOWN.includes(name)) continue;
      const value = window.prompt(
        `A sablonban találtam egy további mezőt:\n\n[[${name}]]\n\nAdd meg az értékét:`,
      );
      if (value === null) return null;
      if (!value.trim()) {
        alert(`A(z) [[${name}]] mező nem maradhat üresen.`);
        return null;
      }
      extras[name] = value.trim();
    }
    return extras;
  };

  // -----------------------------------------------------------------------
  // Előnézet az első címzetthez (automatikus, debounced)
  // -----------------------------------------------------------------------
  const previewKey = JSON.stringify({
    r: recipients[0] || null,
    kozseg, kituzendoHrsz, kituzesIso, oraPerc, keltezesIso,
    deliveryMode,
    sel: templateSelection,
    customDefaultName,
    tplLen: templateBytes?.length ?? 0,
  });

  useEffect(() => {
    if (!pyodide) {
      setPreviewText("");
      setPreviewError(null);
      return;
    }
    if (recipients.length === 0) {
      setPreviewText("");
      setPreviewError(null);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(() => {
      if (cancelled) return;
      try {
        let tplBytesArg: Uint8Array | null = null;
        let tplFilename = "";

        if (templateSelection.kind === "default") {
          if (!templateBytes) return;
          tplBytesArg = templateBytes;
          tplFilename = "";
        } else {
          const list = readCachedTemplates().templates;
          const tpl = list.find((t) => t.id === templateSelection.id);
          if (!tpl || (tpl.mime !== "rtf" && tpl.mime !== "docx") || !tpl.data_b64) return;
          tplBytesArg = base64ToBytes(tpl.data_b64);
          tplFilename = tpl.filename;
        }

        const globals: Record<string, string> = {
          kozseg: kozseg.trim(),
          kituzendo_hrsz: kituzendoHrsz.trim(),
          kituzes_datuma: kituzesIso ? isoDateToHu(kituzesIso) : "",
          ora_perc: oraPerc.trim(),
          keltezes: keltezesIso ? isoDateToHu(keltezesIso) : todayHu(),
        };

        setPreviewLoading(true);
        const result = callPython<{ text: string }>(pyodide, "preview_first_letter", {
          template_bytes: tplBytesArg,
          template_filename: tplFilename,
          recipient: recipients[0],
          global_values: globals,
          postal: deliveryMode === "posta",
        });

        if (!cancelled) {
          setPreviewText(result.text || "");
          setPreviewError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setPreviewError((err as Error).message);
          setPreviewText("");
        }
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    }, 400);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pyodide, previewKey]);

  const generate = async () => {
    const globalValues = validateCommon();
    if (!globalValues) return;

    const postal = deliveryMode === "posta";

    setBusy("Generálás folyamatban…");
    try {
      // Címzettek településének kitöltése
      const finalRecipients = recipients.map((r) => ({
        ...r,
        settlement: r.settlement || globalValues.kozseg,
      }));

      // Előző letöltések URL-jeit nem tartjuk megnyitva
      setOutputs([]);

      const newOutputs: GeneratedFile[] = [];
      const stamp = timestamp();

      if (templateSelection.kind === "default") {
        if (!pyodide) {
          appendLog("A Pyodide még nem áll készen.");
          setBusy(null);
          return;
        }
        if (!templateBytes) {
          appendLog("Hiányzik az RTF sablon.");
          setBusy(null);
          return;
        }

        const knownKeys = new Set(Object.keys(globalValues));
        const extras = askExtras(pyodide, templateBytes, knownKeys);
        if (extras === null) {
          appendLog("Generálás megszakítva (hiányzó sablonadat).");
          setBusy(null);
          return;
        }
        const allValues = { ...globalValues, ...extras };

        appendLog("RTF generálása…");
        const result = callPython<{
          rtf_bytes: Uint8Array;
          rtf_filename: string;
          xlsx_bytes: Uint8Array | null;
          xlsx_filename: string | null;
          warnings: string[];
        }>(pyodide, "generate_outputs", {
          template_bytes: templateBytes,
          envelope_bytes: postal && makeEnvelope ? envelopeBytes : null,
          recipients: finalRecipients,
          global_values: allValues,
          postal,
          make_envelope: makeEnvelope,
        });

        for (const w of result.warnings) appendLog(w);

        newOutputs.push({
          bytes: new Uint8Array(result.rtf_bytes),
          filename: result.rtf_filename,
          mime: RTF_MIME,
        });
        appendLog(`Elkészült RTF: ${result.rtf_filename}`);

        if (result.xlsx_bytes && result.xlsx_filename) {
          newOutputs.push({
            bytes: new Uint8Array(result.xlsx_bytes),
            filename: result.xlsx_filename,
            mime: XLSX_MIME,
          });
          appendLog(`Elkészült boríték Excel: ${result.xlsx_filename}`);
        }
      } else {
        // Saját feltöltött sablon (RTF vagy DOCX) — a TemplateManager már letöltötte
        // a webről, a cache-ben benne van a base64 tartalom.
        const list = readCachedTemplates().templates;
        const tpl = list.find((t) => t.id === templateSelection.id);
        if (!tpl || !tpl.data_b64 || (tpl.mime !== "rtf" && tpl.mime !== "docx")) {
          appendLog("A választott sablon nem található vagy nem támogatott formátum.");
          setBusy(null);
          return;
        }
        if (!pyodide) {
          appendLog("A Pyodide még nem áll készen.");
          setBusy(null);
          return;
        }

        const tplBytes = base64ToBytes(tpl.data_b64);

        // Extra placeholdereket bekérünk a Python segítségével
        const info = callPython<{ kind: string; placeholders: string[] }>(
          pyodide,
          "list_template_placeholders",
          { template_bytes: tplBytes, template_filename: tpl.filename },
        );
        const placeholders = info?.placeholders ?? [];
        const knownKeys = new Set([
          ...Object.keys(globalValues),
          "tulajdonos_neve", "tulajdonos_cime", "tulajdonos_címe",
          "cimzett_neve", "címzett_neve",
          "cimzett_cime", "címzett_cime", "cimzett_címe", "címzett_címe",
          "kozseg", "keltezés",
          ONLY_PERSONAL_PLACEHOLDER_START, ONLY_PERSONAL_PLACEHOLDER_END,
        ]);
        const extras: Record<string, string> = {};
        for (const name of placeholders) {
          if (knownKeys.has(name)) continue;
          const value = window.prompt(
            `A sablonban találtam egy további mezőt:\n\n[[${name}]]\n\nAdd meg az értékét:`,
          );
          if (value === null) {
            appendLog("Generálás megszakítva (hiányzó sablonadat).");
            setBusy(null);
            return;
          }
          if (!value.trim()) {
            window.alert(`A(z) [[${name}]] mező nem maradhat üresen.`);
            setBusy(null);
            return;
          }
          extras[name] = value.trim();
        }

        const allValues = { ...globalValues, ...extras };

        appendLog(`Levél generálása a „${tpl.name}" (${tpl.mime.toUpperCase()}) sablonból…`);
        const result = callPython<{
          letter_bytes: Uint8Array;
          letter_filename: string;
          letter_mime: string;
          xlsx_bytes: Uint8Array | null;
          xlsx_filename: string | null;
          warnings: string[];
        }>(pyodide, "generate_outputs_from_uploaded_template", {
          template_bytes: tplBytes,
          template_filename: tpl.filename,
          envelope_bytes: postal && makeEnvelope ? envelopeBytes : null,
          recipients: finalRecipients,
          global_values: allValues,
          postal,
          make_envelope: makeEnvelope,
        });

        for (const w of result.warnings) appendLog(w);

        newOutputs.push({
          bytes: new Uint8Array(result.letter_bytes),
          filename: result.letter_filename,
          mime: result.letter_mime || MIME_BY_EXTENSION[tpl.mime],
        });
        appendLog(`Elkészült: ${result.letter_filename}`);

        if (result.xlsx_bytes && result.xlsx_filename) {
          newOutputs.push({
            bytes: new Uint8Array(result.xlsx_bytes),
            filename: result.xlsx_filename,
            mime: XLSX_MIME,
          });
          appendLog(`Elkészült boríték Excel: ${result.xlsx_filename}`);
        }
      }

      setOutputs(newOutputs);

      // Automatikus letöltés indítása
      for (const o of newOutputs) {
        if (o.bytes) downloadBytes(o.bytes, o.filename, o.mime);
        else if (o.text) downloadText(o.text, o.filename, o.mime);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      appendLog(`Generálási hiba: ${message}`);
    } finally {
      setBusy(null);
    }
  };

  const pyReady = pyodide !== null;
  const statusBadge = useMemo(() => {
    if (error) return { kind: "err", text: `Hiba: ${error}` };
    if (!pyReady) return { kind: "load", text: status };
    return { kind: "ok", text: "Pyodide készen áll" };
  }, [pyReady, status, error]);

  return (
    <div className="app">
      <header className="header">
        <h1>Kiértesítés készítő</h1>
        <div className="header-right">
          <button type="button" className="settings-btn" onClick={() => setSettingsOpen(true)}>
            ⚙ Beállítások
          </button>
          <span className={`status status--${statusBadge.kind}`}>{statusBadge.text}</span>
        </div>
      </header>

      <section className="card">
        <h2>1. Kitűzendő földrészlet</h2>
        <div className="parcel-line">
          <span>Kitűzendő földrészlet:</span>
          <input
            className="parcel-input"
            value={kozseg}
            onChange={(e) => setKozseg(e.target.value)}
            placeholder="község / város"
          />
          <span>község/város,</span>
          <input
            className="parcel-input parcel-input--small"
            value={kituzendoHrsz}
            onChange={(e) => setKituzendoHrsz(e.target.value)}
            placeholder="hrsz."
          />
          <span>hrsz.</span>
        </div>
        <div className="grid">
          <label className="field">
            <span>Kitűzés dátuma</span>
            <input type="date" value={kituzesIso} onChange={(e) => setKituzesIso(e.target.value)} />
          </label>
          <label className="field">
            <span>Kitűzés időpontja (óra:perc)</span>
            <input type="time" value={oraPerc} onChange={(e) => setOraPerc(e.target.value)} />
          </label>
          <label className="field">
            <span>Keltezés dátuma</span>
            <input
              type="date"
              value={keltezesIso}
              onChange={(e) => setKeltezesIso(e.target.value)}
            />
          </label>
        </div>
        <div className="row">
          <fieldset className="radios">
            <legend>Kézbesítés:</legend>
            <label>
              <input
                type="radio"
                name="delivery"
                value="posta"
                checked={deliveryMode === "posta"}
                onChange={() => setDeliveryMode("posta")}
              />
              posta
            </label>
            <label>
              <input
                type="radio"
                name="delivery"
                value="személyes"
                checked={deliveryMode === "személyes"}
                onChange={() => setDeliveryMode("személyes")}
              />
              személyes
            </label>
          </fieldset>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={makeEnvelope}
              disabled={deliveryMode !== "posta"}
              onChange={(e) => setMakeEnvelope(e.target.checked)}
            />
            Boríték Excel készítése postázásnál
          </label>
        </div>
      </section>

      <section className="card">
        <h2>2. Levélsablon</h2>
        <TemplateManager
          selection={templateSelection}
          onSelectionChange={setTemplateSelection}
          onOpenSettings={() => setSettingsOpen(true)}
          reloadKey={templatesReloadKey}
        />
        {templateSelection.kind === "default" && (
          <div className="upload-row">
            <span className="muted small">Alap RTF sablon felülírása:</span>
            <label className="upload-btn">
              📄 Saját RTF fájl kiválasztása…
              <input
                type="file"
                accept=".rtf,application/rtf"
                onChange={onDefaultTemplateFile}
                style={{ display: "none" }}
              />
            </label>
            <span className={customDefaultName ? "upload-pill upload-pill--ok" : "upload-pill"}>
              {customDefaultName ? `✓ ${customDefaultName}` : "alapértelmezett (kiertesites4.rtf)"}
            </span>
            {customDefaultName && (
              <button type="button" onClick={resetDefaultTemplate}>Visszaállítás</button>
            )}
          </div>
        )}
        <div className="upload-row">
          <span className="muted small">Boríték sablon (XLSX) — postázáshoz:</span>
          <label className="upload-btn">
            📊 Saját XLSX fájl kiválasztása…
            <input
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={onEnvelopeFile}
              style={{ display: "none" }}
            />
          </label>
          <span className={customEnvelopeName ? "upload-pill upload-pill--ok" : "upload-pill"}>
            {customEnvelopeName ? `✓ ${customEnvelopeName}` : "alapértelmezett (boritek.xlsx)"}
          </span>
          {customEnvelopeName && (
            <button type="button" onClick={resetEnvelope}>Visszaállítás</button>
          )}
        </div>
      </section>

      <section className="card">
        <h2>3. Tulajdoni lapok (PDF / TXT)</h2>
        <div className="file-row">
          <input type="file" accept=".pdf,.txt" multiple onChange={onAddInputs} />
          <span className="muted small">
            A betöltés után automatikusan kinyerem a címzetteket. Új fájl hozzáadása a meglévő
            listához fűződik.
          </span>
        </div>
        {inputFiles.length > 0 && (
          <>
            <ul className="filelist">
              {inputFiles.map((f, i) => (
                <li key={`${f.name}-${i}`}>
                  <span>{f.name}</span>
                  <button type="button" onClick={() => removeInput(i)}>Eltávolít</button>
                </li>
              ))}
            </ul>
            <div className="actions">
              <button type="button" onClick={clearInputs}>Fájl-lista törlése</button>
            </div>
          </>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <h2>4. Címzettek ({recipients.length})</h2>
          <div className="actions">
            <button type="button" onClick={addRecipient}>+ Új címzett</button>
            <button type="button" onClick={clearRecipients} disabled={recipients.length === 0}>
              Összes törlése
            </button>
          </div>
        </div>
        {recipients.length === 0 ? (
          <p className="muted">
            Még nincsenek címzettek. Tölts fel tulajdoni lapot, vagy adj hozzá manuálisan.
          </p>
        ) : (
          <div className="table-wrap">
            <table className="recipients">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Név</th>
                  <th>Cím</th>
                  <th>Jogcím</th>
                  <th>Község</th>
                  <th>Forrás</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {recipients.map((r, i) => (
                  <tr key={i}>
                    <td>{i + 1}</td>
                    <td>
                      <input value={r.name} onChange={(e) => updateRecipient(i, { name: e.target.value })} />
                    </td>
                    <td>
                      <input value={r.address} onChange={(e) => updateRecipient(i, { address: e.target.value })} />
                    </td>
                    <td>
                      <input
                        list="role-options"
                        value={r.role}
                        onChange={(e) => updateRecipient(i, { role: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        value={r.settlement}
                        onChange={(e) => updateRecipient(i, { settlement: e.target.value })}
                      />
                    </td>
                    <td className="muted small">{r.source_file}</td>
                    <td>
                      <button type="button" onClick={() => removeRecipient(i)}>×</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <datalist id="role-options">
              {ROLE_OPTIONS.map((opt) => (
                <option key={opt} value={opt} />
              ))}
            </datalist>
          </div>
        )}
      </section>

      <section className="card">
        <div className="actions">
          <button
            type="button"
            className="primary"
            onClick={generate}
            disabled={!pyReady || busy !== null || recipients.length === 0}
          >
            Generálás
          </button>
          {busy && <span className="muted">{busy}</span>}
        </div>
        {outputs.length > 0 && (
          <div className="downloads">
            <h3>Elkészült fájlok (újraletöltés)</h3>
            <ul>
              {outputs.map((o) => (
                <li key={o.filename}>
                  <a
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      if (o.bytes) downloadBytes(o.bytes, o.filename, o.mime);
                      else if (o.text) downloadText(o.text, o.filename, o.mime);
                    }}
                  >
                    {o.filename}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Előnézet — első címzett</h2>
          {previewLoading && <span className="muted small">Frissítés…</span>}
        </div>
        {recipients.length === 0 ? (
          <p className="muted">
            Még nincs címzett. Tölts fel tulajdoni lapot — az első címzettre készül előnézet.
          </p>
        ) : previewError ? (
          <div className="error-text small">⚠ {previewError}</div>
        ) : previewText ? (
          <pre className="preview">{previewText}</pre>
        ) : (
          <p className="muted">Előnézet betöltése…</p>
        )}
      </section>

      <section className="card">
        <h2>Napló</h2>
        <pre className="log" ref={logRef}>
{logLines.join("\n")}
        </pre>
      </section>

      <footer className="footer">
        <span>Kiértesítés készítő — böngészőben futó Python (Pyodide).</span>
      </footer>

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSaved={() => setTemplatesReloadKey((k) => k + 1)}
      />
    </div>
  );
}
