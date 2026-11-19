// Upstash QStash (delayed HTTP messages) for the "next feeding" push reminder.
// Plain fetch + node:crypto, no SDK.
//
//   publish: POST {QSTASH_URL}/v2/publish/<destination>  (Upstash-Not-Before = unix seconds) → {messageId}
//   cancel:  DELETE {QSTASH_URL}/v2/messages/<messageId>  (404 = already delivered / gone: ignored)
//   verify:  the Upstash-Signature JWT (HS256) QStash adds when it calls the destination.
//
// Env: QSTASH_TOKEN (publish/cancel), QSTASH_URL (optional, default https://qstash.upstash.io),
//      QSTASH_CURRENT_SIGNING_KEY / QSTASH_NEXT_SIGNING_KEY (verify),
//      PUBLIC_BASE_URL (optional; else https://VERCEL_PROJECT_PRODUCTION_URL; else the request host).
import crypto from "node:crypto";

export const FIRE_PATH = "/api/public/push/feed-fire";

const env = () => process.env;
const qstashBase = () => (env().QSTASH_URL || "https://qstash.upstash.io").replace(/\/+$/, "");

/** true when messages can be published (QSTASH_TOKEN is set). */
export function qstashConfigured() {
  return !!env().QSTASH_TOKEN;
}

/** The signing keys that are set (current first). */
export function signingKeys() {
  return [env().QSTASH_CURRENT_SIGNING_KEY, env().QSTASH_NEXT_SIGNING_KEY].filter(Boolean);
}

/** Origin of the request itself ("https://host"), or null. */
export function requestOrigin(req) {
  const h = req.headers || {};
  const first = (v) => (Array.isArray(v) ? v[0] : v || "").split(",")[0].trim();
  const host = first(h["x-forwarded-host"]) || first(h.host);
  if (!host || !/^[\w.:[\]-]+$/.test(host)) return null;
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
  const proto = first(h["x-forwarded-proto"]) || (local ? "http" : "https");
  return `${proto === "http" ? "http" : "https"}://${host}`;
}

/** Public origin QStash should call: PUBLIC_BASE_URL, else the production domain, else the request host. */
export function publicOrigin(req) {
  const e = env();
  if (e.PUBLIC_BASE_URL) return e.PUBLIC_BASE_URL.replace(/\/+$/, "");
  if (e.VERCEL_PROJECT_PRODUCTION_URL) return `https://${e.VERCEL_PROJECT_PRODUCTION_URL.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`;
  return requestOrigin(req);
}

/** URLs a valid signature may name as `sub` for this request (configured origin + the request's own). */
export function fireUrls(req) {
  return [...new Set([publicOrigin(req), requestOrigin(req)].filter(Boolean).map((o) => o + FIRE_PATH))];
}

/**
 * Publishes `body` (JSON) to `url`, delivered not before `notBeforeMs`. → messageId.
 * Throws on a network error or a non-2xx answer.
 */
export async function publishDelayed(url, body, notBeforeMs, { fetchImpl = fetch } = {}) {
  const res = await fetchImpl(`${qstashBase()}/v2/publish/${url}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env().QSTASH_TOKEN}`,
      "Content-Type": "application/json",
      "Upstash-Not-Before": String(Math.ceil(notBeforeMs / 1000)),
      "Upstash-Retries": "2",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`qstash publish ${res.status}: ${text.slice(0, 200)}`);
  let id = null;
  try { id = JSON.parse(text).messageId; } catch { /* handled below */ }
  if (typeof id !== "string" || !id) throw new Error("qstash publish: no messageId");
  return id;
}

/** Deletes a scheduled message. Never throws; → true if it is gone (deleted, or 404 = already delivered). */
export async function cancelMessage(id, { fetchImpl = fetch } = {}) {
  if (!id || !qstashConfigured()) return false;
  try {
    const res = await fetchImpl(`${qstashBase()}/v2/messages/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${env().QSTASH_TOKEN}` },
    });
    if (res.ok || res.status === 404) return true;
    console.error("qstash cancel failed", id, res.status);
    return false;
  } catch (err) {
    console.error("qstash cancel failed", id, err && err.message);
    return false;
  }
}

/* ------------------------------------------------------------------ signature */
const b64urlJson = (s) => JSON.parse(Buffer.from(s, "base64url").toString("utf8"));
const unpad = (s) => String(s).replace(/=+$/, "");

function sameStr(a, b) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/**
 * Checks an Upstash-Signature JWT: HS256 with one of `keys`, iss "Upstash", `sub` one of `urls`,
 * not expired / not before (±`toleranceSec`), and `body` = base64url(sha256(rawBody)).
 * → {ok:true, claims} or {ok:false, reason}.
 */
export function verifySignature(jwt, rawBody, { keys, urls, now = Date.now(), toleranceSec = 30 }) {
  if (typeof jwt !== "string" || !jwt) return { ok: false, reason: "missing signature" };
  if (!keys || !keys.length) return { ok: false, reason: "no signing keys" };
  const parts = jwt.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed" };
  let header, claims;
  try { header = b64urlJson(parts[0]); claims = b64urlJson(parts[1]); } catch { return { ok: false, reason: "malformed" }; }
  if (!header || header.alg !== "HS256") return { ok: false, reason: "bad alg" };
  const signed = `${parts[0]}.${parts[1]}`;
  const sig = unpad(parts[2]);
  const keyOk = keys.some((k) => sameStr(crypto.createHmac("sha256", k).update(signed).digest("base64url"), sig));
  if (!keyOk) return { ok: false, reason: "bad signature" };
  if (!claims || claims.iss !== "Upstash") return { ok: false, reason: "bad iss" };
  const t = now / 1000;
  if (typeof claims.exp !== "number" || t > claims.exp + toleranceSec) return { ok: false, reason: "expired" };
  if (typeof claims.nbf === "number" && t < claims.nbf - toleranceSec) return { ok: false, reason: "not yet valid" };
  if (!urls || !urls.includes(claims.sub)) return { ok: false, reason: "bad sub" };
  const hash = crypto.createHash("sha256").update(rawBody || Buffer.alloc(0)).digest("base64url");
  if (typeof claims.body !== "string" || unpad(claims.body) !== unpad(hash)) return { ok: false, reason: "bad body hash" };
  return { ok: true, claims };
}
