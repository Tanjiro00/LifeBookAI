import { useEffect, useState } from "react";
import {
  deleteMemory,
  editMemory,
  listMemories,
  markMemoryDoNotUse,
  type MemoryDto
} from "../api";

// Sprint 3 / 4 Mini App — Memory panel.
//
// Lists every MemoryEntity for the user, grouped by type (PERSON / PLACE /
// THEME / ...). For each row:
//   - Edit content (inline textarea → POST /api/memories/:id/edit)
//   - Delete (cascade-deletes MemoryRevisions)
//   - Mark do-not-use (so future merges skip it; the row stays for history)
//
// The view is intentionally plain: it's a control surface, not a reading
// experience. The book is what we render beautifully; this is the wrench.

const TYPE_LABELS: Record<string, string> = {
  PERSON: "👥 Люди",
  PLACE: "📍 Места",
  THEME: "🎭 Темы",
  LIFE_EVENT: "🌟 События",
  GOAL: "🎯 Цели",
  FEAR: "💭 Страхи",
  ACHIEVEMENT: "🏆 Достижения",
  PREFERENCE: "💡 Предпочтения"
};

export function MemoryPanel() {
  const [memories, setMemories] = useState<MemoryDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    try {
      setMemories(await listMemories());
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (error) return <Bare>Ошибка: {error}</Bare>;
  if (!memories) return <Bare>Загружаю…</Bare>;

  if (memories.length === 0) {
    return (
      <Bare>
        Пока пусто.
        <br />
        После 2-3 записей сюда попадут люди, места и темы, которые я уловил.
      </Bare>
    );
  }

  // Group by type.
  const groups = new Map<string, MemoryDto[]>();
  for (const m of memories) {
    const arr = groups.get(m.type) ?? [];
    arr.push(m);
    groups.set(m.type, arr);
  }

  async function handleSaveEdit(id: string) {
    try {
      await editMemory(id, draft);
      setEditingId(null);
      setDraft("");
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm("Удалить эту память? Действие необратимо.")) return;
    try {
      await deleteMemory(id);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleDoNotUse(id: string) {
    try {
      await markMemoryDoNotUse(id);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <main className="mx-auto min-h-screen max-w-[680px] px-5 pb-24 pt-8">
      <div className="mb-6">
        <a href="/" className="font-sans text-[10px] uppercase tracking-[0.18em] text-bronze hover:underline">
          ← Книга
        </a>
      </div>
      <h1 className="font-serif text-3xl font-semibold text-ink">Что я помню</h1>
      <p className="mt-2 font-serif text-sm text-ink/65">
        Любую память можно поправить, удалить или попросить «не использовать в книге».
      </p>

      {Array.from(groups.entries()).map(([type, items]) => (
        <section key={type} className="my-8">
          <h2 className="font-sans text-sm uppercase tracking-[0.22em] text-ink">
            {TYPE_LABELS[type] ?? type}
          </h2>
          <div className="mt-3 space-y-3">
            {items.map((m) => (
              <article
                key={m.id}
                className={`rounded-md border p-4 ${
                  m.doNotUse ? "border-bronze/15 bg-page/40 opacity-60" : "border-bronze/30 bg-page"
                }`}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="font-serif text-lg font-semibold text-ink">{m.title}</h3>
                  <span className="font-sans text-[10px] uppercase tracking-[0.18em] text-ink/45">
                    {Math.round(m.confidence * 100)}%
                    {m.doNotUse ? " · не использовать" : ""}
                  </span>
                </div>
                {m.aliases.length > 0 && (
                  <div className="mt-1 font-sans text-[11px] italic text-ink/55">
                    aliases: {m.aliases.join(", ")}
                  </div>
                )}
                {editingId === m.id ? (
                  <div className="mt-3">
                    <textarea
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      rows={4}
                      className="w-full rounded-md border border-bronze/30 bg-page/80 p-3 font-serif text-base text-ink"
                    />
                    <div className="mt-2 flex gap-2">
                      <button
                        onClick={() => handleSaveEdit(m.id)}
                        className="rounded-full border border-bronze/40 bg-bronze/10 px-4 py-1.5 font-sans text-xs uppercase tracking-[0.18em] text-ink"
                      >
                        Сохранить
                      </button>
                      <button
                        onClick={() => {
                          setEditingId(null);
                          setDraft("");
                        }}
                        className="rounded-full border border-bronze/20 px-4 py-1.5 font-sans text-xs uppercase tracking-[0.18em] text-ink/65"
                      >
                        Отмена
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="mt-2 font-serif text-base text-ink/85">{m.content}</p>
                )}
                {editingId !== m.id && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      onClick={() => {
                        setEditingId(m.id);
                        setDraft(m.content);
                      }}
                      className="rounded-full border border-bronze/30 px-3 py-1 font-sans text-[11px] uppercase tracking-[0.18em] text-ink"
                    >
                      ✏ изменить
                    </button>
                    <button
                      onClick={() => handleDelete(m.id)}
                      className="rounded-full border border-burgundy/30 px-3 py-1 font-sans text-[11px] uppercase tracking-[0.18em] text-burgundy"
                    >
                      🗑 удалить
                    </button>
                    {!m.doNotUse && (
                      <button
                        onClick={() => handleDoNotUse(m.id)}
                        className="rounded-full border border-bronze/20 px-3 py-1 font-sans text-[11px] uppercase tracking-[0.18em] text-ink/65"
                      >
                        🚫 не использовать
                      </button>
                    )}
                  </div>
                )}
              </article>
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}

function Bare({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-6 text-center">
      <p className="font-serif text-xl text-ink/70">{children}</p>
    </main>
  );
}
