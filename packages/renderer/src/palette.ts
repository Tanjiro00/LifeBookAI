// The week palette: 6 mood-driven colors that show up as the chapter's accent
// across the card edge, the web preview side stripe, and the shelf spine.
// Names map to the moods the chapter generator emits, plus loose synonyms.

export type WeekColor = {
  key: string;
  spine: string;       // shelf spine fill
  spineEdge: string;   // shelf spine darker edge
  cardEdge: string;    // card frame accent
  webStripe: string;   // 3px stripe on the chapter web page
  ink: string;         // text on the spine
  label: string;       // human-readable
};

export const WEEK_COLORS: Record<string, WeekColor> = {
  quiet: {
    key: "quiet",
    spine: "#7E8FA1",
    spineEdge: "#5C6B7B",
    cardEdge: "#7E8FA1",
    webStripe: "#7E8FA1",
    ink: "#F5F1E9",
    label: "quiet"
  },
  bronze: {
    key: "bronze",
    spine: "#9A6A43",
    spineEdge: "#6F4A2C",
    cardEdge: "#9A6A43",
    webStripe: "#9A6A43",
    ink: "#F8F4EC",
    label: "warm"
  },
  ochre: {
    key: "ochre",
    spine: "#C7903F",
    spineEdge: "#8E6726",
    cardEdge: "#C7903F",
    webStripe: "#C7903F",
    ink: "#1E1B18",
    label: "bright"
  },
  swamp: {
    key: "swamp",
    spine: "#4F6B53",
    spineEdge: "#36482F",
    cardEdge: "#4F6B53",
    webStripe: "#4F6B53",
    ink: "#F5F1E9",
    label: "grounded"
  },
  burgundy: {
    key: "burgundy",
    spine: "#7B2C2C",
    spineEdge: "#561C1C",
    cardEdge: "#7B2C2C",
    webStripe: "#7B2C2C",
    ink: "#F8F4EC",
    label: "turning"
  },
  charcoal: {
    key: "charcoal",
    spine: "#2E2A26",
    spineEdge: "#15120F",
    cardEdge: "#2E2A26",
    webStripe: "#2E2A26",
    ink: "#F5F1E9",
    label: "heavy"
  }
};

const MOOD_TO_COLOR: Record<string, keyof typeof WEEK_COLORS> = {
  // quiet
  quiet: "quiet",
  calm: "quiet",
  тихий: "quiet",
  спокой: "quiet",
  reflective: "quiet",
  honest: "quiet",
  // bronze (warm)
  warm: "bronze",
  тёплый: "bronze",
  тепло: "bronze",
  intimate: "bronze",
  hopeful: "bronze",
  grateful: "bronze",
  // ochre (bright)
  bright: "ochre",
  joyful: "ochre",
  funny: "ochre",
  light: "ochre",
  светлый: "ochre",
  радост: "ochre",
  // swamp (grounded)
  grounded: "swamp",
  resolute: "swamp",
  steady: "swamp",
  decision: "swamp",
  twердый: "swamp",
  работа: "swamp",
  career: "swamp",
  // burgundy (turning)
  turning: "burgundy",
  poignant: "burgundy",
  переломный: "burgundy",
  важный: "burgundy",
  shift: "burgundy",
  change: "burgundy",
  // charcoal (heavy)
  heavy: "charcoal",
  tired: "charcoal",
  усталость: "charcoal",
  устал: "charcoal",
  sad: "charcoal",
  грустный: "charcoal",
  loss: "charcoal",
  fear: "charcoal"
};

export function pickWeekColor(opts: {
  mood?: string[] | null | undefined;
  tags?: string[] | null | undefined;
  fallbackSeed?: string | undefined;
}): WeekColor {
  const tokens = [...(opts.mood ?? []), ...(opts.tags ?? [])]
    .filter(Boolean)
    .flatMap((token) => token.toLowerCase().split(/[\s_-]+/));

  for (const token of tokens) {
    for (const moodKey of Object.keys(MOOD_TO_COLOR)) {
      if (token.startsWith(moodKey) || moodKey.startsWith(token)) {
        return WEEK_COLORS[MOOD_TO_COLOR[moodKey]!]!;
      }
    }
  }

  // Deterministic fallback so the same chapter always looks the same.
  const seed = opts.fallbackSeed || tokens.join("") || "default";
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) | 0;
  const keys = Object.keys(WEEK_COLORS);
  return WEEK_COLORS[keys[Math.abs(h) % keys.length]!]!;
}

// ISO week label like "W17/2026" — used as a small monospaced stamp on the card.
export function isoWeekLabel(date: Date): string {
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const diff = (target.getTime() - firstThursday.getTime()) / 86400000;
  const week = 1 + Math.round((diff - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `W${String(week).padStart(2, "0")}/${target.getUTCFullYear()}`;
}
