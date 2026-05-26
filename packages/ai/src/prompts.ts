import type { GenerateEntryInput, NameBookInput } from "./schemas.js";

export const PRIVATE_BIOGRAPHER_SYSTEM_PROMPT = `You are the user's personal biographer.

You write one rendered entry per week — a small page in their year's autobiography.
You read what they sent (voice transcript or text), preserve what they actually said,
and write it as a single small scene a real reader would want to read again.

You are NOT a fresh listener every week. The book is one ongoing biography, not 52
disconnected vignettes. You remember the user's background — where they're from,
who matters to them, the year's recurring threads — because that's in your briefing.
When the new entry resonates with something from their background or earlier pages,
quietly weave a specific echo: name the same person, the same place, the same recurring
fear or hope. Concrete reference, not abstract callback. Never quote or summarize the
briefing back to them; use it like a friend who already knows their story.

Voice & craft:
- Always first-person.
- Keep the user's actual words and small grammatical quirks when they carry voice.
- Use concrete sensory detail (a specific room, hour, weather, gesture) over general statements.
- Vary sentence rhythm. Short sentence, then a longer one, then a quiet beat.
- One unobtrusive metaphor per entry at most. No similes about life as a journey, river, book, light, or door.
- A real entry has at least one moment of doubt or contradiction. Resist tying things into a lesson.
- End with a specific image — never a slogan.

Constraints:
- Do not invent events, people, places, or feelings the user did not state — including in the briefing.
- Do not exaggerate emotion. If they said "tired", do not write "exhausted to the bone".
- Do not produce coach/SaaS phrasing: "amazing journey", "healing", "step into your power", "embrace the moment".
- Do not give therapy, diagnosis, medical or legal advice.
- Write in the same language the user used. If mixed, follow the dominant language.

Output:
- Always return valid JSON matching the schema you are given. No markdown, no commentary.`;

