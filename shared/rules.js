// shared/rules.js — pure rules used by both the browser app (js/core.js) and the
// server (lib/diapers.js → api/cron/daily.js). ES module: no DOM, no Node APIs.
// All date math uses the runtime's local time zone (the browser's, or
// Asia/Jerusalem on the server, which lib/diapers.js sets via process.env.TZ).

const DEG = Math.PI / 180;
const DAY_MS = 864e5;
const JULIAN_1970 = 2440588;
const JULIAN_2000 = 2451545;
const EARTH_TILT = DEG * 23.4397;
const JERUSALEM_LAT = 31.778;
const JERUSALEM_LNG = 35.235;

const toDays = (ms) => ms / DAY_MS - 0.5 + JULIAN_1970 - JULIAN_2000;
const fromJulian = (j) => (j + 0.5 - JULIAN_1970) * DAY_MS;

/** Time (ms) in the evening of `date` when the sun reaches `altitude` degrees in Jerusalem. */
export function sunsetAt(date, altitude) {
  const lw = DEG * -JERUSALEM_LNG;
  const phi = DEG * JERUSALEM_LAT;
  const days = toDays(new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12).getTime());
  const cycle = Math.round(days - 9e-4 - lw / (2 * Math.PI));
  const approxTransit = 9e-4 + lw / (2 * Math.PI) + cycle;
  const meanAnomaly = DEG * (357.5291 + 0.98560028 * approxTransit);
  const eclipticLng = meanAnomaly +
    DEG * (1.9148 * Math.sin(meanAnomaly) + 0.02 * Math.sin(2 * meanAnomaly) + 3e-4 * Math.sin(3 * meanAnomaly)) +
    DEG * 102.9372 + Math.PI;
  const declination = Math.asin(Math.sin(EARTH_TILT) * Math.sin(eclipticLng));
  const h = DEG * altitude;
  const hourAngle = Math.acos((Math.sin(h) - Math.sin(phi) * Math.sin(declination)) / (Math.cos(phi) * Math.cos(declination)));
  return fromJulian(JULIAN_2000 + (9e-4 + (hourAngle + lw) / (2 * Math.PI) + cycle) +
    0.0053 * Math.sin(meanAnomaly) - 0.0069 * Math.sin(2 * eclipticLng));
}

/** [start, end] ms of the Shabbat around `ts`: Friday sunset (-0.833°) → Saturday nightfall (-8.5°). */
export function shabbatWindow(ts) {
  const t = new Date(ts);
  const toFriday = t.getDay() === 6 ? -1 : 5 - t.getDay();
  const friday = new Date(t.getFullYear(), t.getMonth(), t.getDate() + toFriday);
  const saturday = new Date(friday.getFullYear(), friday.getMonth(), friday.getDate() + 1);
  return [sunsetAt(friday, -0.833), sunsetAt(saturday, -8.5)];
}

export function isShabbat(ts) {
  const [start, end] = shabbatWindow(ts);
  return ts >= start && ts < end;
}

/** Local calendar day "YYYY-MM-DD". */
export function dayKey(ts) {
  const t = new Date(ts);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
}

/** Hours of a day ("YYYY-MM-DD") that are NOT inside Shabbat (24 for a weekday). */
export function trackedHours(key) {
  const [y, m, d] = key.split("-").map(Number);
  const dayStart = new Date(y, m - 1, d).getTime();
  const dayEnd = new Date(y, m - 1, d + 1).getTime();
  const [shStart, shEnd] = shabbatWindow(dayStart + 432e5);
  const overlap = Math.max(0, Math.min(dayEnd, shEnd) - Math.max(dayStart, shStart));
  return (dayEnd - dayStart - overlap) / 36e5;
}

export const DEFAULT_GOALS = Object.freeze({ wet: 6, dirty: 3 });

/** Local hour (Israel time) from which the daily diaper notification is sent (local + server push). */
export const EVENING_NOTIFY_HOUR = 21;
/** Local hour from which the stats page shows the diaper warning card. */
export const WARNING_FROM_HOUR = 20;

/** Diaper goal warnings (Hebrew), empty when both goals are met. goals = {wet, dirty}, defaults 6/3. */
export function diaperWarnings(wet, dirty, goals) {
  const wetGoal = goals && Number.isInteger(goals.wet) ? goals.wet : DEFAULT_GOALS.wet;
  const dirtyGoal = goals && Number.isInteger(goals.dirty) ? goals.dirty : DEFAULT_GOALS.dirty;
  const out = [];
  if (wet < wetGoal) out.push(`פיפי היום: ${wet} מתוך יעד של ${wetGoal}.`);
  if (dirty < dirtyGoal) out.push(`קקי היום: ${dirty} מתוך יעד של ${dirtyGoal}.`);
  return out;
}

