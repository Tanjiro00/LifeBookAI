const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1"]);

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

