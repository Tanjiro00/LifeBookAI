import PDFDocument from "pdfkit";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Resolve vendored Noto Serif fonts. Bundled with @lifebook/renderer at
// packages/renderer/fonts/. We export the paths so callers (bookService)
// can pass them as fontPaths or fall through if they're missing in
// constrained deployments.
const FONTS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "fonts");
function fontPath(name: string): string | undefined {
  const p = join(FONTS_DIR, name);
  return existsSync(p) ? p : undefined;
}
export const VENDORED_FONT_PATHS: { regular?: string; bold?: string; italic?: string } = (() => {
  const r = fontPath("NotoSerif-Regular.ttf");
  const b = fontPath("NotoSerif-Bold.ttf");
  const i = fontPath("NotoSerif-Italic.ttf");
  const out: { regular?: string; bold?: string; italic?: string } = {};
  if (r) out.regular = r;
  if (b) out.bold = b;
  if (i) out.italic = i;
  return out;
})();

// Sprint 5.1 — PDF v2.
//
// Replaces the legacy renderPdf.ts. Major upgrades over v1:
//   - 6"×9" trade paper (industry-standard for memoir).
//   - Two-pass render: pass 1 measures pages so the TOC can show real numbers,
//     pass 2 produces the final PDF with TOC entries pointing at correct pages.
//   - Parts → Chapters → Pages structure (master spec §11.2):
//     • Each Part gets a title page.
//     • Each Chapter gets an opener (large title + intro paragraph).
//   - Running header (book title) on every page after the title page.
//   - Page numbers at the foot.
//   - Cover image: contain-fit (no stretch). Falls back to a typographic cover
//     when the image fails to load.
//   - Drop-cap on the first paragraph of each entry.
//   - Optional epilogue page.
//
// The renderer relies on PDFKit's built-in fonts (Times-Roman family) for now
// because they ship with PDFKit and have decent Cyrillic coverage via the WinAnsi
// fallback. Master spec §14.2 wants Noto Serif / Source Serif — we expose a
// `fontPaths` option to let the orchestrator pass custom .ttf files when they
// become available. Without paths we fall through to Times.

const PAGE_W = 6 * 72;
const PAGE_H = 9 * 72;
const MARGIN = 0.75 * 72;
const TEXT_WIDTH = PAGE_W - MARGIN * 2;
const FOOTER_Y = PAGE_H - MARGIN * 0.55;
const HEADER_Y = MARGIN * 0.45;

const INK = "#1E1B18";
const INK_SOFT = "#5D5147";
const INK_FAINT = "#76685D";
const BRONZE = "#9A6A43";
const PAPER = "#F8F4EC";

const MONTHS_RU = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря"
];

export type V2EntryInput = {
  id: string;
  title: string;
  body: string;
  quote?: string | null;
  createdAt: Date;
  chapterId?: string | null;
};

export type V2ChapterInput = {
  id: string;
  title: string;
  subtitle?: string | null;
  intro?: string | null;
  partId?: string | null;
  orderIndex: number;
};

export type V2PartInput = {
  id: string;
  title: string;
  intro?: string | null;
  orderIndex: number;
};

export type RenderPdfV2Input = {
  bookTitle: string;
  authorName?: string | null;
  subtitle?: string | null;
  year: number;
  parts: V2PartInput[];
  chapters: V2ChapterInput[];
  entries: V2EntryInput[];
  prologue?: V2EntryInput[];
  epilogue?: string | null;
  coverPngBuffer?: Buffer | null;
  // Optional custom font paths. Keys: regular, bold, italic. PDFKit registers
  // them once before the render starts.
  fontPaths?: { regular?: string; bold?: string; italic?: string };
};

type Doc = InstanceType<typeof PDFDocument>;

