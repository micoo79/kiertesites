/**
 * Sablonok tárolása a GitHub repoban (data/templates.json).
 *
 * Olvasás: a raw.githubusercontent.com cache-eli, így gyors és nem kell token.
 * Írás: a GitHub Contents API-n keresztül, fine-grained PAT-tal, amit a
 *   böngésző localStorage-jében tárolunk.
 */

import type { CustomTemplate } from "./templates";

export const REPO_OWNER = "micoo79";
export const REPO_NAME = "kiertesites";
export const REPO_BRANCH = "main";
export const TEMPLATES_PATH = "data/templates.json";

const PAT_KEY = "kiertesites_github_pat_v1";
const CACHE_KEY = "kiertesites_remote_templates_cache_v1";

export function getPat(): string | null {
  try {
    return localStorage.getItem(PAT_KEY);
  } catch {
    return null;
  }
}

export function setPat(pat: string | null): void {
  try {
    if (pat) localStorage.setItem(PAT_KEY, pat);
    else localStorage.removeItem(PAT_KEY);
  } catch {
    // ignore
  }
}

export type RemoteTemplatesState = {
  templates: CustomTemplate[];
  sha: string | null;
};

function readCache(): RemoteTemplatesState | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as RemoteTemplatesState;
  } catch {
    return null;
  }
}

function writeCache(state: RemoteTemplatesState): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
}

function base64EncodeUtf8(text: string): string {
  return btoa(unescape(encodeURIComponent(text)));
}

function base64DecodeUtf8(b64: string): string {
  return decodeURIComponent(escape(atob(b64.replace(/\s+/g, ""))));
}

/**
 * Sablonok letöltése a repoból. Auth nélkül is működik (publikus repo).
 * Sha-t a Contents API ad — ezt kell visszaküldeni a következő íráshoz.
 */
export async function fetchRemoteTemplates(): Promise<RemoteTemplatesState> {
  const url =
    `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${TEMPLATES_PATH}` +
    `?ref=${REPO_BRANCH}`;

  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
  };
  const pat = getPat();
  if (pat) headers.Authorization = `Bearer ${pat}`;

  const res = await fetch(url, { headers });

  if (res.status === 404) {
    const state: RemoteTemplatesState = { templates: [], sha: null };
    writeCache(state);
    return state;
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`GitHub olvasás sikertelen: ${res.status} ${text}`);
  }
  const data = await res.json();
  let parsed: { templates?: CustomTemplate[] } = {};
  try {
    parsed = JSON.parse(base64DecodeUtf8(data.content as string));
  } catch {
    parsed = {};
  }
  const state: RemoteTemplatesState = {
    templates: Array.isArray(parsed.templates) ? parsed.templates : [],
    sha: data.sha as string,
  };
  writeCache(state);
  return state;
}

/**
 * Sablonok feltöltése a repoba. PAT szükséges.
 * Versenyhelyzet ellen a `prevSha` paraméter használja a GitHub `sha` mezőjét.
 * Ha a remote oldal időközben változott, a fetchRemoteTemplates frissítését
 * kell előbb meghívni.
 */
export async function saveRemoteTemplates(
  templates: CustomTemplate[],
  prevSha: string | null,
  commitMessage?: string,
): Promise<RemoteTemplatesState> {
  const pat = getPat();
  if (!pat) {
    throw new Error(
      "Nincs GitHub access token beállítva. Nyisd meg a Beállításokat és add meg.",
    );
  }

  const url =
    `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${TEMPLATES_PATH}`;

  const content = JSON.stringify({ templates }, null, 2);
  const body: Record<string, unknown> = {
    message: commitMessage ?? `Sablonok frissítése (${new Date().toISOString()})`,
    content: base64EncodeUtf8(content),
    branch: REPO_BRANCH,
  };
  if (prevSha) body.sha = prevSha;

  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${pat}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let detail = text;
    try {
      const parsed = JSON.parse(text);
      detail = parsed.message ?? text;
    } catch {
      // ignore
    }
    throw new Error(`GitHub mentés sikertelen: ${res.status} — ${detail}`);
  }

  const data = await res.json();
  const state: RemoteTemplatesState = {
    templates,
    sha: data.content.sha as string,
  };
  writeCache(state);
  return state;
}

export function readCachedTemplates(): RemoteTemplatesState {
  return readCache() ?? { templates: [], sha: null };
}

/** Gyors token érvényesség-ellenőrzés. */
export async function verifyPat(pat: string): Promise<boolean> {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}`,
      {
        headers: {
          Authorization: `Bearer ${pat}`,
          Accept: "application/vnd.github+json",
        },
      },
    );
    return res.ok;
  } catch {
    return false;
  }
}
