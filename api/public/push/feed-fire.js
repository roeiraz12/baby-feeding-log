import webpush from "web-push";
import { send, readRaw } from "../../../lib/http.js";
import { getDevice, saveDevice, deleteDevice } from "../../../lib/store.js";
import { signingKeys, verifySignature, fireUrls } from "../../../lib/qstash.js";
import { feedPayload, isShabbat } from "../../../lib/feed.js";

// POST /api/public/push/feed-fire — called by QStash at a reminder's dueAt (never by the app).
// Body {deviceId, dueAt}; must carry a valid Upstash-Signature.
// Sends only if this is still the device's current reminder (a newer feeding replaced it → ignored),
// not on Shabbat, and not twice. 2xx = done (QStash stops); 5xx = QStash retries.
export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "method not allowed" });
  const keys = signingKeys();
  if (!keys.length) return send(res, 503, { error: "qstash not configured" });

  let raw;
  try { raw = await readRaw(req); } catch { return send(res, 413, { error: "too large" }); }
  const sig = req.headers["upstash-signature"];
  const check = verifySignature(Array.isArray(sig) ? sig[0] : sig, raw, { keys, urls: fireUrls(req) });
  if (!check.ok) return send(res, 401, { error: "invalid signature", reason: check.reason });

  let b;
  try { b = JSON.parse(raw.toString("utf8")); } catch { return send(res, 200, { skipped: "bad body" }); }
  if (!b || typeof b.deviceId !== "string" || !Number.isInteger(b.dueAt)) return send(res, 200, { skipped: "bad body" });

  const d = await getDevice(b.deviceId);
  if (!d) return send(res, 200, { skipped: "no device" });
  const f = d.feed;
  if (!f || f.dueAt !== b.dueAt) return send(res, 200, { skipped: "stale" });
  if (f.sentAt) return send(res, 200, { skipped: "already sent" });
  const now = Date.now();
  if (now < b.dueAt - 5 * 6e4) return send(res, 200, { skipped: "early" });
  if (isShabbat(now)) {
    await markDone(b.deviceId, b.dueAt, { skippedAt: now });
    return send(res, 200, { skipped: "shabbat" });
  }

  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT) return send(res, 500, { error: "VAPID env vars missing" });
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

  try {
    await webpush.sendNotification(d.subscription, JSON.stringify(feedPayload(f.lastStart, f.dueAt)), {
      TTL: 3600, urgency: "high", topic: "feed-alarm",
    });
  } catch (err) {
    if (err && (err.statusCode === 404 || err.statusCode === 410)) {
      await deleteDevice(b.deviceId);
      return send(res, 200, { removed: true });
    }
    console.error("feed reminder: push failed", b.deviceId, err && err.statusCode, err && (err.body || err.message));
    return send(res, 502, { error: "push failed" }); // QStash retries
  }
  await markDone(b.deviceId, b.dueAt, { sentAt: Date.now() });
  send(res, 200, { sent: true });
}

// Re-read before writing, so a reminder rescheduled meanwhile is not overwritten.
async function markDone(id, dueAt, patch) {
  const cur = await getDevice(id);
  if (cur && cur.feed && cur.feed.dueAt === dueAt) {
    await saveDevice(id, { ...cur, feed: { ...cur.feed, messageId: null, ...patch } });
  }
}
