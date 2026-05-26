# LifeBookAI — план реализации продукта «AI-биограф»

**Версия:** 1.0  
**Дата:** 2026-05-09  
**Назначение документа:** превратить текущий аудит продукта в практическую спецификацию реализации: что строить, в каком порядке, какие сущности добавить, как должен работать AI-пайплайн, как доставлять результат пользователю и как понять, что продукт наконец ощущается как автобиографическая книга, а не как набор еженедельных виньеток.

---

## 0. Главный вывод

LifeBookAI нельзя чинить как «бот, который лучше пишет страницы». Его нужно реализовывать как **систему управления живой рукописью**.

Текущая проблема не в одном промпте и не в одной модели. Продукт обещает автобиографию, но архитектурно хранит и подаёт модели контекст как набор коротких фактов, тегов и заголовков. В результате модель не может продолжать книгу: она каждую неделю пишет почти с нуля.

Новая архитектура должна строиться вокруг четырёх принципов:

1. **Manuscript-first:** главным источником истины является полный текст рукописи: пролог, страницы, главы, правки, ретроспективные воспоминания.
2. **Context retrieval before writing:** перед каждой генерацией система достаёт релевантные прошлые сцены, активные сюжетные нити, персонажей, места и стиль.
3. **Plan → write → revise:** модель не должна сразу писать финальную страницу; сначала она планирует связь новой сцены с книгой, затем пишет, затем проходит проверку на правдивость, стиль и связность.
4. **Readable delivery:** PNG-карточка — это обложка/тизер, а не основной носитель текста. Основное чтение должно быть в чате и web-книге.

---

## 1. Каким должен быть продукт

### 1.1. Новое позиционирование

Старое фактическое позиционирование:

> «Раз в неделю пришли событие, бот напишет красивую страницу».

Правильное позиционирование:

> **«Ты рассказываешь моменты. LifeBookAI собирает из них живую книгу: помнит людей, возвращает темы, строит главы, помогает редактировать и в конце превращает год в настоящую рукопись».**

Это важно, потому что ценность продукта не в отдельной странице. Отдельную страницу пользователь может получить из любого чат-бота. Ценность — в накоплении, памяти, редактуре и ощущении, что книга становится глубже с каждой неделей.

### 1.2. Основные пользовательские циклы

#### Цикл 1. Еженедельная / свободная страница

```text
Пользователь присылает текст или голос
  -> если голос: бот показывает транскрипт и просит подтвердить
  -> AI смотрит рукопись и задаёт 0-2 конкретных уточнения
  -> AI строит narrative plan
  -> AI пишет страницу
  -> бот отправляет полный текст + poster-card
  -> пользователь правит точечно
  -> бот показывает, что запомнил
  -> система обновляет embeddings, memories, narrative threads
```

#### Цикл 2. Рукопись

```text
Каждые 4-6 страниц
  -> AI группирует страницы в главу
  -> пишет intro главы
  -> предлагает название главы
  -> web-книга и PDF перестраиваются вокруг глав, а не месяцев
```

#### Цикл 3. Ретроспективная память

```text
Пользователь нажимает «Вспомнить прошлое»
  -> бот спрашивает период
  -> пользователь рассказывает сцену из прошлого
  -> AI пишет retrospective page
  -> страница попадает в хронологию книги по времени события, а не по дате создания
```

#### Цикл 4. Голос книги

```text
Онбординг
  -> пользователь выбирает стиль по примерам, а не абстрактным словам
  -> система сохраняет styleSample
Каждые 5 страниц
  -> style auditor проверяет дрейф
  -> обновляет recalibrationNote
```

---

## 2. MVP: что нужно реализовать первым

Ниже — не список «всего хорошего», а минимальный набор, без которого продукт не станет книгой.

### P0 — обязательно для первого сильного релиза

| Приоритет | Что сделать | Зачем |
|---|---|---|
| P0.1 | Отправлять полный текст страницы отдельным Telegram-сообщением | Убрать главный UX-барьер: пользователь должен читать страницу без открытия картинки |
| P0.2 | Переделать PNG-карточку в poster-card | Карточка должна быть красивым тизером, а не мелким и обрезанным носителем прозы |
| P0.3 | Добавить `recentBodies`: полные тела 2 последних страниц + пролог | Мгновенно дать модели фактуру и голос прошлых страниц |
| P0.4 | Добавить `PageEmbedding` и semantic retrieval top-3/top-5 страниц | Чтобы модель находила не только последние, но и смыслово связанные сцены |
| P0.5 | Ввести `NarrativeThread` | Чтобы отношения, темы, страхи, цели и поворотные точки развивались как арки |
| P0.6 | Ввести two-pass generation: `planEntry` -> `writePage` | Чтобы каждая страница сначала понимала своё место в книге |
| P0.7 | Добавить точечное редактирование страницы | Пользователь должен исправлять правду, а не играть в рулетку полной регенерации |
| P0.8 | После страницы показывать «Я запомнил» с edit/delete | У пользователя должен быть контроль над памятью AI |
| P0.9 | Включить `Chapter` модель | Через 4-6 страниц книга должна получать главы |
| P0.10 | Подтверждать транскрипт голосового до генерации | Ошибки распознавания нельзя превращать в «факты биографии» |

### P1 — следующий слой качества

| Приоритет | Что сделать |
|---|---|
| P1.1 | Scene-based onboarding вместо фактического интервью |
| P1.2 | Style profiles с few-shot примером для каждого пользователя |
| P1.3 | Web Mini App: чтение, правки, память, главы |
| P1.4 | Команда `/recall` или кнопка «Вспомнить прошлое» |
| P1.5 | Пересборка пролога после 8-13 страниц |
| P1.6 | PDF с настоящей книжной типографикой |

### P2 — Pro-дифференциация

