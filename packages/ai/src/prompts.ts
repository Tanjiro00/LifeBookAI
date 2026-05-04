import type { AdjustChapterInput, GenerateChapterInput, GenerateClarifyingQuestionsInput } from "./schemas.js";

export const PRIVATE_BIOGRAPHER_SYSTEM_PROMPT = `You are a private AI biographer.

Your job is to help the user turn weekly life updates into a meaningful, honest, beautifully written autobiography.

Rules:
- Preserve the user's voice.
- Do not invent events.
- Do not exaggerate emotions.
- Do not sound like a motivational coach.
- Do not sound like generic AI writing.
- Ask clarifying questions when needed.
- Write with warmth, clarity, and emotional honesty.
- Keep the text realistic and specific.
- Never diagnose the user.
- Never provide therapy or medical advice.
- The final chapter should feel like a page from a real life book.`;

export function buildClarifyingQuestionsPrompt(input: GenerateClarifyingQuestionsInput): string {
  return `The user wrote or recorded the following weekly life update:

${input.rawEntryOrTranscript}

User settings:
- Writing goal: ${input.writingGoal || "not specified"}
- Preferred style: ${input.writingStyle || "honest and simple"}
- Language: ${input.language}

Generate 2 to 4 thoughtful clarifying questions that will help write a better autobiographical chapter.

The questions should uncover:
- emotional meaning;
- key people;
- turning points;
- concrete details;
- what changed;
- what the user wants to remember later.

Rules:
- Questions must be specific to the user's update.
- Do not ask generic journaling questions.
- Do not sound clinical.
- Keep questions warm and short.
- Return JSON only.

Expected JSON:
{
  "questions": [
    {
      "question": "...",
      "reason": "..."
    }
  ]
}`;
}

export function buildChapterPrompt(input: GenerateChapterInput): string {
  const memories = input.memories.length
    ? input.memories.map((memory) => `- ${memory.type}: ${memory.title} — ${memory.content}`).join("\n")
    : "No saved memories yet.";

  return `Write an autobiographical chapter based on the user's weekly update and answers.

Raw weekly update:
${input.rawEntryOrTranscript}

Clarifying answers:
${input.answers || "No clarifying answers provided."}

Relevant memories:
${memories}

User settings:
- Language: ${input.language}
- Writing goal: ${input.writingGoal || "not specified"}
- Preferred style: ${input.writingStyle || "honest and simple"}

Output:
- title
- subtitle
- summary
- chapter content
- quote
- mood
- tags
- people
- places
- key events
- memory updates

Writing rules:
- Do not invent facts.
- Use first person.
- Preserve the user's voice.
- Avoid clichés.
- Avoid generic motivational language.
- Avoid exaggerated drama.
- Be specific and human.
- The chapter should feel like a beautiful page from a real autobiography.
- If the user wrote in Russian, write in Russian.
- If the user wrote in English, write in English.

Return valid JSON only with this shape:
{
  "title": "...",
  "subtitle": "...",
  "summary": "...",
  "content": "...",
  "quote": "...",
  "mood": ["..."],
  "tags": ["..."],
  "people": ["..."],
  "places": ["..."],
  "keyEvents": ["..."],
  "memoryUpdates": [
    {"type": "GOAL", "title": "...", "content": "...", "confidence": 0.7}
  ]
}`;
}

export function buildStyleAdjustmentPrompt(input: AdjustChapterInput): string {
  const requestByKind: Record<string, string> = {
    less_dramatic: "Make the chapter quieter, simpler, and less dramatic.",
    shorter: "Make the chapter shorter while preserving the important facts and emotional center.",
    more_literary: "Make the chapter more literary, with stronger rhythm and imagery, but without inventing facts.",
    more_like_me: "Make the chapter more natural, less polished, and closer to the user's likely voice.",
    regenerate: "Regenerate the chapter from the same facts with a fresh structure and title."
  };

  return `Rewrite the chapter according to the user's requested adjustment.

Original chapter JSON:
${JSON.stringify(input.chapter, null, 2)}

Raw weekly update:
${input.rawEntryOrTranscript}

Clarifying answers:
${input.answers || "No clarifying answers provided."}

User request:
${requestByKind[input.styleAdjustment]}

Rules:
- Preserve all facts.
- Do not add new events.
- Keep the structure if possible.
- Make the text sound more natural and personal.
- Same language as the original chapter.
- Return updated JSON with the same schema.`;
}

