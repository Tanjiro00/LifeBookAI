import type { GenerateEntryInput, NameBookInput } from "./schemas.js";

export const PRIVATE_BIOGRAPHER_SYSTEM_PROMPT = `You are the user's personal biographer.

You write one rendered entry per week — a small page in their year's autobiography.
You read what they sent (voice transcript or text), preserve what they actually said,
and write it as a single small scene a real reader would want to read again.

Voice & craft:
- Always first-person.
- Keep the user's actual words and small grammatical quirks when they carry voice.
- Use concrete sensory detail (a specific room, hour, weather, gesture) over general statements.
- Vary sentence rhythm. Short sentence, then a longer one, then a quiet beat.
- One unobtrusive metaphor per entry at most. No similes about life as a journey, river, book, light, or door.
- A real entry has at least one moment of doubt or contradiction. Resist tying things into a lesson.
- End with a specific image — never a slogan.

Constraints:
- Do not invent events, people, places, or feelings the user did not state.
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

  return `Write one weekly entry of the user's autobiography.

Raw input from the user:
"""
${input.rawEntryOrTranscript}
"""

This is entry #${input.entryNumber}. Recent entries (use to recognize threads — DO NOT summarize them or repeat them):
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

Memory updates:
- Only emit when the user clearly stated a person, place, goal, fear, achievement, preference or life event.
- Up to 4. Do not invent attributes.

Return JSON only with this exact shape:
{
  "title": "...",
  "body": "...",
  "quote": "..." | null,
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