| Приоритет | Что сделать |
|---|---|
| P2.1 | 3 варианта AI-обложки + reroll |
| P2.2 | Редактируемый prompt обложки |
| P2.3 | Финальный AI-editor перед PDF: части, названия частей, эпилог |
| P2.4 | KDP-ready экспорт с bleed/margins |
| P2.5 | Семейный режим: пользователь разрешает родственнику добавлять воспоминания |

---

## 3. Целевая архитектура

### 3.1. Высокоуровневый пайплайн

```text
Telegram input
  -> Entry intake
  -> Voice transcription, if needed
  -> Transcript confirmation
  -> Clarification questions
  -> NarrativeContextBuilder
       -> recent page bodies
       -> prologue bodies
       -> semantic page retrieval
       -> active narrative threads
       -> entity memories
       -> style sample
       -> timeline position
  -> planEntry structured output
  -> writePage structured output
  -> validateAndRepairPage
  -> persist Page version
  -> render poster-card
  -> deliver full text + card + actions
  -> background jobs
       -> embed page
       -> merge memories
       -> update narrative threads
       -> maybe synthesize chapter
       -> maybe audit style
```

### 3.2. Разделение синхронного и фонового

Синхронно, пока пользователь ждёт:

1. подтвердить транскрипт;
2. задать уточнения;
3. собрать контекст;
4. построить plan;
5. написать страницу;
6. отправить текст и карточку.

Фоном:

1. посчитать embedding страницы;
2. объединить memories;
3. обновить narrative threads;
4. проверить стиль;
5. создать/обновить главу;
6. пересобрать web/PDF preview.

Фоновые задачи не должны блокировать публикацию страницы. Но они должны быть идемпотентными и повторяемыми.

---

## 4. Новая модель данных

Ниже — концептуальная схема. Её можно адаптировать под текущий Prisma/Postgres-код.

### 4.1. User

Добавить к текущей модели:

```prisma
model User {
  id                    String   @id @default(cuid())
  telegramId            String   @unique

  writingStyle          String?
  writingStyleProfileId String?
  styleSample           String?  // few-shot эталон голоса
  styleRecalibration    String?  // заметка style auditor

  narrativeCompass      String?  // центральный вопрос/тема книги
  lifeContext           String?  // оставить, но расширить роль: не единственный контекст

  preferredLanguage     String   @default("ru")
  timezone              String?

  createdAt             DateTime @default(now())
  updatedAt             DateTime @updatedAt
}
```

### 4.2. Entry

`Entry` должен хранить не только сырой ввод, но и статус прохождения через редакционный пайплайн.

```prisma
model Entry {
  id                  String   @id @default(cuid())
  userId              String
  rawText             String?
  voiceFileId         String?
  transcript          String?
  transcriptConfirmed Boolean  @default(false)

  entryType           EntryType @default(WEEKLY)
  periodStart         DateTime?
  periodEnd           DateTime?

  status              EntryStatus @default(RECEIVED)
  clarificationJson   Json?
  finalInputText      String?

  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt
}

enum EntryType {
  WEEKLY
  RETROSPECTIVE
  INTAKE_SCENE
}

enum EntryStatus {
  RECEIVED
  TRANSCRIBED
  TRANSCRIPT_CONFIRMED
  CLARIFYING
  READY_TO_GENERATE
  GENERATED
  FAILED
}
```

### 4.3. Page

`Page` должен стать версионируемой единицей рукописи.

```prisma
model Page {
  id              String   @id @default(cuid())
  userId          String
  entryId         String?
  bookId          String?
  chapterId       String?

  kind            PageKind
  title           String
  subtitle        String?
  body            String
  quote           String?
  teaser          String?

  summary         String?
  tags            String[]
  mood            String?

  periodStart     DateTime?
  periodEnd       DateTime?
  manuscriptOrder Int?

  version         Int      @default(1)
  revisionOfId    String?
  isCurrent       Boolean  @default(true)

  generationPlan  Json?
  sourceContext   Json?    // какие страницы/threads/memories были использованы

  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}

enum PageKind {
  WEEKLY
  PROLOGUE
  RETROSPECTIVE
  CHAPTER_INTRO
  EPILOGUE
}
```

### 4.4. PageEmbedding

Если Prisma не поддерживает `vector` напрямую в текущей версии стека, можно использовать `Unsupported("vector(1536)")` и SQL-запросы.

```prisma
model PageEmbedding {
  pageId     String @id
  userId     String
  model      String
  dimensions Int
  embedding  Unsupported("vector(1536)")
  createdAt  DateTime @default(now())

  @@index([userId])
}
```

SQL-миграция:

```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE "PageEmbedding" (
  "pageId" text PRIMARY KEY REFERENCES "Page"("id") ON DELETE CASCADE,
  "userId" text NOT NULL,
  "model" text NOT NULL,
  "dimensions" int NOT NULL,
  "embedding" vector(1536) NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX page_embedding_user_idx
  ON "PageEmbedding" ("userId");

CREATE INDEX page_embedding_hnsw_idx
  ON "PageEmbedding"
  USING hnsw ("embedding" vector_cosine_ops);
```

Почему так: OpenAI embeddings подходят для поиска, кластеризации и рекомендаций; `text-embedding-3-small` по умолчанию возвращает 1536-мерный вектор, а pgvector умеет хранить векторы в Postgres и искать ближайших соседей через cosine/L2/inner product.[^openai-embeddings][^openai-embedding-model][^pgvector]

### 4.5. NarrativeThread

Это ключевая новая сущность. `Memory` хранит факты. `NarrativeThread` хранит **развитие**.

```prisma
model NarrativeThread {
  id                String   @id @default(cuid())
  userId            String

  title             String   // «отношения с отцом», «возвращение к рисованию»
  type              ThreadType
  status            ThreadStatus @default(ACTIVE)

  summary           String   // 200-400 слов, обновляется после релевантных страниц
  tension           String?  // что здесь не решено
  lastMovement      String?  // что изменилось в последней релевантной сцене

  people            String[]
  places            String[]
  themes            String[]

  firstPageId       String?
  lastPageId        String?
  confidence        Float    @default(0.8)

  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
}

enum ThreadType {
  PERSON
  RELATIONSHIP
  PLACE
  THEME
  GOAL
  FEAR
  IDENTITY
  WORK
  HEALTH
  FAMILY
}

enum ThreadStatus {
  ACTIVE
  DORMANT
  RESOLVED
}
```

