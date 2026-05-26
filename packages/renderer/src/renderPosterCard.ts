import { Resvg } from "@resvg/resvg-js";
import { escapeXml, wrapText } from "./text.js";
import { isoWeekLabel, pickWeekColor, type WeekColor } from "./palette.js";

// Sprint 0.3 — Poster card.
//
// Replaces the legacy renderEntryCard.ts as the artifact users see in Telegram.
// The body of the page is NEVER rendered here in full; this card is a *poster*
// that pairs with full reading inside the Mini App.
//
// Layout philosophy:
//   - Big readable title (≥ 64pt, scales down to 48pt only when very long).
//   - Optional pulled-quote in italics (38–46pt) — must be a sentence the user
//     wants to remember.
//   - Short teaser of the page (≤ 7 lines, 40–48pt) — a tasting, not the meal.
//   - Footer with date, page counter, ISO week stamp.
//
// Why these sizes: Telegram thumbnails this card to ~360px wide on mobile, so
// 22pt body in the legacy card rendered visually as ~7px. At 44pt, the same
// card renders at ~14px — readable without opening fullscreen.

export type PosterCardInput = {
  pageNumber: number;
  totalSlots?: number;
  title: string;
  teaser: string;
  quote?: string | null;
  dateLabel?: string | null;
  mood?: string[] | null | undefined;
  tags?: string[] | null | undefined;
  createdAt?: Date;
};

const PAPER_BG = "#F8F4EC";
const INK = "#1E1B18";
const INK_SOFT = "#5D5147";
const INK_FAINT = "#76685D";
const RULE = "#9A6A43";

// 1080 × 1440 — 3:4. Less stretched than 9:16 stories format, leaves plenty of
// room for big type without forcing the card to feel like a phone screen.
const CARD_W = 1080;
const CARD_H = 1440;
const FRAME_X = 60;
const FRAME_Y = 80;
const FRAME_W = CARD_W - 120;
const FRAME_H = CARD_H - 160;

const TITLE_MAX_LINES = 3;
const TITLE_WRAP_CHARS = 18;
const TITLE_FONT_LARGE = 88;
const TITLE_FONT_MEDIUM = 72;
const TITLE_FONT_SMALL = 56;

const TEASER_MAX_LINES = 7;
const TEASER_WRAP_CHARS = 30;
const TEASER_FONT = 44;
const TEASER_LINE_HEIGHT = 60;

const QUOTE_MAX_LINES = 3;
const QUOTE_WRAP_CHARS = 30;
const QUOTE_FONT = 40;
const QUOTE_LINE_HEIGHT = 54;

function paperFilters(accent: string): string {
  return `<defs>
    <filter id="paper" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="9" stitchTiles="stitch" result="n"/>
      <feColorMatrix in="n" type="matrix"
        values="0 0 0 0 0.45
                0 0 0 0 0.40
                0 0 0 0 0.32
                0 0 0 0.06 0"/>
      <feComposite in2="SourceGraphic" operator="in"/>
    </filter>
    <filter id="grain" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="turbulence" baseFrequency="2.4" numOctaves="1" seed="2" result="g"/>
      <feColorMatrix in="g" type="matrix"
        values="0 0 0 0 0.10
                0 0 0 0 0.09
                0 0 0 0 0.07
                0 0 0 0.04 0"/>
      <feComposite in2="SourceGraphic" operator="in"/>
    </filter>
    <linearGradient id="moodGlow" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${accent}" stop-opacity="0.22"/>
      <stop offset="0.6" stop-color="${accent}" stop-opacity="0"/>
    </linearGradient>
  </defs>`;
}

function pickTitleFont(lineCount: number): number {
  if (lineCount <= 1) return TITLE_FONT_LARGE;
  if (lineCount === 2) return TITLE_FONT_MEDIUM;
  return TITLE_FONT_SMALL;
}

