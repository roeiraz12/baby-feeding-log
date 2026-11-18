import { send } from "../../lib/http.js";
import { rateLimit } from "../../lib/ratelimit.js";
import { readBody, credsOk, authDevice, newCode, putCode, CODE_TTL_SEC } from "../../lib/family.js";

// POST /api/family/invite {familyId, deviceId, secret} → {code, expiresAt, devices}
// A 6-character, single-use join code that is valid for 15 minutes.
export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "method not allowed" });
  let b;
  try { b = await readBody(req); } catch { return send(res, 400, { error: "bad json" }); }
  if (!credsOk(b)) return send(res, 400, { error: "bad credentials" });
  if (!(await rateLimit(req, "family-invite", 30, 3600))) return send(res, 429, { error: "too many requests" });
  const auth = await authDevice(b.familyId, b.deviceId, b.secret);
  if (!auth) return send(res, 401, { error: "unauthorized" });
  for (let i = 0; i < 5; i++) {
    const code = newCode();
    if (await putCode(code, b.familyId)) {
      return send(res, 200, { code, expiresAt: Date.now() + CODE_TTL_SEC * 1000, devices: auth.devices });
    }
  }
  send(res, 503, { error: "try again" });
}
