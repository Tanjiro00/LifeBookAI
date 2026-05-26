import { Resvg } from "@resvg/resvg-js";
import { escapeXml, wrapText } from "./text.js";
import { isoWeekLabel, pickWeekColor, type WeekColor } from "./palette.js";

// One template for all weekly entries. The user only ever sees this card.
// 1080×1440 (Stories aspect-ish), Tall-narrow leaf out of a book — feels less like a poster.
export type EntryCardInput = {
  entryNumber: number;       // 1..52
  totalSlots?: number;       // default 52
  title: string;
  body: string;
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
      <stop offset="0" stop-color="${accent}" stop-opacity="0.18"/>
      <stop offset="0.55" stop-color="${accent}" stop-opacity="0"/>
    </linearGradient>
  </defs>`;
}

// Card canvas. 1080×1920 (9:16) — taller than the previous 3:4 so the full body
// (~1700 chars / 30 lines) fits on the card itself. No more truncation, no need to
// dual-send the body as a separate text message.
const CARD_W = 1080;
const CARD_H = 1920;
const FRAME_X = 60;
const FRAME_Y = 80;
const FRAME_W = 960;
const FRAME_H = 1760;

const BODY_LINE_HEIGHT = 36;
const BODY_MAX_LINES = 30;
const BODY_WRAP_CHARS = 56;

function buildSvg(input: EntryCardInput, color: WeekColor): string {
  const total = input.totalSlots ?? 52;
  const titleLines = wrapText(input.title, 22, 3);
  const bodyLines = wrapText(input.body.replace(/\s+/g, " "), BODY_WRAP_CHARS, BODY_MAX_LINES);
  const quote = input.quote ? input.quote.replace(/[“”"]/g, "").trim() : "";
  const quoteLines = quote ? wrapText(`«${quote}»`, 38, 3) : [];
  const date =
    input.dateLabel ||
    (input.createdAt
      ? input.createdAt.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" })
      : "");
  const week = input.createdAt ? isoWeekLabel(input.createdAt) : "";
  const counter = `${String(input.entryNumber).padStart(2, "0")} / ${total}`;

  const titleStartY = 320;
  const titleBlockH = titleLines.length * 64;
  const bodyStartY = titleStartY + 50 + titleBlockH;
  const bodyEndY = bodyStartY + 50 + bodyLines.length * BODY_LINE_HEIGHT;

  // Quote sits below body with a cushion; never above body's natural end.
  const quoteY = Math.max(bodyEndY + 80, CARD_H - 240);
  const footerY = CARD_H - 100;
  const weekY = CARD_H - 70;

  return `<svg width="${CARD_W}" height="${CARD_H}" viewBox="0 0 ${CARD_W} ${CARD_H}" xmlns="http://www.w3.org/2000/svg">
  ${paperFilters(color.cardEdge)}

  <rect width="${CARD_W}" height="${CARD_H}" fill="${PAPER_BG}"/>
  <rect width="${CARD_W}" height="${CARD_H}" filter="url(#paper)"/>
  <rect width="${CARD_W}" height="${CARD_H}" filter="url(#grain)"/>
  <rect x="0" y="0" width="${CARD_W}" height="340" fill="url(#moodGlow)"/>

  <!-- top accent bar -->
  <rect x="0" y="0" width="${CARD_W}" height="4" fill="${color.cardEdge}"/>

  <!-- thin inner frame -->
  <rect x="${FRAME_X}" y="${FRAME_Y}" width="${FRAME_W}" height="${FRAME_H}" fill="none" stroke="${RULE}" stroke-width="0.7" opacity="0.45"/>

  <!-- header: just the wordmark -->
  <text x="${CARD_W / 2}" y="170" text-anchor="middle"
        font-family="Georgia, 'Times New Roman', serif"
        font-size="20" letter-spacing="10" fill="${RULE}">LIFEBOOK</text>

  <!-- title -->
  <text x="${CARD_W / 2}" text-anchor="middle"
        font-family="Georgia, 'Times New Roman', serif"
        font-size="${titleLines.length > 1 ? 54 : 64}" font-weight="700" fill="${INK}">
    ${titleLines.map((l, i) => `<tspan x="${CARD_W / 2}" y="${titleStartY + i * 64}">${escapeXml(l)}</tspan>`).join("")}
  </text>

  <!-- separator -->
  <line x1="480" y1="${titleStartY + 30 + titleBlockH}"
        x2="600" y2="${titleStartY + 30 + titleBlockH}"
        stroke="${color.cardEdge}" stroke-width="1.2"/>

  <!-- body — full text fits here, no truncation -->
  <text x="110"
        font-family="Georgia, 'Times New Roman', serif"
        font-size="22" fill="${INK_SOFT}">
    ${bodyLines
      .map((l, i) => `<tspan x="110" y="${bodyStartY + 50 + i * BODY_LINE_HEIGHT}">${escapeXml(l)}</tspan>`)
      .join("")}
  </text>

  <!-- optional quote at the foot -->
  ${
    quoteLines.length
      ? `<text x="${CARD_W / 2}" text-anchor="middle"
              font-family="Georgia, 'Times New Roman', serif"
              font-size="24" font-style="italic" fill="${INK_SOFT}">
           ${quoteLines
             .map((l, i) => `<tspan x="${CARD_W / 2}" y="${quoteY + i * 36}">${escapeXml(l)}</tspan>`)
             .join("")}
         </text>`
      : ""
  }

  <!-- footer: date left, counter right, ISO week center -->
  <text x="110" y="${footerY}"
        font-family="Georgia, 'Times New Roman', serif"
        font-size="18" fill="${INK_FAINT}">${escapeXml(date)}</text>
  <text x="970" y="${footerY}" text-anchor="end"
        font-family="ui-monospace, 'SF Mono', Menlo, monospace"
        font-size="16" letter-spacing="4" fill="${color.cardEdge}">${escapeXml(counter)}</text>
  ${
    week
      ? `<text x="${CARD_W / 2}" y="${weekY}" text-anchor="middle"
              font-family="ui-monospace, 'SF Mono', Menlo, monospace"
              font-size="12" letter-spacing="3" fill="${INK_FAINT}">${escapeXml(week)}</text>`
      : ""
  }
</svg>`;
}

export function renderEntryCardSvg(input: EntryCardInput): string {
  const color = pickWeekColor({ mood: input.mood, tags: input.tags, fallbackSeed: input.title });
  return buildSvg(input, color);
}

export function renderEntryCardPng(input: EntryCardInput): Buffer {
  return new Resvg(renderEntryCardSvg(input), { fitTo: { mode: "width", value: 1080 } }).render().asPng();
}
