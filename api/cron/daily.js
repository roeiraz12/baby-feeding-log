import webpush from "web-push";
import { send } from "../../lib/http.js";
import { isShabbat, dayKey, israelHour, warnings } from "../../lib/diapers.js";
import { getDevice, saveDevice, deleteDevice, listDeviceIds } from "../../lib/store.js";

// Runs from Vercel Cron at 19:00 and 20:00 UTC (= 22:00 Israel in summer / winter).
// Sends once per device per day, only from 22:00 Israel time, never on Shabbat,
// and only when today's pee < 6 or poop < 3.
// ?force=1 skips the hour/Shabbat checks (for testing; still needs CRON_SECRET).
export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
    return send(res, 401, { error: "unauthorized" });
  }
  if (!secret && process.env.VERCEL_ENV === "production") {
    return send(res, 500, { error: "CRON_SECRET is not set" });
  }
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT) {
    return send(res, 500, { error: "VAPID env vars missing" });
  }
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

  const force = new URL(req.url, "http://x").searchParams.get("force") === "1";
  const now = Date.now();
  const today = dayKey(now);
  if (!force && israelHour(now) < 22) return send(res, 200, { skipped: "before 22:00 Israel time" });
  if (!force && isShabbat(now)) return send(res, 200, { skipped: "shabbat" });

  const result = { sent: 0, ok: 0, removed: 0, failed: 0 };
  for (const id of await listDeviceIds()) {
    const d = await getDevice(id);
    if (!d) { await deleteDevice(id); continue; }
    if (d.lastSentDay === today && !force) continue;
    // Counts are only from today if the app synced today; otherwise nothing was logged.
    const fresh = d.day === today;
    const lines = warnings(fresh ? d.wet : 0, fresh ? d.dirty : 0);
    if (lines.length) {
      result.sent++;
      try {
        await webpush.sendNotification(d.subscription, JSON.stringify({
          title: "יומן תינוק", body: lines.join("\n"), tag: `diapers-${today}`,
        }), { TTL: 3600 });
        result.ok++;
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) {
          await deleteDevice(id); result.removed++; continue;
        }
        result.failed++;
        console.error("push failed", id, err.statusCode, err.body);
        continue;
      }
    }
    await saveDevice(id, { ...d, lastSentDay: today });
  }
  send(res, 200, { day: today, ...result });
}
