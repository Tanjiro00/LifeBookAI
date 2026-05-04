import type { ChapterOutput, ClarifyingQuestionsOutput, GenerateChapterInput, GenerateClarifyingQuestionsInput, StyleAdjustment } from "./schemas.js";

const CYRILLIC_RE = /[а-яё]/i;

export function detectLanguage(text: string): "ru" | "en" {
  return CYRILLIC_RE.test(text) ? "ru" : "en";
}

function firstMeaningfulFragment(text: string): string {
  const cleaned = text
    .replace(/\s+/g, " ")
    .split(/[.!?\n]/)
    .map((part) => part.trim())
    .find((part) => part.length >= 12);

  return cleaned?.slice(0, 90) || text.replace(/\s+/g, " ").slice(0, 90);
}

export function mockClarifyingQuestions(input: GenerateClarifyingQuestionsInput): ClarifyingQuestionsOutput {
  const language = input.language || detectLanguage(input.rawEntryOrTranscript);
  const fragment = firstMeaningfulFragment(input.rawEntryOrTranscript);

  if (language.startsWith("en")) {
    return {
      questions: [
        {
          question: `You mentioned "${fragment}". What made that moment feel important?`,
          reason: "Finds the emotional center without becoming generic."
        },
        {
          question: "Who was closest to this story this week, even if they appeared only briefly?",
          reason: "Adds concrete people and relational texture."
        },
        {
          question: "What small detail from this week would you want to remember years from now?",
          reason: "Turns the entry into a specific scene."
        }
      ]
    };
  }

  return {
    questions: [
      {
        question: `Ты упомянул(а): «${fragment}». Что в этом моменте оказалось для тебя самым важным?`,
        reason: "Помогает найти эмоциональный центр недели."
      },
      {
        question: "Кто был рядом с этой историей на этой неделе, даже если появился ненадолго?",
        reason: "Добавляет конкретику и человеческий контекст."
      },
      {
        question: "Какую маленькую деталь этой недели ты хотел(а) бы вспомнить через несколько лет?",
        reason: "Превращает пересказ в живую сцену."
      }
    ]
  };
}

export function mockChapter(input: GenerateChapterInput): ChapterOutput {
  const language = input.language || detectLanguage(input.rawEntryOrTranscript);
  const raw = input.rawEntryOrTranscript.trim();
  const answers = input.answers?.trim();

  if (language.startsWith("en")) {
    const content = [
      "This week did not arrive as a finished story. It came in ordinary pieces: tasks, pauses, conversations, fatigue, and small signs that something inside me was paying attention.",
      `What I remember first is this: ${raw}`,
      answers
        ? `When I tried to answer the follow-up questions, the week became clearer. ${answers}`
        : "Even without perfect answers, there was enough here to see the shape of the week: not a grand turning point, but a real one.",
      "If I write it honestly, the important part is not that everything changed. The important part is that I noticed what mattered while it was still happening. That is the kind of memory I usually lose first, and the kind I want this book to keep."
    ].join("\n\n");

    return {
      title: "The Week I Started Paying Attention",
      subtitle: "A quiet record of what mattered",
      summary: "A week of ordinary events that became meaningful through attention and reflection.",
      content,
      quote: "Some weeks matter because they teach me what I do not want to forget.",
      mood: ["reflective", "honest"],
      tags: ["weekly-life", "reflection"],
      people: [],
      places: [],
      keyEvents: [firstMeaningfulFragment(raw)],
      memoryUpdates: []
    };
  }

  const content = [
    "Эта неделя не сложилась сразу в готовую историю. Она была собрана из обычных вещей: дел, пауз, разговоров, усталости и маленьких признаков того, что внутри меня что-то меняется или, по крайней мере, просит внимания.",
    `Первым я хочу сохранить вот это: ${raw}`,
    answers
      ? `Когда я ответил(а) на уточняющие вопросы, неделя стала виднее. ${answers}`
      : "Даже без подробных ответов в этой неделе уже есть форма: не большой перелом, а честный след прожитого времени.",
    "Если записывать это без лишней красивости, важным оказалось не то, что всё изменилось. Важным оказалось то, что я заметил(а), что именно мне хочется не потерять. Обычно такие детали исчезают первыми, а здесь они остаются на странице."
  ].join("\n\n");

  return {
    title: "Неделя, которую я начал(а) замечать",
    subtitle: "О тихих деталях, которые оказались важными",
    summary: "Неделя обычных событий, в которой появился личный смысл и желание сохранить детали.",
    content,
    quote: "Иногда неделя становится важной не потому, что всё изменилось, а потому, что я успел(а) её заметить.",
    mood: ["reflective", "honest"],
    tags: ["week", "memory"],
    people: [],
    places: [],
    keyEvents: [firstMeaningfulFragment(raw)],
    memoryUpdates: []
  };
}

export function mockAdjustedChapter(chapter: ChapterOutput, adjustment: StyleAdjustment): ChapterOutput {
  if (adjustment === "shorter") {
    const paragraphs = chapter.content.split(/\n{2,}/).slice(0, 3);
    return {
      ...chapter,
      content: paragraphs.join("\n\n"),
      summary: chapter.summary ? `${chapter.summary} Короткая версия.` : "Короткая версия главы."
    };
  }

  if (adjustment === "less_dramatic" || adjustment === "more_like_me") {
    return {
      ...chapter,
      title: chapter.title.replace("начал(а)", "стал(а)"),
      content: chapter.content
        .replaceAll("Важным оказалось", "Запомнилось")
        .replaceAll("без лишней красивости", "простыми словами")
        .replaceAll("становится важной", "остаётся в памяти"),
      quote: chapter.quote?.replace("становится важной", "остаётся в памяти")
    };
  }

  if (adjustment === "more_literary") {
    return {
      ...chapter,
      subtitle: chapter.subtitle || "Страница из личной книги",
      content: `${chapter.content}\n\nИ теперь эта неделя лежит не где-то в шуме дней, а здесь: на странице, где у неё наконец появилось место.`
    };
  }

  return chapter;
}
