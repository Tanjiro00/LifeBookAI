export function Paywall() {
  return (
    <section className="mx-auto max-w-xl px-6 py-20 text-center">
      <div className="font-sans text-xs uppercase tracking-[0.18em] text-bronze">LifeBook Pro</div>
      <h1 className="mt-5 font-serif text-4xl leading-tight">Книга может продолжаться без лимита</h1>
      <p className="mt-5 font-serif text-xl leading-relaxed text-ink/70">
        Pro открывает безлимитные главы, голосовые, память, карточки и PDF-экспорт.
      </p>
      <button className="mt-8 h-11 rounded-[8px] bg-ink px-6 font-sans text-sm text-page">Unlock Pro</button>
    </section>
  );
}