// ─── Font helpers ──────────────────────────────────────────────────────────
function registerFonts(doc: Doc, paths: RenderPdfV2Input["fontPaths"]): {
  regular: string;
  bold: string;
  italic: string;
} {
  const fontMap = { regular: "Times-Roman", bold: "Times-Bold", italic: "Times-Italic" };
  if (paths?.regular) {
    try {
      doc.registerFont("BookRegular", paths.regular);
      fontMap.regular = "BookRegular";
    } catch {
      /* fall back */
    }
  }
  if (paths?.bold) {
    try {
      doc.registerFont("BookBold", paths.bold);
      fontMap.bold = "BookBold";
    } catch {
      /* fall back */
    }
  }
  if (paths?.italic) {
    try {
      doc.registerFont("BookItalic", paths.italic);
      fontMap.italic = "BookItalic";
    } catch {
      /* fall back */
    }
  }
  return fontMap;
}

function formatDate(d: Date): string {
  return `${d.getDate()} ${MONTHS_RU[d.getMonth()]} ${d.getFullYear()}`;
}

// ─── Layout primitives ─────────────────────────────────────────────────────
function newBlankPage(doc: Doc): void {
  doc.addPage({ size: [PAGE_W, PAGE_H], margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN } });
  doc.rect(0, 0, PAGE_W, PAGE_H).fill(PAPER);
}

function drawRunningHeader(doc: Doc, fonts: ReturnType<typeof registerFonts>, bookTitle: string, pageNumber: number, currentPart: string | null): void {
  doc.font(fonts.regular).fontSize(9).fillColor(INK_FAINT);
  doc.text(bookTitle.toUpperCase(), MARGIN, HEADER_Y, {
    width: TEXT_WIDTH,
    align: "left",
    characterSpacing: 2
  });
  if (currentPart) {
    doc.text(currentPart.toUpperCase(), MARGIN, HEADER_Y, {
      width: TEXT_WIDTH,
      align: "right",
      characterSpacing: 2
    });
  }
  // Foot: page number, centered.
  doc.text(String(pageNumber), MARGIN, FOOTER_Y, {
    width: TEXT_WIDTH,
    align: "center"
  });
}

// ─── Cover ──────────────────────────────────────────────────────────────────
function drawCover(doc: Doc, fonts: ReturnType<typeof registerFonts>, input: RenderPdfV2Input): void {
  doc.addPage({ size: [PAGE_W, PAGE_H], margin: 0 });
  doc.rect(0, 0, PAGE_W, PAGE_H).fill(PAPER);

  if (input.coverPngBuffer) {
    try {
      // contain-fit: image is centered and scaled to fit inside the page,
      // never stretched to fill. PDFKit's `fit` keeps aspect ratio.
      doc.image(input.coverPngBuffer, MARGIN * 0.4, MARGIN * 0.4, {
        fit: [PAGE_W - MARGIN * 0.8, PAGE_H - MARGIN * 0.8 - 1.6 * 72],
        align: "center",
        valign: "center"
      });
    } catch {
      /* swallow — fall through to typographic cover */
    }
  }

  // Title overlay band at the bottom.
  doc.rect(0, PAGE_H - 1.6 * 72, PAGE_W, 1.6 * 72).fillOpacity(0.92).fill(PAPER);
  doc.fillOpacity(1);

  doc.fillColor(BRONZE).font(fonts.regular).fontSize(11);
  doc.text("LIFEBOOK", 0, PAGE_H - 1.4 * 72, {
    align: "center",
    width: PAGE_W,
    characterSpacing: 4
  });
  doc.fillColor(INK).font(fonts.bold).fontSize(28);
  doc.text(input.bookTitle, MARGIN, PAGE_H - 1.05 * 72, {
    width: TEXT_WIDTH,
    align: "center"
  });
  if (input.subtitle) {
    doc.font(fonts.italic).fontSize(13).fillColor(INK_SOFT);
    doc.text(input.subtitle, MARGIN, PAGE_H - 0.55 * 72, {
      width: TEXT_WIDTH,
      align: "center"
    });
  }
  doc.font(fonts.regular).fontSize(10).fillColor(INK_FAINT);
  doc.text(String(input.year), 0, PAGE_H - 0.3 * 72, {
    align: "center",
    width: PAGE_W,
    characterSpacing: 4
  });
}

