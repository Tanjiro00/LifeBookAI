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

function buildSvg(input: EntryCardInput, color: WeekColor): string {
  const total = input.totalSlots ?? 52;
  const titleLines = wrapText(input.title, 22, 3);
  const bodyLines = wrapText(input.body.replace(/\s+/g, " "), 56, 14);
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

  return `<svg width="1080" height="1440" viewBox="0 0 1080 1440" xmlns="http://www.w3.org/2000/svg">
  ${paperFilters(color.cardEdge)}

  <rect width="1080" height="1440" fill="${PAPER_BG}"/>
  <rect width="1080" height="1440" filter="url(#paper)"/>
  <rect width="1080" height="1440" filter="url(#grain)"/>
  <rect x="0" y="0" width="1080" height="340" fill="url(#moodGlow)"/>

  <!-- top accent bar -->
  <rect x="0" y="0" width="1080" height="4" fill="${color.cardEdge}"/>

  <!-- thin inner frame -->
  <rect x="60" y="80" width="960" height="1280" fill="none" stroke="${RULE}" stroke-width="0.7" opacity="0.45"/>

  <!-- header: just the wordmark -->
  <text x="540" y="170" text-anchor="middle"
        font-family="Georgia, 'Times New Roman', serif"
        font-size="20" letter-spacing="10" fill="${RULE}">LIFEBOOK</text>

  <!-- title -->
  <text x="540" text-anchor="middle"
        font-family="Georgia, 'Times New Roman', serif"
        font-size="${titleLines.length > 1 ? 54 : 64}" font-weight="700" fill="${INK}">
    ${titleLines.map((l, i) => `<tspan x="540" y="${titleStartY + i * 64}">${escapeXml(l)}</tspan>`).join("")}
  </text>

  <!-- separator -->
  <line x1="480" y1="${titleStartY + 30 + titleBlockH}"
        x2="600" y2="${titleStartY + 30 + titleBlockH}"
        stroke="${color.cardEdge}" stroke-width="1.2"/>

  <!-- body excerpt -->
  <text x="110"
        font-family="Georgia, 'Times New Roman', serif"
        font-size="22" fill="${INK_SOFT}">
    ${bodyLines
      .map((l, i) => `<tspan x="110" y="${bodyStartY + 50 + i * 36}">${escapeXml(l)}</tspan>`)
      .join("")}
  </text>

  <!-- optional quote at the foot -->
  ${
    quoteLines.length
      ? `<text x="540" text-anchor="middle"
              font-family="Georgia, 'Times New Roman', serif"
              font-size="24" font-style="italic" fill="${INK_SOFT}">
           ${quoteLines
             .map((l, i) => `<tspan x="540" y="${1200 + i * 36}">${escapeXml(l)}</tspan>`)
             .join("")}
         </text>`
      : ""
  }

  <!-- footer: date left, counter right, ISO week center -->
  <text x="110" y="1330"
        font-family="Georgia, 'Times New Roman', serif"
        font-size="18" fill="${INK_FAINT}">${escapeXml(date)}</text>
  <text x="970" y="1330" text-anchor="end"
        font-family="ui-monospace, 'SF Mono', Menlo, monospace"
        font-size="16" letter-spacing="4" fill="${color.cardEdge}">${escapeXml(counter)}</text>
  ${
    week
      ? `<text x="540" y="1360" text-anchor="middle"
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
