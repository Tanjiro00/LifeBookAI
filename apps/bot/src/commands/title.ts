import type { Context } from "grammy";
import { ensureTelegramUser } from "../services/userService.js";
import { setPending, clearPending } from "../lib/pending.js";
import { TITLE_LIMITS, displayTitle, setUserBookTitle } from "../services/bookTitleService.js";
import { prisma } from "../lib/db.js";
import { t } from "../lib/i18n.js";
import { track } from "../services/analytics.js";

// /title — prompts the user to pick a custom title for their book. The next
// non-command text message is consumed as the title (see textMessage handler).
export async function sendTitlePrompt(ctx: Context): Promise<void> {
  const user = await ensureTelegramUser(ctx);
  const book = await prisma.book.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
    select: { title: true, aiTitle: true, titleSetByUser: true }
  });
  const current = book ? displayTitle(book) : "—";

  await setPending(user.id, "title");
  track("title_prompt", { userId: user.id });

  await ctx.reply(
    t(
      ctx,
      [
        `Сейчас книга называется «${current}».`,
        "",
        `Пришли новое название одной строкой (до ${TITLE_LIMITS.max} символов).`,
        "",
        "Если хочешь оставить как есть — нажми /cancel."
      ].join("\n"),
      [
        `Right now the book is called "${current}".`,
        "",
        `Send a new title in one line (up to ${TITLE_LIMITS.max} chars).`,
        "",
        "If you want to keep it — tap /cancel."
      ].join("\n")
    )
  );
}

// Called from the text handler when getPending() === "title".
export async function applyTitleFromText(ctx: Context, text: string): Promise<void> {
  const user = await ensureTelegramUser(ctx);
  const result = await setUserBookTitle(user.id, text);
  await clearPending(user.id);

  if (!result.ok) {
    if (result.reason === "too_long") {
      await ctx.reply(
        t(
          ctx,
          `Слишком длинно. Короче ${TITLE_LIMITS.max} символов, пожалуйста.`,
          `Too long. Please keep it under ${TITLE_LIMITS.max} characters.`
        )
      );
      // Re-arm pending so the user can try again without re-running /title.
      await setPending(user.id, "title");
      return;
    }
    if (result.reason === "no_book") {
      await ctx.reply(
        t(
          ctx,
          "Книга появится после первой записи. Расскажи момент — открою первую страницу.",
          "Your book starts with the first entry. Tell me a moment to open page one."
        )
      );
      return;
    }
    await ctx.reply(t(ctx, "Не получилось — попробуй ещё раз.", "Didn't work — try again."));
    return;
  }

  track("title_set", { userId: user.id });
  await ctx.reply(t(ctx, `Готово. Книга теперь называется «${result.title}».`, `Done. Your book is now called "${result.title}".`));
}
