const CYRILLIC_RE = /[а-яё]/i;

// Detects content language from raw text. Falls back to provided default
// (typically Telegram language_code) only when there's no signal at all.
export function detectContentLanguage(text: string, fallback?: string | null): "ru" | "en" {
  const trimmed = text.trim();
  if (trimmed) {
    const cyr = (trimmed.match(/[а-яё]/gi) || []).length;
    const lat = (trimmed.match(/[a-z]/gi) || []).length;
    if (cyr === 0 && lat === 0) {
      // No alpha at all — use fallback.
    } else if (cyr >= lat) {
      return "ru";
    } else {
      return "en";
    }
  }
  if (fallback && fallback.toLowerCase().startsWith("en")) {
    return "en";
  }
  return CYRILLIC_RE.test(trimmed) ? "ru" : "ru";
}
