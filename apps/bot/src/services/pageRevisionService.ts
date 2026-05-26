import { type Page, type User } from "@prisma/client";
import { revisePage, rewriteTitle } from "@lifebook/ai";
import { pickWeekColor } from "@lifebook/renderer";
import { prisma } from "../lib/db.js";
import { logger } from "../lib/logger.js";
import { enqueueEmbedding } from "../queues/index.js";
import { generateShareToken } from "./pageService.js";

// Sprint 2.6 service — Versioned point revision.
//
// Creates a NEW Page row that is v(prev.version+1), revisionOfId=prev.id, with
// isCurrent=true; flips the previous version's isCurrent=false. Both rows
// stay in the database forever — old versions are visible in the Mini App
// page-history view (Sprint 4) and used to reconstruct «what was the page
// before I changed it».
//
// One-current-per-chain integrity: enforced by the partial unique index
// `WHERE isCurrent=true` on COALESCE(revisionOfId, id) in the schema, plus
// our explicit transaction here.

function language(user: Pick<User, "languageCode">): "ru" | "en" {
  return (user.languageCode || "").toLowerCase().startsWith("en") ? "en" : "ru";
}

export async function reviseExistingPage(opts: {
  user: User;
  pageId: string;
  userInstruction: string;
}): Promise<Page> {
  const prev = await prisma.page.findFirst({
    where: { id: opts.pageId, userId: opts.user.id, isCurrent: true }
  });
  if (!prev) {
    throw new Error("revisePage: page not found or not current");
  }

  const revised = await revisePage({
    language: language(opts.user),
    previous: {
      title: prev.sceneTitle,
      body: prev.sceneContent,
      quote: prev.quote ?? null,
      teaser: prev.teaser ?? null,
      pageSummary: prev.summary ?? null,
      mood: prev.mood,
      tags: prev.tags
    },
    userInstruction: opts.userInstruction
  });

  const accent = pickWeekColor({ mood: revised.mood, tags: revised.tags, fallbackSeed: revised.title }).key;

  // Three-step transaction:
  //   1. Move shareToken off prev (Page.shareToken is @unique so we can't have
  //      two rows holding it simultaneously). Append `-v<n>` suffix so the
  //      historical row still has a unique non-conflicting token.
  //   2. Flip prev.isCurrent=false (partial-unique index requires exactly one
  //      isCurrent=true per chain).
  //   3. Create the new revision row with the original shareToken transferred.
  const next = await prisma.$transaction(async (tx) => {
    if (prev.shareToken) {
      await tx.page.update({
        where: { id: prev.id },
        data: { shareToken: `${prev.shareToken}-v${prev.version}` }
      });
    }
    await tx.page.update({
      where: { id: prev.id },
      data: { isCurrent: false }
    });
    return tx.page.create({
      data: {
        userId: prev.userId,
        entryId: prev.entryId,
        chapterId: prev.chapterId,
        sceneTitle: revised.title,
        sceneContent: revised.body,
        quote: revised.quote ?? null,
        teaser: revised.teaser ?? null,
        summary: revised.pageSummary ?? null,
        mood: revised.mood,
        tags: revised.tags,
        accentColor: accent,
        biographerNote: "",
        kind: prev.kind,
        version: prev.version + 1,
        revisionOfId: prev.id,
        isCurrent: true,
        // Inherit the chain's canonical share token. Mini App URLs that
        // reference this token continue to point at the latest version of the
        // page.
        shareToken: prev.shareToken,
        sourceContext: {
          revisedFrom: prev.id,
          userInstruction: opts.userInstruction.slice(0, 1000)
        }
      }
    });
  });

  // Re-embed: the body changed, so the existing embedding is stale. The job
  // is idempotent — it'll skip if the bodyHash happens to match (e.g. a no-op
  // revision).
  await enqueueEmbedding({ pageId: next.id, userId: next.userId }).catch(() => {});

  logger.info(
    {
      event: "page.revised",
      userId: next.userId,
      previousPageId: prev.id,
      newPageId: next.id,
      newVersion: next.version,
      instructionLength: opts.userInstruction.length
    },
    "page.revised"
  );

  return next;
}

export async function rewritePageTitle(opts: {
  user: User;
  pageId: string;
  userInstruction?: string;
}): Promise<Page> {
  const prev = await prisma.page.findFirst({
    where: { id: opts.pageId, userId: opts.user.id, isCurrent: true }
  });
  if (!prev) {
    throw new Error("rewriteTitle: page not found or not current");
  }
  const out = await rewriteTitle({
    language: language(opts.user),
    body: prev.sceneContent,
    ...(opts.userInstruction ? { userInstruction: opts.userInstruction } : {})
  });

  // Title-only rewrite still bumps version (so old version is recoverable),
  // but body / teaser / mood / tags are reused unchanged. Same three-step
  // shareToken handoff as reviseExistingPage above.
  const next = await prisma.$transaction(async (tx) => {
    if (prev.shareToken) {
      await tx.page.update({
        where: { id: prev.id },
        data: { shareToken: `${prev.shareToken}-v${prev.version}` }
      });
    }
    await tx.page.update({ where: { id: prev.id }, data: { isCurrent: false } });
    return tx.page.create({
      data: {
        userId: prev.userId,
        entryId: prev.entryId,
        chapterId: prev.chapterId,
        sceneTitle: out.title,
        sceneContent: prev.sceneContent,
        quote: prev.quote,
        teaser: prev.teaser,
        summary: prev.summary,
        mood: prev.mood,
        tags: prev.tags,
        accentColor: prev.accentColor,
        biographerNote: prev.biographerNote ?? "",
        kind: prev.kind,
        version: prev.version + 1,
        revisionOfId: prev.id,
        isCurrent: true,
        shareToken: prev.shareToken,
        sourceContext: { titleOnlyRevisionFrom: prev.id }
      }
    });
  });
  // Body unchanged → embedding still valid; we still call embedPage so it
  // notices via bodyHash and fast-paths to "skipped: unchanged".
  await enqueueEmbedding({ pageId: next.id, userId: next.userId }).catch(() => {});
  logger.info(
    {
      event: "page.title_rewritten",
      userId: next.userId,
      previousPageId: prev.id,
      newPageId: next.id,
      newVersion: next.version
    },
    "page.title_rewritten"
  );

  // Note: shareToken: must remain unique. If the user has issued the same
  // version-of-version (e.g. v3 from v2), `${prev.shareToken}-v${prev.version}`
  // is unique because the prev row is the only one to ever carry that
  // (token, version) pair. If a collision ever happens (very rare race), the
  // unique constraint will throw — caller surfaces a friendly error.
  return next;
}
