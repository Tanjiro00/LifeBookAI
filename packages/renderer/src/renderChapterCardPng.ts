import { Resvg } from "@resvg/resvg-js";
import { escapeXml, wrapText } from "./text.js";
import { pickWeekColor, type WeekColor } from "./palette.js";

// Sprint 4.3 — Chapter cover card.
//
// Distinct from the per-page poster card. The chapter card is a book-cover
// artifact: large title, optional subtitle, accent stripe with chapter number,
// page-range stamp at the foot. NO body / teaser is rendered — the full intro
// lives in the caption text (≤ 1024 chars) or the Mini App.
//
// Composition:
//   - 1080×1440 canvas, ivory background with paper grain.
//   - Top accent strip in the chapter's mood color.
//   - Wordmark «LIFEBOOK · CHAPTER N» small caps.
//   - Title centered, dominant (88-104pt, scales down by line count).
//   - Subtitle italic if present (38pt).
//   - Themes line (lowercased, comma-separated, 24pt) below the title block.
//   - Footer: «pages X-Y · MM YYYY — MM YYYY».

export type ChapterCardInput = {
  chapterNumber: number;
  title: string;
  subtitle?: string | null;
  themes?: string[] | null;
  pageRange?: { from: number; to: number } | null;
  periodStart?: Date | null;
  periodEnd?: Date | null;
  // Mood / tags drive the accent color — same palette as page poster.
  mood?: string[] | null;
  tags?: string[] | null;
};

const PAPER_BG = "#F8F4EC";
const INK = "#1E1B18";
const INK_SOFT = "#5D5147";
const INK_FAINT = "#76685D";
const RULE = "#9A6A43";

const CARD_W = 1080;
const CARD_H = 1440;
const FRAME_X = 60;
const FRAME_Y = 80;
const FRAME_W = CARD_W - 120;
const FRAME_H = CARD_H - 160;

// Title scaling: a 1-line title gets the biggest treatment because the chapter
// card is meant to feel like a book cover.
const TITLE_MAX_LINES = 4;
const TITLE_WRAP_CHARS = 18;
const TITLE_FONT_HUGE = 104;
const TITLE_FONT_LARGE = 88;
const TITLE_FONT_MEDIUM = 68;
const TITLE_FONT_SMALL = 56;

const SUBTITLE_FONT = 38;
const SUBTITLE_LINE_HEIGHT = 50;
const SUBTITLE_WRAP_CHARS = 32;
const SUBTITLE_MAX_LINES = 2;

const THEMES_FONT = 24;

const MONTHS_RU = [
  "янв", "фев", "мар", "апр", "май", "июн",
  "июл", "авг", "сен", "окт", "ноя", "дек"
];

function paperFilters(accent: string): string {
  return `<defs>
    <filter id="paper-c" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="11" stitchTiles="stitch" result="n"/>
      <feColorMatrix in="n" type="matrix"
        values="0 0 0 0 0.45
                0 0 0 0 0.40
                0 0 0 0 0.32
                0 0 0 0.05 0"/>
      <feComposite in2="SourceGraphic" operator="in"/>
    </filter>
    <linearGradient id="chapterMoodGlow" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0"   stop-color="${accent}" stop-opacity="0.32"/>
      <stop offset="0.5" stop-color="${accent}" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="bottomMoodGlow" x1="0" y1="1" x2="0" y2="0">
      <stop offset="0"   stop-color="${accent}" stop-opacity="0.18"/>
      <stop offset="0.6" stop-color="${accent}" stop-opacity="0"/>
    </linearGradient>
  </defs>`;
}

function pickTitleFont(lineCount: number): number {
  if (lineCount <= 1) return TITLE_FONT_HUGE;
  if (lineCount === 2) return TITLE_FONT_LARGE;
  if (lineCount === 3) return TITLE_FONT_MEDIUM;
  return TITLE_FONT_SMALL;
}

function formatRange(start?: Date | null, end?: Date | null): string {
  if (!start && !end) return "";
  const fmt = (d: Date) => `${MONTHS_RU[d.getMonth()]} ${d.getFullYear()}`;
  if (start && end) {
    if (start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth()) {
      return fmt(start);
    }
    return `${fmt(start)} — ${fmt(end)}`;
  }
  return fmt((start ?? end)!);
}

