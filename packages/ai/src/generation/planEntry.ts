import { z } from "zod";
import { parseWithSchema } from "../json.js";
import { getOpenAiClient } from "../openaiClient.js";
import { PAGE_PLANNER_SYSTEM_PROMPT, buildPagePlannerPrompt } from "../prompts/pagePlannerPrompt.js";

// Sprint 2.1 — Page planner.
//
// Before the writer composes prose, the planner reads the new entry alongside
// the manuscript context (recent/related/prologue bodies, threads, memories)
// and produces a structured intent. This decouples «what does this page do in
// the book?» from «what words go in it?».
//
// Two effects: (1) the writer can ground its prose in the plan instead of
// scrambling for continuity, and (2) we persist the plan on Page.generationPlan
// for audit — so a future reviewer can see WHY the AI thought this page was an
// «echo» vs a «new_thread».

const PAGE_ROLES = [
  "new_thread",
  "continues_thread",
  "echo",
  "turning_point",
  "quiet_interlude"
] as const;

// Same lenient-coerce pattern as memory types. Unknown / camelCase / drifted
// values fall back to "continues_thread" — the most neutral role that doesn't
// promise a specific narrative move from the writer.
export const PageRoleSchema = z.preprocess((v) => {
  if (typeof v !== "string") return "continues_thread";
  const lower = v.toLowerCase().replace(/[-\s]/g, "_");
  if ((PAGE_ROLES as readonly string[]).includes(lower)) return lower;
  // Common LLM drift aliases.
  const aliases: Record<string, (typeof PAGE_ROLES)[number]> = {
    new: "new_thread",
    thread: "continues_thread",
    continuation: "continues_thread",
    continue: "continues_thread",
    callback: "echo",
    reference: "echo",
    turning: "turning_point",
    pivot: "turning_point",
    quiet: "quiet_interlude",
    interlude: "quiet_interlude",
    rest: "quiet_interlude"
  };
  return aliases[lower] ?? "continues_thread";
}, z.enum(PAGE_ROLES));
export type PageRole = z.infer<typeof PageRoleSchema>;

export const ContinuityMoveSchema = z.object({
  // pageId of the prior page being echoed. May be omitted if the move is a
  // thread reference rather than a single-page echo.
  sourcePageId: z.string().optional(),
  threadId: z.string().optional(),
  // 1-sentence description of WHAT to echo. The writer will read this and
  // weave it into prose; it should never quote.
  move: z.string().trim().min(8).max(280),
  // The biographer must NOT make echoes flagged here — even a single one is too loud.
  mustBeSubtle: z.boolean().default(true)
});
export type ContinuityMove = z.infer<typeof ContinuityMoveSchema>;

export const PlannerThreadUpdateSchema = z.object({
  threadId: z.string().optional(),
  proposedTitle: z.string().trim().min(2).max(120).optional(),
  updateReason: z.string().trim().min(8).max(280)
});
export type PlannerThreadUpdate = z.infer<typeof PlannerThreadUpdateSchema>;

// Production observation: gpt-4.1-mini occasionally invents memory types outside
// the spec ("FOOD", "RELATIONSHIP", "EXPERIENCE"). A strict z.enum throws on
// these, which used to crash the entire entry pipeline. We catch the drift in
// a preprocess and fall back to "THEME" — a safe catch-all that doesn't lose
// the memory candidate. The candidate is still emitted, just gets the
// generic bucket.
const MEMORY_TYPES = [
  "PERSON",
  "PLACE",
  "THEME",
  "LIFE_EVENT",
  "GOAL",
  "FEAR",
  "ACHIEVEMENT",
  "PREFERENCE"
] as const;

const LenientMemoryType = z.preprocess((v) => {
  if (typeof v !== "string") return "THEME";
  const upper = v.toUpperCase();
  // Direct match.
  if ((MEMORY_TYPES as readonly string[]).includes(upper)) return upper;
  // Common LLM aliases → canonical bucket.
  const aliases: Record<string, (typeof MEMORY_TYPES)[number]> = {
    PEOPLE: "PERSON",
    RELATIONSHIP: "PERSON",
    FRIEND: "PERSON",
    FAMILY: "PERSON",
    LOCATION: "PLACE",
    CITY: "PLACE",
    ADDRESS: "PLACE",
    EXPERIENCE: "LIFE_EVENT",
    EVENT: "LIFE_EVENT",
    MEMORY: "LIFE_EVENT",
    HOBBY: "PREFERENCE",
    HABIT: "PREFERENCE",
    TASTE: "PREFERENCE",
    FOOD: "PREFERENCE",
    DREAM: "GOAL",
    PLAN: "GOAL",
    AMBITION: "GOAL",
    WORRY: "FEAR",
    LOSS: "FEAR"
  };
  return aliases[upper] ?? "THEME";
}, z.enum(MEMORY_TYPES));

export const PlannerMemoryCandidateSchema = z.object({
  type: LenientMemoryType,
  name: z.string().trim().min(2).max(120),
  evidence: z.string().trim().min(8).max(400)
});
export type PlannerMemoryCandidate = z.infer<typeof PlannerMemoryCandidateSchema>;

