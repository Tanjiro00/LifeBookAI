const RU_RULES = new Intl.PluralRules("ru-RU");

export function pluralRu(count: number, forms: { one: string; few: string; many: string }): string {
  const rule = RU_RULES.select(count);
  if (rule === "one") return forms.one;
  if (rule === "few") return forms.few;
  return forms.many;
}

export function chaptersWord(count: number): string {
  return pluralRu(count, { one: "глава", few: "главы", many: "глав" });
}

export function weeksWord(count: number): string {
  return pluralRu(count, { one: "неделя", few: "недели", many: "недель" });
}

export function daysWord(count: number): string {
  return pluralRu(count, { one: "день", few: "дня", many: "дней" });
}
