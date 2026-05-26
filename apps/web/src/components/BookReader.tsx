import { useEffect, useState } from "react";
import { getManuscript, type ManuscriptDto } from "../api";

// Sprint 4 / 5 — Mini App BookReader.
//
// Authenticated entry point for users coming in from the bot's «📖 Открыть
// книгу» button. Loads the full manuscript via /api/manuscript (JWT in
// Authorization header, set up by ensureMiniAppAuth in api.ts) and renders:
//
//   Cover + Title
//   Prologue pages
//   For each Part (in orderIndex):
//     Part title + intro
//     For each Chapter in part (in orderIndex):
//       Chapter title + subtitle + intro
//       Pages of that chapter (full body, drop-cap on first paragraph)
//   Standalone chapters (no partId) in order
//   Unchaptered current pages at the end
//
// Drop-caps are pure CSS (.drop-cap::first-letter — see palette.ts / global
// styles). Pages link to /page/:id for editing, chapters to /chapter/:id.

const TOTAL_SLOTS = 52;

const MONTHS_RU = [
  "января","февраля","марта","апреля","мая","июня",
  "июля","августа","сентября","октября","ноября","декабря"
];

function fmtDate(d: Date): string {
  return `${d.getDate()} ${MONTHS_RU[d.getMonth()]}`;
}

export function BookReader() {
  const [manuscript, setManuscript] = useState<ManuscriptDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await getManuscript();
        if (!cancelled) setManuscript(data);
      } catch (err) {
        if (!cancelled) setError((err as Error).message || "Не удалось загрузить книгу");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <Empty
        title="Не удалось открыть книгу"
        body={error.includes("401") ? "Открой ссылку из Telegram бота — мне нужна авторизация." : error}
      />
    );
  }
  if (!manuscript) return <Empty title="Открываю книгу…" body="" />;

  const prologue = manuscript.pages.filter((p) => p.kind === "PROLOGUE");
  const weekly = manuscript.pages.filter((p) => p.kind !== "PROLOGUE");
  const partsSorted = [...manuscript.parts].sort((a, b) => a.orderIndex - b.orderIndex);
  const chaptersSorted = [...manuscript.chapters].sort((a, b) => a.orderIndex - b.orderIndex);

  return (
    <main className="relative min-h-screen pb-24">
      <header className="mx-auto max-w-[680px] px-5 py-12 text-center">
        <div className="font-sans text-[10px] uppercase tracking-[0.32em] text-bronze">LIFEBOOK</div>
        {manuscript.book && (
          <>
            <h1 className="mt-5 font-serif text-4xl font-semibold text-ink sm:text-5xl">
              {manuscript.book.title}
            </h1>
            {manuscript.book.subtitle && (
              <p className="mt-3 font-serif text-base italic text-ink/65">
                {manuscript.book.subtitle}
              </p>
            )}
            <div className="mt-4 font-sans text-[10px] uppercase tracking-[0.24em] text-ink/55">
              {weekly.length}/{TOTAL_SLOTS} · {chaptersSorted.length} глав · {partsSorted.length} частей
            </div>
            {manuscript.book.pdfUrl && (
              <a
                href={manuscript.book.pdfUrl}
                className="mt-4 inline-block rounded-full border border-bronze/30 bg-page px-4 py-1.5 font-sans text-xs uppercase tracking-[0.18em] text-bronze hover:bg-page/95"
                target="_blank"
                rel="noreferrer"
              >
                Скачать PDF
              </a>
            )}
          </>
        )}
      </header>

      <div className="mx-auto max-w-[680px] px-5 sm:px-8">
        {prologue.length > 0 && <SectionHeader label="ПРОЛОГ" />}
        {prologue.map((p) => (
          <PageBlock key={p.id} page={p} />
        ))}

        {/* Parts → chapters → pages */}
        {partsSorted.map((part) => (
          <div key={part.id} className="my-12">
            <SectionHeader label={`ЧАСТЬ ${part.orderIndex + 1}`} />
            <h2 className="text-center font-serif text-3xl font-semibold text-ink">{part.title}</h2>
            {part.intro && (
              <p className="mx-auto mt-4 max-w-[560px] text-center font-serif text-base italic text-ink/70">
                {part.intro}
              </p>
            )}
            {chaptersSorted
              .filter((c) => c.partId === part.id)
              .map((chapter) => (
                <ChapterBlock
                  key={chapter.id}
                  chapter={chapter}
                  pages={weekly.filter((p) => p.chapterId === chapter.id)}
                />
              ))}
          </div>
        ))}

        {/* Chapters with no partId. */}
        {chaptersSorted
          .filter((c) => !c.partId)
          .map((chapter) => (
            <ChapterBlock
              key={chapter.id}
              chapter={chapter}
              pages={weekly.filter((p) => p.chapterId === chapter.id)}
            />
          ))}

        {/* Orphaned pages (no chapter yet). */}
        {(() => {
          const orphans = weekly.filter((p) => !p.chapterId);
          if (orphans.length === 0) return null;
          return (
            <>
              <SectionHeader label="ВНЕ ГЛАВЫ" />
              {orphans.map((p) => (
                <PageBlock key={p.id} page={p} />
              ))}
            </>
          );
        })()}
      </div>

      <nav className="fixed bottom-5 left-1/2 -translate-x-1/2 flex gap-2">
        <a
          href="/memories"
          className="rounded-full border border-bronze/30 bg-page/95 px-4 py-2 font-sans text-[11px] uppercase tracking-[0.18em] text-ink shadow-page backdrop-blur"
        >
          Память
        </a>
      </nav>
    </main>
  );
}