export const EntryPlanSchema = z.object({
  pageRole: PageRoleSchema,
  // 1-sentence description of the central scene. The writer will *render* this,
  // not the user's full input.
  centralScene: z.string().trim().min(8).max(400),
  // Hard constraints derived from the user's input. The writer must respect these
  // verbatim (names spelled as the user spelled them, places they actually said).
  factualBoundaries: z.array(z.string().trim().min(2).max(280)).max(8).default([]),
  continuityMoves: z.array(ContinuityMoveSchema).max(3).default([]),
  threadsToUpdate: z.array(PlannerThreadUpdateSchema).max(3).default([]),
  memoriesToCreateOrMerge: z.array(PlannerMemoryCandidateSchema).max(4).default([]),
  styleNotes: z.array(z.string().trim().min(4).max(200)).max(4).default([]),
  // Things the planner is worried about: invented dialogue risk, sensitive content,
  // material too thin to render. The writer is told to flag these in its output.
  riskFlags: z.array(z.string().trim().min(4).max(200)).max(4).default([])
});
export type EntryPlan = z.infer<typeof EntryPlanSchema>;

export type PlanEntryInput = {
  language: "ru" | "en";
  rawEntryOrTranscript: string;
  entryNumber: number;
  recentBodies: Array<{ pageId?: string; title: string; body: string; daysAgo: number }>;
  prologueBodies: Array<{ pageId?: string; title: string; body: string; daysAgo: number }>;
  relatedBodies: Array<{
    pageId?: string;
    title: string;
    body: string;
    daysAgo: number;
    similarity?: number | undefined;
  }>;
  memories: Array<{ type: string; title: string; content: string }>;
  narrativeThreads: Array<{ threadId: string; title: string; summary: string }>;
  lifeContext?: string | null;
  writingStyle?: string | null;
  styleSample?: string | null;
};

// When the LLM returns truly unparseable JSON twice in a row, we emit a
// structurally-minimal plan derived from the user's input. This is NOT mock
// content — it adds no prose, invents no continuity moves, proposes no
// memories. It only gives the writer a valid skeleton with the user's own
// words quoted in centralScene. The writer then writes from the user's raw
// text alone, as if the planner had not run at all.
function minimalStructuralPlan(input: PlanEntryInput): EntryPlan {
  // centralScene has a 400-char cap and an 8-char floor; the user's input is
  // already validated to ≥ 10 chars at Entry.ingest time.
  const sceneFromInput = input.rawEntryOrTranscript.slice(0, 380);
  return {
    pageRole: "continues_thread",
    centralScene: sceneFromInput,
    factualBoundaries: [],
    continuityMoves: [],
    threadsToUpdate: [],
    memoriesToCreateOrMerge: [],
    styleNotes:
      input.writingStyle && input.writingStyle.length > 0
        ? [`Voice: ${input.writingStyle}`]
        : [],
    // Surface the degradation in audit trails so we can monitor planner
    // failure rates in production.
    riskFlags: ["planner_unavailable_minimal_plan_used"]
  };
}

export async function planEntry(input: PlanEntryInput): Promise<EntryPlan> {
  const client = getOpenAiClient();
  const model = process.env.OPENAI_PLANNER_MODEL || "gpt-4.1-mini";

  const prompt = buildPagePlannerPrompt(input);

  // Two-attempt loop: if the first parse fails (schema drift, malformed JSON,
  // etc.), retry once with an explicit corrective hint. Temperature is also
  // tightened on retry to reduce variance. If retry still fails — fallback to
  // the mock plan derived from the user's input. The page goes through.
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const completion = await client.chat.completions.create({
        model,
        temperature: attempt === 1 ? 0.3 : 0.1,
        top_p: 0.9,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: PAGE_PLANNER_SYSTEM_PROMPT },
          {
            role: "user",
            content:
              attempt === 1
                ? prompt
                : `${prompt}\n\nThe previous response failed schema validation. Return ONLY the JSON object specified above. \`memoriesToCreateOrMerge[i].type\` MUST be one of: PERSON, PLACE, THEME, LIFE_EVENT, GOAL, FEAR, ACHIEVEMENT, PREFERENCE — NO other values.`
          }
        ]
      });
      const raw = completion.choices[0]?.message?.content || "";
      return parseWithSchema(raw, EntryPlanSchema);
    } catch (err) {
      lastError = err;
      // Loop and try once more with a stricter hint.
    }
  }
  // Both attempts failed — emit a structured warning and degrade to the
  // minimal structural plan (NO mock prose; just the user's own input wrapped
  // in a valid EntryPlan skeleton). The writer then composes the page from
  // the raw text as if the planner had not run.
  // eslint-disable-next-line no-console
  console.warn(
    `[planEntry] schema validation failed twice, using minimal structural plan. last error: ${(lastError as Error)?.message ?? lastError}`
  );
  return minimalStructuralPlan(input);
}
