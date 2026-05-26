import { createHmac } from "node:crypto";
import { config } from "../config.js";

// Sprint 4.8 — Mini App authentication helpers.
//
// Two pieces:
//   1. verifyTelegramInitData(initData) — validates the `tgWebAppData` string
//      Telegram passes to a Mini App per
//      https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
//   2. issueJwt(payload) / verifyJwt(token) — minimal HS256 JWT so the Mini
//      App's REST calls to /api/* can present a short-lived bearer token
//      without keeping a session table.
//
// We use node:crypto's HMAC primitives; no external JWT library required.

// ─── tgWebAppData verification ─────────────────────────────────────────────

export type TgInitDataUser = {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
};

export type TgInitDataVerified = {
  ok: true;
  user: TgInitDataUser;
  authDateUnix: number;
  raw: string;
};

export type TgInitDataInvalid = {
  ok: false;
  reason:
    | "no_bot_token"
    | "no_init_data"
    | "missing_hash"
    | "bad_hash"
    | "stale"
    | "no_user"
    | "malformed";
};

const MAX_AUTH_AGE_SECONDS = 24 * 60 * 60;

export function verifyTelegramInitData(initData: string): TgInitDataVerified | TgInitDataInvalid {
  if (!config.TELEGRAM_BOT_TOKEN) return { ok: false, reason: "no_bot_token" };
  if (!initData) return { ok: false, reason: "no_init_data" };

  // Parse the URL-encoded query string. `hash` is the signature; everything
  // else goes into the data-check string sorted alphabetically.
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return { ok: false, reason: "missing_hash" };
  params.delete("hash");

  const dataCheckLines: string[] = [];
  const keys: string[] = [];
  params.forEach((_, key) => keys.push(key));
  keys.sort();
  for (const key of keys) {
    dataCheckLines.push(`${key}=${params.get(key)}`);
  }
  const dataCheckString = dataCheckLines.join("\n");

  // Per Telegram spec, the secret key is HMAC-SHA256("WebAppData", BOT_TOKEN).
  const secretKey = createHmac("sha256", "WebAppData").update(config.TELEGRAM_BOT_TOKEN).digest();
  const computedHash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
  if (computedHash !== hash) return { ok: false, reason: "bad_hash" };

  // Freshness check (mitigates replay).
  const authDateRaw = params.get("auth_date");
  const authDateUnix = authDateRaw ? Number.parseInt(authDateRaw, 10) : 0;
  const nowUnix = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(authDateUnix) || nowUnix - authDateUnix > MAX_AUTH_AGE_SECONDS) {
    return { ok: false, reason: "stale" };
  }

  // Parse user JSON.
  const userJson = params.get("user");
  if (!userJson) return { ok: false, reason: "no_user" };
  let user: TgInitDataUser;
  try {
    user = JSON.parse(userJson);
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!user || typeof user.id !== "number") return { ok: false, reason: "no_user" };

  return { ok: true, user, authDateUnix, raw: initData };
}

// ─── HS256 JWT (no external lib) ───────────────────────────────────────────

function b64urlEncode(input: Buffer | string): string {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input, "utf8");
  return buf
    .toString("base64")
    .replace(/=+$/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function b64urlDecode(input: string): Buffer {
  const pad = input.length % 4 === 0 ? "" : "=".repeat(4 - (input.length % 4));
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/") + pad;
  return Buffer.from(b64, "base64");
}

export type MiniAppJwtPayload = {
  // Internal user id; the Mini App API uses this to scope queries.
  sub: string;
  tgId: number;
  iat: number;
  exp: number;
};

export function issueJwt(payload: { sub: string; tgId: number }): string {
  if (!config.MINIAPP_JWT_SECRET) {
    throw new Error("MINIAPP_JWT_SECRET is not configured");
  }
  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const full: MiniAppJwtPayload = {
    sub: payload.sub,
    tgId: payload.tgId,
    iat: now,
    exp: now + config.MINIAPP_JWT_TTL_SECONDS
  };
  const encHeader = b64urlEncode(JSON.stringify(header));
  const encPayload = b64urlEncode(JSON.stringify(full));
  const signingInput = `${encHeader}.${encPayload}`;
  const signature = createHmac("sha256", config.MINIAPP_JWT_SECRET)
    .update(signingInput)
    .digest();
  return `${signingInput}.${b64urlEncode(signature)}`;
}

export type VerifiedJwt =
  | { ok: true; payload: MiniAppJwtPayload }
  | { ok: false; reason: "missing_secret" | "malformed" | "bad_signature" | "expired" };

export function verifyJwt(token: string): VerifiedJwt {
  if (!config.MINIAPP_JWT_SECRET) return { ok: false, reason: "missing_secret" };
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed" };
  const [h, p, s] = parts as [string, string, string];
  const signingInput = `${h}.${p}`;
  const expected = createHmac("sha256", config.MINIAPP_JWT_SECRET)
    .update(signingInput)
    .digest();
  const provided = b64urlDecode(s);
  if (expected.length !== provided.length) return { ok: false, reason: "bad_signature" };
  let mismatch = 0;
  for (let i = 0; i < expected.length; i += 1) mismatch |= expected[i]! ^ provided[i]!;
  if (mismatch !== 0) return { ok: false, reason: "bad_signature" };

  let payload: MiniAppJwtPayload;
  try {
    payload = JSON.parse(b64urlDecode(p).toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  const now = Math.floor(Date.now() / 1000);
  if (!payload.exp || payload.exp < now) return { ok: false, reason: "expired" };
  return { ok: true, payload };
}
