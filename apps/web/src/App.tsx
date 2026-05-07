import { useEffect, useMemo, useState } from "react";
import { LivingBook } from "./components/LivingBook";
import { Paywall } from "./components/Paywall";
import { getBook, type BookDto } from "./api";

type Route = { kind: "book"; token: string } | { kind: "home" };

function parseRoute(pathname: string): Route {
  const [, section, value] = pathname.split("/");
  if (section === "book" && value) return { kind: "book", token: value };
  return { kind: "home" };
}

export function App() {
  const route = useMemo(() => parseRoute(window.location.pathname), []);
  const [book, setBook] = useState<BookDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        if (route.kind === "book") {
          const data = await getBook(route.token);
          if (!cancelled) setBook(data);
        }
      } catch {
        if (!cancelled) setError("Книга не найдена или ссылка устарела.");
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [route]);

  if (route.kind === "book") {
    if (error) return <EmptyState text={error} />;
    if (!book) return <EmptyState text="Открываю книгу…" />;
    return <LivingBook book={book} />;
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