События внутри нити:

```prisma
model NarrativeThreadEvent {
  id        String   @id @default(cuid())
  threadId  String
  pageId    String
  summary   String
  createdAt DateTime @default(now())
}
```

### 4.6. MemoryEntity и MemoryRevision

Текущий `Memory` лучше разделить на entity-state и историю изменений.

```prisma
model MemoryEntity {
  id              String   @id @default(cuid())
  userId          String
  type            MemoryType

  canonicalName   String
  normalizedName  String
  aliases         String[]

  currentSummary  String   // 80-200 слов, не сухой факт
  sourcePageIds   String[]
  confidence      Float    @default(0.8)

  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@unique([userId, type, normalizedName])
}

model MemoryRevision {
  id          String   @id @default(cuid())
  memoryId    String
  pageId      String?
  oldSummary  String?
  newSummary  String
  reason      String?
  createdAt   DateTime @default(now())
}
```

### 4.7. Chapter и BookPart

`Chapter` должен стать рабочей моделью, а не фантомом.

```prisma
model Chapter {
  id             String   @id @default(cuid())
  userId         String
  bookId         String?
  partId         String?

  title          String
  subtitle       String?
  intro          String?  // 100-250 слов: мост между страницами
  summary        String?  // служебно для retrieval/PDF

  orderIndex     Int
  periodStart    DateTime?
  periodEnd      DateTime?

  people         String[]
  places         String[]
  themes         String[]
  keyEvents      String[]

  status         ChapterStatus @default(DRAFT)

  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
}

model BookPart {
  id          String @id @default(cuid())
  userId      String
  bookId      String?
  title       String
  intro       String?
  orderIndex  Int
}

enum ChapterStatus {
  DRAFT
  USER_APPROVED
  LOCKED_FOR_PDF
}
```

---

## 5. Контекст для генерации страницы

### 5.1. Что должно попадать в `generateEntry`

Новый `GenerationContext`:

```ts
type GenerationContext = {
  user: {
    language: string;
    writingStyle?: string;
    styleSample?: string;
    styleRecalibration?: string;
    narrativeCompass?: string;
  };

  currentEntry: {
    rawText: string;
    transcript?: string;
    clarificationAnswers?: string[];
    entryType: "WEEKLY" | "RETROSPECTIVE" | "INTAKE_SCENE";
    periodStart?: string;
    periodEnd?: string;
  };

  timeline: {
    pageNumber: number;
    weekOfYear?: number;
    monthName?: string;
    season?: string;
    daysSinceLastPage?: number;
    missedWeeks?: number;
  };

  manuscriptContext: {
    prologueBodies: PageSnippet[];
    recentBodies: PageSnippet[];
    relatedBodies: PageSnippet[];
    currentChapter?: ChapterSnippet;
  };

  narrativeThreads: NarrativeThreadSnippet[];
  memories: MemorySnippet[];
};
```

### 5.2. Правила сборки контекста

#### Always include

1. Полные тела 2 последних текущих страниц.
2. Полные тела 5 страниц пролога или их сжатые версии, если пролог длинный.
3. Текущий `styleSample`.
4. Текущую позицию во времени: месяц, номер страницы, сколько прошло с последней страницы.

#### Retrieve semantically

1. Сформировать retrieval query:

```text
current raw entry
+ transcript corrections
+ clarification answers
+ named people/places detected locally or by LLM
+ candidate themes
```

2. Посчитать embedding query.
3. Найти top-10 страниц пользователя по cosine similarity.
4. Применить MMR/diversity, чтобы не взять 5 почти одинаковых страниц.
5. Передать в prompt top-3/top-5 как `relatedBodies`.

Пример SQL:

```sql
SELECT p.id, p.title, p.body, p.summary, p.tags,
       1 - (pe.embedding <=> $1::vector) AS similarity
FROM "PageEmbedding" pe
JOIN "Page" p ON p.id = pe."pageId"
WHERE pe."userId" = $2
  AND p."isCurrent" = true
  AND p.id <> $3
ORDER BY pe.embedding <=> $1::vector
LIMIT 10;
```

#### Retrieve narrative threads

1. Явные совпадения по людям/местам/алиасам.
2. Semantic match по summary нити.
3. Recency boost: нити, которые двигались в последних 30-45 днях.
4. Не больше 3-5 нитей в prompt.

### 5.3. Бюджет контекста

Не нужно подавать модели всю книгу. Для хорошей страницы достаточно:

| Блок | Объём |
|---|---:|
| Static system + style rules | 1 000-1 500 tokens |
| Current entry + clarifications | 300-1 500 tokens |
| 2 recent page bodies | 1 000-2 000 tokens |
| 3 related page bodies | 1 500-3 000 tokens |
| Prologue snippets | 1 000-2 000 tokens |
| Threads + memories | 800-1 500 tokens |
| План | 300-700 tokens |

Итого обычно 6 000-12 000 tokens, что нормально для современных длинноконтекстных моделей. Для снижения задержки и стоимости статические инструкции и few-shot примеры нужно держать в начале prompt: prompt caching работает на совпадающих prefix-частях prompt и может снижать latency/cost на длинных повторяющихся префиксах.[^openai-prompt-caching]

---

## 6. AI-пайплайн

### 6.1. Шаг 1 — транскрипция и подтверждение

Для голосовых сообщений:

1. Транскрибировать аудио.
2. Отправить пользователю:

```text
Я услышал так:

«...транскрипт...»

Всё верно?
[Да, писать страницу] [Поправить]
```

3. До подтверждения не создавать Page и не извлекать memories.

