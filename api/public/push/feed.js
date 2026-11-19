import { send, readJson } from "../../../lib/http.js";
import { rateLimit } from "../../../lib/ratelimit.js";
import { getDevice, saveDevice } from "../../../lib/store.js";
import { qstashConfigured, publishDelayed, cancelMessage, publicOrigin, FIRE_PATH } from "../../../lib/qstash.js";
import { sameToken, MIN_INTERVAL_MS, MAX_INTERVAL_MS, MAX_AHEAD_MS, PAST_SLACK_MS } from "../../../lib/feed.js";

const isStr = (v, max) => typeof v === "string" && v.length > 0 && v.length <= max;

// POST /api/public/push/feed — schedule / cancel this device's one "next feeding" reminder.
// { id, token, dueAt: ms | null, lastStart: ms | null }
//   dueAt = start of the last feeding + the feed interval; null cancels.
// The device must already be registered via /api/public/push/device (same id + token).
// → 200 {ok, dueAt} · 400 bad input · 403 wrong token · 404 unknown device · 429 · 502 QStash error
//   · 503 {error:"qstash not configured"} (scheduling only; cancelling still works)
// QStash calls /api/public/push/feed-fire at dueAt; only the current dueAt is sent (older messages are ignored).
export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "method not allowed" });
  if (!(await rateLimit(req, "push-feed", 60, 600))) return send(res, 429, { error: "too many requests" });
  let b;
  try { b = await readJson(req); } catch { return send(res, 400, { error: "bad json" }); }

  if (!b || !isStr(b.id, 64) || !/^[\w-]+$/.test(b.id) || !isStr(b.token, 128)) {
    return send(res, 400, { error: "bad device" });
  }
  const now = Date.now();
  const cancel = b.dueAt === null || b.dueAt === undefined;
  if (!cancel) {
    const { dueAt, lastStart } = b;
    if (!Number.isInteger(dueAt) || dueAt < now - PAST_SLACK_MS || dueAt > now + MAX_AHEAD_MS) {
      return send(res, 400, { error: "bad dueAt" });
    }
    if (!Number.isInteger(lastStart) || dueAt - lastStart < MIN_INTERVAL_MS || dueAt - lastStart > MAX_INTERVAL_MS) {
      return send(res, 400, { error: "bad lastStart" });
    }
  }

  const device = await getDevice(b.id);
  if (!device) return send(res, 404, { error: "unknown device" });
  if (!sameToken(device.token, b.token)) return send(res, 403, { error: "forbidden" });
  const prev = device.feed || null;

  if (cancel) {
    if (prev && prev.messageId) await cancelMessage(prev.messageId);
    if (prev) await saveDevice(b.id, { ...device, feed: null });
    return send(res, 200, { ok: true, dueAt: null });
  }

  // Same reminder again (e.g. a forced resync): nothing to do.
  if (prev && prev.dueAt === b.dueAt && prev.lastStart === b.lastStart && (prev.messageId || prev.sentAt || prev.skippedAt)) {
    return send(res, 200, { ok: true, dueAt: b.dueAt, unchanged: true });
  }
  if (!qstashConfigured()) return send(res, 503, { error: "qstash not configured" });
  const origin = publicOrigin(req);
  if (!origin) return send(res, 500, { error: "no public url" });

  let messageId;
  try {
    messageId = await publishDelayed(origin + FIRE_PATH, { deviceId: b.id, dueAt: b.dueAt }, b.dueAt);
  } catch (err) {
    console.error("feed reminder: publish failed", err && err.message);
    return send(res, 502, { error: "qstash publish failed" });
  }
  if (prev && prev.messageId) await cancelMessage(prev.messageId);
  await saveDevice(b.id, { ...device, feed: { dueAt: b.dueAt, lastStart: b.lastStart, messageId } });
  send(res, 200, { ok: true, dueAt: b.dueAt });
}
