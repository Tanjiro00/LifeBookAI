import { useEffect, useMemo, useState } from "react";
import { BookPreview } from "./components/BookPreview";
import { ChapterPage } from "./components/ChapterPage";
import { Paywall } from "./components/Paywall";
import { getBook, getChapter, type BookDto, type ChapterDto } from "./api";

type Route =
  | { kind: "chapter"; token: string }
  | { kind: "book"; id: string }
  | { kind: "admin" }
  | { kind: "miniapp" }
  | { kind: "home" };

function parseRoute(pathname: string): Route {
  const [, section, value] = pathname.split("/");
  if (section === "chapter" && value) {
    return { kind: "chapter", token: value };
  }
  if (section === "book" && value) {
    return { kind: "book", id: value };
  }
  if (section === "admin") {
    return { kind: "admin" };
  }
  if (section === "miniapp") {
    return { kind: "miniapp" };
  }
  return { kind: "home" };
}

export function App() {
  const route = useMemo(() => parseRoute(window.location.pathname), []);
  const [chapter, setChapter] = useState<ChapterDto | null>(null);
  const [book, setBook] = useState<BookDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        if (route.kind === "chapter") {
          const data = await getChapter(route.token);
          if (!cancelled) {
            setChapter(data);
          }
        }
        if (route.kind === "book") {
          const data = await getBook(route.id);
          if (!cancelled) {
            setBook(data);
          }
        }
      } catch {
        if (!cancelled) {
          setError("Страница не найдена или ссылка устарела.");
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [route]);

  if (route.kind === "chapter") {
    if (error) {
      return <EmptyState text={error} />;
    }
    if (!chapter) {
      return <EmptyState text="Открываю страницу книги..." />;
    }
    return <ChapterPage chapter={{ ...chapter, createdAt: new Date(chapter.createdAt) }} />;
  }

  if (route.kind === "book") {
    if (error) {
      return <EmptyState text={error} />;
    }
    if (!book) {
      return <EmptyState text="Открываю книгу..." />;
    }
    return (
      <BookPreview
        book={book}
        chapters={book.chapters.map((item) => ({
          ...item,
          createdAt: new Date(item.createdAt)
        }))}
      />
    );
  }

  if (route.kind === "admin") {
    return <EmptyState text="Метрики доступны на защищённом endpoint бота: /admin/metrics." />;
  }

  return <Paywall />;
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