OpenAI Audio API поддерживает speech-to-text endpoints и современные `gpt-4o-transcribe` / `gpt-4o-mini-transcribe` / diarize-варианты; продукту достаточно обычной транскрипции, а diarize можно оставить для будущих длинных интервью.[^openai-transcription]

### 6.2. Шаг 2 — уточняющие вопросы

Уточняющие вопросы должны использовать тот же retrieval-контекст, что и генерация.

Плохой вопрос:

> «Что ты почувствовал?»

Хороший вопрос:

> «Ты снова упомянул кухню — это та же кухня, где в апреле был разговор с мамой, или другое место?»

Правило:

- 0 вопросов, если сцена и так конкретная.
- 1 вопрос, если не хватает одной опоры: кто/где/когда/что изменилось.
- 2 вопроса только если без них страница будет неверной.

### 6.3. Шаг 3 — `planEntry`

Перед написанием страницы модель должна вернуть структурированный план.

```ts
type EntryPlan = {
  pageRole: "new_thread" | "continues_thread" | "echo" | "turning_point" | "quiet_interlude";
  centralScene: string;
  factualBoundaries: string[];
  continuityMoves: Array<{
    sourcePageId?: string;
    sourceThreadId?: string;
    move: string;
    mustBeSubtle: boolean;
  }>;
  threadsToUpdate: Array<{
    threadId?: string;
    proposedTitle?: string;
    updateReason: string;
  }>;
  memoriesToCreateOrMerge: Array<{
    type: string;
    name: string;
    evidence: string;
  }>;
  styleNotes: string[];
  riskFlags: string[];
};
```

Использовать Structured Outputs через JSON Schema, чтобы план был валидируемым и не ломал пайплайн. OpenAI Structured Outputs поддерживают `json_schema`/structured response formats и предназначены как раз для случаев, когда приложение должно получить данные в фиксированной структуре.[^openai-structured]

### 6.4. Шаг 4 — `writePage`

Writer получает:

1. текущий ввод;
2. подтверждённые уточнения;
3. `EntryPlan`;
4. релевантные прошлые страницы;
5. narrative threads;
6. memories;
7. style sample.

Выход:

```ts
type PageDraft = {
  title: string;
  subtitle?: string;
  body: string;
  quote?: string;
  teaser: string;
  tags: string[];
  mood?: string;
  pageSummary: string;
  extractedMemoryCandidates: MemoryCandidate[];
  threadUpdateCandidates: ThreadUpdateCandidate[];
};
```

Правила текста:

- 180-320 слов для обычной страницы.
- 120-220 слов для quiet interlude.
- 250-450 слов для turning point, если пользователь дал материал.
- Не добавлять факты, которых нет в вводе или контексте.
- Не объяснять пользователю его чувства, если он их не назвал.
- Делать максимум 1-2 конкретные переклички с прошлым, иначе текст станет искусственным.
- Сохранять абзацы.
- Не писать «как будто это литература»; писать как биограф, который уважает живого человека.

### 6.5. Шаг 5 — validator / repair

Перед отправкой страница проходит автоматические проверки:

```ts
type PageValidation = {
  ok: boolean;
  errors: Array<
    | "too_long"
    | "too_short"
    | "no_paragraphs"
    | "invented_fact_risk"
    | "style_drift"
    | "generic_reflection"
    | "missing_continuity_when_plan_required_it"
  >;
  repairInstruction?: string;
};
```

Минимальные deterministic checks:

- word count;
- есть ли абзацы;
- title не пустой;
- teaser не длиннее карточки;
- quote взята из body или явно является короткой фразой страницы;
- нет запрещённых placeholders.

LLM-checks:

- не противоречит ли страница source context;
- не появилась ли выдуманная конкретика;
- выдержан ли styleSample.

---

## 7. Память и сюжетные нити

### 7.1. Почему `Memory` и `NarrativeThread` нельзя смешивать

`Memory` отвечает на вопрос:

> «Что система знает о человеке/месте/теме?»

`NarrativeThread` отвечает на вопрос:

> «Как это менялось во времени?»

Пример:

```text
MemoryEntity:
  type: PERSON
  canonicalName: «мама»
  summary: «Живёт в Калининграде, часто говорит коротко, но заботится делами...»

NarrativeThread:
  title: «Разговоры с мамой без прямых слов»
  tension: «Пользователь хочет тепла, но боится снова услышать только практические советы»
  lastMovement: «После апрельской ссоры в новой сцене мама сама прислала старую фотографию»
```

### 7.2. Merge memory вместо дубликатов

После каждой страницы:

1. Writer предлагает `MemoryCandidate[]`.
2. Система нормализует имя: lower-case, trim, alias map, fuzzy match.
3. Если есть похожая `MemoryEntity`, вызвать `mergeMemory`.
4. Если нет — создать новую.
5. В любом случае создать `MemoryRevision`.
6. Показать пользователю коротко: «Я запомнил...».

Пример prompt-задачи для merge:

```text
You are updating a biographical memory.
Do not overwrite older truth unless the new page clearly changes it.
Preserve concrete details.
Return 80-160 words in the user's language.

Existing memory:
...

New evidence from page:
...

Return JSON:
{ "newSummary": string, "changeType": "confirm" | "add_detail" | "contradict" | "evolve", "confidence": number }
```

### 7.3. Обновление narrative threads

После каждой Page:

1. `planEntry` уже предложил threads to update.
2. Фоновая задача берёт page summary + body + plan.
3. Для каждой нити создаёт `NarrativeThreadEvent`.
4. Обновляет summary, tension, lastMovement.
5. Если появилась новая значимая линия — создаёт новую.

Критерий создания новой нити: тема должна потенциально вернуться в книге. Разовая покупка кофе — не нить. Первое занятие бегом после долгого перерыва — возможно нить.

---

## 8. Онбординг

### 8.1. Что убрать

