// Server-side copy of the app's diaper-goal and Shabbat logic.
// All date math runs in Israel time.
process.env.TZ = "Asia/Jerusalem";

const ov = Math.PI / 180, sv = 864e5, cv = 2440588, lv = 2451545, uv = ov * 23.4397;
const dv = (e) => e / sv - 0.5 + cv - lv;
const fv = (e) => (e + 0.5 - cv) * sv;

// Sun time for a given altitude in Jerusalem (port of the app's pv()).
function sunTime(date, altitude) {
  const n = ov * -35.235, r = ov * 31.778;
  const i = dv(new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12).getTime());
  const a = Math.round(i - 9e-4 - n / (2 * Math.PI));
  const o = 9e-4 + n / (2 * Math.PI) + a;
  const s = ov * (357.5291 + 0.98560028 * o);
  const c = s + ov * (1.9148 * Math.sin(s) + 0.02 * Math.sin(2 * s) + 3e-4 * Math.sin(3 * s)) + ov * 102.9372 + Math.PI;
  const l = Math.asin(Math.sin(uv) * Math.sin(c));
  const u = ov * altitude;
  return fv(lv + (9e-4 + (Math.acos((Math.sin(u) - Math.sin(r) * Math.sin(l)) / (Math.cos(r) * Math.cos(l))) + n) / (2 * Math.PI) + a) + 0.0053 * Math.sin(s) - 0.0069 * Math.sin(2 * c));
}

// Friday sunset → Saturday nightfall around a timestamp.
function shabbatWindow(ts) {
  const t = new Date(ts);
  const off = t.getDay() === 6 ? -1 : 5 - t.getDay();
  const fri = new Date(t.getFullYear(), t.getMonth(), t.getDate() + off);
  const sat = new Date(fri.getFullYear(), fri.getMonth(), fri.getDate() + 1);
  return [sunTime(fri, -0.833), sunTime(sat, -8.5)];
}

export function isShabbat(ts) {
  const [a, b] = shabbatWindow(ts);
  return ts >= a && ts < b;
}

export function dayKey(ts) {
  const t = new Date(ts);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
}

export function israelHour(ts) {
  return new Date(ts).getHours();
}

// Same text as the in-app warnings (Wv).
export function warnings(wet, dirty) {
  const out = [];
  if (wet < 6) out.push(`פיפי היום: ${wet} מתוך יעד של 6.`);
  if (dirty < 3) out.push(`קקי היום: ${dirty} מתוך יעד של 3.`);
  return out;
}
