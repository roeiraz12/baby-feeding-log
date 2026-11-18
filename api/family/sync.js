import { send } from "../../lib/http.js";
import { rateLimit } from "../../lib/ratelimit.js";
import {
  readBody, credsOk, authDevice, syncFamily, normEvent, normTomb, toValue, wins, MAX_PUSH
} from "../../lib/family.js";

// POST /api/family/sync {familyId, deviceId, secret, since, events?, tombstones?}
//   → {rev, more, devices, events, tombstones, skipped}
// Stores the pushed changes (last-writer-wins by updatedAt / deletedAt, like shared/rules.js
// mergeData) and returns everything written after revision `since` (0 = all), at most 500 items
// per response: while `more` is true the client calls again with since = rev.
// Redis commands: 1 when nothing is pushed and the client is up to date, otherwise 2.
export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "method not allowed" });
  let b;
  try { b = await readBody(req); } catch { return send(res, 400, { error: "bad json" }); }
  if (!credsOk(b)) return send(res, 400, { error: "bad credentials" });
  const since = b.since === undefined ? 0 : b.since;
  if (!Number.isSafeInteger(since) || since < 0) return send(res, 400, { error: "bad since" });
  const events = b.events == null ? [] : b.events;
  const tombs = b.tombstones == null ? [] : b.tombstones;
  if (!Array.isArray(events) || !Array.isArray(tombs)) return send(res, 400, { error: "bad payload" });
  if (events.length + tombs.length > MAX_PUSH) return send(res, 413, { error: "too many items" });

  const auth = await authDevice(b.familyId, b.deviceId, b.secret);
  if (!auth) {
    // failed logins only (successful syncs cost no rate-limit commands)
    if (!(await rateLimit(req, "family-auth", 30, 600))) return send(res, 429, { error: "too many requests" });
    return send(res, 401, { error: "unauthorized" });
  }

  // validate + dedupe by id (the LWW winner inside the request is kept)
  const now = Date.now();
  const pushed = new Map();
  let skipped = 0;
  const put = (v, id) => { if (wins(v, pushed.get(id))) pushed.set(id, v); };
  for (const e of events) {
    const n = normEvent(e, now);
    if (n) put(toValue("e", n), n.id); else skipped++;
  }
  for (const t of tombs) {
    const n = normTomb(t, now);
    if (n) put(toValue("t", n), n.id); else skipped++;
  }

  if (!pushed.size && since === auth.rev) {
    return send(res, 200, { rev: auth.rev, more: false, devices: auth.devices, events: [], tombstones: [], skipped });
  }
  const r = await syncFamily(b.familyId, since, pushed);
  if (r.gone) return send(res, 401, { error: "unauthorized" });
  if (r.full) return send(res, 507, { error: "family storage full" });
  send(res, 200, { rev: r.rev, more: r.more, devices: r.devices, events: r.events, tombstones: r.tombstones, skipped });
}