Не надо начинать с длинного формального интервью из 7 абстрактных вопросов. Оно собирает факты, но не сцены. Для мемуара важны не только «кто» и «откуда», а поворотные моменты, конкретные сцены и центральный вопрос книги. В craft-подходе к memoir важны essential question, turning points и сцены, которые работают на динамику истории, а не просто перечисляют события.[^memoir-essential-question][^memoir-turning-points][^memoir-scenes]

### 8.2. Новый короткий онбординг

Цель: быстро довести пользователя до первой сильной страницы, но не пытаться написать весь пролог из 5 минут материала.

```text
1. Зачем ты хочешь вести эту книгу?
   [для себя] [для семьи] [пережить год] [оставить память] [другое]

2. Выбери голос книги.
   Бот показывает один и тот же микро-абзац в 4 стилях.

3. Расскажи одну сцену из прошлого, которая до сих пор возвращается.
   Можно голосом.

4. Кто точно должен быть в этой книге?
   3-5 людей, но с одной фразой: «почему важен».

5. Что сейчас в твоей жизни не закончено?
```

После этого:

- не писать сразу 5-страничный пролог;
- создать `narrativeCompass`;
- создать первые `MemoryEntity` и `NarrativeThread`;
- написать короткую `Opening Note` или 1 страницу пролога;
- остальные прологовые страницы собрать после 2-4 недель использования.

### 8.3. Style profiles

Пользователь не должен выбирать «спокойно, иронично, литературно» вслепую. Ему нужно показать один и тот же фрагмент в разных голосах.

Пример профилей:

1. **Тихий документальный** — мало метафор, много точных деталей.
2. **Тёплый семейный** — мягкий, человеческий, без пафоса.
3. **Ироничный живой** — чуть легче, с наблюдениями, но без стендапа.
4. **Литературный сдержанный** — ритм, образность, но без драматизации.
5. **Прямой дневниковый** — проще, ближе к речи пользователя.

Сохранять нужно не только название, но и `styleSample` — несколько предложений, которые каждый раз идут в prompt как эталон.

---

## 9. Доставка в Telegram

### 9.1. Новая роль карточки

Карточка больше не должна пытаться вместить всю страницу.

| Артефакт | Роль | Содержание |
|---|---|---|
| Telegram text | Основное чтение | Полное тело страницы с абзацами |
| Poster-card PNG | Эмоциональный объект / share | Заголовок, quote, 3-6 строк teaser |
| Web book | Лучшее чтение и редактирование | Полная книга, главы, память, правки |
| PDF | Итоговый артефакт | Книжная сборка |

Telegram Bot API позволяет отправлять текстовые сообщения до 4096 символов, а caption у медиа ограничен 1024 символами; значит полный body логичнее слать как `sendMessage`, а не пытаться прятать его в caption картинки.[^telegram-message-limits]

### 9.2. Порядок сообщений

Рекомендованный порядок:

```text
1. Poster-card PNG
   caption: «Страница 12 — “Название”. Полный текст ниже.»

2. Full body text
   С абзацами, без markdown-перегруза.

3. Action keyboard
   [✍ Подправить] [🏷 Заголовок] [📌 Что запомнил] [📖 Открыть книгу]
```

Если body длиннее 4096 символов — делить по абзацам на 2 сообщения.

### 9.3. Poster-card параметры

Текущая карточка слишком мелкая. Новый вариант:

```ts
CARD_W = 1080
CARD_H = 1440 или 1920
TITLE_FONT = 68-82
QUOTE_FONT = 38-46
TEASER_FONT = 40-48
TEASER_MAX_LINES = 5-7
```

Тело страницы на карточке не рендерить целиком. Только teaser.

### 9.4. Action flows

#### Точечная правка

```text
Пользователь нажал «✍ Подправить»
Бот: «Пришли, что изменить. Можно так: “замени второй абзац...” или “добавь, что я злился, а не грустил”.»
Пользователь пишет правку
AI вызывает revisePage(previousPage, instruction, sourceFacts)
Создаётся Page version +1
Бот показывает diff summary и новую версию
```

#### Исправить память

```text
Бот: «Я запомнил: мама, Калининград, страх быть забытым»
[исправить] [удалить] [не запоминать такое]
```

#### Переписать заголовок

Отдельный короткий prompt только для title/subtitle. Не регенерировать body.

---

## 10. Web Mini App

Telegram Mini Apps можно запускать из кнопки, меню, inline button и других точек, а web_app button позволяет передавать данные обратно боту.[^telegram-miniapps]

LifeBookAI нужен Mini App не как «ещё один экран», а как редактор живой рукописи.

### 10.1. Экран 1 — «Моя книга»

Структура:

```text
Cover
Title
Narrative compass
Part I
  Chapter 1: title + intro
    Page
    Page
    Page
  Chapter 2...
Part II...
```

Не группировать по месяцам как основную структуру. Месяц может быть вторичным divider или фильтром.

### 10.2. Экран 2 — Page editor

Функции:

- редактировать title;
- редактировать body;
- попросить AI переписать выделенный абзац;
- добавить деталь;
- увидеть source memories;
- увидеть какие страницы были использованы как context.

### 10.3. Экран 3 — Memory

Функции:

- список людей, мест, тем;
- source pages;
- edit/delete;
- aliases;
- «это неверно»;
- «не использовать в будущем».

### 10.4. Экран 4 — Chapters

Функции:

- переименовать главу;
- объединить/разделить главы;
- перетащить retrospective page в нужное место;
- approve для PDF.

---

## 11. Главы и структура книги

### 11.1. Автосборка главы

Фоновая задача раз в несколько страниц:

```text
Input:
  последние unchaptered pages или pages текущего draft chapter
  page summaries
  tags
  narrative threads
  embeddings

Output:
  shouldCreateChapter: boolean
  title
  subtitle
  intro
  summary
  pageIds
  themes
  people
  places
```

Правила:

- глава обычно 4-6 страниц;
- если страницы явно не связаны — лучше подождать;
- глава может быть тематической, а не календарной;
- пользователь может переименовать;
- chapter intro должен быть мостом, не пересказом.

