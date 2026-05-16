/**
 * Saját sablon típusok és segédfüggvények.
 *
 * A sablonokat a GitHub repo `data/templates.json` fájlja tárolja (lásd
 * `githubStorage.ts`). Minden sablon egy feltöltött RTF vagy DOCX fájl,
 * amit base64-elve mentünk a JSON-ba.
 */

export type CustomTemplate = {
  id: string;
  name: string;
  filename: string;
  mime: "rtf" | "docx";
  /** Base64-encoded fájltartalom. */
  data_b64: string;
  createdAt: number;
  updatedAt: number;
};

export type TemplateSelection =
  | { kind: "default" }
  | { kind: "custom"; id: string };

export function newTemplateId(): string {
  return `tpl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function detectTemplateMime(filename: string): "rtf" | "docx" | null {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".rtf")) return "rtf";
  if (lower.endsWith(".docx")) return "docx";
  return null;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const len = bytes.length;
  const chunkSize = 0x8000;
  for (let i = 0; i < len; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
