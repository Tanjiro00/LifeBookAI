type ChapterPageProps = {
  chapter: {
    title: string;
    subtitle?: string | null;
    quote?: string | null;
    content: string;
    createdAt: Date;
    isSaved: boolean;
  };
};

export function ChapterPage({ chapter }: ChapterPageProps) {
  const paragraphs = chapter.content.split(/\n{2,}/).filter(Boolean);

  return (
    <main className="min-h-screen px-4 py-5 sm:px-8 sm:py-10">
      <article className="mx-auto min-h-[calc(100vh-96px)] max-w-3xl bg-page px-6 py-10 shadow-page sm:px-14 sm:py-16 lg:px-20">
        <header className="mb-10 border-b border-bronze/25 pb-8">
          <div className="mb-8 flex items-center justify-between gap-4 font-sans text-xs uppercase tracking-[0.16em] text-bronze">
            <span>LifeBook</span>
            <span>{chapter.isSaved ? "Saved" : "Draft"}</span>
          </div>
          <h1 className="font-serif text-4xl leading-tight text-ink sm:text-6xl">{chapter.title}</h1>
          {chapter.subtitle ? <p className="mt-5 font-serif text-xl leading-relaxed text-ink/70">{chapter.subtitle}</p> : null}
          {chapter.quote ? (
            <blockquote className="mt-9 border-l-2 border-bronze pl-5 font-serif text-xl italic leading-relaxed text-ink/80">
              “{chapter.quote.replace(/[“”"]/g, "")}”
            </blockquote>
          ) : null}
        </header>

        <section className="pb-24 font-serif text-[20px] leading-[1.82] text-ink sm:text-[21px]">
          {paragraphs.map((paragraph) => (
            <p key={paragraph.slice(0, 40)} className="mb-7">
              {paragraph}
            </p>
          ))}
        </section>
      </article>

      <nav className="fixed inset-x-0 bottom-0 border-t border-bronze/20 bg-page/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto grid max-w-3xl grid-cols-4 gap-2">
          <button className="h-10 rounded-[8px] bg-ink px-3 font-sans text-sm text-page">Save</button>
          <button className="h-10 rounded-[8px] border border-bronze/35 px-3 font-sans text-sm text-ink">Edit</button>
          <button className="h-10 rounded-[8px] border border-bronze/35 px-3 font-sans text-sm text-ink">Share</button>
          <button className="h-10 rounded-[8px] border border-bronze/35 px-3 font-sans text-sm text-ink">Export</button>
        </div>
      </nav>
    </main>
  );
}

