import { Resvg } from "@resvg/resvg-js";
import { escapeXml, wrapText } from "./text.js";

export type ChapterCardInput = {
  chapterNumber: number;
  title: string;
  quote?: string | null;
  dateRange?: string | null;
  bookLabel?: string;
};

function tspanLines(lines: string[], x: number, y: number, lineHeight: number): string {
  return lines
    .map((line, index) => `<tspan x="${x}" y="${y + index * lineHeight}">${escapeXml(line)}</tspan>`)
    .join("");
}

export function renderChapterCardSvg(input: ChapterCardInput): string {
  const titleLines = wrapText(input.title, 24, 5);
  const quote = input.quote ? input.quote.replace(/[“”"]/g, "").trim() : "";
  const quoteLines = quote ? wrapText(`"${quote}"`, 34, 5) : [];
  const dateRange = input.dateRange || new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(new Date());
  const label = input.bookLabel || "LifeBook";

  return `<svg width="1200" height="1600" viewBox="0 0 1200 1600" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect width="1200" height="1600" fill="#F8F4EC"/>
  <path d="M72 74H1128V1526H72V74Z" stroke="#9A6A43" stroke-width="3"/>
  <path d="M101 104H1099V1496H101V104Z" stroke="#D9C8B5" stroke-width="1.5"/>
  <circle cx="600" cy="218" r="34" fill="#9A6A43" opacity="0.12"/>
  <text x="600" y="206" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="34" letter-spacing="4" fill="#9A6A43">${escapeXml(label)}</text>
  <text x="600" y="290" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="30" fill="#5D5147">Chapter ${input.chapterNumber}</text>
  <text x="600" y="510" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="78" font-weight="700" fill="#1E1B18">${tspanLines(titleLines, 600, 510, 88)}</text>
  <line x1="430" y1="865" x2="770" y2="865" stroke="#9A6A43" stroke-width="2"/>
  <text x="600" y="975" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="38" font-style="italic" fill="#423A33">${tspanLines(quoteLines, 600, 975, 56)}</text>
  <text x="600" y="1365" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="30" fill="#76685D">${escapeXml(dateRange)}</text>
  <text x="600" y="1440" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="22" letter-spacing="3" fill="#9A6A43">PRIVATE BY DEFAULT</text>
</svg>`;
}

export function renderChapterCardPng(input: ChapterCardInput): Buffer {
  const svg = renderChapterCardSvg(input);
  const result = new Resvg(svg, {
    fitTo: {
      mode: "width",
      value: 1200
    }
  }).render();

  return result.asPng();
}

