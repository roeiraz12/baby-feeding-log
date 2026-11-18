import { send } from "../../../lib/http.js";
import { rateLimit } from "../../../lib/ratelimit.js";

// GET /api/public/push/key → { publicKey }
export default async function handler(req, res) {
  if (req.method !== "GET") return send(res, 405, { error: "method not allowed" });
  if (!(await rateLimit(req, "push-key", 60, 600))) return send(res, 429, { error: "too many requests" });
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  if (!publicKey) return send(res, 503, { error: "VAPID_PUBLIC_KEY is not set" });
  send(res, 200, { publicKey });
}
