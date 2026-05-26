import { config } from "../config.js";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1"]);

// Sprint 0.8 — Mini App URL helpers.
//
// All «open in book» buttons throughout the bot route through these helpers so
// the Mini App URL strategy lives in one place. MINIAPP_URL falls back to
// PUBLIC_WEB_URL during local dev when the Mini App and the web preview are
// served from the same origin.
function miniAppBase(): string {
  return (config.MINIAPP_URL || config.PUBLIC_WEB_URL).replace(/\/$/, "");
}

export function pageMiniAppUrl(pageId: string): string {
  return `${miniAppBase()}/page/${pageId}`;
}

export function chapterMiniAppUrl(chapterId: string): string {
  return `${miniAppBase()}/chapter/${chapterId}`;
}

export function bookMiniAppUrl(shareToken: string): string {
  return `${miniAppBase()}/book/${shareToken}`;
}

export function isTelegramInlineUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return false;
    }

    const hostname = url.hostname.toLowerCase();
    if (LOCAL_HOSTS.has(hostname) || hostname.endsWith(".local")) {
      return false;
    }

    if (isPrivateIpv4(hostname)) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split(".").map((part) => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) {
    return false;
  }

  const [a, b] = parts;
  if (a === 10 || a === 127 || a === 169) {
    return true;
  }
  if (a === 172 && b !== undefined && b >= 16 && b <= 31) {
    return true;
  }
  if (a === 192 && b === 168) {
    return true;
  }
  if (a === 198 && (b === 18 || b === 19)) {
    return true;
  }

  return false;
}