### 11.2. Book parts

После 13-18 страниц можно создать первую часть.

Пример структуры годовой книги:

```text
Prologue
Part I — Зима / начало вопроса
  Chapter 1
  Chapter 2
Part II — Весна-лето / усложнение
  Chapter 3
  Chapter 4
Part III — Осень-зима / изменение
  Chapter 5
  Chapter 6
Epilogue
```

Финальное деление на части лучше делать перед PDF, когда виден весь корпус.

---

## 12. Пролог

### 12.1. Что изменить

Не писать 5 страниц пролога сразу после короткого онбординга. Это порождает бедный текст, потому что материала мало.

Новый подход:

1. На старте — `Opening Note` или 1 короткая prologue page.
2. После 3-4 weekly pages — «Хочешь, я соберу начало книги из того, что уже знаю?»
3. После 8-13 pages — пересборка пролога как Pro/engagement-событие.
4. В web — возможность редактировать пролог вручную.

### 12.2. Пролог как живой раздел

Пролог должен иметь версии:

```text
Prologue v1 — после онбординга
Prologue v2 — после 8 страниц
Prologue v3 — перед PDF
```

Пользователь должен видеть, что пролог можно пересмотреть. Для мемуара это естественно: понимание своей истории меняется в процессе письма.

---

## 13. Ретроспективные страницы

### 13.1. Почему это важно

Автобиография не может быть заперта в «эта неделя». Значимые события могли случиться 3, 10 или 30 лет назад.

### 13.2. UX

Кнопка:

```text
📓 Вспомнить прошлое
```

Flow:

```text
Бот: «Когда это было? Можно примерно: “лето 2018”, “мне было 12”, “до переезда”.»
Пользователь отвечает.
Бот: «Расскажи одну сцену. Не всю историю — один момент.»
Пользователь рассказывает.
AI пишет retrospective page.
```

### 13.3. Хронология

У `Page` есть:

```text
createdAt — когда пользователь рассказал
periodStart/periodEnd — когда событие произошло
manuscriptOrder — где страница стоит в книге
```

В web-книге retrospective page должна попадать туда, где она работает narratively. Иногда это хронология, иногда вставная глава.

---

## 14. PDF и финальная книга

### 14.1. Новый PDF pipeline

```text
collect current pages
  -> ensure all pages are current versions
  -> ensure chapters exist
  -> generate missing chapter intros
  -> generate/edit book title
  -> suggest parts
  -> generate epilogue
  -> render PDF
  -> user preview
  -> final export
```

### 14.2. Верстка

Рекомендации:

- trim size: 6" x 9" для обычного paperback или 5.5" x 8.5" для более камерного формата;
- шрифт с кириллицей: Noto Serif, Source Serif, Lora, EB Garamond с проверкой покрытия;
- page numbers;
- running headers;
- TOC с номерами страниц;
- Part title pages;
- Chapter title pages или chapter opener;
- не растягивать квадратную обложку; использовать cover-fit/crop;
- не начинать каждую короткую page с новой физической страницы, если это ломает ритм.

Amazon KDP указывает 6" x 9" как самый распространённый paperback trim size в США и отдельно описывает bleed/margins, поэтому для Pro/PDF стоит проектировать экспорт сразу с понятными trim/margin параметрами.[^kdp-trim]

### 14.3. PDF как Pro-ценность

Free может видеть web-book preview. Pro получает:

- PDF preview;
- export;
- cover variants;
- title/parts/epilogue;
- print-ready mode.

---

## 15. AI-обложка

OpenAI image generation API поддерживает генерацию изображений и параметр `n` для нескольких вариантов в одном запросе, поэтому продукту не нужно показывать пользователю один-единственный результат.[^openai-image]

### 15.1. Новый flow

```text
Milestone reached
  -> generate 3 covers
  -> show A/B/C
  -> user chooses
  -> optional reroll
  -> optional edit prompt
```

### 15.2. Cover prompt должен учитывать

- title;
- narrativeCompass;
- 3 главные темы;
- style profile;
- recurring places;
- запрет на фотореалистичные лица, если нет согласия/референса;
- формат под PDF cover.

---

## 16. Монетизация

Telegram Stars подходят для цифровых товаров и сервисов внутри ботов: Telegram описывает оплату digital goods/services через Stars, invoice messages и currency `XTR`.[^telegram-stars]

### 16.1. Не ставить paywall слишком рано

Текущий Free на 4 записи слишком короткий: пользователь ещё не почувствовал «книгу». Ценность continuity появляется примерно после 5-8 страниц, а главы — после 4-6.

Новая модель:

| Тариф | Что дать |
|---|---|
| Free | 8 страниц, 1 chapter intro, web preview, basic card |
| Pro Monthly | unlimited pages, chapters, memory editor, prologue refresh, covers, PDF preview/export |
| Pro Yearly | всё выше + print-ready PDF, final editor pass, priority generation |

### 16.2. Paywall moment

Лучший paywall — после того, как пользователь увидел chapter:

```text
«У тебя уже складывается первая глава: “...”
Чтобы продолжить книгу без лимита и получить PDF в конце года — включи Pro.»
```

Не после механической 4-й записи.

---

## 17. Метрики

### 17.1. North Star

**Количество пользователей, у которых есть 1 approved chapter из 4+ страниц.**

Почему не «число страниц»: страницы можно генерировать механически. Chapter означает, что продукт начал выполнять обещание книги.

### 17.2. Activation metrics

| Метрика | Цель |
|---|---:|
| Дошёл до первой страницы | 70%+ от `/start` |
| Подтвердил транскрипт/текст и получил страницу | 60%+ |
| Прочитал/открыл full text | 50%+ |
| Сделал хотя бы одну правку | 20-35% — это хороший знак вовлечения |
| Дошёл до 5 страниц | 40-50% |
| Получил первую главу | 30%+ |

