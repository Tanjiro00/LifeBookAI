import type { PlanEntryInput } from "../generation/planEntry.js";

// Sprint 2.1 — system + user prompts for the page planner. The planner does NOT
// write prose; it produces a structured intent the writer will execute.

export const PAGE_PLANNER_SYSTEM_PROMPT = `You are the planning editor for a living autobiographical manuscript.

Your job is NOT to write prose. Your job is to decide how the new material belongs in the existing book.

Decide:
- pageRole: new_thread | continues_thread | echo | turning_point | quiet_interlude
  (use turning_point sparingly — only when the user clearly marks a pivot)
- centralScene: ONE sentence naming the scene the writer must render
- factualBoundaries: explicit names/places/dates the writer MUST preserve verbatim
- continuityMoves: at most 3 specific echoes to PRIOR pages or threads.
  Echo means "the writer can name the same person/place/object/word", not "summarize".
  Prefer ONE precise echo over many vague ones.
- threadsToUpdate: which existing threads (or proposed new ones) this page advances
- memoriesToCreateOrMerge: people/places/themes/etc. mentioned in the input.
  Each entry's "type" field MUST be EXACTLY one of (case-sensitive, no aliases):
    PERSON, PLACE, THEME, LIFE_EVENT, GOAL, FEAR, ACHIEVEMENT, PREFERENCE
  Examples: a city → PLACE, a dish/cuisine → PREFERENCE, a one-time event → LIFE_EVENT,
  a recurring abstract topic → THEME. NEVER invent type values like "FOOD" or
  "EXPERIENCE" — pick the closest of the 8 allowed strings.
- styleNotes: tonal nudges for the writer (1-2 lines max)
- riskFlags: invented-dialogue risk, sensitive content, material too thin

Rules:
- Never invent facts. Only use what the user wrote or what's already in the manuscript.
- If no prior context is genuinely relevant, mark it as new_thread or quiet_interlude with no continuityMoves.
- Be terse. The writer reads this as instructions, not literature.
- Return only valid JSON matching the schema.
- pageRole MUST be one of the 5 enum values verbatim — no aliases, no camelCase.`;

export function buildPagePlannerPrompt(input: PlanEntryInput): string {
  const fmtBody = (b: { title: string; body: string; daysAgo: number; similarity?: number | undefined; pageId?: string }) => {
    const sim = b.similarity !== undefined ? ` (similarity ${b.similarity.toFixed(2)})` : "";
    const id = b.pageId ? ` id=${b.pageId}` : "";
    const trimmed = b.body.length > 1500 ? b.body.slice(0, 1500) + "…" : b.body;
    return `--- ${b.daysAgo}d ago${id}${sim} — "${b.title}" ---\n${trimmed}`;
  };

  const prologue = input.prologueBodies.length
    ? input.prologueBodies.map(fmtBody).join("\n\n")
    : "(none)";
  const recent = input.recentBodies.length
    ? input.recentBodies.map(fmtBody).join("\n\n")
    : "(none)";
  const related = input.relatedBodies.length
    ? input.relatedBodies.map(fmtBody).join("\n\n")
    : "(none)";

  const memories = input.memories.length
    ? input.memories.map((m) => `- [${m.type}] ${m.title}: ${m.content}`).join("\n")
    : "(none)";
  const threads = input.narrativeThreads.length
    ? input.narrativeThreads
        .map((t) => `- ${t.threadId}: "${t.title}" — ${t.summary}`)
        .join("\n")
    : "(none)";

  const lifeCtx = input.lifeContext
    ? `BIOGRAPHER'S BRIEFING (foundation):\n${input.lifeContext}\n\n`
    : "";
  const styleLine = input.writingStyle ? `Voice: ${input.writingStyle}\n` : "";

  return `${lifeCtx}${styleLine}Language: ${input.language}
Entry number in the book: ${input.entryNumber}

NEW USER INPUT:
"""
${input.rawEntryOrTranscript}
"""

PROLOGUE PAGES:
${prologue}

RECENT PAGES (the just-written current pages — same writer, same voice):
${recent}

RELATED PAGES (semantically similar from anywhere in the corpus):
${related}

ACTIVE NARRATIVE THREADS:
${threads}

LONG-TERM MEMORIES:
${memories}

Return JSON only with this exact shape:
{
  "pageRole": "new_thread" | "continues_thread" | "echo" | "turning_point" | "quiet_interlude",
  "centralScene": "...",
  "factualBoundaries": ["..."],
  "continuityMoves": [
    { "sourcePageId": "...", "threadId": "...", "move": "...", "mustBeSubtle": true }
  ],
  "threadsToUpdate": [
    { "threadId": "...", "proposedTitle": "...", "updateReason": "..." }
  ],
  "memoriesToCreateOrMerge": [
    { "type": "PERSON", "name": "...", "evidence": "..." }
  ],
  "styleNotes": ["..."],
  "riskFlags": ["..."]
}`;
}
