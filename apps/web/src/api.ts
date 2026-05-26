export type BookEntryDto = {
  id: string;
  sceneTitle: string;
  sceneContent: string;
  quote: string | null;
  accentColor?: string | null;
  createdAt: string;
  // Sprint 4.12 — chapter association. Null when unchaptered.
  chapterId?: string | null;
};

// Sprint 4.12 — chapters exposed in the public preview so LivingBook can
// render Chapter N + intro group dividers instead of grouping by month.
export type BookChapterDto = {
  id: string;
  title: string;
  subtitle: string | null;
  intro: string | null;
  themes: string[];
  orderIndex: number;
  periodStart: string | null;
  periodEnd: string | null;
};

export type BookDto = {
  title: string;
  subtitle: string | null;
  coverUrl?: string | null;
  pdfUrl?: string | null;
  createdAt: string;
  prologue?: BookEntryDto[];
  entries: BookEntryDto[];
  chapters?: BookChapterDto[];
};

// Empty (or unset) → use same origin. The Vite dev server proxies /api/* and /media/*
// to the bot. In production (single-origin deployment) this works the same way.
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");

// Sprint 4.10 — Mini App JWT held in module-level memory (no localStorage so a
// stolen device can't replay the token). The bootstrap below requests one on
// page load when window.Telegram.WebApp is available.
let jwt: string | null = null;
let authPromise: Promise<string | null> | null = null;

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        initData?: string;
        initDataUnsafe?: { user?: { id?: number } };
        ready?: () => void;
        expand?: () => void;
      };
    };
  }
}

export function setJwt(token: string | null): void {
  jwt = token;
}

export function getJwt(): string | null {
  return jwt;
}

// Resolves with a valid JWT, or null if we're outside Telegram (e.g. dev preview
// via shareToken). All Mini App API calls await this on first use.
export function ensureMiniAppAuth(): Promise<string | null> {
  if (jwt) return Promise.resolve(jwt);
  if (authPromise) return authPromise;
  const initData = typeof window !== "undefined" ? window.Telegram?.WebApp?.initData : "";
  if (!initData) {
    authPromise = Promise.resolve(null);
    return authPromise;
  }
  authPromise = (async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/telegram`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initData })
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { token: string };
      jwt = data.token;
      return jwt;
    } catch {
      return null;
    }
  })();
  return authPromise;
}

async function fetchJson<T>(path: string, opts: { auth?: boolean; method?: string; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.auth) {
    const token = await ensureMiniAppAuth();
    if (token) headers["Authorization"] = `Bearer ${token}`;
  }
  if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined
  });
  if (!response.ok) {
    let detail = "";
    try {
      detail = await response.text();
    } catch {
      /* ignore */
    }
    throw new Error(`Request failed: ${response.status} ${detail.slice(0, 200)}`);
  }
  return response.json() as Promise<T>;
}

export function getBook(shareToken: string): Promise<BookDto> {
  // Public-by-shareToken — no auth required. This is the legacy share flow.
  return fetchJson<BookDto>(`/api/books/${encodeURIComponent(shareToken)}`);
}

// ─── Sprint 4 Mini App APIs ────────────────────────────────────────────────

export type MeDto = {
  id: string;
  firstName: string | null;
  languageCode: string | null;
  lifeContext: string | null;
};

export type ManuscriptPartDto = {
  id: string;
  title: string;
  intro: string | null;
  orderIndex: number;
};

export type ManuscriptChapterDto = {
  id: string;
  title: string;
  subtitle: string | null;
  intro: string | null;
  summary: string | null;
  themes: string[];
  status: "DRAFT" | "USER_APPROVED" | "LOCKED_FOR_PDF";
  orderIndex: number;
  partId: string | null;
  periodStart: string | null;
  periodEnd: string | null;
};

export type ManuscriptPageDto = {
  id: string;
  kind: "WEEKLY" | "PROLOGUE" | "RETROSPECTIVE" | "CHAPTER_INTRO" | "EPILOGUE";
  chapterId: string | null;
  sceneTitle: string;
  sceneContent: string;
  quote: string | null;
  teaser: string | null;
  accentColor: string | null;
  createdAt: string;
  version: number;
};

export type ManuscriptDto = {
  book: { title: string; subtitle: string | null; coverUrl: string | null; pdfUrl: string | null } | null;
  parts: ManuscriptPartDto[];
  chapters: ManuscriptChapterDto[];
  pages: ManuscriptPageDto[];
};

export function getMe(): Promise<MeDto> {
  return fetchJson<MeDto>("/api/me", { auth: true });
}

export function getManuscript(): Promise<ManuscriptDto> {
  return fetchJson<ManuscriptDto>("/api/manuscript", { auth: true });
}

// ─── Mini App write actions (Sprint 4 + 5 Mini App views) ──────────────────

export type MemoryDto = {
  id: string;
  type: string;
  category: string;
  title: string;
  content: string;
  confidence: number;
  aliases: string[];
  sourcePageIds: string[];
  doNotUse: boolean;
  createdAt: string;
  updatedAt: string;
};

export function revisePage(pageId: string, instruction: string): Promise<{ newPageId: string; version: number }> {
  return fetchJson(`/api/page/${encodeURIComponent(pageId)}/revise`, {
    auth: true,
    method: "POST",
    body: { instruction }
  });
}

export function retitlePage(pageId: string, instruction?: string): Promise<{ newPageId: string; title: string; version: number }> {
  return fetchJson(`/api/page/${encodeURIComponent(pageId)}/retitle`, {
    auth: true,
    method: "POST",
    body: { instruction }
  });
}

export function renameChapter(chapterId: string, title: string): Promise<{ id: string; title: string; version: number }> {
  return fetchJson(`/api/chapter/${encodeURIComponent(chapterId)}/rename`, {
    auth: true,
    method: "POST",
    body: { title }
  });
}

export function addChapterIntroDetail(chapterId: string, detail: string): Promise<{ id: string; intro: string; version: number }> {
  return fetchJson(`/api/chapter/${encodeURIComponent(chapterId)}/intro_detail`, {
    auth: true,
    method: "POST",
    body: { detail }
  });
}

export function approveChapter(chapterId: string): Promise<{ id: string; status: string }> {
  return fetchJson(`/api/chapter/${encodeURIComponent(chapterId)}/approve`, {
    auth: true,
    method: "POST",
    body: {}
  });
}

export function resplitChapter(chapterId: string): Promise<{ ok: boolean }> {
  return fetchJson(`/api/chapter/${encodeURIComponent(chapterId)}/resplit`, {
    auth: true,
    method: "POST",
    body: {}
  });
}

export function listMemories(): Promise<MemoryDto[]> {
  return fetchJson<MemoryDto[]>("/api/memories", { auth: true });
}

export function editMemory(id: string, content: string): Promise<MemoryDto> {
  return fetchJson(`/api/memories/${encodeURIComponent(id)}/edit`, {
    auth: true,
    method: "POST",
    body: { content }
  });
}

export function deleteMemory(id: string): Promise<{ ok: boolean }> {
  return fetchJson(`/api/memories/${encodeURIComponent(id)}`, {
    auth: true,
    method: "DELETE"
  });
}

export function markMemoryDoNotUse(id: string): Promise<{ ok: boolean }> {
  return fetchJson(`/api/memories/${encodeURIComponent(id)}/do_not_use`, {
    auth: true,
    method: "POST",
    body: {}
  });
}
