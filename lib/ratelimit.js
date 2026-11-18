// Fixed-window rate limiting per client IP for the api/ functions.
// Redis (shared client from lib/redis.js): INCR + EXPIRE on the first hit (≤ 2 commands).
// Without Redis: an in-memory Map (per server instance; fine for local dev).
import { redis } from "./redis.js";

const mem = globalThis.__rateMem || (globalThis.__rateMem = new Map());

/** Client IP: first x-forwarded-for entry, else the socket address. */
export function clientIp(req) {
  const fwd = req.headers?.["x-forwarded-for"];
  const first = (Array.isArray(fwd) ? fwd[0] : fwd || "").split(",")[0].trim();
  return first || req.socket?.remoteAddress || "unknown";
}

/**
 * true if this request is allowed: at most `limit` requests per `windowSec` seconds
 * per client IP in `bucket` (e.g. "sync-push"). Fails open if Redis errors.
 */
export async function rateLimit(req, bucket, limit, windowSec) {
  const key = `rl:${bucket}:${clientIp(req)}`;
  if (redis) {
    try {
      const count = await redis.incr(key);
      if (count === 1) await redis.expire(key, windowSec);
      return count <= limit;
    } catch (err) {
      console.error("rateLimit: redis error, allowing request", err);
      return true;
    }
  }
  const now = Date.now();
  let entry = mem.get(key);
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + windowSec * 1000 };
    mem.set(key, entry);
  }
  entry.count++;
  if (mem.size > 10000) {
    for (const [k, v] of mem) if (v.resetAt <= now) mem.delete(k);
  }
  return entry.count <= limit;
}
