const TELEGRAM_LIMIT = 4096;

// Split text safely into chunks <= limit, preferring paragraph then sentence boundaries.
export function splitForTelegram(text: string, limit = TELEGRAM_LIMIT): string[] {
  if (text.length <= limit) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > limit) {
    const window = remaining.slice(0, limit);
    let cut = window.lastIndexOf("\n\n");
    if (cut < limit * 0.4) {
      cut = window.lastIndexOf("\n");
    }
    if (cut < limit * 0.4) {
      cut = Math.max(window.lastIndexOf(". "), window.lastIndexOf("! "), window.lastIndexOf("? "));
      if (cut > 0) {
        cut += 1;
      }
    }
    if (cut < limit * 0.4) {
      cut = limit;
    }

    chunks.push(remaining.slice(0, cut).trimEnd());
    remaining = remaining.slice(cut).trimStart();
  }

  if (remaining.length > 0) {
    chunks.push(remaining);
  }

  return chunks;
}