### 17.3. Quality metrics

| Метрика | Как мерить |
|---|---|
| Continuity score | LLM-eval: есть ли конкретная, уместная связь с прошлой сценой |
| Faithfulness score | LLM-eval + пользовательские corrections |
| Style consistency | сравнение с `styleSample` |
| Genericness rate | доля страниц с абстрактными клише |
| Edit friction | сколько попыток нужно, чтобы пользователь принял страницу |
| Memory trust | % memories, которые пользователь удаляет/исправляет |

### 17.4. Business metrics

| Метрика | Цель |
|---|---:|
| Free -> Pro conversion after first chapter | выше, чем paywall after 4 pages |
| Month-2 retention | главная проверка привычки |
| Pages per active Pro per month | не только quantity, но quality-approved pages |
| PDF export intent | сколько пользователей нажимают preview до декабря |

---

## 18. Технический roadmap

### Sprint 0 — стабилизация чтения и данных

**Цель:** пользователь должен читать страницу нормально, а система должна хранить всё, что понадобится для рукописи.

Сделать:

1. Full body через `sendMessage`.
2. Poster-card вместо full-card.
3. Сохранение page summary/teaser/sourceContext.
4. Transcript confirmation.
5. Page versioning skeleton.
6. События аналитики.

Acceptance criteria:

- ни одна страница не теряется из-за PNG truncation;
- body сохраняет абзацы;
- пользователь может прочитать страницу без открытия картинки;
- voice transcript можно поправить до генерации.

### Sprint 1 — retrieval и контекст рукописи

**Цель:** модель реально видит прошлую прозу.

Сделать:

1. `PageEmbedding` + pgvector migration.
2. embedding job after page creation.
3. `buildNarrativeContext()`.
4. `recentBodies` + `prologueBodies`.
5. semantic retrieval top-3/top-5.
6. передавать context в clarification и generation.

Acceptance criteria:

- в логах видно, какие страницы были retrieved;
- вопросы стали конкретнее;
- страницы уместно ссылаются на прошлые сцены;
- retrieval покрыт тестами на фиктивном корпусе.

### Sprint 2 — two-pass writing и редактирование

**Цель:** страница должна иметь намерение и быть редактируемой.

Сделать:

1. `planEntry()` structured output.
2. `writePage()` structured output.
3. `validateAndRepairPage()`.
4. `revisePage()`.
5. `rewriteTitle()`.
6. UI-кнопки правок.

Acceptance criteria:

- каждая Page хранит generationPlan;
- можно исправить один абзац без полной регенерации;
- title можно менять отдельно;
- old versions не теряются.

### Sprint 3 — memory merge и narrative threads

**Цель:** продукт помнит не факты-обрывки, а развивающиеся линии.

Сделать:

1. `MemoryEntity` + `MemoryRevision`.
2. alias/normalization.
3. `mergeMemory()`.
4. `NarrativeThread` + events.
5. `updateThreadsAfterPage()`.
6. Telegram message «Я запомнил...» с edit/delete.

Acceptance criteria:

- нет 8 дублей «мама»;
- у memory есть source pages;
- у thread есть lastMovement;
- пользователь может удалить memory.

### Sprint 4 — chapters и web-book

**Цель:** книга начинает выглядеть как книга.

Сделать:

1. `synthesizeChapter()`.
2. привязка Page -> Chapter.
3. LivingBook по главам.
4. web editor для title/body/chapter title.
5. chapter approval.

Acceptance criteria:

- после 4-6 страниц создаётся chapter draft;
- web отображает главы, не только месяцы;
- пользователь может переименовать главу;
- PDF TOC строится по главам.

### Sprint 5 — PDF и Pro packaging

**Цель:** Pro получает настоящий артефакт.

Сделать:

1. PDF renderer v2.
2. TOC with page numbers.
3. running headers/page numbers.
4. fonts with Cyrillic.
5. cover fit/crop.
6. PDF preview.
7. Pro paywall after first chapter.

Acceptance criteria:

- PDF выглядит как книга;
- страницы не растягивают обложку;
- есть номера страниц;
- chapter intros есть в PDF.

---

## 19. Файловая структура изменений

Предлагаемая структура в текущем monorepo:

```text
packages/ai/src/
  context/
    buildNarrativeContext.ts
    retrieveRelatedPages.ts
    selectNarrativeThreads.ts
  generation/
    planEntry.ts
    writePage.ts
    validatePage.ts
    revisePage.ts
    rewriteTitle.ts
  memory/
    mergeMemory.ts
    updateNarrativeThreads.ts
  chapter/
    synthesizeChapter.ts
    suggestBookParts.ts
  style/
    auditStyle.ts
  prompts/
    pagePlannerPrompt.ts
    pageWriterPrompt.ts
    pageRevisionPrompt.ts
    memoryMergePrompt.ts
    chapterPrompt.ts

apps/bot/src/services/
  narrativeContextService.ts
  embeddingService.ts
  pageDeliveryService.ts
  pageRevisionService.ts
  memoryReviewService.ts
  chapterService.ts

apps/bot/src/conversations/
  weeklyEntry.ts
  retrospectiveEntry.ts
  pageRevision.ts
  transcriptConfirmation.ts

packages/renderer/src/
  renderPosterCard.ts
  renderPdfV2.ts

apps/web/src/components/
  BookReader.tsx
  PageEditor.tsx
  MemoryPanel.tsx
  ChapterEditor.tsx
```

---

## 20. Prompt templates: минимальный каркас

### 20.1. Planner system

```text
You are the planning editor for a living autobiographical manuscript.
Your job is not to write prose.
Your job is to decide how the new material belongs in the existing book.

Rules:
- Never invent facts.
- Prefer one precise continuity move over many vague echoes.
- If no prior context is relevant, mark the page as new_thread or quiet_interlude.
- Track people, places, themes, fears, goals, and unresolved tensions.
- Return only valid JSON matching the schema.
```

### 20.2. Writer system

