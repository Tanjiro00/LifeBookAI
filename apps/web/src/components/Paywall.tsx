export function Paywall() {
  return (
    <section className="mx-auto max-w-xl px-6 py-20 text-center">
      <div className="font-sans text-xs uppercase tracking-[0.18em] text-bronze">LifeBook Pro</div>
      <h1 className="mt-5 font-serif text-4xl leading-tight">Биограф пишет настоящие главы из твоих страниц</h1>
      <p className="mt-5 font-serif text-xl leading-relaxed text-ink/70">
        Страницы остаются твоими — это всегда бесплатно.
        <br />
        Pro — это работа биографа: он берёт страницы и складывает из них главы. Раз в месяц или раз в год.
      </p>
      <button className="mt-8 h-11 rounded-[8px] bg-ink px-6 font-sans text-sm text-page">Открыть Pro</button>
    </section>
  );
}