function buildSvg(input: ChapterCardInput, color: WeekColor): string {
  const titleLines = wrapText(input.title, TITLE_WRAP_CHARS, TITLE_MAX_LINES);
  const titleFont = pickTitleFont(titleLines.length);
  const titleLineH = Math.round(titleFont * 1.04);

  const subtitleClean = (input.subtitle || "").trim();
  const subtitleLines = subtitleClean
    ? wrapText(subtitleClean, SUBTITLE_WRAP_CHARS, SUBTITLE_MAX_LINES)
    : [];

  const themesLine = (input.themes ?? [])
    .filter(Boolean)
    .slice(0, 6)
    .map((t) => t.toLowerCase())
    .join(" · ");

  const range = formatRange(input.periodStart ?? null, input.periodEnd ?? null);
  const pageRange = input.pageRange
    ? `pages ${input.pageRange.from}–${input.pageRange.to}`
    : "";
  const footerLine = [pageRange, range].filter(Boolean).join("  ·  ");

  // Vertical rhythm.
  const HEADER_Y = 200;
  const titleBlockH = titleLines.length * titleLineH;
  const titleStartY = Math.round((CARD_H - titleBlockH) / 2 - 80);
  const titleEndY = titleStartY + titleBlockH;

  const sepY = titleEndY + 60;
  const subtitleStartY = sepY + 70;
  const subtitleBlockH = subtitleLines.length * SUBTITLE_LINE_HEIGHT;
  const themesY = subtitleStartY + subtitleBlockH + (subtitleLines.length ? 60 : -20);

  const FOOTER_Y = CARD_H - 120;

  return `<svg width="${CARD_W}" height="${CARD_H}" viewBox="0 0 ${CARD_W} ${CARD_H}" xmlns="http://www.w3.org/2000/svg">
  ${paperFilters(color.cardEdge)}

  <rect width="${CARD_W}" height="${CARD_H}" fill="${PAPER_BG}"/>
  <rect width="${CARD_W}" height="${CARD_H}" filter="url(#paper-c)"/>
  <rect width="${CARD_W}" height="380" fill="url(#chapterMoodGlow)"/>
  <rect x="0" y="${CARD_H - 360}" width="${CARD_W}" height="360" fill="url(#bottomMoodGlow)"/>

  <!-- top accent strip (taller than the page card to feel like a hardcover) -->
  <rect x="0" y="0" width="${CARD_W}" height="14" fill="${color.cardEdge}"/>
  <!-- bottom accent strip -->
  <rect x="0" y="${CARD_H - 8}" width="${CARD_W}" height="8" fill="${color.cardEdge}"/>

  <!-- inner frame -->
  <rect x="${FRAME_X}" y="${FRAME_Y}" width="${FRAME_W}" height="${FRAME_H}" fill="none" stroke="${RULE}" stroke-width="0.7" opacity="0.55"/>

  <!-- wordmark -->
  <text x="${CARD_W / 2}" y="${HEADER_Y}" text-anchor="middle"
        font-family="Georgia, 'Times New Roman', serif"
        font-size="22" letter-spacing="14" fill="${RULE}">LIFEBOOK · ${escapeXml(`CHAPTER ${String(input.chapterNumber).padStart(2, "0")}`)}</text>

  <!-- title -->
  <text x="${CARD_W / 2}" text-anchor="middle"
        font-family="Georgia, 'Times New Roman', serif"
        font-size="${titleFont}" font-weight="700" fill="${INK}">
    ${titleLines.map((l, i) => `<tspan x="${CARD_W / 2}" y="${titleStartY + i * titleLineH}">${escapeXml(l)}</tspan>`).join("")}
  </text>

  <!-- separator under the title -->
  <line x1="${CARD_W / 2 - 90}" y1="${sepY}" x2="${CARD_W / 2 + 90}" y2="${sepY}"
        stroke="${color.cardEdge}" stroke-width="1.6"/>

  ${
    subtitleLines.length
      ? `<text x="${CARD_W / 2}" text-anchor="middle"
              font-family="Georgia, 'Times New Roman', serif"
              font-size="${SUBTITLE_FONT}" font-style="italic" fill="${INK_SOFT}">
           ${subtitleLines.map((l, i) => `<tspan x="${CARD_W / 2}" y="${subtitleStartY + i * SUBTITLE_LINE_HEIGHT}">${escapeXml(l)}</tspan>`).join("")}
         </text>`
      : ""
  }

  ${
    themesLine
      ? `<text x="${CARD_W / 2}" y="${themesY}" text-anchor="middle"
              font-family="ui-monospace, 'SF Mono', Menlo, monospace"
              font-size="${THEMES_FONT}" letter-spacing="6" fill="${INK_FAINT}">${escapeXml(themesLine)}</text>`
      : ""
  }

  <!-- footer: page range + period -->
  ${
    footerLine
      ? `<text x="${CARD_W / 2}" y="${FOOTER_Y}" text-anchor="middle"
              font-family="Georgia, 'Times New Roman', serif"
              font-size="22" fill="${INK_FAINT}">${escapeXml(footerLine)}</text>`
      : ""
  }
</svg>`;
}

export function renderChapterCardSvg(input: ChapterCardInput): string {
  const color = pickWeekColor({
    mood: input.mood,
    tags: input.tags,
    fallbackSeed: input.title
  });
  return buildSvg(input, color);
}

export function renderChapterCardPng(input: ChapterCardInput): Buffer {
  return new Resvg(renderChapterCardSvg(input), { fitTo: { mode: "width", value: CARD_W } })
    .render()
    .asPng();
}
