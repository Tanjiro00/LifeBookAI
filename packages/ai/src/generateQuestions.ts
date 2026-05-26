import { z } from "zod";
import { parseWithSchema } from "./json.js";
import { getOpenAiClient } from "./openaiClient.js";

// Sprint 1.7 — questions also benefit from prose context. The writer prompt's
// «no abstract feelings questions» rule lives here too; with related bodies in
// view the model can ask «Это та же кухня, что в апрельской записи?» instead
// of «Что ты почувствовал?».
const QPageBody = z.object({
  pageId: z.string().optional(),
  title: z.string(),
  body: z.string(),
  daysAgo: z.number().int().nonnegative().default(0),
  similarity: z.number().optional()
});

export const GenerateQuestionsInputSchema = z.object({
  rawEntryOrTranscript: z.string().trim().min(10),
  language: z.string().optional().default("ru"),
  recentEntries: z
    .array(
      z.object({
        title: z.string(),
        tags: z.array(z.string()).default([]),
        daysAgo: z.number().int().nonnegative()
      })
    )
    .default([]),
  recentBodies: z.array(QPageBody).default([]),
  relatedBodies: z.array(QPageBody).default([]),
  memories: z
    .array(z.object({ type: z.string(), title: z.string(), content: z.string() }))
    .default([]),
  count: z.number().int().min(1).max(3).default(2)
});
export type GenerateQuestionsInput = z.infer<typeof GenerateQuestionsInputSchema>;

export const ClarificationSchema = z.object({
  question: z.string().trim().min(8).max(220),
  reason: z.string().trim().min(4).max(180).optional()
});
export type Clarification = z.infer<typeof ClarificationSchema>;

export const GenerateQuestionsOutputSchema = z.object({
  questions: z.array(ClarificationSchema).min(0).max(3)
});
export type GenerateQuestionsOutput = z.infer<typeof GenerateQuestionsOutputSchema>;

const SYSTEM_PROMPT = `You are the user's personal biographer.
Before writing the weekly entry, you may ask up to N short, specific clarifying questions.
You ask only when an answer would noticeably enrich the page; otherwise return an empty list.
Never ask about feelings in the abstract. Never ask "how did that make you feel?".
Ask about a concrete sensory detail, a specific person, a moment, or what changed.
Each question is one sentence, in the user's language.
Return only valid JSON; no markdown, no commentary.`;

function buildPrompt(input: GenerateQuestionsInput): string {
  const recent = input.recentEntries
    .slice(0, 4)
    .map(
      (e) =>
        `- ${e.daysAgo}d ago — "${e.title}"${e.tags.length ? ` (${e.tags.slice(0, 3).join(", ")})` : ""}`
    )
    .join("\n");
  const memories = input.memories
    .slice(0, 6)
    .map((m) => `- [${m.type}] ${m.title}: ${m.content}`)
    .join("\n");

  // Sprint 1.7 — give the questioner the prose it needs to ask CONCRETE
  // questions tying the new entry to a prior scene. We pass at most 2 recent
  // bodies + 2 related bodies — the questioner doesn't need the full corpus.
  const fmt = (b: { title: string; body: string; daysAgo: number }) => {
    const trimmed = b.body.length > 1200 ? b.body.slice(0, 1200) + "…" : b.body;
    return `--- ${b.daysAgo}d ago — "${b.title}" ---\n${trimmed}`;
  };
  const recentBodiesBlock = input.recentBodies.slice(0, 2).map(fmt).join("\n\n");
  const relatedBodiesBlock = input.relatedBodies.slice(0, 2).map(fmt).join("\n\n");

  const recentProse = recentBodiesBlock
    ? `\n\nRECENT PAGES (ask about a specific recurring detail if it helps; never paraphrase):\n${recentBodiesBlock}`
    : "";
  const relatedProse = relatedBodiesBlock
    ? `\n\nRELATED PAGES (semantically similar; you may ask whether the user is referring to the SAME place/person/object):\n${relatedBodiesBlock}`
    : "";

  return `Raw input from the user:
"""
${input.rawEntryOrTranscript}
"""

Recent entries (titles only):
${recent || "(none yet)"}${recentProse}${relatedProse}

Long-term memories about this person:
${memories || "(none yet)"}

Language: ${input.language}
Maximum questions: ${input.count}

Return JSON only:
{
  "questions": [
    { "question": "...", "reason": "what this clarifies" }
  ]
}

Rules:
- 0 to ${input.count} questions. Empty list is valid if you don't need anything.
- Each question must reference something the user actually said OR a specific
  detail from the RECENT/RELATED prose above (e.g. «это та же кухня, что в апрельской записи?»).
- Same language as the user.
- No "how did that make you feel" or "what did you learn".
- Specific, sensory, or concrete: who, where, what changed.`;
}

export async function generateQuestions(unsafe: GenerateQuestionsInput): Promise<GenerateQuestionsOutput> {
  const input = GenerateQuestionsInputSchema.parse(unsafe);

  const client = getOpenAiClient();
  const model = process.env.OPENAI_TEXT_MODEL || "gpt-4.1-mini";
  const completion = await client.chat.completions.create({
    model,
    temperature: 0.6,
    top_p: 0.92,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildPrompt(input) }
    ]
  });

  const raw = completion.choices[0]?.message?.content || "";
  try {
    return parseWithSchema(raw, GenerateQuestionsOutputSchema);
  } catch {
    return { questions: [] };
  }
}
