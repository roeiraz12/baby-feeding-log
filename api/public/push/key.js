import { send } from "../../../lib/http.js";

// GET /api/public/push/key → { publicKey }
export default function handler(req, res) {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  if (!publicKey) return send(res, 503, { error: "VAPID_PUBLIC_KEY is not set" });
  send(res, 200, { publicKey });
}
