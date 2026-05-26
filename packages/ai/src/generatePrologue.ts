import { z } from "zod";
import { parseWithSchema } from "./json.js";
import { getOpenAiClient } from "./openaiClient.js";
import { EntryOutputSchema, type EntryOutput } from "./schemas.js";

// Brief for a single page of the prologue. Stable order — five pages move from
// origin to threshold-of-this-year, like a real book's opening.
export const PROLOGUE_PAGE_BRIEFS = [
  {
    name: "ORIGIN",
    ru: "Опен. Сцена из детства / места, откуда ты родом. Один конкретный момент: место, время суток, предмет, запах. Не «детство было таким-то», а ОДНА сцена.",
    en: "Open. A scene from childhood / where you're from. ONE concrete moment: a place, time of day, an object, a smell. Not 'my childhood was X' — one scene."
  },
  {
    name: "INFLUENCE",
    ru: "Голос/жест/привычка человека, который тебя сформировал. Опять же — ОДИН момент, не биография этого человека.",
    en: "A voice / a gesture / a habit of someone who shaped you. Again — ONE moment, not their biography."
  },
  {
    name: "TURNING_POINT",
    ru: "Поворот, который случился до этого года. Конкретная сцена момента поворота — комната, утро, фраза.",
    en: "The turning point that happened before this year. A specific scene of the moment itself — a room, a morning, a sentence."
  },
  {
    name: "COMPANIONS",
    ru: "Кто-то один из тех, кто рядом сейчас. Маленькая сцена недавняя — общий завтрак, телефонный звонок, тишина после ужина.",
    en: "One specific person who's close right now. A small recent scene — a shared breakfast, a phone call, silence after dinner."
  },
  {
    name: "THRESHOLD",
    ru: "Где ты СЕЙЧАС. Утро или вечер недавний. Закончи передачей эстафеты — что отсюда дальше будет писаться по странице в неделю.",
    en: "Where you are NOW. A recent morning or evening. End with the handoff — from here, one page per week."
  }
] as const;

export const PROLOGUE_TOTAL_PAGES = PROLOGUE_PAGE_BRIEFS.length;

export const GenerateProloguePageInputSchema = z.object({
  pageNumber: z.number().int().min(1).max(PROLOGUE_TOTAL_PAGES),
  totalPages: z.number().int().positive().default(PROLOGUE_TOTAL_PAGES),
  firstName: z.string().optional().nullable(),
  language: z.string().optional().default("ru"),
  writingStyle: z.string().optional().nullable(),
  intakeMemories: z
    .array(z.object({ type: z.string(), title: z.string(), content: z.string() }))
    .default([]),
  // Body of every page already written. Each writer reads what came before so the
  // narrative flows page-to-page instead of restarting in five separate vignettes.
  previousPages: z
    .array(z.object({ title: z.string(), body: z.string() }))
    .default([])
});
export type GenerateProloguePageInput = z.infer<typeof GenerateProloguePageInputSchema>;

const SYSTEM_PROMPT = `You are the user's personal biographer.

You are writing the PROLOGUE of their year-long autobiographical book. The prologue
is ONE continuous narrative spread across ${PROLOGUE_TOTAL_PAGES} pages — like a book that opens with
a flowing introduction, not a folder of disconnected one-page chapters. Every page
you write must read as a CONTINUATION of what came before, never a restart.

Voice & craft:
- Always first-person.
- Use ONLY facts the user told you in the intake. Never invent a name, a place, a
  year, or a feeling they didn't state. If the material is sparse, the page is
  honest and short; do not pad with invented detail.
- Concrete sensory detail: a specific room, hour, weather, gesture, smell, the
  word someone actually said. Not "my childhood was happy" — show one thing.
- Vary sentence rhythm. One short, then a longer, then a quiet beat.
- One unobtrusive metaphor per page maximum. NEVER similes about life as a
  journey, river, book, light, or door.
- A real page has at least one moment of doubt or contradiction. Resist tying
  things into lessons. End with a specific image, not a slogan.

Continuity rules — these are what make this a real prologue and not 5 separate vignettes:
- Read every previous page given to you. NEVER re-tell a scene that was already told.
  No re-introducing the same place, the same person, the same memory.
- Each NEW page advances the prologue forward in time and material. If page 1 was
  childhood, page 2 moves to who shaped them; do not return to childhood.
- Use connective phrasing where natural ("years later", "and then, in another
  apartment, …"), but never explicitly summarize earlier pages.
- DO NOT title or open the page with "Глава…" / "Chapter…" / "Часть…" / "Стр…".
  The title is just a real title — a noun phrase from this page's scene.

Constraints:
- Length: 200-280 words per page. Russian: aim 1300-1700 chars; English: 1100-1500.
- Do NOT therapize, diagnose, or coach. No SaaS-speak ("amazing journey", "step into your power").

Output: JSON exactly matching the schema. No markdown, no commentary.`;