function buildSvg(input: PosterCardInput, color: WeekColor): string {
  const total = input.totalSlots ?? 52;
  const titleLines = wrapText(input.title, TITLE_WRAP_CHARS, TITLE_MAX_LINES);
  const titleFont = pickTitleFont(titleLines.length);
  const titleLineH = Math.round(titleFont * 1.04);

  // Teaser is the page's *opener*, never the whole body. We paragraph-collapse it
  // so wrapping behaves consistently across short/long inputs.
  const cleanTeaser = (input.teaser || "").replace(/\s+/g, " ").trim();
  const teaserLines = cleanTeaser
    ? wrapText(cleanTeaser, TEASER_WRAP_CHARS, TEASER_MAX_LINES)
    : [];

  const cleanQuote = input.quote ? input.quote.replace(/[“”"]/g, "").trim() : "";
  const quoteLines = cleanQuote
    ? wrapText(`«${cleanQuote}»`, QUOTE_WRAP_CHARS, QUOTE_MAX_LINES)
    : [];

  const date =
    input.dateLabel ||
    (input.createdAt
      ? input.createdAt.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" })
      : "");
  const week = input.createdAt ? isoWeekLabel(input.createdAt) : "";
  const counter = `${String(input.pageNumber).padStart(2, "0")} / ${total}`;

  // Vertical rhythm: header (LIFEBOOK wordmark) → title → quote → teaser → footer.
  const HEADER_Y = 170;
  const titleStartY = 320;
  const titleBlockH = titleLines.length * titleLineH;
  const titleEndY = titleStartY + titleBlockH;

  // Separator line under the title.
  const sepY = titleEndY + 56;

  // Quote sits between title and teaser when present.
  const quoteStartY = sepY + 70;
  const quoteBlockH = quoteLines.length * QUOTE_LINE_HEIGHT;
  const teaserAfterQuoteY = quoteStartY + quoteBlockH + 70;
  const teaserStartY = quoteLines.length ? teaserAfterQuoteY : sepY + 80;

  const FOOTER_Y = CARD_H - 100;
  const WEEK_Y = CARD_H - 70;

  return `<svg width="${CARD_W}" height="${CARD_H}" viewBox="0 0 ${CARD_W} ${CARD_H}" xmlns="http://www.w3.org/2000/svg">
  ${paperFilters(color.cardEdge)}

  <rect width="${CARD_W}" height="${CARD_H}" fill="${PAPER_BG}"/>
  <rect width="${CARD_W}" height="${CARD_H}" filter="url(#paper)"/>
  <rect width="${CARD_W}" height="${CARD_H}" filter="url(#grain)"/>
  <rect x="0" y="0" width="${CARD_W}" height="380" fill="url(#moodGlow)"/>

  <!-- top accent bar -->
  <rect x="0" y="0" width="${CARD_W}" height="6" fill="${color.cardEdge}"/>

  <!-- thin inner frame -->
  <rect x="${FRAME_X}" y="${FRAME_Y}" width="${FRAME_W}" height="${FRAME_H}" fill="none" stroke="${RULE}" stroke-width="0.7" opacity="0.5"/>

  <!-- header: just the wordmark -->
  <text x="${CARD_W / 2}" y="${HEADER_Y}" text-anchor="middle"
        font-family="Georgia, 'Times New Roman', serif"
        font-size="22" letter-spacing="12" fill="${RULE}">LIFEBOOK</text>

  <!-- title: the dominant element of the poster -->
  <text x="${CARD_W / 2}" text-anchor="middle"
        font-family="Georgia, 'Times New Roman', serif"
        font-size="${titleFont}" font-weight="700" fill="${INK}">
    ${titleLines.map((l, i) => `<tspan x="${CARD_W / 2}" y="${titleStartY + i * titleLineH}">${escapeXml(l)}</tspan>`).join("")}
  </text>

  <!-- separator -->
  <line x1="${CARD_W / 2 - 70}" y1="${sepY}" x2="${CARD_W / 2 + 70}" y2="${sepY}"
        stroke="${color.cardEdge}" stroke-width="1.4"/>

  ${
    quoteLines.length
      ? `<text x="${CARD_W / 2}" text-anchor="middle"
              font-family="Georgia, 'Times New Roman', serif"
              font-size="${QUOTE_FONT}" font-style="italic" fill="${INK_SOFT}">
           ${quoteLines
             .map(
               (l, i) =>
                 `<tspan x="${CARD_W / 2}" y="${quoteStartY + i * QUOTE_LINE_HEIGHT}">${escapeXml(l)}</tspan>`
             )
             .join("")}
         </text>`
      : ""
  }

  ${
    teaserLines.length
      ? `<text x="${CARD_W / 2}" text-anchor="middle"
              font-family="Georgia, 'Times New Roman', serif"
              font-size="${TEASER_FONT}" fill="${INK}">
           ${teaserLines
             .map(
               (l, i) =>
                 `<tspan x="${CARD_W / 2}" y="${teaserStartY + i * TEASER_LINE_HEIGHT}">${escapeXml(l)}</tspan>`
             )
             .join("")}
         </text>`
      : ""
  }

  <!-- footer: date left, counter right, ISO week center -->
  <text x="110" y="${FOOTER_Y}"
        font-family="Georgia, 'Times New Roman', serif"
        font-size="22" fill="${INK_FAINT}">${escapeXml(date)}</text>
  <text x="${CARD_W - 110}" y="${FOOTER_Y}" text-anchor="end"
        font-family="ui-monospace, 'SF Mono', Menlo, monospace"
        font-size="18" letter-spacing="4" fill="${color.cardEdge}">${escapeXml(counter)}</text>
  ${
    week
      ? `<text x="${CARD_W / 2}" y="${WEEK_Y}" text-anchor="middle"
              font-family="ui-monospace, 'SF Mono', Menlo, monospace"
              font-size="14" letter-spacing="3" fill="${INK_FAINT}">${escapeXml(week)}</text>`
      : ""
  }
</svg>`;
}

export function renderPosterCardSvg(input: PosterCardInput): string {
  const color = pickWeekColor({ mood: input.mood, tags: input.tags, fallbackSeed: input.title });
  return buildSvg(input, color);
}

export function renderPosterCardPng(input: PosterCardInput): Buffer {
  return new Resvg(renderPosterCardSvg(input), { fitTo: { mode: "width", value: CARD_W } })
    .render()
    .asPng();
}
