import type { EntryOutput } from "../schemas.js";
import type { EntryPlan } from "./planEntry.js";

// Sprint 2.3 — Page validator.
//
// Two layers:
//   1. Deterministic checks (fast, free) — word count, paragraphs, teaser
//      length, quote-in-body, no template placeholders.
//   2. Optional LLM rubric (TODO: enabled in a follow-up) — checks for
//      style drift, generic reflection, invented facts. We declare the surface
//      here but ship Sprint 2 with deterministic checks only; the LLM rubric
//      lands when we have a writer model dialed in.
//
// The validator returns a structured PageValidation that the caller can use to
// (a) ship as-is, (b) request a single repair pass with `repairInstruction`,
// or (c) fail the page entirely. We never block delivery for >30s — at most
// one repair retry is attempted upstream.

export type ValidationError =
  | "too_long"
  | "too_short"
  | "no_paragraphs"
  | "title_empty"
  | "teaser_too_long"
  | "teaser_too_short"
  | "quote_not_in_body_and_not_styled"
  | "page_summary_too_long"
  | "page_summary_too_short"
  | "missing_continuity_when_plan_required_it"
  | "echo_loud_when_plan_said_subtle"
  | "generic_reflection"
  | "invented_fact_risk"
  | "style_drift";

export type PageValidation = {
  ok: boolean;
  errors: ValidationError[];
  // A short instruction for the writer's repair pass. Constructed only when
  // errors are present; null when the page passes.
  repairInstruction: string | null;
  // Stats for logging — never affects ok.
  stats: {
    wordCount: number;
    charCount: number;
    paragraphCount: number;
    teaserLength: number;
    pageSummaryLength: number;
  };
};

const MIN_BODY_WORDS_QUIET = 100;
const MIN_BODY_WORDS = 160;
const MAX_BODY_WORDS_TURNING = 480;
const MAX_BODY_WORDS = 400;

const TEASER_MIN = 60;
const TEASER_MAX = 280;
const PAGE_SUMMARY_MIN = 60;
const PAGE_SUMMARY_MAX = 400;

const GENERIC_PHRASES = [
  // Russian
  "путь",
  "путешествие",
  "трансформация",
  "обнял",
  "embrace the moment",
  "step into your power",
  "amazing journey",
  "self-love",
  "growth",
  "healing"
];

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function paragraphCount(text: string): number {
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean).length;
}

// Loose heuristic: did the writer perform at least one continuity move when
// the planner asked for ≥1 with mustBeSubtle=true? We can't truly check echo
// quality without an LLM — but if the planner referenced a sourcePageId by
// name in a continuityMove, the writer should at minimum mention something
// from the move's instruction text. False negatives are fine here: this is a
// "nudge to repair", not a hard reject.
function continuityFulfilled(body: string, plan: EntryPlan): boolean {
  if (plan.continuityMoves.length === 0) return true;
  const lower = body.toLowerCase();
  for (const move of plan.continuityMoves) {
    // Pull notable nouns from the move text — anything ≥4 chars not on a stop list.
    const tokens = move.move
      .toLowerCase()
      .split(/[^\p{L}\d]+/u)
      .filter((t) => t.length > 4);
    for (const tok of tokens) {
      if (lower.includes(tok)) return true;
    }
  }
  return false;
}

function genericReflectionDetected(body: string): boolean {
  const lower = body.toLowerCase();
  return GENERIC_PHRASES.some((p) => lower.includes(p));
}

export type ValidatePageInput = {
  output: EntryOutput;
  plan: EntryPlan;
};