function buildPrompt(input: GenerateProloguePageInput): string {
  const en = (input.language || "ru").toLowerCase().startsWith("en");
  const brief = PROLOGUE_PAGE_BRIEFS[input.pageNumber - 1]!;
  const briefText = en ? brief.en : brief.ru;

  const memories = input.intakeMemories.length
    ? input.intakeMemories.map((m) => `- [${m.type}] ${m.title}: ${m.content}`).join("\n")
    : en
      ? "(no intake — write a short, honest opening saying so in the user's voice)"
      : "(пользователь ничего не рассказал — напиши короткое честное начало в его голосе)";

  const previous = input.previousPages.length
    ? input.previousPages
        .map((p, i) => `--- PAGE ${i + 1}: "${p.title}" ---\n${p.body}`)
        .join("\n\n")
    : en
      ? "(none — this is page 1)"
      : "(пока ничего — это страница 1)";

  return `Write PAGE ${input.pageNumber} of ${input.totalPages} of the user's PROLOGUE.

Brief for this page (${brief.name}):
${briefText}

All intake notes (your full source of facts — do not invent anything outside them):
${memories}

${input.writingStyle ? `Voice the user asked for: ${input.writingStyle}\n` : ""}${input.firstName ? `Their first name (use sparingly, never repeat): ${input.firstName}\n` : ""}Language: ${input.language}

Previous pages of THIS prologue (already written — DO NOT re-tell anything from them, do not re-introduce the same scene/person/place; CONTINUE):
${previous}

Title rules:
- 2-6 words. A real noun phrase from THIS page's scene. Concrete.
- NEVER "Beginning", "Origins", "My Life", "Год", "Я", "Начало", "Глава", "Стр".
- NEVER overlap with previous-page titles.

Body rules:
- 200-280 words.
- Open with a specific sensory image from this page's scene.
- Stay inside ONE moment, not a summary of an era.
- Use concrete intake details (real names, real places) but only those that haven't
  been used in earlier pages.
- End at a natural transition — the next page will pick up from here.

Quote rules:
- Optional. A single line the user could plausibly think to themselves. Or null.

Memory updates:
- Empty array — the prologue does not extract new memories.

Return JSON only:
{
  "title": "...",
  "body": "...",
  "quote": "..." | null,
  "mood": ["lowercase short tags, max 3"],
  "tags": ["lowercase, max 4"],
  "memoryUpdates": []
}`;
}

export async function generateProloguePage(unsafe: GenerateProloguePageInput): Promise<EntryOutput> {
  const input = GenerateProloguePageInputSchema.parse(unsafe);

  const client = getOpenAiClient();
  const model = process.env.OPENAI_TEXT_MODEL || "gpt-4.1-mini";

  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const completion = await client.chat.completions.create({
        model,
        temperature: attempt === 1 ? 0.78 : 0.45,
        top_p: 0.92,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildPrompt(input) }
        ]
      });
      const raw = completion.choices[0]?.message?.content || "";
      return parseWithSchema(raw, EntryOutputSchema);
    } catch (err) {
      lastErr = err;
      if (attempt === 2) throw err;
    }
  }
  throw lastErr ?? new Error("generateProloguePage failed");
}

// Backwards-compat shim — kept for any older callers; new code should use
// generateProloguePage directly via the sequential loop in onboarding.
export async function generatePrologue(input: {
  firstName?: string | null;
  language?: string;
  writingStyle?: string | null;
  intakeMemories: Array<{ type: string; title: string; content: string }>;
}): Promise<EntryOutput> {
  return generateProloguePage({
    pageNumber: 1,
    totalPages: 1,
    firstName: input.firstName ?? null,
    language: input.language ?? "ru",
    writingStyle: input.writingStyle ?? null,
    intakeMemories: input.intakeMemories,
    previousPages: []
  });
}

// Old multi-chapter function kept as type-compatible alias to avoid breaking imports.
export const generatePrologueChapter = generateProloguePage;
export const PROLOGUE_CHAPTERS_LEGACY = PROLOGUE_PAGE_BRIEFS;