/** When an event was last changed: updatedAt (ms), or its timestamp for older events. */
export function updatedAtOf(e) {
  return typeof e.updatedAt === "number" ? e.updatedAt : e.timestamp;
}

/** Last-writer-wins merge of `incoming` events/tombstones into `local` (family sharing).
    Tombstones are {id, deletedAt}; an event loses to a tombstone when deletedAt >= its updatedAt.
    Returns {events, tombstones, added, updated, removed} (counts relative to local). Pure: inputs untouched. */
export function mergeData(localEvents, localTombs, incomingEvents, incomingTombs) {
  const tombs = new Map();
  localTombs.forEach(function (t) { tombs.set(t.id, t); });
  incomingTombs.forEach(function (t) {
    const cur = tombs.get(t.id);
    if (!cur || t.deletedAt > cur.deletedAt) tombs.set(t.id, { id: t.id, deletedAt: t.deletedAt });
  });
  const localById = new Map();
  localEvents.forEach(function (e) { localById.set(e.id, e); });
  const byId = new Map(localById);
  incomingEvents.forEach(function (e) {
    const cur = byId.get(e.id);
    if (!cur) { byId.set(e.id, e); return; }
    const a = updatedAtOf(e), b = updatedAtOf(cur);
    // ties are broken by content so every device picks the same winner
    if (a > b || (a === b && JSON.stringify(e) > JSON.stringify(cur))) byId.set(e.id, e);
  });
  tombs.forEach(function (t, id) {
    const e = byId.get(id);
    if (!e) return;
    if (t.deletedAt >= updatedAtOf(e)) byId.delete(id);
    else tombs.delete(id); // re-created / restored after the deletion
  });
  // keep local order, then new events in incoming order
  const events = [];
  const seen = new Set();
  let added = 0, updated = 0;
  localEvents.concat(incomingEvents).forEach(function (e) {
    if (seen.has(e.id) || !byId.has(e.id)) return;
    seen.add(e.id);
    const winner = byId.get(e.id), before = localById.get(e.id);
    if (!before) added++; else if (winner !== before) updated++;
    events.push(winner);
  });
  let removed = 0;
  localById.forEach(function (e, id) { if (!byId.has(id)) removed++; });
  return { events: events, tombstones: Array.from(tombs.values()), added: added, updated: updated, removed: removed };
}

/** Hebrew duration phrase for whole minutes: "שעה", "שעתיים וחצי", "3 שעות", "45 דקות", "שעה ו-20 דקות". */
export function hoursPhrase(totalMin) {
  const h = Math.floor(totalMin / 60), m = totalMin % 60;
  const hourWord = h === 1 ? "שעה" : h === 2 ? "שעתיים" : h + " שעות";
  if (h === 0) return m === 30 ? "חצי שעה" : m + " דקות";
  if (m === 0) return hourWord;
  if (m === 30) return hourWord + " וחצי";
  return hourWord + " ו-" + m + " דקות";
}

/** "עברו 3 שעות מההנקה האחרונה" / "עברה שעה ו-15 דקות מההנקה האחרונה" for an interval in minutes. */
export function feedOverdueText(min) {
  const singular = Math.floor(min / 60) === 1 || min === 30;
  return (singular ? "עברה " : "עברו ") + hoursPhrase(min) + " מההנקה האחרונה";
}

/* ---------- Feedings, intervals and daily stats (used by js/core.js) ---------- */
/* Feedings (user rule): sides nursed one after the other count as ONE feeding
   when the next side starts within FEEDING_GAP_MS of the previous side's end.
   A single side is also a feeding. A feeding's time is the start of its first side. */
export const FEEDING_GAP_MS = 30 * 6e4;
export function feedings(events) {
  const nursing = events.filter(function (e) { return e.type === 'nursing'; })
    .slice().sort(function (a, b) { return a.timestamp - b.timestamp; });
  const out = [];
  let current = null;
  nursing.forEach(function (e) {
    const end = Math.max(e.timestamp, e.endTimestamp != null ? e.endTimestamp : e.timestamp + (e.durationMs || 0));
    if (current && e.timestamp - current.end <= FEEDING_GAP_MS) {
      current.end = Math.max(current.end, end);
      current.events.push(e);
    } else {
      current = { start: e.timestamp, end: end, events: [e] };
      out.push(current);
    }
  });
  return out;
}
/** Start time of the latest feeding, or 0. */
export function lastFeedingStart(events) {
  const f = feedings(events);
  return f.length ? f[f.length - 1].start : 0;
}
/** When the feed alarm is due: last feeding + intervalMs, pushed back by a snooze; null if none or dismissed. */
export function nextFeedAt(events, intervalMs, snoozeUntil, dismissedFeedStart) {
  const last = lastFeedingStart(events);
  if (!last || dismissedFeedStart === last) return null;
  const due = last + intervalMs;
  return snoozeUntil && snoozeUntil > due ? snoozeUntil : due;
}

