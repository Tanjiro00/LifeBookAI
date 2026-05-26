import { useEffect, useState } from "react";
import {
  addChapterIntroDetail,
  approveChapter,
  getManuscript,
  renameChapter,
  resplitChapter,
  type ManuscriptDto
} from "../api";

// Sprint 4 Mini App — ChapterEditor.
//
// Loads the manuscript, picks a chapter by id, and exposes the four chapter
// actions powered by the bot's chapterService:
//   - Rename
//   - Add detail to intro
//   - Approve (DRAFT → USER_APPROVED)
//   - Resplit (DRAFT only — returns pages to unchaptered pool)
//
// Approved chapters can still be renamed / get intro details (those produce a
// version+1 in the chapter row); resplit is hidden once approved because it'd
// effectively destroy what the user has accepted.

export function ChapterEditor({ chapterId }: { chapterId: string }) {
  const [manuscript, setManuscript] = useState<ManuscriptDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [renameInput, setRenameInput] = useState("");
  const [detailInput, setDetailInput] = useState("");

  useEffect(() => {
    void load();
  }, [chapterId]);

  async function load() {
    try {
      setManuscript(await getManuscript());
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (error) return <Bare>Ошибка: {error}</Bare>;
  if (!manuscript) return <Bare>Загружаю…</Bare>;

  const chapter = manuscript.chapters.find((c) => c.id === chapterId);
  if (!chapter) return <Bare>Глава не найдена. <a href="/" className="underline">К книге</a></Bare>;

  const pages = manuscript.pages
    .filter((p) => p.chapterId === chapterId)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  async function handleRename() {
    if (renameInput.trim().length < 2) return;
    setLoading(true);
    setError(null);
    try {
      await renameChapter(chapterId, renameInput.trim());
      setRenameInput("");
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleAddDetail() {
    if (detailInput.trim().length < 2) return;
    setLoading(true);
    setError(null);
    try {
      await addChapterIntroDetail(chapterId, detailInput.trim());
      setDetailInput("");
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleApprove() {
    setLoading(true);
    setError(null);
    try {
      await approveChapter(chapterId);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleResplit() {
    if (
      !window.confirm(
        "Разделить эту главу заново? Страницы вернутся в общую кучу, бот соберёт другую группировку при следующем синтезе."
      )
    ) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await resplitChapter(chapterId);
      window.location.href = "/";
    } catch (err) {
      setError((err as Error).message);
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto min-h-screen max-w-[680px] px-5 pb-32 pt-8">
      <div className="mb-6 font-sans text-[10px] uppercase tracking-[0.18em] text-bronze">
        <a href="/" className="hover:underline">← Книга</a>
      </div>
      <div className="font-sans text-[10px] uppercase tracking-[0.22em] text-bronze">
        Глава {chapter.orderIndex + 1} · {chapter.status}
      </div>
      <h1 className="mt-2 font-serif text-4xl font-semibold leading-tight text-ink">{chapter.title}</h1>
      {chapter.subtitle && (
        <p className="mt-2 font-serif text-base italic text-ink/65">{chapter.subtitle}</p>
      )}
      {chapter.intro && (
        <article className="mt-6 font-serif text-[18px] leading-[1.8] text-ink/85">
          {chapter.intro.split(/\n{2,}/).filter(Boolean).map((p, i) => (
            <p key={i} className="mb-4">{p}</p>
          ))}
        </article>
      )}
      <div className="mt-6 font-sans text-[11px] uppercase tracking-[0.18em] text-ink/55">
        {pages.length} страниц
      </div>

      <hr className="my-12 border-bronze/20" />

      <Section title="✏️ Переименовать">
        <input
          type="text"
          value={renameInput}
          onChange={(e) => setRenameInput(e.target.value)}
          className="w-full rounded-md border border-bronze/30 bg-page/80 p-3 font-serif text-base text-ink"
          placeholder="Новое название"
        />
        <button
          disabled={loading || renameInput.trim().length < 2}
          onClick={handleRename}
          className="mt-3 rounded-full border border-bronze/40 bg-bronze/10 px-5 py-2 font-sans text-sm text-ink disabled:opacity-50"
        >
          Применить
        </button>
      </Section>

      <Section title="➕ Добавить деталь во вступление">
        <textarea
          value={detailInput}
          onChange={(e) => setDetailInput(e.target.value)}
          rows={4}
          className="w-full rounded-md border border-bronze/30 bg-page/80 p-3 font-serif text-base text-ink"
          placeholder="Что должно быть отражено в intro этой главы?"
        />
        <button
          disabled={loading || detailInput.trim().length < 2}
          onClick={handleAddDetail}
          className="mt-3 rounded-full border border-bronze/40 bg-bronze/10 px-5 py-2 font-sans text-sm text-ink disabled:opacity-50"
        >
          Добавить
        </button>
      </Section>

      <Section title="✅ Подтвердить главу">
        <p className="mb-3 font-serif text-sm text-ink/65">
          Подтверждённая глава попадёт в финальный PDF. Можно редактировать после подтверждения,
          но это создаст новую версию.
        </p>
        <button
          disabled={loading || chapter.status === "USER_APPROVED" || chapter.status === "LOCKED_FOR_PDF"}
          onClick={handleApprove}
          className="rounded-full border border-swamp/40 bg-swamp/10 px-5 py-2 font-sans text-sm text-ink disabled:opacity-50"
        >
          {chapter.status === "USER_APPROVED" || chapter.status === "LOCKED_FOR_PDF"
            ? "Уже подтверждено"
            : "Подтвердить"}
        </button>
      </Section>

      {chapter.status === "DRAFT" && (
        <Section title="🔁 Не нравится / переразбить">
          <p className="mb-3 font-serif text-sm text-ink/65">
            Страницы вернутся в общий список. Бот попробует другую группировку на следующей итерации синтеза.
          </p>
          <button
            disabled={loading}
            onClick={handleResplit}
            className="rounded-full border border-burgundy/40 bg-burgundy/10 px-5 py-2 font-sans text-sm text-burgundy disabled:opacity-50"
          >
            Переразбить
          </button>
        </Section>
      )}

      {error && <p className="mt-6 font-serif text-sm text-burgundy">{error}</p>}
    </main>
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
