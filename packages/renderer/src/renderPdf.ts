import { escapeHtml } from "./text.js";

export type ChapterPdfInput = {
  title: string;
  subtitle?: string | null;
  quote?: string | null;
  content: string;
  createdAt?: Date;
};

export function renderChapterHtml(input: ChapterPdfInput): string {
  const paragraphs = input.content
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`)
    .join("\n");

  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(input.title)}</title>
  <style>
    :root { color-scheme: light; }
    body {
      margin: 0;
      background: #f8f4ec;
      color: #1e1b18;
      font-family: Georgia, "Times New Roman", serif;
    }
    main {
      max-width: 760px;
      margin: 0 auto;
      padding: 80px 48px 96px;
      background: #fffaf3;
      min-height: 100vh;
      box-shadow: 0 24px 80px rgba(30, 27, 24, 0.12);
    }
    .meta {
      color: #9a6a43;
      font-family: Arial, sans-serif;
      font-size: 13px;
      letter-spacing: .14em;
      text-transform: uppercase;
    }
    h1 {
      font-size: 52px;
      line-height: 1.05;
      margin: 32px 0 16px;
      letter-spacing: 0;
    }
    h2 {
      font-size: 22px;
      font-weight: 400;
      color: #5d5147;
      margin: 0 0 36px;
    }
    blockquote {
      border-left: 2px solid #9a6a43;
      color: #423a33;
      font-style: italic;
      margin: 0 0 42px;
      padding-left: 24px;
      font-size: 23px;
      line-height: 1.55;
    }
    p {
      font-size: 20px;
      line-height: 1.78;
      margin: 0 0 24px;
    }
  </style>
</head>
<body>
  <main>
    <div class="meta">LifeBook${input.createdAt ? ` · ${escapeHtml(input.createdAt.toLocaleDateString("ru-RU"))}` : ""}</div>
    <h1>${escapeHtml(input.title)}</h1>
    ${input.subtitle ? `<h2>${escapeHtml(input.subtitle)}</h2>` : ""}
    ${input.quote ? `<blockquote>${escapeHtml(input.quote)}</blockquote>` : ""}
    ${paragraphs}
  </main>
</body>
</html>`;
}

