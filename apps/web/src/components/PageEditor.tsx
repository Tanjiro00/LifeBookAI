import { useEffect, useState } from "react";
import { getManuscript, retitlePage, revisePage, type ManuscriptDto } from "../api";

// Sprint 2.6 / 4 Mini App — Page editor.
//
// Loads the full manuscript, picks the current page by id, and exposes two
// actions powered by the bot's writePage/rewriteTitle services via the Mini
// App API:
//   - Revise body (instruction prompt → POST /api/page/:id/revise)
//   - Retitle (optional instruction → POST /api/page/:id/retitle)
//
// We don't fetch a single page from the API — the manuscript endpoint is
// already cached and exposes everything we need (sourceContext, version,
// chapter linkage). After a successful revise the user is taken to the new
// page id (the revision creates a new Page row).

export function PageEditor({ pageId }: { pageId: string }) {
  const [manuscript, setManuscript] = useState<ManuscriptDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reviseInstruction, setReviseInstruction] = useState("");
  const [retitleInstruction, setRetitleInstruction] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await getManuscript();
        if (!cancelled) setManuscript(data);
      } catch (err) {
        if (!cancelled) setError((err as Error).message || "Не удалось загрузить");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pageId]);

  if (error) return <Bare>Ошибка: {error}</Bare>;
  if (!manuscript) return <Bare>Загружаю…</Bare>;

  const page = manuscript.pages.find((p) => p.id === pageId);
  if (!page) return <Bare>Страница не найдена. <a href="/" className="underline">Назад</a></Bare>;

  const chapter = page.chapterId ? manuscript.chapters.find((c) => c.id === page.chapterId) : null;
  const paragraphs = page.sceneContent.split(/\n{2,}/).filter(Boolean);

  async function handleRevise() {
    if (reviseInstruction.trim().length < 2) return;
    setLoading(true);
    setError(null);
    try {
      const result = await revisePage(pageId, reviseInstruction);
      window.location.href = `/page/${result.newPageId}`;
    } catch (err) {
      setError((err as Error).message || "Ошибка");
    } finally {
      setLoading(false);
    }
  }

  async function handleRetitle() {
    setLoading(true);
    setError(null);
    try {
      const result = await retitlePage(
        pageId,
        retitleInstruction.trim() ? retitleInstruction : undefined
      );
      window.location.href = `/page/${result.newPageId}`;
    } catch (err) {
      setError((err as Error).message || "Ошибка");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto min-h-screen max-w-[680px] px-5 pb-32 pt-8">
      <Crumbs chapter={chapter} />
      <div className="font-sans text-[10px] uppercase tracking-[0.22em] text-ink/45">
        v{page.version}
      </div>
      <h1 className="mt-2 font-serif text-3xl font-semibold leading-tight text-ink sm:text-4xl">
        {page.sceneTitle}
      </h1>
      {page.quote && (
        <blockquote className="mt-4 border-l-2 border-bronze/40 pl-4 font-serif text-lg italic text-ink/70">
          «{page.quote.replace(/[“”"]/g, "")}»
        </blockquote>
      )}
      <article className="mt-6 font-serif text-[18px] leading-[1.8] text-ink/95">
        {paragraphs.map((p, i) => (
          <p key={i} className="mb-4">{p}</p>
        ))}
      </article>

      <hr className="my-12 border-bronze/20" />

      <Section title="✍️ Подправить страницу">
        <p className="mb-3 font-serif text-sm text-ink/65">
          Опиши, что поменять. Например: «замени второй абзац на …» или «я был зол, не грустен».
        </p>
        <textarea
          value={reviseInstruction}
          onChange={(e) => setReviseInstruction(e.target.value)}
          rows={4}
          className="w-full rounded-md border border-bronze/30 bg-page/80 p-3 font-serif text-base text-ink"
          placeholder="Что поправить?"
        />
        <button
          disabled={loading || reviseInstruction.trim().length < 2}
          onClick={handleRevise}
          className="mt-3 rounded-full border border-bronze/40 bg-bronze/10 px-5 py-2 font-sans text-sm text-ink disabled:opacity-50"
        >
          Перерабатать страницу
        </button>
      </Section>

      <Section title="🏷 Переписать заголовок">
        <p className="mb-3 font-serif text-sm text-ink/65">
          Можно оставить пустым — тогда AI просто перевыберет заголовок из текста.
        </p>
        <input
          type="text"
          value={retitleInstruction}
          onChange={(e) => setRetitleInstruction(e.target.value)}
          className="w-full rounded-md border border-bronze/30 bg-page/80 p-3 font-serif text-base text-ink"
          placeholder="(необязательно) подсказка"
        />
        <button
          disabled={loading}
          onClick={handleRetitle}
          className="mt-3 rounded-full border border-bronze/40 bg-bronze/10 px-5 py-2 font-sans text-sm text-ink disabled:opacity-50"
        >
          Переписать заголовок
        </button>
      </Section>

      {error && <p className="mt-6 font-serif text-sm text-burgundy">{error}</p>}
    </main>
  );
}

function Crumbs({ chapter }: { chapter?: ManuscriptDto["chapters"][number] | null }) {
  return (
    <div className="mb-6 font-sans text-[10px] uppercase tracking-[0.18em] text-bronze">
      <a href="/" className="hover:underline">← Книга</a>
      {chapter && (
        <>
          <span className="mx-2 text-bronze/40">·</span>
          <a href={`/chapter/${chapter.id}`} className="hover:underline">
            Глава {chapter.orderIndex + 1}
          </a>
        </>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="my-8">
      <h2 className="font-sans text-sm uppercase tracking-[0.22em] text-ink">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Bare({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-6 text-center">
      <p className="font-serif text-xl text-ink/70">{children}</p>
    </main>
  );
}