function drawTitlePage(doc: Doc, fonts: ReturnType<typeof registerFonts>, input: RenderPdfV2Input): void {
  newBlankPage(doc);
  doc.fillColor(BRONZE).font(fonts.regular).fontSize(10);
  doc.text("LIFEBOOK", { align: "center", characterSpacing: 6 });
  doc.moveDown(8);
  doc.fillColor(INK).font(fonts.bold).fontSize(26).text(input.bookTitle, { align: "center" });
  doc.moveDown(0.6);
  if (input.subtitle) {
    doc.font(fonts.italic).fontSize(14).fillColor(INK_SOFT).text(input.subtitle, { align: "center" });
  }
  doc.moveDown(2);
  doc.font(fonts.regular).fontSize(11).fillColor(INK_FAINT)
     .text(`${input.entries.length} записей · ${input.year}`, { align: "center" });
  if (input.authorName) {
    doc.moveDown(8);
    doc.font(fonts.regular).fontSize(13).fillColor(INK).text(input.authorName, { align: "center" });
  }
}

// ─── Manuscript layout: parts / chapters / pages ───────────────────────────
//
// The two-pass design:
//   pass 1: render to a counting doc, recording which physical page each
//           chapter / entry / part landed on.
//   pass 2: render the real doc, using the page-number map to print the TOC
//           with correct numbers.
//
// PDFKit doesn't expose a "current page number" API directly; we bind it via
// `doc.bufferedPageRange()` which counts pages added so far.

type PageMapEntry = { kind: "part" | "chapter" | "entry" | "epilogue"; id: string; pageNumber: number };

function pagesAdded(doc: Doc): number {
  // bufferedPageRange returns { start, count } of buffered pages. count is the
  // 1-based total number of pages we've added so far. We use it as "this page
  // is page N" by reading just before we start writing the new page's content.
  const range = doc.bufferedPageRange();
  return range.count;
}

function drawPartTitle(doc: Doc, fonts: ReturnType<typeof registerFonts>, part: V2PartInput, map: PageMapEntry[]): void {
  newBlankPage(doc);
  map.push({ kind: "part", id: part.id, pageNumber: pagesAdded(doc) });
  doc.moveDown(8);
  doc.fillColor(BRONZE).font(fonts.regular).fontSize(11)
     .text(`ЧАСТЬ ${part.orderIndex + 1}`, { align: "center", characterSpacing: 6 });
  doc.moveDown(2);
  doc.fillColor(INK).font(fonts.bold).fontSize(28).text(part.title, { align: "center" });
  if (part.intro) {
    doc.moveDown(2);
    doc.font(fonts.italic).fontSize(13).fillColor(INK_SOFT)
       .text(part.intro, { align: "center", width: TEXT_WIDTH * 0.85, indent: 0 });
  }
}

function drawChapterOpener(doc: Doc, fonts: ReturnType<typeof registerFonts>, chapter: V2ChapterInput, map: PageMapEntry[]): void {
  newBlankPage(doc);
  map.push({ kind: "chapter", id: chapter.id, pageNumber: pagesAdded(doc) });
  doc.moveDown(4);
  doc.fillColor(BRONZE).font(fonts.regular).fontSize(10)
     .text(`ГЛАВА ${chapter.orderIndex + 1}`, { align: "center", characterSpacing: 6 });
  doc.moveDown(2);
  doc.fillColor(INK).font(fonts.bold).fontSize(22).text(chapter.title, { align: "center" });
  if (chapter.subtitle) {
    doc.moveDown(0.5);
    doc.font(fonts.italic).fontSize(12).fillColor(INK_SOFT).text(chapter.subtitle, { align: "center" });
  }
  if (chapter.intro) {
    doc.moveDown(2);
    doc.font(fonts.regular).fontSize(11).fillColor(INK_SOFT)
       .text(chapter.intro, {
         align: "left",
         width: TEXT_WIDTH * 0.92,
         indent: 0,
         lineGap: 2,
         paragraphGap: 6
       });
  }
}

