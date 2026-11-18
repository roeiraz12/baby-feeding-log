import { send, readJson } from "../../../lib/http.js";
import { getDevice, saveDevice, deleteDevice } from "../../../lib/store.js";

const isStr = (v, max) => typeof v === "string" && v.length > 0 && v.length <= max;
const isCount = (v) => Number.isInteger(v) && v >= 0 && v < 1000;

// POST /api/public/push/device
// { id, token, subscription:{endpoint, keys:{p256dh, auth}}, enabled, day:"YYYY-MM-DD", wet, dirty }
export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "method not allowed" });
  let b;
  try { b = await readJson(req); } catch { return send(res, 400, { error: "bad json" }); }

  if (!b || !isStr(b.id, 64) || !/^[\w-]+$/.test(b.id) || !isStr(b.token, 128)) {
    return send(res, 400, { error: "bad device" });
  }
  const existing = await getDevice(b.id);
  // The random token proves the caller is the device that registered this id.
  if (existing && existing.token !== b.token) return send(res, 403, { error: "forbidden" });

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

  await saveDevice(b.id, {
    token: b.token,
    subscription: { endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth } },
    day: b.day,
    wet: b.wet,
    dirty: b.dirty,
    lastSentDay: existing ? existing.lastSentDay || null : null,
    updatedAt: Date.now(),
  });
  send(res, 200, { ok: true, enabled: true });
}
