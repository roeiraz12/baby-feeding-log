// "Next feeding" push reminder: the notification text and payload (api/public/push/feed*.js).
// Imports lib/diapers.js first so all date math runs in Israel time.
import crypto from "node:crypto";
import { isShabbat } from "./diapers.js";
import { feedOverdueText } from "../shared/rules.js";

export { isShabbat };

export const MIN_INTERVAL_MS = 30 * 6e4; // same range as the feedIntervalMin setting (30–480 min)
export const MAX_INTERVAL_MS = 480 * 6e4;
export const MAX_AHEAD_MS = 12 * 36e5; // dueAt at most 12 h from now
export const PAST_SLACK_MS = 2 * 6e4; // phone clock a little ahead of the server: still fine

/** Constant-time token comparison (different lengths never match). */
export function sameToken(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

const hm = (ts) => {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

/** "עברו 3 שעות מההנקה האחרונה (התחילה ב-14:05)" */
export function feedBody(lastStart, dueAt) {
  const min = Math.max(1, Math.round((dueAt - lastStart) / 6e4));
  return `${feedOverdueText(min)} (התחילה ב-${hm(lastStart)})`;
}

/** Web Push payload; diaper-messaging-sw.js turns it into the notification. */
export function feedPayload(lastStart, dueAt) {
  return {
    title: "הגיע זמן הנקה",
    body: feedBody(lastStart, dueAt),
    tag: "feed-alarm",
    url: "/#/",
    requireInteraction: true,
    renotify: true,
    vibrate: [600, 200, 600, 200, 600, 200, 1000],
    timestamp: dueAt,
  };
}