```text
You are writing one page of a living autobiographical book.
You are not a fresh listener. You have selected prior pages and narrative threads.
Use them only when they truly resonate.

Do:
- write in the user's language;
- preserve factual truth;
- keep concrete sensory details from the user's input;
- use the style sample as the strongest guide;
- preserve paragraph rhythm;
- make continuity subtle.

Do not:
- summarize like a therapist;
- over-explain emotions;
- invent dialogue;
- mention that you used context;
- turn every ordinary week into a climax.
```

### 20.3. Revision system

```text
You revise an existing page according to the user's instruction.
Preserve everything that the user did not ask to change.
If the user corrects a fact or emotion, the correction is authoritative.
Return a full revised page, not a diff.
```

---

## 21. Privacy, trust, safety

LifeBookAI хранит интимный биографический корпус. Поэтому доверие — не второстепенная фича.

Минимум:

1. Export all data.
2. Delete account and all manuscript data.
3. Delete specific memory.
4. Mark memory as private/do not use.
5. Source trace: «откуда AI это знает».
6. Не использовать страницу в обложке/маркетинге без явного согласия.
7. Не делать семейный sharing без granular permissions.

Для hallucination-risk:

- подтверждать transcript;
- structured plan с factual boundaries;
- validator на invented facts;
- user corrections update memory;
- sourceContext хранить в Page.

---

## 22. Самое важное продуктово-инженерное решение

Не пытаться решить всё большим `lifeContext`.

`lifeContext` можно оставить как краткий бриф, но он не должен быть главным механизмом памяти. Настоящая память продукта должна быть многослойной:

```text
1. Full manuscript text
2. Semantic retrieval of pages
3. Narrative threads
4. Entity memories with revisions
5. Style sample
6. Chapter summaries
7. LifeContext as short top-level brief
```

Только такая система даст пользователю ощущение:

> «Он не просто красиво пишет. Он помнит мою книгу».

---

## 23. Definition of Done для новой версии

Продукт можно считать реализованным правильно, когда выполняется следующее:

1. Пользователь после 5-й страницы видит конкретные, уместные переклички с ранними сценами.
2. Полный текст всегда читается в Telegram без открытия PNG.
3. Пользователь может исправить один факт/абзац без полной регенерации.
4. После 4-6 страниц появляется первая глава.
5. Memories не дублируются и имеют source pages.
6. Пролог можно пересобрать после накопления материала.
7. Web-книга структурирована по главам.
8. PDF имеет title, TOC, page numbers, chapters и нормальную типографику.
9. Paywall появляется после демонстрации ценности, а не до неё.
10. В логах каждой генерации видно: какие страницы, нити и memories использовались.

---

## 24. Источники и внешние опоры

[^openai-embeddings]: OpenAI API Docs, “Vector embeddings”: embeddings are used for search, clustering, recommendations and relatedness measurement; embedding distance represents relatedness. https://developers.openai.com/api/docs/guides/embeddings
[^openai-embedding-model]: OpenAI API Docs, “text-embedding-3-small Model”: model page lists `text-embedding-3-small`, 1536 default dimensions and current API pricing details. https://developers.openai.com/api/docs/models/text-embedding-3-small
[^pgvector]: pgvector README: Postgres extension for vector similarity search; supports exact/approximate nearest neighbor search, cosine/L2/inner product distances, HNSW/IVFFlat indexes. https://github.com/pgvector/pgvector
[^openai-prompt-caching]: OpenAI API Docs, “Prompt caching”: repeated prompt prefixes can reduce latency and input token cost; static content should be placed before variable content for cache hits. https://developers.openai.com/api/docs/guides/prompt-caching
[^openai-structured]: OpenAI API Docs, “Structured model outputs”: structured outputs via function calling or JSON schema response formats. https://developers.openai.com/api/docs/guides/structured-outputs
[^openai-transcription]: OpenAI API Docs, “Speech to text”: Audio API transcriptions/translations, including `gpt-4o-transcribe` and `gpt-4o-mini-transcribe`. https://developers.openai.com/api/docs/guides/speech-to-text
[^telegram-message-limits]: Telegram Bot API: `sendMessage` text is 1-4096 characters; media captions are 0-1024 characters after entity parsing. https://core.telegram.org/bots/api
[^telegram-miniapps]: Telegram Mini Apps documentation: Mini Apps can be launched from keyboard/inline/menu/profile/direct links and can send data back to the bot. https://core.telegram.org/bots/webapps
[^telegram-stars]: Telegram Bot Payments API for Digital Goods and Services: digital goods/services are sold through Telegram Stars using currency `XTR` and invoice messages. https://core.telegram.org/bots/payments-stars
[^openai-image]: OpenAI API Docs, “Image generation”: image generation endpoint and `n` parameter for multiple images. https://developers.openai.com/api/docs/guides/image-generation
[^kdp-trim]: Amazon KDP Help, “Set Trim Size, Bleed, and Margins”: 6" x 9" is described as the most common US paperback trim size; KDP explains trim size, bleed and margins. https://kdp.amazon.com/en_US/help/topic/GVBQ3CMEQW3W2VL6
[^memoir-essential-question]: Jane Friedman, “What Is a Memoir’s Essential Question and Why Do You Need One?”: central question helps decide what belongs in a memoir and creates cohesion. https://janefriedman.com/finding-your-memoirs-essential-question/
[^memoir-turning-points]: National Association of Memoir Writers, “Turning Points—How to Find the Structure of Your Memoir”: turning point moments can form the outline/chapters of a memoir. https://www.namw.org/turning-points-how-to-find-the-structure-of-your-memoir/
[^memoir-scenes]: Writer’s Digest, “Writing Memoir Scenes That Work”: memoir scenes should enrich narrative, develop relationships/patterns and maintain reader investment. https://www.writersdigest.com/write-better-nonfiction/writing-memoir-scenes-that-work-choosing-what-stays-in-your-memoir-and-what-goes