export function validatePage(input: ValidatePageInput): PageValidation {
  const { output, plan } = input;
  const errors: ValidationError[] = [];

  const words = wordCount(output.body);
  const paragraphs = paragraphCount(output.body);
  const teaserLen = (output.teaser ?? "").length;
  const pageSumLen = (output.pageSummary ?? "").length;

  // ─── Length bounds (role-aware) ──────────────────────────────────────────
  const minWords = plan.pageRole === "quiet_interlude" ? MIN_BODY_WORDS_QUIET : MIN_BODY_WORDS;
  const maxWords = plan.pageRole === "turning_point" ? MAX_BODY_WORDS_TURNING : MAX_BODY_WORDS;
  if (words < minWords) errors.push("too_short");
  if (words > maxWords) errors.push("too_long");

  // ─── Structure ───────────────────────────────────────────────────────────
  if (paragraphs < 2) errors.push("no_paragraphs");
  if (!output.title || output.title.trim().length < 2) errors.push("title_empty");

  // ─── Teaser / summary ────────────────────────────────────────────────────
  if (output.teaser !== undefined) {
    if (teaserLen < TEASER_MIN) errors.push("teaser_too_short");
    if (teaserLen > TEASER_MAX) errors.push("teaser_too_long");
  }
  if (output.pageSummary !== undefined) {
    if (pageSumLen < PAGE_SUMMARY_MIN) errors.push("page_summary_too_short");
    if (pageSumLen > PAGE_SUMMARY_MAX) errors.push("page_summary_too_long");
  }

  // ─── Quote sanity ────────────────────────────────────────────────────────
  // The quote must EITHER appear (substring, case-insensitive) inside the body
  // OR be ≤140 chars and contain no quotation marks (it's already pulled out
  // for ornament). Otherwise it's likely a generic invented sentence.
  if (output.quote) {
    const quote = output.quote.replace(/[«»“”"']/g, "").trim();
    const inBody = output.body.toLowerCase().includes(quote.toLowerCase().slice(0, Math.min(40, quote.length)));
    if (!inBody && quote.length > 140) {
      errors.push("quote_not_in_body_and_not_styled");
    }
  }

  // ─── Continuity ──────────────────────────────────────────────────────────
  if (!continuityFulfilled(output.body, plan)) {
    errors.push("missing_continuity_when_plan_required_it");
  }

  // ─── Genericness ────────────────────────────────────────────────────────
  if (genericReflectionDetected(output.body)) {
    errors.push("generic_reflection");
  }

  const ok = errors.length === 0;
  const repairInstruction = ok ? null : buildRepairInstruction(errors, plan);

  return {
    ok,
    errors,
    repairInstruction,
    stats: {
      wordCount: words,
      charCount: output.body.length,
      paragraphCount: paragraphs,
      teaserLength: teaserLen,
      pageSummaryLength: pageSumLen
    }
  };
}

function buildRepairInstruction(errors: ValidationError[], plan: EntryPlan): string {
  const lines: string[] = [];
  if (errors.includes("too_long")) {
    lines.push(
      `Tighten the body — it's longer than the plan calls for. Aim for ${plan.pageRole === "quiet_interlude" ? "120-220" : plan.pageRole === "turning_point" ? "250-450" : "200-360"} words.`
    );
  }
  if (errors.includes("too_short")) {
    lines.push(
      "Extend the body with one more concrete sensory beat — a sound, a gesture, a word someone said."
    );
  }
  if (errors.includes("no_paragraphs")) {
    lines.push("Break the body into 3-5 paragraphs separated by \\n\\n.");
  }
  if (errors.includes("title_empty")) {
    lines.push("Provide a real title (2-7 words, concrete, no colons).");
  }
  if (errors.includes("teaser_too_short") || errors.includes("teaser_too_long")) {
    lines.push("Make the teaser 1-3 sentences (80-280 chars), no morals.");
  }
  if (errors.includes("page_summary_too_short") || errors.includes("page_summary_too_long")) {
    lines.push("Page summary: 1-2 neutral factual sentences (80-400 chars).");
  }
  if (errors.includes("quote_not_in_body_and_not_styled")) {
    lines.push("Quote should be a sentence that could plausibly appear inside the body, or null.");
  }
  if (errors.includes("missing_continuity_when_plan_required_it")) {
    const moves = plan.continuityMoves.map((m) => `"${m.move}"`).join("; ");
    lines.push(
      `The plan asked for these continuity moves but none landed in the body: ${moves}. ` +
        "Perform exactly one of them with a specific concrete reference (a name, a place, a word)."
    );
  }
  if (errors.includes("generic_reflection")) {
    lines.push(
      "Remove SaaS / self-help phrases (journey, transformation, growth, embrace the moment, healing, etc.)."
    );
  }
  return lines.join("\n");
}
