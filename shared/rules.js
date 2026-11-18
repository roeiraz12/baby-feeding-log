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
