import { getRedis } from "./redis.js";

// Ephemeral "what is this user about to type next" state, stored in Redis with TTL.
// Used for short, single-step input flows (e.g. picking a book title) that don't
// warrant a new UserState enum value. Keys auto-expire so a forgotten flow doesn't
// permanently route the user's next message into the wrong handler.

// Sprint 2.6 — pending actions are namespaced strings like `page_revise:<id>`
// or `page_retitle:<id>`. Pre-existing single-token actions (e.g. "title")
// continue to work — callers just pass them as-is.
export type PendingAction = string;

const PENDING_TTL_SECONDS = 180;

function pendingKey(userId: string): string {
  return `pending:${userId}`;
}

export async function setPending(userId: string, action: PendingAction): Promise<void> {
  await getRedis().set(pendingKey(userId), action, "EX", PENDING_TTL_SECONDS);
}

export async function getPending(userId: string): Promise<PendingAction | null> {
  const value = await getRedis().get(pendingKey(userId));
  return (value as PendingAction | null) ?? null;
}

export async function clearPending(userId: string): Promise<void> {
  await getRedis().del(pendingKey(userId));
}

// ── Intake question pointer ─────────────────────────────────────────────────
// Tracks which onboarding intake question (0..N-1) the user is currently on.
// Backed by Redis with a longer TTL since onboarding may span sessions and
// reflective questions can take minutes to compose.

const INTAKE_TTL_SECONDS = 60 * 60; // 1h

function intakeKey(userId: string): string {
  return `intake:${userId}`;
}

export async function setIntakeIndex(userId: string, index: number): Promise<void> {
  await getRedis().set(intakeKey(userId), String(index), "EX", INTAKE_TTL_SECONDS);
}

export async function getIntakeIndex(userId: string): Promise<number | null> {
  const value = await getRedis().get(intakeKey(userId));
  if (!value) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export async function clearIntakeIndex(userId: string): Promise<void> {
  await getRedis().del(intakeKey(userId));
}