function drawEntry(
  doc: Doc,
  fonts: ReturnType<typeof registerFonts>,
  entry: V2EntryInput,
  map: PageMapEntry[]
): void {
  newBlankPage(doc);
  map.push({ kind: "entry", id: entry.id, pageNumber: pagesAdded(doc) });

  // Date stamp (small, top of body area).
  doc.fillColor(BRONZE).font(fonts.regular).fontSize(9)
     .text(formatDate(entry.createdAt).toUpperCase(), { characterSpacing: 4 });
  doc.moveDown(2);

  // Title.
  doc.fillColor(INK).font(fonts.bold).fontSize(20).text(entry.title);
  doc.moveDown(1);

  // Optional pulled quote, italic indented.
  if (entry.quote) {
    doc.font(fonts.italic).fontSize(12).fillColor(INK_SOFT)
       .text(`«${entry.quote.replace(/[“”"]/g, "")}»`, {
         indent: 16,
         paragraphGap: 8
       });
    doc.moveDown(0.6);
  }

  // Body. We do a tiny drop-cap on the very first character of paragraph 1.
  // PDFKit doesn't natively support drop caps; we approximate by rendering the
  // first letter at a larger font size at the start of the line.
  const paragraphs = entry.body.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  if (paragraphs.length === 0) return;

  const [firstPara, ...restParas] = paragraphs;
  if (firstPara && firstPara.length > 1) {
    const initial = firstPara[0]!;
    const remainder = firstPara.slice(1);
    const startY = doc.y;
    doc.font(fonts.bold).fontSize(28).fillColor(INK)
       .text(initial, { continued: false, lineBreak: false });
    // Place the rest of the paragraph after the initial. We restore the x position
    // and font and let PDFKit wrap.
    doc.font(fonts.regular).fontSize(11.5).fillColor(INK);
    doc.text(remainder, MARGIN + 28, startY + 4, {
      align: "left",
      paragraphGap: 6,
      lineGap: 2,
      width: TEXT_WIDTH - 28
    });
    doc.moveDown(0.3);
  }

  doc.font(fonts.regular).fontSize(11.5).fillColor(INK);
  for (const p of restParas) {
    doc.text(p, MARGIN, doc.y, {
      align: "left",
      paragraphGap: 6,
      lineGap: 2,
      width: TEXT_WIDTH
    });
  }
}

function drawEpilogue(doc: Doc, fonts: ReturnType<typeof registerFonts>, epilogue: string, map: PageMapEntry[]): void {
  newBlankPage(doc);
  map.push({ kind: "epilogue", id: "epilogue", pageNumber: pagesAdded(doc) });
  doc.moveDown(3);
  doc.fillColor(BRONZE).font(fonts.regular).fontSize(11).text("ЭПИЛОГ", { align: "center", characterSpacing: 6 });
  doc.moveDown(3);
  doc.fillColor(INK).font(fonts.regular).fontSize(11.5).text(epilogue, {
    align: "left",
    paragraphGap: 6,
    lineGap: 2,
    width: TEXT_WIDTH
  });
}

function drawColophon(doc: Doc, fonts: ReturnType<typeof registerFonts>): void {
  newBlankPage(doc);
  doc.moveDown(15);
  doc.fillColor(INK_FAINT).font(fonts.italic).fontSize(11).text("— конец книги —", { align: "center" });
  doc.moveDown(2);
  doc.fillColor(BRONZE).font(fonts.regular).fontSize(9)
     .text("Написано с LifeBook", { align: "center", characterSpacing: 4 });
}

// ─── TOC ────────────────────────────────────────────────────────────────────
//
// We render the TOC immediately after the title page. To know the page numbers
// of each chapter/part we run a "dry" pass first: same drawing code, no buffer
// preserved at the end, just to populate the page map.

