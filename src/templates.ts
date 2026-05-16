/**
 * Saját HTML sablonok — típusok és HTML-alapú levél-generálás.
 *
 * Tárolás: a sablonok a GitHub repo `data/templates.json` fájljában vannak
 * (lásd `githubStorage.ts`), így minden böngészőből ugyanazok elérhetők.
 *
 * Kimenet: .doc fájl (Word-kompatibilis HTML).
 */

export type CustomTemplate = {
  id: string;
  name: string;
  html: string;
  createdAt: number;
  updatedAt: number;
};

export type TemplateSelection =
  | { kind: "default" }
  | { kind: "custom"; id: string };

export function newTemplateId(): string {
  return `tpl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ---------------------------------------------------------------------------
// HTML alapú levél generálás saját sablonból
// ---------------------------------------------------------------------------

export type Recipient = {
  name: string;
  address: string;
  role: string;
  source_file: string;
  settlement: string;
};

/** Egyszerű HTML escape (a kitöltött értékekhez). */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const PLACEHOLDER_RE = /\[\s*\[?\s*([0-9A-Za-zÁÉÍÓÖŐÚÜŰáéíóöőúüű_]+(?:\s*[0-9A-Za-zÁÉÍÓÖŐÚÜŰáéíóöőúüű_]+)*)\s*\]\s*\]/gu;
const STAR_PLACEHOLDER_RE = /\[\s*\*\s*([^*]+?)\s*\*\s*\]/gu;

function normalizePlaceholderName(name: string): string {
  return name.replace(/\s+/g, "").trim();
}

function buildAliases(values: Record<string, string>): Record<string, string> {
  const aliases: Record<string, string> = { ...values };
  const pairs: Record<string, string> = {
    keltezés: "keltezes",
    tulajdonos_címe: "tulajdonos_cime",
    cimzett_neve: "tulajdonos_neve",
    címzett_neve: "tulajdonos_neve",
    cimzett_cime: "tulajdonos_cime",
    címzett_címe: "tulajdonos_cime",
    cimzett_címe: "tulajdonos_cime",
    címzett_cime: "tulajdonos_cime",
  };
  for (const [alias, target] of Object.entries(pairs)) {
    if (values[target] !== undefined && aliases[alias] === undefined) {
      aliases[alias] = values[target];
    }
  }
  return aliases;
}

/** Megkeresi az összes placeholder nevet egy HTML sablonban. */
export function findPlaceholdersInHtml(html: string): string[] {
  // A HTML attribútumokba ne keressünk: csak a látható szövegben.
  const div = document.createElement("div");
  div.innerHTML = html;
  const visibleText = div.textContent || "";

  const names = new Set<string>();
  for (const re of [PLACEHOLDER_RE, STAR_PLACEHOLDER_RE]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(visibleText)) !== null) {
      const name = normalizePlaceholderName(m[1]);
      if (name) names.add(name);
    }
  }
  return Array.from(names);
}

/** Eltávolítja a `data-only-personal` jelölésű elemeket (postai esetén). */
function stripPersonalOnlyBlocks(html: string): string {
  const div = document.createElement("div");
  div.innerHTML = html;
  div.querySelectorAll("[data-only-personal]").forEach((el) => el.remove());
  return div.innerHTML;
}

/**
 * Egy egyszerű replace minden látható szövegen — egyszerre kell cserélni
 * a TextNode-okat, hogy a HTML-tag tartalmát ne sértse meg.
 */
function replacePlaceholdersInHtml(
  html: string,
  values: Record<string, string>,
): { html: string; missing: string[] } {
  const aliases = buildAliases(values);
  const missing = new Set<string>();

  const replaceFn = (full: string, name: string) => {
    const norm = normalizePlaceholderName(name);
    const value = aliases[norm];
    if (value === undefined) {
      missing.add(norm);
      return full;
    }
    return escapeHtml(value);
  };

  // A HTML-ben a karakterek lehetnek tag-en belül; mi csak a tagek közötti
  // szövegrészekre szeretnénk replace-elni. Egyszerű megoldás: tokenizáljuk
  // a HTML-t < és > mentén, és csak a szöveg-darabokra alkalmazzuk a regex-et.
  const parts: string[] = [];
  let i = 0;
  while (i < html.length) {
    if (html[i] === "<") {
      const end = html.indexOf(">", i);
      if (end === -1) {
        parts.push(html.slice(i));
        break;
      }
      parts.push(html.slice(i, end + 1));
      i = end + 1;
    } else {
      const next = html.indexOf("<", i);
      const chunk = next === -1 ? html.slice(i) : html.slice(i, next);
      // A placeholder-kifejezések látható szövegben jelennek meg, de a chunk
      // HTML-encoded lehet (pl. `[[`). Megcseréljük közvetlenül a string-en.
      const replaced = chunk
        .replace(PLACEHOLDER_RE, replaceFn)
        .replace(STAR_PLACEHOLDER_RE, replaceFn);
      parts.push(replaced);
      i = next === -1 ? html.length : next;
    }
  }

  return { html: parts.join(""), missing: Array.from(missing) };
}

/**
 * A TipTap HTML-jét Word-barát formára hozza:
 * - üres `<p></p>` és `<p><br></p>` bekezdéseket `<p>&nbsp;</p>`-vé alakítja,
 *   hogy a Word megjelenítse a vertikális helyet;
 * - bezárja a teljesen üres bekezdéseken belüli whitespace-eket.
 */
function makeWordFriendly(html: string): string {
  // Üres bekezdés (csak whitespace vagy <br>) → &nbsp;
  return html.replace(
    /<p\b([^>]*)>(\s|<br\s*\/?>)*<\/p>/gi,
    '<p$1>&nbsp;</p>',
  );
}

/**
 * Word-kompatibilis .doc HTML fájl előállítása az összes címzettre.
 * Page-break-előre stílussal vágunk oldalt minden címzett között.
 */
export function buildCustomLetterDoc(
  template: CustomTemplate,
  recipients: Recipient[],
  globalValues: Record<string, string>,
  postal: boolean,
): { content: string; missing: string[] } {
  const body = postal ? stripPersonalOnlyBlocks(template.html) : template.html;

  const pages: string[] = [];
  const allMissing = new Set<string>();

  for (const r of recipients) {
    const values: Record<string, string> = {
      ...globalValues,
      tulajdonos_neve: r.name,
      tulajdonos_cime: r.address,
      kozseg: r.settlement || globalValues.kozseg || "",
      cimzett_neve: r.name,
      cimzett_cime: r.address,
    };
    const { html, missing } = replacePlaceholdersInHtml(body, values);
    missing.forEach((m) => allMissing.add(m));
    pages.push(`<div class="letter-page">${makeWordFriendly(html)}</div>`);
  }

  // .doc kompatibilis HTML wrapper, Word felismeri a page-break-eket.
  const doc = `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:w="urn:schemas-microsoft-com:office:word"
      xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8">
<title>${escapeHtml(template.name)}</title>
<!--[if gte mso 9]>
<xml>
  <w:WordDocument>
    <w:View>Print</w:View>
    <w:Zoom>100</w:Zoom>
    <w:DoNotOptimizeForBrowser/>
  </w:WordDocument>
</xml>
<![endif]-->
<style>
  @page WordSection1 { size: A4; margin: 2cm; mso-page-orientation: portrait; }
  div.WordSection1 { page: WordSection1; }
  body { font-family: "Times New Roman", serif; font-size: 12pt; line-height: 1.4; }
  p {
    margin: 0;
    mso-margin-top-alt: auto;
    mso-margin-bottom-alt: auto;
    mso-pagination: widow-orphan;
    line-height: 1.4;
  }
  .letter-page { page-break-after: always; }
  .letter-page:last-child { page-break-after: auto; }
  ul, ol { margin: 0 0 0 24pt; }
  br { mso-special-character: line-break; }
</style>
</head>
<body>
<div class="WordSection1">
${pages.join("\n")}
</div>
</body>
</html>`;

  return { content: doc, missing: Array.from(allMissing) };
}
