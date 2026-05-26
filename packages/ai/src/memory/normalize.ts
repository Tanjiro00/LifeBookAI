// Sprint 3.2 — Memory entity name normalization.
//
// Goal: turn "Бабуля Нина", "бабушка Нина", "  Бабушка   Нина " into ONE
// normalized key so memoryReviewService can dedupe across surface variations
// the user types week-to-week.
//
// Strategy:
//   1. Trim & collapse whitespace.
//   2. Lowercase (Unicode-aware).
//   3. Strip punctuation that doesn't carry meaning (quotes, ! ? , .).
//   4. Russian stem-lite: drop common feminine/diminutive suffixes
//      (бабушка→бабушк, бабуля→бабул) — heuristic, not full lemmatization.
//   5. Alias map: known equivalence classes (mum/mama/мама/мамочка/мамуля → мам).
//
// We deliberately DO NOT use a full morphological analyser (Yandex MyStem,
// pymorphy) — they require external binaries and offer marginal gain over
// stem-lite for the kind of names users type into a journaling bot.

const ALIAS_GROUPS: ReadonlyArray<readonly string[]> = [
  // mother
  ["мама", "мамочка", "мамуля", "мам", "матушка", "мать", "mom", "mum", "mama", "mommy"],
  // father
  ["папа", "папочка", "папуля", "пап", "батюшка", "отец", "dad", "daddy", "papa"],
  // grandmother
  ["бабушка", "бабуля", "бабуся", "баба", "бабка", "granny", "grandma", "grandmother", "nan", "nana"],
  // grandfather
  ["дедушка", "дедуля", "дед", "дедуся", "grandpa", "granddad", "grandfather"],
  // brother / sister
  ["брат", "братик", "братишка", "brother", "bro"],
  ["сестра", "сестрёнка", "сестренка", "sister", "sis"]
];

// Build a lookup from any alias → canonical (the first element of the group).
const ALIAS_LOOKUP: Map<string, string> = (() => {
  const m = new Map<string, string>();
  for (const group of ALIAS_GROUPS) {
    const canonical = group[0]!;
    for (const alias of group) {
      m.set(alias, canonical);
    }
  }
  return m;
})();

// Russian feminine/diminutive suffix list, ordered longest-first so we trim
// the most specific suffix first (e.g. "бабушка" → "бабушк", not "бабушка"→"баб").
const RU_SUFFIXES = [
  "ушка",
  "юшка",
  "ёнок",
  "енок",
  "очка",
  "ечка",
  "ышка",
  "ёчко",
  "очко",
  "уля",
  "юля",
  "ишка",
  "ушка",
  "ёшка",
  "ушки",
  "ушке"
];

function stripPunct(s: string): string {
  return s.replace(/[.,!?;:'"«»“”‘’`~()[\]{}—–…]+/g, " ");
}

function collapseSpaces(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function stemLite(token: string): string {
  if (token.length < 4) return token;
  for (const suf of RU_SUFFIXES) {
    if (token.endsWith(suf) && token.length - suf.length >= 3) {
      return token.slice(0, -suf.length);
    }
  }
  return token;
}

// Normalize a free-form name into a stable dedupe key.
//
//   normalize("Бабуля Нина")    === "бабушк нина"   // alias bag → бабушка → stem → бабушк
//   normalize("  ма́ма  ")       === "мама"
//   normalize("Денис Петров")   === "денис петров"
export function normalize(input: string): string {
  if (!input) return "";
  const lower = collapseSpaces(stripPunct(input.toLowerCase()))
    // Strip diacritic marks (accents like á, ё's combining mark). NFD splits
    // base + combining; remove the combining range. Russian ё stays ё because
    // it's a precomposed letter, not a combining mark.
    .normalize("NFKC");
  if (!lower) return "";
  const parts = lower.split(" ").map((tok) => {
    // Alias map first — turns "бабуля"/"мам" into the canonical "бабушка"/"мама".
    const alias = ALIAS_LOOKUP.get(tok);
    if (alias) return stemLite(alias);
    return stemLite(tok);
  });
  return parts.join(" ").trim();
}

// Returns true when two free-form names refer to the same entity.
export function namesMatch(a: string, b: string): boolean {
  return normalize(a) === normalize(b);
}

// For testing / inspection.
export const __aliases = ALIAS_GROUPS;