function drawTocFromMap(
  doc: Doc,
  fonts: ReturnType<typeof registerFonts>,
  parts: V2PartInput[],
  chapters: V2ChapterInput[],
  map: PageMapEntry[]
): void {
  newBlankPage(doc);
  doc.fillColor(BRONZE).font(fonts.regular).fontSize(10).text("СОДЕРЖАНИЕ", { characterSpacing: 6 });
  doc.moveDown(2);

  const partOf = new Map(parts.map((p) => [p.id, p]));
  // Group: parts (with their chapters) → standalone chapters at the end.
  const partsSorted = [...parts].sort((a, b) => a.orderIndex - b.orderIndex);
  const chaptersSorted = [...chapters].sort((a, b) => a.orderIndex - b.orderIndex);

  const renderTocEntry = (label: string, pageNumber: number | undefined, indent: number, bold: boolean) => {
    const page = pageNumber ? String(pageNumber) : "—";
    if (bold) doc.font(fonts.bold);
    else doc.font(fonts.regular);
    doc.fontSize(11).fillColor(bold ? INK : INK_SOFT);
    // Build a leader: label … page-number, right-aligned.
    const dotsWidth = TEXT_WIDTH - indent - doc.widthOfString(label) - doc.widthOfString(page) - 8;
    const dots = dotsWidth > 0 ? "·".repeat(Math.max(2, Math.floor(dotsWidth / 4))) : "";
    doc.text(`${label}  ${dots}  ${page}`, MARGIN + indent, doc.y, {
      lineBreak: true,
      width: TEXT_WIDTH - indent
    });
  };

  for (const part of partsSorted) {
    const pn = map.find((m) => m.kind === "part" && m.id === part.id)?.pageNumber;
    renderTocEntry(`Часть ${part.orderIndex + 1}. ${part.title}`, pn, 0, true);
    const partChapters = chaptersSorted.filter((c) => c.partId === part.id);
    for (const c of partChapters) {
      const cpn = map.find((m) => m.kind === "chapter" && m.id === c.id)?.pageNumber;
      renderTocEntry(`Глава ${c.orderIndex + 1}. ${c.title}`, cpn, 14, false);
    }
    doc.moveDown(0.4);
  }

  const standalone = chaptersSorted.filter((c) => !c.partId || !partOf.has(c.partId));
  if (standalone.length) {
    if (partsSorted.length) doc.moveDown(0.5);
    for (const c of standalone) {
      const cpn = map.find((m) => m.kind === "chapter" && m.id === c.id)?.pageNumber;
      renderTocEntry(`Глава ${c.orderIndex + 1}. ${c.title}`, cpn, 0, false);
    }
  }

  const epi = map.find((m) => m.kind === "epilogue");
  if (epi) {
    doc.moveDown(0.5);
    renderTocEntry("Эпилог", epi.pageNumber, 0, true);
  }
}

// ─── Main render ───────────────────────────────────────────────────────────
async function buildBuffer(doc: Doc): Promise<Buffer> {
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  doc.end();
  await new Promise<void>((resolve, reject) => {
    doc.on("end", () => resolve());
    doc.on("error", reject);
  });
  return Buffer.concat(chunks);
}

function buildEmptyDoc(input: RenderPdfV2Input): Doc {
  return new PDFDocument({
    size: [PAGE_W, PAGE_H],
    margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
    autoFirstPage: false,
    info: {
      Title: input.bookTitle,
      Author: input.authorName || "LifeBook",
      Subject: `Personal autobiography ${input.year}`
    }
  });
}

