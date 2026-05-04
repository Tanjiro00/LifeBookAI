type BookPreviewProps = {
  book: {
    title: string;
    subtitle?: string | null;
  };
  chapters: {
    id: string;
    title: string;
    quote?: string | null;
    createdAt: Date;
  }[];
};

export function BookPreview({ book, chapters }: BookPreviewProps) {
  return (
    <main className="min-h-screen px-4 py-8 sm:px-8">
      <section className="mx-auto max-w-5xl">
        <header className="mb-10">
          <div className="font-sans text-xs uppercase tracking-[0.18em] text-bronze">LifeBook</div>
          <h1 className="mt-5 font-serif text-5xl leading-tight text-ink sm:text-7xl">{book.title}</h1>
          {book.subtitle ? <p className="mt-4 max-w-2xl font-serif text-2xl text-ink/70">{book.subtitle}</p> : null}
        </header>

        <div className="grid gap-4 md:grid-cols-2">
          {chapters.map((chapter, index) => (
            <article key={chapter.id} className="rounded-[8px] border border-bronze/20 bg-page p-6 shadow-sm">
              <div className="mb-6 font-sans text-xs uppercase tracking-[0.14em] text-bronze">Chapter {index + 1}</div>
              <h2 className="font-serif text-2xl leading-snug">{chapter.title}</h2>
              {chapter.quote ? <p className="mt-4 font-serif text-lg italic leading-relaxed text-ink/70">“{chapter.quote}”</p> : null}
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