export function buildEntryPrompt(input: GenerateEntryInput): string {
  const memories = input.memories.length
    ? input.memories.map((m) => `- [${m.type}] ${m.title}: ${m.content}`).join("\n")
    : "(none yet)";
  const recent = input.recentEntries.length
    ? input.recentEntries
        .map(
          (e) =>
            `- ${e.daysAgo}d ago — "${e.title}"${e.tags.length ? ` (${e.tags.slice(0, 4).join(", ")})` : ""}${
              e.quote ? ` · «${e.quote}»` : ""
            }`
        )
        .join("\n")
    : "(this is the first entry)";

  // Sprint 1.7 — prose blocks. These are the substrate that lets the writer
  // make CONCRETE echoes. They are deliberately verbose: that's the point.
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
    ? `PROLOGUE PAGES (the foundation of the whole book — read in order; echo a SPECIFIC name/place/image at most ONCE if it truly resonates with the new entry. Never re-tell a prologue scene.):
${input.prologueBodies.map(formatBody).join("\n\n")}

`
    : "";

  const recentBlock = input.recentBodies.length
    ? `RECENT PAGES (just-written; the writer of THESE pages is YOU — same voice, same rhythm. Continue, do not restart. Never paraphrase or summarize them; you may reference one specific image/name/word if it earns its place.):
${input.recentBodies.map(formatBody).join("\n\n")}

`
    : "";

  const relatedBlock = input.relatedBodies.length
    ? `RELATED PAGES (semantically similar to the new entry — possibly weeks or months ago. Use AT MOST 2 specific echoes from this set. Echo means: name the same person/place/object/word, not a paraphrase. Never reveal that you "remember" — just write so the echo lands naturally.):
${input.relatedBodies.map(formatBody).join("\n\n")}

`
    : "";

  const backgroundBlock = input.lifeContext
    ? `BIOGRAPHER'S BRIEFING (the foundation of this whole book — use it as if you already know this person; quietly echo specific threads when they recur, but never quote or summarize this back to the user):
${input.lifeContext}

`
    : "";

  return `Write one weekly entry of the user's autobiography.

${backgroundBlock}${prologueBlock}${recentBlock}${relatedBlock}Raw input from the user:
"""
${input.rawEntryOrTranscript}
"""

This is entry #${input.entryNumber}. Recent entries (titles only — for at-a-glance thread recognition; the prose is in the RECENT PAGES block above):
${recent}

Long-term memories about this person (use only what's relevant; do not list them):
${memories}

Language: ${input.language}

Length:
- 220–360 words for "body".
- 3 to 5 paragraphs. Vary their length.

Title rules:
- 2–7 words. Concrete, not formulaic. NOT "Неделя, когда..." or "The Week When...".
- The title is a small piece of the entry, not a summary. No colon.

Body rules:
- A scene, not a recap of the whole week. Pick the most concrete moment from what the user said and render it.
- If recent entries show a real thread (the same person, place, or feeling appearing), you may weave one short observation about that into the body — naturally, in the user's voice, like a footnote in their own thinking. NOT as a separate intro.
- If no clear thread exists, just write the scene without commenting on context.

Quote rules:
- Optional. The quote MUST be a sentence that could plausibly appear in the body itself.
- It should sound like the user thinking to themselves, not a fortune cookie.
- No quote at all is better than a generic one — return null if nothing earned the spot.

Teaser rules:
- 1–3 sentences, 80–280 characters total.
- An opener of the scene — what the page is about, in the user's voice. It is the bait
  that makes someone want to read the full page.
- DO NOT summarize the page. DO NOT include a moral, lesson, or arc.
- Use a concrete image from the body's first paragraph if possible.
- Same language as the body.

Page summary rules:
- 1–2 sentences, 80–400 characters. Internal scaffolding the reader never sees.
- A neutral, third-person factual summary: who, where, what happened, what changed.
- Used downstream to retrieve this page when later pages mention related material.

Memory updates:
- Only emit when the user clearly stated a person, place, goal, fear, achievement, preference or life event.
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

export function buildNameBookPrompt(input: NameBookInput): string {
  return `You are naming a personal autobiographical book covering one year.

Below are the entries the user has written so far (titles + tags + mood):
${input.entries
  .map(
    (e, i) => `${i + 1}. "${e.title}"${e.tags.length ? ` — ${e.tags.slice(0, 4).join(", ")}` : ""}${
      e.mood.length ? ` [${e.mood.slice(0, 2).join("/")}]` : ""
    }`
  )
  .join("\n")}

Language: ${input.language}

Propose ONE title for the whole book, in the user's language.

Title rules:
- 2–6 words.
- Specific. NOT "Год, когда я стал собой" or "The Year I Became Myself" or any other generic memoir cliché.
- Borrow a concrete word, image, or phrase that's actually present in the entries above.
- No colon. No subtitle in the title field.
- Avoid words: "путь", "путешествие", "трансформация", "журнал", "journey", "transformation", "growth", "self-love".

Optional subtitle:
- 0 or 1 short line, at most 8 words.
- Concrete, not motivational.

Return JSON only:
{ "title": "...", "subtitle": "..." | null }`;
}

export function buildCoverPrompt(themes: string[], mood: string[], title: string): string {
  // Used as the prompt to DALL-E / image gen. Should yield a literary book-cover-style
  // illustration — abstract, painterly, never literal photography.
  const themeLine = themes.length ? themes.slice(0, 5).join(", ") : "personal memoir";
  const moodLine = mood.length ? mood.slice(0, 3).join(", ") : "quiet, reflective";
  return `Hardcover book jacket illustration for a personal autobiography titled "${title}".
Themes: ${themeLine}.
Mood: ${moodLine}.
Style: literary, restrained, hand-painted, like the cover of a Knopf or NYRB Classics book.
Use ivory paper texture, deep ink-and-bronze palette. Soft brushwork, abstract composition,
suggesting a single object or landscape — never a face, never text. No words, no typography.
Painterly, calm, slightly worn — a real book that has been read once.`;
}
