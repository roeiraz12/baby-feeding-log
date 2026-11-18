import { send } from "../../lib/http.js";
import { rateLimit } from "../../lib/ratelimit.js";
import { createFamily, newFamilyId, newDeviceId, newSecret, hashSecret } from "../../lib/family.js";

// POST /api/family/create → {familyId, deviceId, secret}
// Starts a family with this device as its first member. Only a hash of the secret is stored.
export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "method not allowed" });
  if (!(await rateLimit(req, "family-create", 10, 3600))) return send(res, 429, { error: "too many requests" });
  const familyId = newFamilyId(), deviceId = newDeviceId(), secret = newSecret();
  await createFamily(familyId, deviceId, hashSecret(secret));
  send(res, 200, { familyId, deviceId, secret });
}
