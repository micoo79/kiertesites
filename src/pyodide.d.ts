declare global {
  interface Window {
    loadPyodide: (opts?: { indexURL?: string }) => Promise<PyodideInterface>;
  }
}

export interface PyodideInterface {
  loadPackage: (names: string | string[]) => Promise<void>;
  runPythonAsync: (code: string) => Promise<unknown>;
  runPython: (code: string) => unknown;
  globals: {
    get: (name: string) => any;
    set: (name: string, value: unknown) => void;
  };
  pyimport: (name: string) => any;
  FS: {
    writeFile: (path: string, data: Uint8Array | string) => void;
    readFile: (path: string, opts?: { encoding?: string }) => Uint8Array | string;
    mkdirTree: (path: string) => void;
  };
  toPy: (value: unknown) => any;
}
