import { send } from "../../lib/http.js";
import { rateLimit } from "../../lib/ratelimit.js";
import { readBody, normalizeCode, takeCode, addDevice, newDeviceId, newSecret, hashSecret } from "../../lib/family.js";

// POST /api/family/join {code} → {familyId, deviceId, secret, devices}
// The code is single use (deleted on the first valid attempt). This device gets its own secret.
// Brute force: 10 attempts per 10 minutes per IP against ~10^9 possible codes.
export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "method not allowed" });
  if (!(await rateLimit(req, "family-join", 10, 600))) return send(res, 429, { error: "too many requests" });
  let b;
  try { b = await readBody(req); } catch { return send(res, 400, { error: "bad json" }); }
  const code = normalizeCode(b && b.code);
  if (!code) return send(res, 400, { error: "bad code" });
  const familyId = await takeCode(code);
  if (!familyId) return send(res, 404, { error: "code not found" });
  const deviceId = newDeviceId(), secret = newSecret();
  const devices = await addDevice(familyId, deviceId, hashSecret(secret));
  if (devices < 0) return send(res, 404, { error: "code not found" });
  send(res, 200, { familyId, deviceId, secret, devices });
}
