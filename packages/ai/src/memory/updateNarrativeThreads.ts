import { z } from "zod";
import { parseWithSchema } from "../json.js";
import { getOpenAiClient } from "../openaiClient.js";

// Sprint 3.5 — NarrativeThread updater (LLM half).
//
// The planner (Sprint 2.1) flagged threadsToUpdate; the writer rendered prose;
// now we ask a separate LLM call to write the «what changed in this thread»
// summary plus an updated rolling thread summary. Lives here in @lifebook/ai
// so both the runtime job (Sprint 3.6) and offline tools can use it.

export const ThreadUpdateInputSchema = z.object({
  language: z.enum(["ru", "en"]).default("ru"),
  // The thread we're updating, OR null for a new thread.
  thread: z
    .object({
      id: z.string(),
      title: z.string(),
      type: z.string(),
      summary: z.string(),
      tension: z.string().nullable().optional(),
      lastMovement: z.string().nullable().optional()
    })
    .nullable(),
  // The Page that just landed and the EntryPlan's reason for marking this
  // thread to update.
  pageBody: z.string().trim().min(20),
  pageTitle: z.string(),
  pageSummary: z.string().nullable().optional(),
  updateReason: z.string().trim().min(4),
  // For new threads, the planner's proposed title. Optional; the model can
  // override.
  proposedTitle: z.string().optional(),
  proposedType: z.string().optional()
});
export type ThreadUpdateInput = z.infer<typeof ThreadUpdateInputSchema>;

export const ThreadUpdateOutputSchema = z.object({
  // Updated rolling summary (200–600 chars). Preserves prior arc; appends or
  // re-frames in light of the new movement.
  newSummary: z.string().trim().min(40).max(2000),
  // What actually moved in the new page (1 short sentence).
  lastMovement: z.string().trim().min(8).max(280),
  // Optional refresh of the unresolved tension.
  tension: z.string().trim().min(0).max(280).nullable().default(null),
  // For NEW threads only — the model picks a final title and type.
  title: z.string().trim().min(2).max(120).optional(),
  type: z
    .enum([
      "PERSON",
      "RELATIONSHIP",
      "PLACE",
      "THEME",
      "GOAL",
      "FEAR",
      "IDENTITY",
      "WORK",
      "HEALTH",
      "FAMILY"
    ])
    .optional(),
  // Status the thread should land on after this update.
  status: z.enum(["ACTIVE", "DORMANT", "RESOLVED"]).default("ACTIVE")
});
export type ThreadUpdateOutput = z.infer<typeof ThreadUpdateOutputSchema>;

const SYSTEM_PROMPT = `You maintain a narrative thread inside a living autobiographical book.

A thread is NOT a fact. It's an unfolding line: a relationship, a project, a fear,
a question. It evolves week by week.

When given a new page that touches this thread, you produce:
- newSummary: an updated rolling summary (200-600 chars) that PRESERVES the arc
  and adds the latest movement. Do not erase prior context.
- lastMovement: ONE short sentence describing what changed in this latest page.
- tension: optionally update the unresolved tension. null when nothing is unresolved.
- status: ACTIVE if the thread continues, DORMANT if it's quiet for a while,
  RESOLVED if the user clearly closed it.

For NEW threads (thread input is null), you also pick a final title and type.

Rules:
- Stay in the user's language.
- Never invent: only use facts visible in the page or the prior summary.
- summary is third-person prose about the user. Not bullet lists, not advice.
- Return only valid JSON.`;

export async function updateNarrativeThread(unsafe: ThreadUpdateInput): Promise<ThreadUpdateOutput> {
  const input = ThreadUpdateInputSchema.parse(unsafe);

  const client = getOpenAiClient();
  const model = process.env.OPENAI_PLANNER_MODEL || "gpt-4.1-mini";

  const threadBlock = input.thread
    ? `EXISTING THREAD:
- id: ${input.thread.id}
- title: ${input.thread.title}
- type: ${input.thread.type}
- summary: """${input.thread.summary}"""
- tension: ${input.thread.tension ?? "(none)"}
- lastMovement: ${input.thread.lastMovement ?? "(none)"}`
    : `NEW THREAD (no prior state):
- proposedTitle: ${input.proposedTitle ?? "(none)"}
- proposedType:  ${input.proposedType ?? "(none)"}`;

  const userPrompt = `Language: ${input.language}

${threadBlock}

NEW PAGE that touches this thread:
- title: ${input.pageTitle}
- summary: ${input.pageSummary ?? "(none)"}
- body:
"""
${input.pageBody.slice(0, 4000)}
"""

PLANNER'S REASON for updating this thread:
"${input.updateReason}"

Return JSON only with this exact shape:
{
  "newSummary": "...",
  "lastMovement": "...",
  "tension": "..." | null,
  "title": "...",         // only when this is a NEW thread; otherwise omit
  "type":  "THEME",       // only when this is a NEW thread; otherwise omit
  "status": "ACTIVE" | "DORMANT" | "RESOLVED"
}`;

  const completion = await client.chat.completions.create({
    model,
    temperature: 0.3,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt }
    ]
  });
  const raw = completion.choices[0]?.message?.content || "";
  return parseWithSchema(raw, ThreadUpdateOutputSchema);
}
