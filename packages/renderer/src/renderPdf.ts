import PDFDocument from "pdfkit";
import { Readable } from "node:stream";

// 5.5" × 8.25" trade-paper book trim, in PDF points (72/inch).
const PAGE_W = 5.5 * 72;
const PAGE_H = 8.25 * 72;
const MARGIN = 0.6 * 72;
const INK = "#1E1B18";
const INK_SOFT = "#5D5147";
const INK_FAINT = "#76685D";
const BRONZE = "#9A6A43";
const PAPER = "#F8F4EC";

export type BookEntryPdfInput = {
  title: string;
  body: string;
  quote?: string | null;
  createdAt: Date;
};

export type BookPdfInput = {
  bookTitle: string;
  authorName?: string | null | undefined;
  subtitle?: string | null;
  year: number;
  entries: BookEntryPdfInput[];
  coverPngBuffer?: Buffer | null;
};

const MONTHS_RU = [
  "января","февраля","марта","апреля","мая","июня",
  "июля","августа","сентября","октября","ноября","декабря"
];

function formatDate(d: Date): string {
  return `${d.getDate()} ${MONTHS_RU[d.getMonth()]} ${d.getFullYear()}`;
}

function newPage(doc: InstanceType<typeof PDFDocument>): void {
  doc.addPage({ size: [PAGE_W, PAGE_H], margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN } });
  doc.rect(0, 0, PAGE_W, PAGE_H).fill(PAPER);
}

// Simple multi-page book. Cover + title page + month-grouped TOC + each entry as a
// chapter page. PDFKit's text wrapping handles reflow within a single page; entries
// longer than a page flow naturally.
export async function renderBookPdf(input: BookPdfInput): Promise<Buffer> {
  const doc = new PDFDocument({
    size: [PAGE_W, PAGE_H],
    margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
    autoFirstPage: false,
    info: {
      Title: input.bookTitle,
      Author: input.authorName || "LifeBook",
      Subject: `Personal autobiography ${input.year}`
    }
  });

  // ---- COVER ----
  doc.addPage({ size: [PAGE_W, PAGE_H], margin: 0 });
  doc.rect(0, 0, PAGE_W, PAGE_H).fill(PAPER);
  if (input.coverPngBuffer) {
    try {
      doc.image(input.coverPngBuffer, 0, 0, { width: PAGE_W, height: PAGE_H });
      // Title overlay band at the bottom for readability.
      doc.rect(0, PAGE_H - 1.6 * 72, PAGE_W, 1.6 * 72).fillOpacity(0.9).fill(PAPER);
      doc.fillOpacity(1);
    } catch {
      // Fall through to typographic cover.
    }
  }
  doc.fillColor(BRONZE).font("Times-Roman").fontSize(11);
  doc.text("LIFEBOOK", 0, PAGE_H - 1.4 * 72, { align: "center", width: PAGE_W, characterSpacing: 4 });
  doc.fillColor(INK).font("Times-Bold").fontSize(28);
  doc.text(input.bookTitle, MARGIN, PAGE_H - 1.05 * 72, {
    width: PAGE_W - MARGIN * 2,
    align: "center"
  });
  if (input.subtitle) {
    doc.font("Times-Italic").fontSize(13).fillColor(INK_SOFT);
    doc.text(input.subtitle, MARGIN, PAGE_H - 0.55 * 72, {
      width: PAGE_W - MARGIN * 2,
      align: "center"
    });
  }
  doc.font("Times-Roman").fontSize(10).fillColor(INK_FAINT);
  doc.text(String(input.year), 0, PAGE_H - 0.3 * 72, { align: "center", width: PAGE_W, characterSpacing: 4 });

  // ---- TITLE PAGE ----
  newPage(doc);
  doc.fillColor(BRONZE).font("Times-Roman").fontSize(10).text("LIFEBOOK", { align: "center", characterSpacing: 6 });
  doc.moveDown(8);
  doc.fillColor(INK).font("Times-Bold").fontSize(26).text(input.bookTitle, { align: "center" });
  doc.moveDown(0.6);
  if (input.subtitle) {
    doc.font("Times-Italic").fontSize(14).fillColor(INK_SOFT).text(input.subtitle, { align: "center" });
  }
  doc.moveDown(2);
  doc.font("Times-Roman").fontSize(11).fillColor(INK_FAINT)
     .text(`${input.entries.length} записей · ${input.year}`, { align: "center" });
  if (input.authorName) {
    doc.moveDown(8);
    doc.font("Times-Roman").fontSize(13).fillColor(INK).text(input.authorName, { align: "center" });
  }

  // ---- TABLE OF CONTENTS (by month) ----
  newPage(doc);
  doc.fillColor(BRONZE).font("Times-Roman").fontSize(10).text("СОДЕРЖАНИЕ", { characterSpacing: 6 });
  doc.moveDown(2);
  const byMonth = new Map<string, BookEntryPdfInput[]>();
  for (const e of input.entries) {
    const key = `${e.createdAt.getFullYear()}-${String(e.createdAt.getMonth() + 1).padStart(2, "0")}`;
    const arr = byMonth.get(key) || [];
    arr.push(e);
    byMonth.set(key, arr);
  }
  for (const [key, items] of byMonth) {
    const monthIdx = Number(key.split("-")[1]) - 1;
    const monthLabel = MONTHS_RU[monthIdx]!;
    doc.font("Times-Bold").fontSize(13).fillColor(INK).text(monthLabel.toUpperCase());
    for (const e of items) {
      doc.font("Times-Roman").fontSize(11).fillColor(INK_SOFT)
         .text(`   ${e.title}`, { lineBreak: true });
    }
    doc.moveDown(0.5);
  }

  // ---- ENTRIES ----
  for (const entry of input.entries) {
    newPage(doc);
    // Date stamp
    doc.fillColor(BRONZE).font("Times-Roman").fontSize(9)
       .text(formatDate(entry.createdAt).toUpperCase(), { characterSpacing: 4 });
    doc.moveDown(2);
    // Title
    doc.fillColor(INK).font("Times-Bold").fontSize(20).text(entry.title);
    doc.moveDown(1);
    // Optional quote — italic, indented.
    if (entry.quote) {
      doc.font("Times-Italic").fontSize(12).fillColor(INK_SOFT)
         .text(`«${entry.quote.replace(/[“”"]/g, "")}»`, {
           indent: 16,
           paragraphGap: 8
         });
      doc.moveDown(0.6);
    }
    // Body
    doc.font("Times-Roman").fontSize(11.5).fillColor(INK)
       .text(entry.body, {
         align: "left",
         paragraphGap: 6,
         lineGap: 2
       });
  }

  // ---- COLOPHON ----
  newPage(doc);
  doc.moveDown(15);
  doc.fillColor(INK_FAINT).font("Times-Italic").fontSize(11)
     .text(`— конец книги —`, { align: "center" });
  doc.moveDown(2);
  doc.fillColor(BRONZE).font("Times-Roman").fontSize(9)
     .text("Написано с LifeBook", { align: "center", characterSpacing: 4 });

  // Collect to buffer
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  doc.end();
  await new Promise<void>((resolve, reject) => {
    doc.on("end", () => resolve());
    doc.on("error", reject);
  });
  return Buffer.concat(chunks);
}

// Convenience: convert a Buffer-yielding promise to a Readable stream when callers want it.
export function bookPdfStream(buffer: Buffer): Readable {
  return Readable.from(buffer);
}
