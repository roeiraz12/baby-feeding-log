import crypto from "node:crypto";
import { send, readJson } from "../../../lib/http.js";
import { rateLimit } from "../../../lib/ratelimit.js";
import { getDevice, saveDevice, deleteDevice } from "../../../lib/store.js";

const isStr = (v, max) => typeof v === "string" && v.length > 0 && v.length <= max;
const isCount = (v) => Number.isInteger(v) && v >= 0 && v < 1000;
const isGoal = (v) => Number.isInteger(v) && v >= 1 && v <= 20;

// Constant-time token comparison (different lengths never match).
function sameToken(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// POST /api/public/push/device
// { id, token, subscription:{endpoint, keys:{p256dh, auth}}, enabled, day:"YYYY-MM-DD", wet, dirty,
//   wetGoal?, dirtyGoal? (integers 1-20; missing = defaults 6 / 3) }
export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "method not allowed" });
  if (!(await rateLimit(req, "push-device", 30, 600))) return send(res, 429, { error: "too many requests" });
  let b;
  try { b = await readJson(req); } catch { return send(res, 400, { error: "bad json" }); }

  if (!b || !isStr(b.id, 64) || !/^[\w-]+$/.test(b.id) || !isStr(b.token, 128)) {
    return send(res, 400, { error: "bad device" });
  }
  const existing = await getDevice(b.id);
  // The random token proves the caller is the device that registered this id.
  if (existing && !sameToken(existing.token, b.token)) return send(res, 403, { error: "forbidden" });

  if (b.enabled !== true) {
    if (existing) await deleteDevice(b.id);
    return send(res, 200, { ok: true, enabled: false });
  }

  const s = b.subscription;
  if (!s || !isStr(s.endpoint, 1024) || !/^https:\/\//.test(s.endpoint) || !s.keys ||
      !isStr(s.keys.p256dh, 256) || !isStr(s.keys.auth, 128)) {
    return send(res, 400, { error: "bad subscription" });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.day || "") || !isCount(b.wet) || !isCount(b.dirty)) {
    return send(res, 400, { error: "bad counts" });
  }
  if ((b.wetGoal != null && !isGoal(b.wetGoal)) || (b.dirtyGoal != null && !isGoal(b.dirtyGoal))) {
    return send(res, 400, { error: "bad goals" });
  }

  await saveDevice(b.id, {
    token: b.token,
    subscription: { endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth } },
    day: b.day,
    wet: b.wet,
    dirty: b.dirty,
    wetGoal: b.wetGoal ?? null,
    dirtyGoal: b.dirtyGoal ?? null,
    lastSentDay: existing ? existing.lastSentDay || null : null,
    updatedAt: Date.now(),
  });
  send(res, 200, { ok: true, enabled: true });
}