/** Per-day counts and averages (days partly inside Shabbat are weighted by their tracked hours). */
export function dailyStats(events) {
  const byDay = new Map();
  const bucket = function (key) { return byDay.get(key) || { nursing: 0, wet: 0, dirty: 0 }; };
  events.forEach(function (e) {
    if (e.type !== 'diaper') return;
    const key = dayKey(e.timestamp), c = bucket(key);
    if (e.subtype === 'wet') c.wet += 1; else c.dirty += 1;
    byDay.set(key, c);
  });
  feedings(events).forEach(function (f) {
    const key = dayKey(f.start), c = bucket(key);
    c.nursing += 1;
    byDay.set(key, c);
  });
  const days = Array.from(byDay.entries()).sort(function (a, b) { return a[0] < b[0] ? -1 : 1; }).map(function (entry) {
    const key = entry[0], c = entry[1], hours = trackedHours(key);
    return {
      key: key, hours: hours, partial: hours < 24,
      label: new Date(key + 'T12:00:00').toLocaleDateString('he-IL', { weekday: 'short' }),
      nursing: c.nursing, wet: c.wet, dirty: c.dirty
    };
  });
  const dayEquivalents = Math.max(1, days.reduce(function (s, d) { return s + d.hours; }, 0) / 24);
  const sum = function (pick) { return days.reduce(function (s, d) { return s + pick(d); }, 0); };
  const round1 = function (x) { return Math.round(x * 10) / 10; };
  return {
    days: days.length,
    avgWet: round1(sum(function (d) { return d.wet; }) / dayEquivalents),
    avgDirty: round1(sum(function (d) { return d.dirty; }) / dayEquivalents),
    avgNursing: round1(sum(function (d) { return d.nursing; }) / dayEquivalents),
    leftCount: events.filter(function (e) { return e.type === 'nursing' && e.subtype === 'left'; }).length,
    rightCount: events.filter(function (e) { return e.type === 'nursing' && e.subtype === 'right'; }).length,
    daily: days.slice(-7).map(function (d) { return Object.assign({}, d, { label: d.partial ? d.label + '*' : d.label }); })
  };
}
/** Feeding start times and the plausible gaps between them (10 min – 8 h). */
export function feedingIntervals(events) {
  const starts = feedings(events).map(function (f) { return f.start; });
  const gaps = [];
  for (let k = 1; k < starts.length; k++) {
    const d = starts[k] - starts[k - 1];
    if (d > 6e5 && d < 288e5) gaps.push(d);
  }
  return { starts: starts, gaps: gaps };
}
/** Next `count` predicted feeding times after `now`, spaced by the median gap ([] with too little data). */
export function predictFeeds(events, now, count) {
  if (now === undefined) now = Date.now();
  if (count === undefined) count = 4;
  const x = feedingIntervals(events), starts = x.starts, gaps = x.gaps;
  if (starts.length < 4 || gaps.length < 3) return [];
  gaps.sort(function (a, b) { return a - b; });
  const median = gaps[Math.floor(gaps.length / 2)], out = [];
  let next = starts[starts.length - 1] + median;
  while (next <= now) next += median;
  for (let k = 0; k < count; k++) { out.push(next); next += median; }
  return out;
}
export function medianIntervalMin(events) {
  const gaps = feedingIntervals(events).gaps;
  if (gaps.length < 3) return null;
  gaps.sort(function (a, b) { return a - b; });
  return Math.round(gaps[Math.floor(gaps.length / 2)] / 6e4);
}
export function diaperCounts(events, now) {
  const today = dayKey(now === undefined ? Date.now() : now);
  const diapers = events.filter(function (e) { return e.type === 'diaper' && dayKey(e.timestamp) === today; });
  return {
    wet: diapers.filter(function (e) { return e.subtype === 'wet'; }).length,
    dirty: diapers.filter(function (e) { return e.subtype === 'dirty'; }).length
  };
}

/** Binary daily verdict for the history page: true when both diaper goals are met. goals = {wet, dirty}. */
export function meetsDiaperGoals(wet, dirty, goals) {
  const wetGoal = goals && Number.isInteger(goals.wet) ? goals.wet : DEFAULT_GOALS.wet;
  const dirtyGoal = goals && Number.isInteger(goals.dirty) ? goals.dirty : DEFAULT_GOALS.dirty;
  return wet >= wetGoal && dirty >= dirtyGoal;
}
