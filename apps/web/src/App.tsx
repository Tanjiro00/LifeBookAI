import { useEffect, useMemo, useState } from "react";
import { LivingBook } from "./components/LivingBook";
import { Paywall } from "./components/Paywall";
import { BookReader } from "./components/BookReader";
import { PageEditor } from "./components/PageEditor";
import { MemoryPanel } from "./components/MemoryPanel";
import { ChapterEditor } from "./components/ChapterEditor";
import { getBook, type BookDto } from "./api";

// Sprint 4 / 5 Mini App routes:
//   /                      → MiniApp BookReader (auth required) OR Paywall fallback
//   /book/:shareToken      → public LivingBook (no auth, legacy share flow)
//   /page/:id              → MiniApp PageEditor (auth required)
//   /chapter/:id           → MiniApp ChapterEditor (auth required)
//   /memories              → MiniApp MemoryPanel (auth required)
type Route =
  | { kind: "book"; token: string }
  | { kind: "miniapp_book" }
  | { kind: "miniapp_page"; id: string }
  | { kind: "miniapp_chapter"; id: string }
  | { kind: "miniapp_memories" }
  | { kind: "home" };

function parseRoute(pathname: string): Route {
  const [, section, value] = pathname.split("/");
  if (section === "book" && value) return { kind: "book", token: value };
  if (section === "page" && value) return { kind: "miniapp_page", id: value };
  if (section === "chapter" && value) return { kind: "miniapp_chapter", id: value };
  if (section === "memories") return { kind: "miniapp_memories" };
  // Mini App lands on / — when the URL is bare and Telegram.WebApp is available
  // we treat it as the authenticated BookReader.
  if (!section) {
    if (typeof window !== "undefined" && window.Telegram?.WebApp?.initData) {
      return { kind: "miniapp_book" };
    }
    return { kind: "home" };
  }
  return { kind: "home" };
}

export function App() {
  const route = useMemo(() => parseRoute(window.location.pathname), []);

  useEffect(() => {
    // Tell Telegram the Mini App is ready so it removes the loading state
    // in the host UI. Safe outside Telegram (no-op).
    try {
      window.Telegram?.WebApp?.ready?.();
      window.Telegram?.WebApp?.expand?.();
    } catch {
      /* no-op */
    }
  }, []);

  if (route.kind === "miniapp_book") return <BookReader />;
  if (route.kind === "miniapp_page") return <PageEditor pageId={route.id} />;
  if (route.kind === "miniapp_chapter") return <ChapterEditor chapterId={route.id} />;
  if (route.kind === "miniapp_memories") return <MemoryPanel />;

  if (route.kind === "book") return <PublicBook token={route.token} />;
  return <Paywall />;
}

function PublicBook({ token }: { token: string }) {
  const [book, setBook] = useState<BookDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await getBook(token);
        if (!cancelled) setBook(data);
      } catch {
        if (!cancelled) setError("Книга не найдена или ссылка устарела.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (error) return <EmptyState text={error} />;
  if (!book) return <EmptyState text="Открываю книгу…" />;
  return <LivingBook book={book} />;
}

function EmptyState({ text }: { text: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <section className="max-w-md rounded-[8px] border border-bronze/20 bg-page p-8 text-center shadow-sm">
        <div className="font-sans text-xs uppercase tracking-[0.18em] text-bronze">LifeBook</div>
        <p className="mt-5 font-serif text-2xl leading-relaxed text-ink">{text}</p>
      </section>
    </main>
  );
}
