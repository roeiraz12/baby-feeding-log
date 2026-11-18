// Server-side diaper-goal and Shabbat rules. The logic itself lives in
// shared/rules.js (also used by the browser app); this file pins the time zone.
// All date math runs in Israel time. (ES imports are hoisted, but shared/rules.js
// does no date math at load time, so TZ is set before any rule runs.)
process.env.TZ = "Asia/Jerusalem";

import { diaperWarnings } from "../shared/rules.js";

export {
  isShabbat, shabbatWindow, dayKey, diaperWarnings, DEFAULT_GOALS, EVENING_NOTIFY_HOUR, WARNING_FROM_HOUR,
} from "../shared/rules.js";

export function israelHour(ts) {
  return new Date(ts).getHours();
}

// Same text as the in-app warnings. goals = {wet, dirty} (defaults 6 / 3).
export function warnings(wet, dirty, goals) {
  return diaperWarnings(wet, dirty, goals);
}
