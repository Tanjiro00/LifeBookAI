import type { GenerateEntryInput } from "../schemas.js";
import type { EntryPlan } from "../generation/planEntry.js";

// Sprint 2.2 — Writer prompts.
//
// The system prompt is a tightened, more opinionated version of the legacy
// PRIVATE_BIOGRAPHER_SYSTEM_PROMPT. The user prompt now opens with the plan so
// the writer's first task is "execute the plan" rather than "improvise from
// scratch".

export const PAGE_WRITER_SYSTEM_PROMPT = `You are writing one page of a living autobiographical book.

You are not a fresh listener. You receive a PLAN written by your editor, plus the
prose of selected prior pages. Use them only when they truly resonate. Make
continuity SUBTLE — name the same person/place/object/word ONCE if it earns the
spot; never paraphrase or summarise prior pages.

Do:
- write in the user's language;
- preserve every fact in factualBoundaries verbatim;
- keep concrete sensory details from the user's input (a specific room, hour,
  weather, gesture, the actual words someone said);
- vary sentence rhythm. Short sentence, then a longer one, then a quiet beat;
- keep paragraphs (no walls of text);
- end with a specific image, never a slogan;
- respect the plan's pageRole — a quiet_interlude is short and small, a
  turning_point gets more room, an echo names ONE specific thing from a prior page.

Do not:
- summarise like a therapist or list a "lesson learned";
- over-explain emotions; if the user said "tired", do not write "exhausted to the bone";
- invent dialogue, people, places, or feelings the user did not state;
- mention that you used context or that you "remember" anything;
- turn an ordinary week into a climax;
- use "journey", "transformation", "growth", "self-love", "amazing journey",
  "step into your power", "embrace the moment", or similar SaaS-speak.

Output: JSON exactly matching the schema you are given. No markdown, no commentary.`;

type WriterPromptInput = GenerateEntryInput & { plan: EntryPlan; language: string };

export function buildPageWriterPrompt(input: WriterPromptInput): string {
  const memories = input.memories.length
    ? input.memories.map((m) => `- [${m.type}] ${m.title}: ${m.content}`).join("\n")
    : "(none yet)";

  const recentLine = input.recentEntries.length
    ? input.recentEntries
        .map(
          (e) =>
            `- ${e.daysAgo}d ago — "${e.title}"${e.tags.length ? ` (${e.tags.slice(0, 4).join(", ")})` : ""}${
              e.quote ? ` · «${e.quote}»` : ""
            }`
        )
        .join("\n")
    : "(this is the first entry)";

  type BodyForPrompt = {
    title: string;
    body: string;
    daysAgo: number;
    tags: string[];
    similarity?: number | undefined;
  };
  const formatBody = (b: BodyForPrompt) => {
    const sim = b.similarity !== undefined ? ` (similarity ${b.similarity.toFixed(2)})` : "";
    const tags = b.tags.length ? ` [${b.tags.slice(0, 4).join(", ")}]` : "";
    return `--- ${b.daysAgo}d ago — "${b.title}"${tags}${sim} ---\n${b.body.trim()}`;
  };

  const prologueBlock = input.prologueBodies.length
    ? `PROLOGUE PAGES (foundation):\n${input.prologueBodies.map(formatBody).join("\n\n")}\n\n`
    : "";
  const recentBlock = input.recentBodies.length
    ? `RECENT PAGES (same writer, same voice — continue, do not restart):\n${input.recentBodies.map(formatBody).join("\n\n")}\n\n`
    : "";
  const relatedBlock = input.relatedBodies.length
    ? `RELATED PAGES (semantic neighbours — echo at most what the plan asks for):\n${input.relatedBodies.map(formatBody).join("\n\n")}\n\n`
    : "";
  const backgroundBlock = input.lifeContext
    ? `BIOGRAPHER'S BRIEFING:\n${input.lifeContext}\n\n`
    : "";

  // The plan is rendered last in the static section so cache hits work for
  // common static prefixes; specific plan content is per-request anyway.
  const plan = input.plan;
  const planBlock = `EDITOR'S PLAN — execute this:
- pageRole: ${plan.pageRole}
- centralScene: ${plan.centralScene}
${plan.factualBoundaries.length ? `- factualBoundaries (preserve verbatim):\n  ${plan.factualBoundaries.map((s) => `· ${s}`).join("\n  ")}\n` : ""}${
    plan.continuityMoves.length
      ? `- continuityMoves (perform exactly these, no more):\n  ${plan.continuityMoves
          .map(
            (m) =>
              `· ${m.move}${m.sourcePageId ? ` [ref:${m.sourcePageId}]` : ""}${m.mustBeSubtle ? " [subtle]" : ""}`
          )
          .join("\n  ")}\n`
      : ""
  }${plan.styleNotes.length ? `- styleNotes:\n  ${plan.styleNotes.map((s) => `· ${s}`).join("\n  ")}\n` : ""}${
    plan.riskFlags.length ? `- riskFlags (handle gently):\n  ${plan.riskFlags.map((s) => `· ${s}`).join("\n  ")}\n` : ""
  }`;

  return `Write one page of the user's autobiography.

${backgroundBlock}${prologueBlock}${recentBlock}${relatedBlock}${planBlock}

Raw input from the user:
"""
${input.rawEntryOrTranscript}
"""

This is entry #${input.entryNumber}. Recent entry titles (for at-a-glance thread recognition):
${recentLine}

Long-term memories about this person (use only what's relevant; do not list them):
${memories}

Language: ${input.language}

Length:
- pageRole=quiet_interlude → 120-220 words. Short, small.
- pageRole=turning_point  → 250-450 words IF the user gave material; otherwise 220-360.
- otherwise               → 200-360 words.
- 3-5 paragraphs. Vary their length.

Title rules:
- 2-7 words. Concrete, not formulaic. NOT "Неделя, когда..." / "The Week When...".
- The title is a small piece of the entry, not a summary. No colon.

Body rules:
- A scene, not a recap of the whole week. Render the centralScene the plan named.
- Make ONLY the continuity moves the plan listed. Each move = one specific
  echo (a name, a place, a word) — never a paraphrase.
- If the plan listed 0 continuityMoves, write the page WITHOUT cross-references.
- Keep paragraph breaks intact in the output JSON: use literal \\n\\n.

Quote rules:
- Optional. Must be a sentence that could plausibly appear in the body itself.
- Sounds like the user thinking to themselves, not a fortune cookie.
- Null is better than generic.

Teaser rules:
- 1–3 sentences, 80–280 chars. Opening of the scene, in the user's voice. NOT a moral.

Page summary rules:
- 1–2 sentences, 80–400 chars. Internal scaffolding (third-person factual).

Memory updates:
- Only emit when the user clearly stated a person/place/goal/fear/achievement/preference/life-event.
- Up to 4. Do not invent attributes.

Return JSON only with this exact shape:
{
  "title": "...",
  "body": "...",
  "quote": "..." | null,
  "teaser": "...",
  "pageSummary": "...",
  "mood": ["lowercase short tags, max 3"],
  "tags": ["lowercase, max 4"],
  "memoryUpdates": [
    { "type": "GOAL", "title": "...", "content": "...", "confidence": 0.7 }
  ]
}`;
}
