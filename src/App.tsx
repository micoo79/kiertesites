import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePyodide } from "./usePyodide";
import type { PyodideInterface } from "./pyodide.d";

type Recipient = {
  name: string;
  address: string;
  role: string;
  source_file: string;
  settlement: string;
};

type GeneratedFile = {
  bytes: Uint8Array;
  filename: string;
  url: string;
  mime: string;
};

const ROLE_OPTIONS = [
  "tulajdonos",
  "haszonélvező",
  "vagyonkezelő",
  "tartási jog jogosultja",
  "özvegyi jog jogosultja",
];

function todayHu(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}.${mm}.${dd}.`;
}

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

function downloadBlob(bytes: Uint8Array, filename: string, mime: string): GeneratedFile {
  const blob = new Blob([bytes as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  return { bytes, filename, url, mime };
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

const RTF_MIME = "application/rtf";
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export default function App() {
  const { pyodide, status, error } = usePyodide();

  const [templateBytes, setTemplateBytes] = useState<Uint8Array | null>(null);
  const [templateName, setTemplateName] = useState<string>("kiertesites4.rtf (alapértelmezett)");
  const [envelopeBytes, setEnvelopeBytes] = useState<Uint8Array | null>(null);
  const [envelopeName, setEnvelopeName] = useState<string>("boritek.xlsx (alapértelmezett)");

  const [inputFiles, setInputFiles] = useState<{ file: File; bytes: Uint8Array }[]>([]);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [defaultSettlement, setDefaultSettlement] = useState("");

  const [kituzendoHrsz, setKituzendoHrsz] = useState("");
  const [kituzesDatuma, setKituzesDatuma] = useState("");
  const [oraPerc, setOraPerc] = useState("");
  const [keltezes, setKeltezes] = useState(todayHu());
  const [kozseg, setKozseg] = useState("");

  const [deliveryMode, setDeliveryMode] = useState<"posta" | "személyes">("posta");
  const [makeEnvelope, setMakeEnvelope] = useState(true);

  const [logLines, setLogLines] = useState<string[]>([
    "Indulásra kész. A Pyodide betöltése után tölthetsz fel tulajdoni lapokat.",
  ]);

  const [outputs, setOutputs] = useState<GeneratedFile[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const logRef = useRef<HTMLPreElement>(null);

  const appendLog = useCallback((line: string) => {
    setLogLines((prev) => [...prev, line]);
  }, []);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logLines]);

  // Default sablonok betöltése egyszer
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

  const onTemplateFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const bytes = await readFileAsBytes(file);
    setTemplateBytes(bytes);
    setTemplateName(file.name);
    appendLog(`Saját RTF sablon betöltve: ${file.name}`);
  };

  const onEnvelopeFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const bytes = await readFileAsBytes(file);
    setEnvelopeBytes(bytes);
    setEnvelopeName(file.name);
    appendLog(`Saját boríték sablon betöltve: ${file.name}`);
  };

  const onAddInputs = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    const newOnes: { file: File; bytes: Uint8Array }[] = [];
    for (const f of files) {
      const lower = f.name.toLowerCase();
      if (!lower.endsWith(".pdf") && !lower.endsWith(".txt")) {
        appendLog(`Kihagyom (nem PDF/TXT): ${f.name}`);
        continue;
      }
      const bytes = await readFileAsBytes(f);
      newOnes.push({ file: f, bytes });
    }
    setInputFiles((prev) => [...prev, ...newOnes]);
    if (newOnes.length > 0) {
      appendLog(`Hozzáadva ${newOnes.length} bemeneti fájl.`);
    }
    e.target.value = "";
  };

  const removeInput = (index: number) => {
    setInputFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const clearInputs = () => setInputFiles([]);

  const parseInputs = async () => {
    if (!pyodide) {
      appendLog("A Pyodide még nem áll készen.");
      return;
    }
    if (inputFiles.length === 0) {
      appendLog("Adj hozzá legalább egy PDF/TXT tulajdoni lapot.");
      return;
    }
    setBusy("Címzettek kinyerése…");
    try {
      appendLog("Címzettek kinyerése indul…");
      const payload = inputFiles.map(({ file, bytes }) => ({
        name: file.name,
        data: bytes,
      }));
      const result = callPython<{
        recipients: Recipient[];
        default_settlement: string;
        log: string[];
      }>(pyodide, "parse_uploaded_sheets", payload);

      for (const line of result.log) appendLog(line);

      const ds = result.default_settlement || "";
      setDefaultSettlement(ds);
      if (ds && !kozseg.trim()) setKozseg(ds);

      const filled = result.recipients.map((r) => ({
        ...r,
        settlement: r.settlement || ds || kozseg,
      }));
      setRecipients(filled);

      if (filled.length === 0) {
        appendLog("Nem sikerült automatikusan címzettet kinyerni. Manuálisan adj hozzá címzettet.");
      } else {
        appendLog(`Kinyerés kész: ${filled.length} egyedi címzett.`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      appendLog(`Hiba: ${message}`);
    } finally {
      setBusy(null);
    }
  };

  const updateRecipient = (index: number, patch: Partial<Recipient>) => {
    setRecipients((prev) =>
      prev.map((r, i) => (i === index ? { ...r, ...patch } : r)),
    );
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

  const askExtras = async (
    py: PyodideInterface,
    tplBytes: Uint8Array,
    knownKeys: Set<string>,
  ): Promise<Record<string, string> | null> => {
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

  const generate = async () => {
    if (!pyodide) {
      appendLog("A Pyodide még nem áll készen.");
      return;
    }
    if (!templateBytes) {
      appendLog("Hiányzik az RTF sablon.");
      return;
    }
    if (recipients.length === 0) {
      appendLog("Nincs címzett a listában.");
      return;
    }
    for (let i = 0; i < recipients.length; i++) {
      const r = recipients[i];
      if (!r.name.trim() || !r.address.trim()) {
        appendLog(`A(z) ${i + 1}. címzettnél hiányzik a név vagy a cím.`);
        return;
      }
    }
    if (!kituzendoHrsz.trim() || !kituzesDatuma.trim() || !oraPerc.trim() || !kozseg.trim()) {
      appendLog("Hiányos kitűzési adatok. Töltsd ki az összes kötelező mezőt.");
      return;
    }

    setBusy("Generálás folyamatban…");
    try {
      const globalValues: Record<string, string> = {
        kituzendo_hrsz: kituzendoHrsz.trim(),
        kituzes_datuma: kituzesDatuma.trim(),
        ora_perc: oraPerc.trim(),
        keltezes: (keltezes || todayHu()).trim(),
        kozseg: kozseg.trim(),
      };

      const knownKeys = new Set<string>(Object.keys(globalValues));
      const extras = await askExtras(pyodide, templateBytes, knownKeys);
      if (extras === null) {
        appendLog("Generálás megszakítva (hiányzó sablonadat).");
        setBusy(null);
        return;
      }
      Object.assign(globalValues, extras);

      const postal = deliveryMode === "posta";

      const payload = {
        template_bytes: templateBytes,
        envelope_bytes: postal && makeEnvelope ? envelopeBytes : null,
        recipients,
        global_values: globalValues,
        postal,
        make_envelope: makeEnvelope,
      };

      appendLog("RTF generálása…");
      const result = callPython<{
        rtf_bytes: Uint8Array;
        rtf_filename: string;
        xlsx_bytes: Uint8Array | null;
        xlsx_filename: string | null;
        warnings: string[];
      }>(pyodide, "generate_outputs", payload);

      for (const w of result.warnings) appendLog(w);

      const newOutputs: GeneratedFile[] = [];
      // Revoke előző URL-eket
      for (const o of outputs) URL.revokeObjectURL(o.url);

      newOutputs.push(
        downloadBlob(new Uint8Array(result.rtf_bytes), result.rtf_filename, RTF_MIME),
      );
      appendLog(`Elkészült RTF: ${result.rtf_filename}`);

      if (result.xlsx_bytes && result.xlsx_filename) {
        newOutputs.push(
          downloadBlob(new Uint8Array(result.xlsx_bytes), result.xlsx_filename, XLSX_MIME),
        );
        appendLog(`Elkészült boríték Excel: ${result.xlsx_filename}`);
      }

      setOutputs(newOutputs);
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
        <span className={`status status--${statusBadge.kind}`}>{statusBadge.text}</span>
      </header>

      <section className="card">
        <h2>Sablonok</h2>
        <div className="row">
          <label className="field">
            <span>Levélsablon (RTF):</span>
            <div className="file-row">
              <input type="file" accept=".rtf" onChange={onTemplateFile} />
              <span className="muted">{templateName}</span>
            </div>
          </label>
          <label className="field">
            <span>Boríték sablon (XLSX):</span>
            <div className="file-row">
              <input type="file" accept=".xlsx" onChange={onEnvelopeFile} />
              <span className="muted">{envelopeName}</span>
            </div>
          </label>
        </div>
      </section>

      <section className="card">
        <h2>Tulajdoni lapok (PDF / TXT)</h2>
        <div className="file-row">
          <input type="file" accept=".pdf,.txt" multiple onChange={onAddInputs} />
          <button type="button" onClick={clearInputs} disabled={inputFiles.length === 0}>
            Lista törlése
          </button>
        </div>
        {inputFiles.length > 0 && (
          <ul className="filelist">
            {inputFiles.map((f, i) => (
              <li key={`${f.file.name}-${i}`}>
                <span>{f.file.name}</span>
                <button type="button" onClick={() => removeInput(i)}>Eltávolít</button>
              </li>
            ))}
          </ul>
        )}
        <div className="actions">
          <button
            type="button"
            onClick={parseInputs}
            disabled={!pyReady || busy !== null || inputFiles.length === 0}
          >
            Címzettek kinyerése
          </button>
        </div>
      </section>

      <section className="card">
        <h2>Kitűzés adatai</h2>
        <div className="grid">
          <label className="field">
            <span>1: Kitűzendő földrészlet helyrajzi száma [[kituzendo_hrsz]]</span>
            <input value={kituzendoHrsz} onChange={(e) => setKituzendoHrsz(e.target.value)} />
          </label>
          <label className="field">
            <span>2: Mikor kerül sor a kitűzésre, dátum [[kituzes_datuma]]</span>
            <input value={kituzesDatuma} onChange={(e) => setKituzesDatuma(e.target.value)} />
          </label>
          <label className="field">
            <span>3: Hány órakor? óra:perc [[ora_perc]]</span>
            <input value={oraPerc} onChange={(e) => setOraPerc(e.target.value)} />
          </label>
          <label className="field">
            <span>4: Keltezés dátuma (üresen = mai nap)</span>
            <input value={keltezes} onChange={(e) => setKeltezes(e.target.value)} />
          </label>
          <label className="field field--wide">
            <span>Település / község [[kozseg]]</span>
            <input value={kozseg} onChange={(e) => setKozseg(e.target.value)} />
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
        <div className="card-head">
          <h2>Címzettek ({recipients.length})</h2>
          <button type="button" onClick={addRecipient}>+ Új címzett</button>
        </div>
        {recipients.length === 0 ? (
          <p className="muted">Még nincsenek címzettek. Adj hozzá tulajdoni lapot és kattints a „Címzettek kinyerése” gombra, vagy adj hozzá manuálisan.</p>
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
                      <input
                        value={r.name}
                        onChange={(e) => updateRecipient(i, { name: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        value={r.address}
                        onChange={(e) => updateRecipient(i, { address: e.target.value })}
                      />
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
            disabled={!pyReady || busy !== null || recipients.length === 0 || !templateBytes}
          >
            Generálás
          </button>
          {busy && <span className="muted">{busy}</span>}
        </div>
        {outputs.length > 0 && (
          <div className="downloads">
            <h3>Elkészült fájlok</h3>
            <ul>
              {outputs.map((o) => (
                <li key={o.filename}>
                  <a href={o.url} download={o.filename}>{o.filename}</a>
                </li>
              ))}
            </ul>
          </div>
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
    </div>
  );
}