function ChapterBlock({
  chapter,
  pages
}: {
  chapter: ManuscriptDto["chapters"][number];
  pages: ManuscriptDto["pages"];
}) {
  const sorted = [...pages].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );
  return (
    <section className="my-16">
      <div className="my-8 flex items-center gap-3 font-sans text-[11px] uppercase tracking-[0.32em] text-bronze">
        <span className="h-px flex-1 bg-bronze/25" />
        <span>Глава {chapter.orderIndex + 1}</span>
        <span className="h-px flex-1 bg-bronze/25" />
      </div>
      <h2 className="text-center font-serif text-3xl font-semibold text-ink">
        <a href={`/chapter/${chapter.id}`} className="hover:underline">{chapter.title}</a>
      </h2>
      {chapter.subtitle && (
        <p className="mt-3 text-center font-serif text-base italic text-ink/65">{chapter.subtitle}</p>
      )}
      {chapter.intro && (
        <article className="mx-auto mt-8 max-w-[600px] font-serif text-[18px] leading-[1.8] text-ink/85">
          {chapter.intro.split(/\n{2,}/).filter(Boolean).map((p, i) => (
            <p key={i} className="mb-4">{p}</p>
          ))}
        </article>
      )}
      <div className="mt-2">
        {chapter.status === "DRAFT" && (
          <div className="my-4 text-center text-[11px] uppercase tracking-[0.24em] text-ink/45">
            ⌛ глава в черновике — открой в боте, чтобы подтвердить
          </div>
        )}
      </div>
      {sorted.map((p) => (
        <PageBlock key={p.id} page={p} />
      ))}
    </section>
  );
}

function PageBlock({ page }: { page: ManuscriptDto["pages"][number] }) {
  const date = new Date(page.createdAt);
  const paragraphs = page.sceneContent.split(/\n{2,}/).filter(Boolean);
  return (
    <article className="my-12 border-l-2 border-bronze/20 pl-5">
      <div className="font-sans text-[10px] uppercase tracking-[0.22em] text-ink/45">
        {fmtDate(date)} · v{page.version}
      </div>
      <h3 className="mt-2 font-serif text-2xl font-semibold leading-tight text-ink sm:text-3xl">
        <a href={`/page/${page.id}`} className="hover:underline">{page.sceneTitle}</a>
      </h3>
      {page.quote && (
        <blockquote className="mt-4 border-l-2 border-bronze/40 pl-4 font-serif text-lg italic text-ink/70">
          «{page.quote.replace(/[“”"]/g, "")}»
        </blockquote>
      )}
      <div className="mt-5 font-serif text-[18px] leading-[1.8] text-ink/95">
        {paragraphs.map((p, i) => (
          <p key={i} className="mb-4">
            {p}
          </p>
        ))}
      </div>
    </article>
  );
}

function SectionHeader({ label }: { label: string }) {
  return (
    <div className="my-12 flex items-center gap-3 font-sans text-[11px] uppercase tracking-[0.32em] text-bronze">
      <span className="h-px flex-1 bg-bronze/25" />
      <span>{label}</span>
      <span className="h-px flex-1 bg-bronze/25" />
    </div>
  );
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <section className="max-w-md rounded-md border border-bronze/20 bg-page p-8 text-center">
        <div className="font-sans text-xs uppercase tracking-[0.18em] text-bronze">LifeBook</div>
        <p className="mt-4 font-serif text-2xl text-ink">{title}</p>
        {body && <p className="mt-2 font-serif text-sm text-ink/65">{body}</p>}
      </section>
    </main>
  );
}
