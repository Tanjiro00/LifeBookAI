# LifeBook Bot MVP

Telegram bot that turns weekly text or voice updates into private autobiographical chapters.

The MVP loop is:

```text
/start -> onboarding -> /new -> text/voice -> clarifying questions -> chapter -> style edits -> save -> /book
```

## What Is Implemented

- Telegram bot on Node.js 22+, TypeScript and grammY.
- Fastify server for health, webhook, admin metrics, media and preview API.
- Prisma/PostgreSQL schema and initial migration for users, entries, questions, chapters, books, memories and payments.
- Redis/BullMQ queue scaffolding for transcription, AI generation, card rendering and reminders.
- Onboarding with writing goal, style, reminder frequency, day/time and privacy confirmation.
- Text entry flow with AI clarifying questions and generated chapter.
- Voice entry flow with Telegram file download and transcription.
- AI package with OpenAI integration, structured JSON validation via Zod, retries and deterministic mock fallback.
- Chapter review buttons: save, less dramatic, shorter, more literary, more like me, regenerate, open as book page.
- Chapter card renderer as 1200x1600 PNG with warm ivory/book typography.
- Vite React web preview for `/chapter/:shareToken` and `/book/:bookId`.
- Reminder loop, free limit/paywall scaffolding and Telegram Stars payment handling.
- Privacy defaults: private chapters, long share tokens, logs without raw user content.
- Tests for AI schemas and state transitions.

## Setup

```bash
cd lifebook-bot
cp .env.example .env
npm install
npm run prisma:generate
docker compose up -d
npm run prisma:migrate
```

Fill `.env`:

```bash
TELEGRAM_BOT_TOKEN=...
DATABASE_URL=postgresql://lifebook:lifebook@localhost:5432/lifebook?schema=public
REDIS_URL=redis://localhost:6379
PUBLIC_WEB_URL=http://localhost:3000
VITE_API_BASE_URL=http://localhost:8080
AI_PROVIDER=mock
```

For real AI:

```bash
OPENAI_API_KEY=...
AI_PROVIDER=openai
OPENAI_TEXT_MODEL=gpt-4.1-mini
OPENAI_TRANSCRIPTION_MODEL=gpt-4o-mini-transcribe
```

## Run

Terminal 1:

```bash
npm run dev:bot
```

Terminal 2:

```bash
npm run dev:web
```

Bot health:

```bash
curl http://localhost:8080/health
```

Protected admin metrics:

```bash
curl -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:8080/admin/metrics
```

## Scripts

```bash
npm run typecheck
npm test
npm run build
npm run prisma:generate
npm run prisma:migrate
npm run prisma:studio
```

## Project Structure

```text
apps/bot      Telegram bot, Fastify API, queues, reminders
apps/web      Vite React book/chapter preview
packages/ai   prompts, OpenAI calls, Zod schemas, mock AI
packages/db   Prisma schema and migrations
packages/renderer chapter card and HTML rendering
tests         unit tests
```

## Notes

- `AI_PROVIDER=mock` lets the full product loop run locally without OpenAI billing.
- Web preview reads public data through the bot API by `shareToken`; raw user content is not logged.
- PDF export and deeper admin dashboards are scaffolded as next phases, while the core chapter loop is implemented end to end.

