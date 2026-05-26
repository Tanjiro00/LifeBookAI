import { forwardRef, useEffect, useMemo, useRef, useState } from "react";
import type { BookChapterDto, BookDto, BookEntryDto } from "../api";
import { accentFor } from "../palette";

type Props = { book: BookDto };

const MONTHS_RU = [
  "января","февраля","марта","апреля","мая","июня",
  "июля","августа","сентября","октября","ноября","декабря"
];
const TOTAL_SLOTS = 52;

function formatDateLong(d: Date): string {
  return `${d.getDate()} ${MONTHS_RU[d.getMonth()]} ${d.getFullYear()}`;
}

function isSameMonth(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

const DENSITIES = [
  { padding: "py-20 sm:py-28", gap: "mb-7", textSize: "text-[20px] sm:text-[21px]", leading: "leading-[1.85]", titleSize: "text-4xl sm:text-6xl" },
  { padding: "py-16 sm:py-24", gap: "mb-6", textSize: "text-[19px] sm:text-[20px]", leading: "leading-[1.8]",  titleSize: "text-4xl sm:text-5xl" },
  { padding: "py-14 sm:py-20", gap: "mb-5", textSize: "text-[18px] sm:text-[19px]", leading: "leading-[1.78]", titleSize: "text-3xl sm:text-5xl" },
  { padding: "py-12 sm:py-16", gap: "mb-4", textSize: "text-[18px]",                leading: "leading-[1.75]", titleSize: "text-3xl sm:text-5xl" }
];

function densityForIndex(i: number, total: number) {
  if (total <= 1) return DENSITIES[0]!;
  const t = i / Math.max(1, total - 1);
  if (t < 0.2) return DENSITIES[0]!;
  if (t < 0.5) return DENSITIES[1]!;
  if (t < 0.8) return DENSITIES[2]!;
  return DENSITIES[3]!;
}

export function LivingBook({ book }: Props) {
  const prologue = book.prologue ?? [];
  const entries = book.entries;
  const hasPrologue = prologue.length > 0;
  const lastRef = useRef<HTMLElement | null>(null);
  const [opened, setOpened] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => setOpened(true), 30);
    return () => window.clearTimeout(t);
  }, []);

  const subtitle = useMemo(() => {
    if (!hasPrologue && entries.length === 0) return book.subtitle || "Книга только начинается";
    const all = [...prologue, ...entries];
    const first = new Date(all[0]!.createdAt);
    const last = new Date(all[all.length - 1]!.createdAt);
    return `${formatDateLong(first)} — ${formatDateLong(last)}`;
  }, [book.subtitle, prologue, entries, hasPrologue]);

  const counter =
    hasPrologue && entries.length === 0
      ? `Пролог · ${prologue.length} ${pluralRuPages(prologue.length)}`
      : `${entries.length} из ${TOTAL_SLOTS} записей`;
  const shipDate = `7 декабря ${new Date(book.createdAt).getFullYear()}`;

  const scrollToLast = () => lastRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <main className="relative min-h-screen">
      <Cover
        title={book.title}
        subtitle={subtitle}
        counter={counter}
        shipDate={shipDate}
        coverUrl={book.coverUrl ?? null}
        opened={opened}
      />

      <div
        className={`relative mx-auto max-w-[680px] px-5 sm:px-8 transition-opacity duration-700 ${
          opened ? "opacity-100" : "opacity-0"
        }`}
      >
        {hasPrologue && (
          <>
            <PrologueHeader count={prologue.length} />
            {prologue.map((p, i) => (
              <EntrySection
                key={p.id}
                entry={p}
                index={i}
                total={prologue.length}
                previous={i > 0 ? prologue[i - 1]! : null}
                kind="prologue"
              />
            ))}
            {entries.length > 0 && <SectionDivider label="ГОД ПОШЁЛ" />}
          </>
        )}
        {/*
          Sprint 4.12 — chapter-aware rendering.
          When the book has chapters, group entries by chapterId and emit a
          Chapter divider with the chapter intro before each group. Unchaptered
          entries (chapterId=null) fall through to a final "current week" group
          rendered without an intro. When no chapters exist (legacy path), this
          collapses to one big group rendered exactly like the old flat list,
          which preserves backward compatibility for users pre-Sprint-4.
        */}
        {(() => {
          const chapters = (book.chapters ?? []).slice().sort((a, b) => a.orderIndex - b.orderIndex);
          const groups: Array<{ chapter: BookChapterDto | null; entries: BookEntryDto[] }> = [];
          if (chapters.length === 0) {
            groups.push({ chapter: null, entries });
          } else {
            for (const c of chapters) {
              groups.push({ chapter: c, entries: entries.filter((e) => e.chapterId === c.id) });
            }
            const orphans = entries.filter((e) => !e.chapterId);
            if (orphans.length) groups.push({ chapter: null, entries: orphans });
          }
          let renderedTotal = 0;
          return groups.map((g, gi) => (
            <div key={g.chapter?.id ?? `group-${gi}`}>
              {g.chapter ? <ChapterDivider chapter={g.chapter} /> : gi > 0 ? <SectionDivider label="ВНЕ ГЛАВЫ" /> : null}
              {g.entries.map((e, i) => {
                const idx = renderedTotal + i;
                const isLast = gi === groups.length - 1 && i === g.entries.length - 1;
                return (
                  <EntrySection
                    key={e.id}
                    entry={e}
                    index={idx}
                    total={entries.length}
                    previous={idx > 0 ? entries[idx - 1]! : null}
                    ref={isLast ? lastRef : null}
                  />
                );
              })}
              {(() => {
                renderedTotal += g.entries.length;
                return null;
              })()}
            </div>
          ));
        })()}
        <BookFoot count={entries.length} hasPrologue={hasPrologue} />
      </div>

      {/* Sticky CTA: PDF if available, else jump-to-last */}
      {book.pdfUrl ? (
        <a
          href={book.pdfUrl}
          target="_blank"
          rel="noreferrer"
          className="fixed bottom-5 left-1/2 -translate-x-1/2 rounded-full border border-bronze/30 bg-page/95 px-5 py-2.5 font-sans text-sm text-ink shadow-page backdrop-blur transition hover:bg-page"
        >
          Скачать PDF
        </a>
      ) : entries.length > 1 ? (
        <button
          onClick={scrollToLast}
          className="fixed bottom-5 left-1/2 -translate-x-1/2 rounded-full border border-bronze/30 bg-page/95 px-5 py-2.5 font-sans text-sm text-ink shadow-page backdrop-blur transition hover:bg-page"
        >
          К последней записи
        </button>
      ) : null}
    </main>
  );
}

