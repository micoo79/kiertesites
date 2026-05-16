import { useEffect, useRef, useState } from "react";
import type { PyodideInterface } from "./pyodide.d";

const PYODIDE_VERSION = "0.26.4";
const PYODIDE_BASE = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

let pyodidePromise: Promise<PyodideInterface> | null = null;

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${src}"]`,
    );
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error(`Nem sikerült betölteni: ${src}`)));
      if ((existing as any).__loaded) resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => {
      (script as any).__loaded = true;
      resolve();
    };
    script.onerror = () => reject(new Error(`Nem sikerült betölteni: ${src}`));
    document.head.appendChild(script);
  });
}

async function bootPyodide(
  onProgress: (msg: string) => void,
): Promise<PyodideInterface> {
  onProgress("Pyodide betöltése…");
  await loadScript(`${PYODIDE_BASE}pyodide.js`);

  if (!window.loadPyodide) {
    throw new Error("A Pyodide nem érhető el a window globálisban.");
  }

  const pyodide = await window.loadPyodide({ indexURL: PYODIDE_BASE });

  onProgress("Csomagok telepítése (micropip, openpyxl, pypdf, python-docx)…");
  await pyodide.loadPackage(["micropip", "lxml"]);
  await pyodide.runPythonAsync(`
import micropip
await micropip.install(["openpyxl", "pypdf", "python-docx"])
`);

  onProgress("Magmodul betöltése…");
  const coreUrl = new URL("python/kiertesites_core.py", document.baseURI).toString();
  const response = await fetch(coreUrl);
  if (!response.ok) {
    throw new Error(`Nem sikerült letölteni a Python magmodult: ${response.status}`);
  }
  const coreSource = await response.text();
  pyodide.FS.writeFile("/home/pyodide/kiertesites_core.py", coreSource);
  await pyodide.runPythonAsync(`
import sys
if "/home/pyodide" not in sys.path:
    sys.path.insert(0, "/home/pyodide")
import kiertesites_core
`);

  onProgress("Készen áll.");
  return pyodide;
}

export function usePyodide() {
  const [pyodide, setPyodide] = useState<PyodideInterface | null>(null);
  const [status, setStatus] = useState<string>("Inicializálás előtt…");
  const [error, setError] = useState<string | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    if (!pyodidePromise) {
      pyodidePromise = bootPyodide((msg) => setStatus(msg));
    }
    pyodidePromise
      .then((py) => {
        setPyodide(py);
        setStatus("Készen áll.");
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        setStatus("Hiba a Pyodide betöltésekor.");
        pyodidePromise = null;
      });
  }, []);

  return { pyodide, status, error };
}