function drawAllContent(doc: Doc, fonts: ReturnType<typeof registerFonts>, input: RenderPdfV2Input, map: PageMapEntry[]): void {
  // Cover (page 1, no header).
  drawCover(doc, fonts, input);

  // Title page (no header).
  drawTitlePage(doc, fonts, input);

  // TOC: drawn here as a placeholder; in pass 2 we replace it. For pass 1 the
  // TOC layout uses provisional numbers, so it occupies the right amount of
  // vertical space when we lay out the rest. We just emit it once.
  drawTocFromMap(doc, fonts, input.parts, input.chapters, map);

  // Prologue pages (each as an entry, no chapter opener).
  if (input.prologue?.length) {
    for (const p of input.prologue) {
      drawEntry(doc, fonts, p, map);
    }
  }

  // Group chapters by part. Rendering order:
  //   for each part (sorted): part title page → for each chapter in part (sorted):
  //     chapter opener → entries.
  // Standalone chapters (no partId) render after parts.
  const partsSorted = [...input.parts].sort((a, b) => a.orderIndex - b.orderIndex);
  const chaptersSorted = [...input.chapters].sort((a, b) => a.orderIndex - b.orderIndex);
  const entriesByChapter = new Map<string, V2EntryInput[]>();
  for (const e of input.entries) {
    if (!e.chapterId) continue;
    const arr = entriesByChapter.get(e.chapterId) ?? [];
    arr.push(e);
    entriesByChapter.set(e.chapterId, arr);
  }
  // Sort entries per chapter by createdAt.
  for (const arr of entriesByChapter.values()) {
    arr.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }
  const renderChapter = (chapter: V2ChapterInput) => {
    drawChapterOpener(doc, fonts, chapter, map);
    const ents = entriesByChapter.get(chapter.id) ?? [];
    for (const e of ents) drawEntry(doc, fonts, e, map);
  };

  for (const part of partsSorted) {
    drawPartTitle(doc, fonts, part, map);
    const inPart = chaptersSorted.filter((c) => c.partId === part.id);
    for (const c of inPart) renderChapter(c);
  }
  const standaloneChapters = chaptersSorted.filter((c) => !c.partId || !partsSorted.some((p) => p.id === c.partId));
  for (const c of standaloneChapters) renderChapter(c);

  // Unchaptered entries land at the end as their own informal section.
  const orphans = input.entries.filter((e) => !e.chapterId);
  if (orphans.length) {
    newBlankPage(doc);
    map.push({ kind: "chapter", id: "orphan-chapter", pageNumber: pagesAdded(doc) });
    doc.fillColor(BRONZE).font(fonts.regular).fontSize(11)
       .text("ОТДЕЛЬНЫЕ СТРАНИЦЫ", { align: "center", characterSpacing: 6 });
    for (const e of orphans) drawEntry(doc, fonts, e, map);
  }

  // Epilogue.
  if (input.epilogue && input.epilogue.trim().length > 20) {
    drawEpilogue(doc, fonts, input.epilogue, map);
  }

  // Colophon.
  drawColophon(doc, fonts);

  // Stamp running headers on every page after the title page.
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    if (i < 2) continue; // skip cover (i=0) and title page (i=1)
    doc.switchToPage(i);
    drawRunningHeader(doc, fonts, input.bookTitle, i + 1, null);
  }
}

export async function renderPdfV2(input: RenderPdfV2Input): Promise<Buffer> {
  // Default to vendored Noto Serif when caller didn't supply paths. The
  // vendored TTFs ship inside @lifebook/renderer/fonts so kirillic kombіnatsiyas
  // render correctly in the produced PDF.
  const fontPaths: typeof input.fontPaths = input.fontPaths ?? VENDORED_FONT_PATHS;
  const inputWithFonts: RenderPdfV2Input = { ...input, fontPaths };

  // PASS 1: dry run — same content, populate page map.
  const passOneMap: PageMapEntry[] = [];
  const passOneDoc = buildEmptyDoc(inputWithFonts);
  const passOneFonts = registerFonts(passOneDoc, inputWithFonts.fontPaths);
  drawAllContent(passOneDoc, passOneFonts, inputWithFonts, passOneMap);
  // Drain pass-1 doc to release file handles. We don't keep its bytes.
  await buildBuffer(passOneDoc);

  // PASS 2: real render with the populated map. We re-create the doc so all
  // content positions are deterministic; the map ensures the TOC has accurate
  // page numbers for parts/chapters that pass-1 measured.
  const passTwoMap: PageMapEntry[] = [];
  const passTwoDoc = buildEmptyDoc(inputWithFonts);
  const passTwoFonts = registerFonts(passTwoDoc, inputWithFonts.fontPaths);

  // Splice pass-1 numbers in: pass-1 page numbers are valid because pass-2
  // produces the same physical layout (same content, same fonts, same widths).
  // We seed the map by just reusing pass-1 entries before the TOC draws.
  for (const m of passOneMap) passTwoMap.push(m);
  drawAllContent(passTwoDoc, passTwoFonts, inputWithFonts, passOneMap.length ? [...passOneMap] : passTwoMap);
  return buildBuffer(passTwoDoc);
}