function Cover({
  title,
  subtitle,
  counter,
  shipDate,
  coverUrl,
  opened
}: {
  title: string;
  subtitle: string;
  counter: string;
  shipDate: string;
  coverUrl?: string | null;
  opened: boolean;
}) {
  return (
    <header
      className={`relative mx-auto flex h-[88vh] max-w-[680px] flex-col items-center justify-center px-6 pt-10 text-center transition-transform duration-[900ms] ease-[cubic-bezier(.2,.8,.2,1)] ${
        opened ? "translate-y-0" : "translate-y-3"
      }`}
    >
      {coverUrl && (
        <div className="absolute inset-x-6 top-12 bottom-32 overflow-hidden rounded-sm shadow-page">
          <img src={coverUrl} alt="" className="h-full w-full object-cover" />
        </div>
      )}
      <div className="relative z-10 mt-auto rounded-md bg-page/95 px-6 py-7 backdrop-blur sm:px-10 sm:py-9">
        <div className="font-sans text-[10px] uppercase tracking-[0.32em] text-bronze">LIFEBOOK</div>
        <h1 className="mt-5 font-serif text-4xl leading-[1.05] text-ink sm:text-6xl">{title}</h1>
        <p className="mt-4 font-serif text-base italic text-ink/65 sm:text-lg">{subtitle}</p>
        <div className="mt-6 flex items-center justify-center gap-3 font-sans text-[10px] uppercase tracking-[0.24em] text-ink/55">
          <span>{counter}</span>
          <span className="text-bronze/60">·</span>
          <span>книга к {shipDate}</span>
        </div>
      </div>
      <div className="mt-6 font-sans text-[10px] uppercase tracking-[0.28em] text-bronze/70">↓ страница ниже ↓</div>
    </header>
  );
}

type SectionProps = {
  entry: BookEntryDto;
  index: number;
  total: number;
  previous: BookEntryDto | null;
  kind?: "weekly" | "prologue";
};

