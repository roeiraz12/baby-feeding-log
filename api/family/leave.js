import { send } from "../../lib/http.js";
import { readBody, credsOk, authDevice, removeDevice } from "../../lib/family.js";

// POST /api/family/leave {familyId, deviceId, secret} → {ok}
// Revokes this device. When the last device leaves, the family's data is deleted from the server.
export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "method not allowed" });
  let b;
  try { b = await readBody(req); } catch { return send(res, 400, { error: "bad json" }); }
  if (!credsOk(b)) return send(res, 400, { error: "bad credentials" });
  if (!(await authDevice(b.familyId, b.deviceId, b.secret))) return send(res, 401, { error: "unauthorized" });
  await removeDevice(b.familyId, b.deviceId);
  send(res, 200, { ok: true });
}