const EntrySection = forwardRef<HTMLElement, SectionProps>(({ entry, index, total, previous, kind = "weekly" }, ref) => {
  const accent = accentFor(entry.accentColor);
  const density = densityForIndex(index, total);
  const date = new Date(entry.createdAt);
  const prevDate = previous ? new Date(previous.createdAt) : null;
  const isPrologue = kind === "prologue";
  // Prologue pages are sequential within the prologue, no month dividers — they all
  // appear under one PROLOGUE header. Weekly entries get month dividers as before.
  const showMonthDivider = !isPrologue && (!prevDate || !isSameMonth(prevDate, date));

  const paragraphs = entry.sceneContent.split(/\n{2,}/).filter(Boolean);

  return (
    <section ref={ref} className={`relative ${density.padding}`}>
      {showMonthDivider && (
        <div
          className="mb-12 flex items-center gap-3 font-sans text-[11px] uppercase tracking-[0.24em]"
          style={{ color: accent.ink }}
        >
          <span className="h-px flex-1 bg-bronze/25" />
          <span>{MONTHS_RU[date.getMonth()]} {date.getFullYear()}</span>
          <span className="h-px flex-1 bg-bronze/25" />
        </div>
      )}

      <header className="relative mb-6 pl-6">
        <span
          className="absolute left-0 top-1 h-[calc(100%-4px)] w-[3px] rounded-full"
          style={{ background: accent.stripe }}
        />
        <div className="font-sans text-[10px] uppercase tracking-[0.22em] text-ink/45">
          {isPrologue
            ? `Стр. ${index + 1} из ${total}`
            : `${date.getDate()} ${MONTHS_RU[date.getMonth()]}`}
        </div>
        <h2 className={`mt-3 font-serif ${density.titleSize} font-semibold leading-tight text-ink`}>{entry.sceneTitle}</h2>
        {entry.quote && (
          <blockquote
            className="mt-5 border-l-2 pl-4 font-serif text-lg italic leading-relaxed text-ink/75"
            style={{ borderColor: accent.stripe }}
          >
            «{entry.quote.replace(/[“”"]/g, "")}»
          </blockquote>
        )}
      </header>

      <article className={`font-serif ${density.textSize} ${density.leading} text-ink/95`}>
        {paragraphs.map((p, i) => (
          <p key={i} className={density.gap}>
            {p}
          </p>
        ))}
      </article>
    </section>
  );
});

EntrySection.displayName = "EntrySection";

// Sprint 4.12 — Chapter divider rendered between page groups. Shows the
// chapter number (orderIndex+1), title, optional subtitle, and the intro
// paragraph the synthesiser produced. Themes show as a small monospace tag
// row underneath.
function ChapterDivider({ chapter }: { chapter: BookChapterDto }) {
  const themesLine = (chapter.themes ?? [])
    .filter(Boolean)
    .slice(0, 6)
    .map((t) => t.toLowerCase())
    .join(" · ");
  return (
    <section className="my-20">
      <div className="mb-6 flex items-center gap-3 font-sans text-[11px] uppercase tracking-[0.32em] text-bronze">
        <span className="h-px flex-1 bg-bronze/25" />
        <span>Глава {chapter.orderIndex + 1}</span>
        <span className="h-px flex-1 bg-bronze/25" />
      </div>
      <h2 className="text-center font-serif text-3xl font-semibold leading-tight text-ink sm:text-5xl">
        {chapter.title}
      </h2>
      {chapter.subtitle && (
        <p className="mt-3 text-center font-serif text-base italic text-ink/65 sm:text-lg">
          {chapter.subtitle}
        </p>
      )}
      {chapter.intro && (
        <article className="mx-auto mt-8 max-w-[600px] font-serif text-[18px] leading-[1.8] text-ink/85 sm:text-[19px]">
          {chapter.intro.split(/\n{2,}/).filter(Boolean).map((p, i) => (
            <p key={i} className="mb-4">
              {p}
            </p>
          ))}
        </article>
      )}
      {themesLine && (
        <div className="mt-6 text-center font-sans text-[10px] uppercase tracking-[0.24em] text-ink/45">
          {themesLine}
        </div>
      )}
    </section>
  );
}

function PrologueHeader({ count }: { count: number }) {
  return (
    <div className="my-12 flex items-center gap-3 font-sans text-[11px] uppercase tracking-[0.32em] text-bronze">
      <span className="h-px flex-1 bg-bronze/25" />
      <span>ПРОЛОГ · {count} {pluralRuPages(count)}</span>
      <span className="h-px flex-1 bg-bronze/25" />
    </div>
  );
}

function SectionDivider({ label }: { label: string }) {
  return (
    <div className="my-16 flex items-center gap-3 font-sans text-[11px] uppercase tracking-[0.32em] text-bronze">
      <span className="h-px flex-1 bg-bronze/25" />
      <span>{label}</span>
      <span className="h-px flex-1 bg-bronze/25" />
    </div>
  );
}

function pluralRuPages(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return "страниц";
  if (mod10 === 1) return "страница";
  if (mod10 >= 2 && mod10 <= 4) return "страницы";
  return "страниц";
}

function BookFoot({ count, hasPrologue }: { count: number; hasPrologue: boolean }) {
  if (count === 0) {
    if (hasPrologue) {
      return (
        <div className="my-24 text-center font-serif text-lg italic text-ink/55">
          год пошёл — первая страница за неделю
        </div>
      );
    }
    return (
      <div className="my-24 text-center font-serif text-lg italic text-ink/55">
        книга начинается с первой записи
      </div>
    );
  }
  return (
    <div className="my-24 text-center font-sans text-[10px] uppercase tracking-[0.24em] text-bronze/70">
      — {count} из {TOTAL_SLOTS} записей —
    </div>
  );
}
