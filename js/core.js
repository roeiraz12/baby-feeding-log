/* core.js — global App API (settings, store, helpers, icons, toast, dialog,
   router, feed alarm, local notifications). ES module, loaded first; page
   scripts use `window.App`. Pure rules shared with the server live in
   ../shared/rules.js. */
import {
  shabbatWindow, isShabbat, dayKey, trackedHours,
  diaperWarnings as goalWarnings, DEFAULT_GOALS, mergeData,
  EVENING_NOTIFY_HOUR, WARNING_FROM_HOUR,
  hoursPhrase, feedOverdueText as overdueTextFor
} from '../shared/rules.js';

const App = (window.App = window.App || {});
const LS = window.localStorage;

/* ------------------------------------------------------------------ */
/* Keys / constants                                                     */
/* ------------------------------------------------------------------ */
const KEYS = (App.KEYS = {
  events: 'newborn-tracker:events',
  active: 'newborn-tracker:active-nursing',
  alertsEnabled: 'newborn-tracker:alerts-enabled',
  alertLastDay: 'newborn-tracker:alert-last-day',
  vitaminDay: 'newborn-tracker:vitamin-d-day',
  snoozeUntil: 'newborn-tracker:snooze-until',
  feedDismissed: 'newborn-tracker:feed-alarm-dismissed',
  pushEnabled: 'newborn-tracker:push-enabled',
  settings: 'newborn-tracker:settings',
  tombstones: 'newborn-tracker:tombstones'
});
const NURSING_MAX = (App.NURSING_MAX = 9e5); // a nursing side auto-ends after 15 min
const SNOOZE_MS = (App.SNOOZE = 9e5); // feed alarm snooze: 15 min
const CHANGED_EVENT = (App.CHANGED_EVENT = 'newborn-tracker:changed');
const SETTINGS_EVENT = (App.SETTINGS_EVENT = 'newborn-tracker:settings-changed');
const TOMBSTONE_TTL = (App.TOMBSTONE_TTL = 30 * 864e5);
const MINUTE = 6e4;
const VITAMIN_NOTE = 'ויטמין D';
App.EVENING_NOTIFY_HOUR = EVENING_NOTIFY_HOUR; // daily diaper notification from 21:00
App.WARNING_FROM_HOUR = WARNING_FROM_HOUR; // stats diaper warning card from 20:00

App.isShabbat = isShabbat;
App.shabbatWindow = shabbatWindow;
App.dayHours = trackedHours;
App.dayKey = dayKey;

/* ------------------------------------------------------------------ */
/* Settings                                                             */
/* ------------------------------------------------------------------ */
const SETTINGS_DEFAULTS = Object.freeze({ feedIntervalMin: 180, wetGoal: DEFAULT_GOALS.wet, dirtyGoal: DEFAULT_GOALS.dirty, feedReminderAlways: false });
const SETTINGS_RULES = {
  feedIntervalMin: { min: 30, max: 480, error: 'מרווח ההנקות צריך להיות מספר שלם של דקות בין 30 ל־480.' },
  wetGoal: { min: 1, max: 20, error: 'יעד הפיפי צריך להיות מספר שלם בין 1 ל־20.' },
  dirtyGoal: { min: 1, max: 20, error: 'יעד הקקי צריך להיות מספר שלם בין 1 ל־20.' },
  // background push reminder for every next feeding (js/push.js)
  feedReminderAlways: { bool: true, error: 'ערך לא תקין לתזכורת ההנקה.' }
};
let settingsCache = null;

function validSetting(key, value) {
  const rule = SETTINGS_RULES[key];
  if (rule && rule.bool) return typeof value === 'boolean' ? value : null;
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return rule && Number.isInteger(n) && n >= rule.min && n <= rule.max ? n : null;
}
function readSettings() {
  if (settingsCache) return settingsCache;
  let stored = {};
  try { stored = JSON.parse(LS.getItem(KEYS.settings) || '{}') || {}; } catch (err) { stored = {}; }
  const out = Object.assign({}, SETTINGS_DEFAULTS);
  Object.keys(SETTINGS_RULES).forEach(function (k) {
    const v = validSetting(k, stored[k]);
    if (v !== null) out[k] = v;
  });
  settingsCache = out;
  return out;
}

App.settings = {
  defaults: SETTINGS_DEFAULTS,
  /** Current settings: defaults merged with stored values. Returns a fresh copy. */
  get: function () { return Object.assign({}, readSettings()); },
  /** Validates and persists `patch`; throws Error (Hebrew message) on an invalid value. Unknown keys are ignored. */
  set: function (patch) {
    const next = Object.assign({}, readSettings());
    Object.keys(patch || {}).forEach(function (k) {
      if (!SETTINGS_RULES[k]) return;
      const v = validSetting(k, patch[k]);
      if (v === null) throw new Error(SETTINGS_RULES[k].error);
      next[k] = v;
    });
    LS.setItem(KEYS.settings, JSON.stringify(next));
    settingsCache = next;
    window.dispatchEvent(new CustomEvent(SETTINGS_EVENT, { detail: Object.assign({}, next) }));
    emitChanged();
    return Object.assign({}, next);
  }
};

function feedIntervalMs() { return readSettings().feedIntervalMin * MINUTE; }
function goals() { const s = readSettings(); return { wet: s.wetGoal, dirty: s.dirtyGoal }; }
App.feedIntervalMs = feedIntervalMs;
App.goals = goals;
// Kept for older callers: App.FEED_INTERVAL now follows the setting.
Object.defineProperty(App, 'FEED_INTERVAL', { get: feedIntervalMs, enumerable: true, configurable: true });

/* hoursPhrase / the overdue text live in shared/rules.js (the server's feed reminder uses them too). */
/** "עברו 3 שעות מההנקה האחרונה" for the configured feed interval. */
function feedOverdueText(min) {
  return overdueTextFor(min === undefined ? readSettings().feedIntervalMin : min);
}
App.hoursPhrase = hoursPhrase;
App.feedOverdueText = feedOverdueText;

/* ------------------------------------------------------------------ */
/* Feeding / diaper helpers                                             */
/* ------------------------------------------------------------------ */
/* Feedings (user rule): sides nursed one after the other count as ONE feeding
   when the next side starts within FEEDING_GAP of the previous side's end.
   A single side is also a feeding. A feeding's time is the start of its first side. */
const FEEDING_GAP = (App.FEEDING_GAP = 30 * MINUTE);
function feedings(events) {
  const nursing = events.filter(function (e) { return e.type === 'nursing'; })
    .slice().sort(function (a, b) { return a.timestamp - b.timestamp; });
  const out = [];
  let current = null;
  nursing.forEach(function (e) {
    const end = Math.max(e.timestamp, e.endTimestamp != null ? e.endTimestamp : e.timestamp + (e.durationMs || 0));
    if (current && e.timestamp - current.end <= FEEDING_GAP) {
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
function lastFeedingStart(events) {
  const f = feedings(events);
  return f.length ? f[f.length - 1].start : 0;
}
/** When the feed alarm is due: last feeding + interval, pushed back by a snooze; null if none or dismissed. */
function nextFeedAt(events, snoozeUntil, dismissedFeedStart) {
  const last = lastFeedingStart(events);
  if (!last || dismissedFeedStart === last) return null;
  const due = last + feedIntervalMs();
  return snoozeUntil && snoozeUntil > due ? snoozeUntil : due;
}
function newId() { return Date.now() + '-' + Math.floor(Math.random() * 1e6); }
/** "12 דק'" / "1 ש' 5 דק'" */
function fmtDuration(ms) {
  const totalMin = Math.max(0, Math.round(ms / MINUTE)), h = Math.floor(totalMin / 60), m = totalMin % 60;
  return h === 0 ? m + " דק'" : h + " ש' " + m + " דק'";
}
/** "05:09" / "1:05:09" */
function fmtClock(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1e3));
  const h = Math.floor(totalSec / 3600), m = Math.floor((totalSec % 3600) / 60), s = totalSec % 60;
  const pad = function (x) { return String(x).padStart(2, '0'); };
  return h > 0 ? h + ':' + pad(m) + ':' + pad(s) : pad(m) + ':' + pad(s);
}
function eventLabel(e) {
  if (e.type === 'custom') return e.note || 'אירוע';
  if (e.type === 'nursing') return 'הנקה — ' + (e.subtype === 'left' ? 'שמאל' : 'ימין') + (e.durationMs === undefined ? '' : ' · ' + fmtDuration(e.durationMs));
  if (e.type === 'diaper') return 'חיתול — ' + (e.subtype === 'wet' ? 'פיפי' : 'קקי');
  return 'שינה — ' + fmtDuration(e.durationMs != null ? e.durationMs : 0);
}
/** Per-day counts and averages (days partly inside Shabbat are weighted by their tracked hours). */
function dailyStats(events) {
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
function feedingIntervals(events) {
  const starts = feedings(events).map(function (f) { return f.start; });
  const gaps = [];
  for (let k = 1; k < starts.length; k++) {
    const d = starts[k] - starts[k - 1];
    if (d > 6e5 && d < 288e5) gaps.push(d);
  }
  return { starts: starts, gaps: gaps };
}
/** Next `count` predicted feeding times after `now`, spaced by the median gap ([] with too little data). */
function predictFeeds(events, now, count) {
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
function medianIntervalMin(events) {
  const gaps = feedingIntervals(events).gaps;
  if (gaps.length < 3) return null;
  gaps.sort(function (a, b) { return a - b; });
  return Math.round(gaps[Math.floor(gaps.length / 2)] / MINUTE);
}
function isToday(key, now) { return key === dayKey(now === undefined ? Date.now() : now); }
function vitaminEvent(ts) { return { id: 'vitamin-d-' + dayKey(ts), type: 'custom', subtype: 'custom', timestamp: ts, note: VITAMIN_NOTE }; }
function diaperCounts(events, now) {
  const today = dayKey(now === undefined ? Date.now() : now);
  const diapers = events.filter(function (e) { return e.type === 'diaper' && dayKey(e.timestamp) === today; });
  return {
    wet: diapers.filter(function (e) { return e.subtype === 'wet'; }).length,
    dirty: diapers.filter(function (e) { return e.subtype === 'dirty'; }).length
  };
}
/** Today's diaper goal warnings (configured goals); none on Shabbat. */
function diaperWarnings(events, now) {
  if (now === undefined) now = Date.now();
  if (isShabbat(now)) return [];
  const c = diaperCounts(events, now);
  return goalWarnings(c.wet, c.dirty, goals());
}
/** Warnings for the local evening notification: only if alerts are on, from EVENING_NOTIFY_HOUR, once per day. */
function eveningWarnings(events, now, alertsOn, lastAlertDay) {
  return !alertsOn || new Date(now).getHours() < EVENING_NOTIFY_HOUR || lastAlertDay === dayKey(now) ? [] : diaperWarnings(events, now);
}

App.feedings = feedings;
App.isToday = isToday;
App.fmtDuration = fmtDuration;
App.fmtClock = fmtClock;
App.label = eventLabel;
App.timeHM = function (ts) { return new Date(ts).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }); };
App.lastNursing = lastFeedingStart;
App.nextFeedAt = nextFeedAt;
App.diaperCounts = diaperCounts;
App.diaperWarnings = diaperWarnings;
App.eveningWarnings = eveningWarnings;
App.dailyStats = dailyStats;
App.predictFeeds = predictFeeds;
App.medianIntervalMin = medianIntervalMin;
App.vitaminEvent = vitaminEvent;
App.newId = newId;

/* ------------------------------------------------------------------ */
/* Store                                                                */
/* ------------------------------------------------------------------ */
/* The parsed events are cached in memory; the cache is replaced on our own
   writes and dropped on a `storage` event (another tab) or when the page
   becomes visible again. Event objects are shared with callers: treat them
   as read-only and change data only through App.store. */
let eventsCache = null;

function isEventLike(e) {
  return !!e && typeof e === 'object' && typeof e.id === 'string' && e.id !== '' &&
    typeof e.type === 'string' && typeof e.timestamp === 'number' && isFinite(e.timestamp);
}
function readEvents() {
  if (eventsCache) return eventsCache;
  let list = [];
  try {
    const parsed = JSON.parse(LS.getItem(KEYS.events) || '[]');
    // drop non-object entries (e.g. null) so one bad item can't crash every page and timer
    list = Array.isArray(parsed) ? parsed.filter(function (e) { return e && typeof e === 'object'; }) : [];
  } catch (err) { list = []; }
  eventsCache = list;
  return list;
}
function writeEvents(list) {
  LS.setItem(KEYS.events, JSON.stringify(list));
  eventsCache = list;
}
function readTombstones(now) {
  if (now === undefined) now = Date.now();
  let list = [];
  try { list = JSON.parse(LS.getItem(KEYS.tombstones) || '[]'); } catch (err) { list = []; }
  if (!Array.isArray(list)) return [];
  return list.filter(function (t) {
    return t && typeof t.id === 'string' && typeof t.deletedAt === 'number' && now - t.deletedAt <= TOMBSTONE_TTL;
  });
}
function writeTombstones(list) {
  const now = Date.now();
  const kept = list.filter(function (t) { return now - t.deletedAt <= TOMBSTONE_TTL; });
  if (kept.length) LS.setItem(KEYS.tombstones, JSON.stringify(kept));
  else LS.removeItem(KEYS.tombstones);
}

function emitChanged() { window.dispatchEvent(new Event(CHANGED_EVENT)); }
const localChangeListeners = [];
/** A user-originated change was written (not applyRemote): re-render + tell the sync engine. */
function commitLocal(reason) {
  emitChanged();
  localChangeListeners.slice().forEach(function (fn) {
    try { fn({ reason: reason }); } catch (err) { console.error(err); }
  });
}

window.addEventListener('storage', function (e) {
  if (e.key === null || e.key === KEYS.events) eventsCache = null;
  if (e.key === null || e.key === KEYS.settings) settingsCache = null;
}); // registered before any page subscribes, so pages read fresh data
document.addEventListener('visibilitychange', function () {
  if (document.visibilityState === 'visible') { eventsCache = null; settingsCache = null; }
});

function isOpenNursing(e) { return e.type === 'nursing' && e.endTimestamp == null; }
/** Ends every open nursing side older than NURSING_MAX (at exactly NURSING_MAX). Writes only if needed. */
function autoCompleteNursing(now) {
  const list = readEvents();
  const stale = list.some(function (e) { return isOpenNursing(e) && now >= e.timestamp + NURSING_MAX; });
  if (!stale) return false;
  const activeId = LS.getItem(KEYS.active);
  let activeEnded = false;
  writeEvents(list.map(function (e) {
    if (!isOpenNursing(e) || now < e.timestamp + NURSING_MAX) return e;
    if (e.id === activeId) activeEnded = true;
    return Object.assign({}, e, { endTimestamp: e.timestamp + NURSING_MAX, durationMs: NURSING_MAX, updatedAt: now });
  }));
  if (activeEnded) LS.removeItem(KEYS.active);
  commitLocal('auto-complete');
  return true;
}
/** The running nursing side: the one this device started (active-nursing key) or, e.g. when it was
    started on another device, the newest open nursing event that started less than NURSING_MAX ago. */
function findActiveNursing(list, now) {
  const activeId = LS.getItem(KEYS.active);
  let found = null;
  list.forEach(function (e) {
    if (!isOpenNursing(e) || now >= e.timestamp + NURSING_MAX) return;
    if (e.id === activeId) { found = e; return; }
    if (!found || (found.id !== activeId && e.timestamp > found.timestamp)) found = e;
  });
  return found;
}
function vitaminDoneToday(now) {
  if (now === undefined) now = Date.now();
  if (isToday(LS.getItem(KEYS.vitaminDay), now)) return true;
  const today = dayKey(now);
  return readEvents().some(function (e) {
    return e.id === 'vitamin-d-' + today ||
      (e.type === 'custom' && e.note === VITAMIN_NOTE && dayKey(e.timestamp) === today);
  });
}
App.vitaminDoneToday = vitaminDoneToday;

App.mergeData = mergeData;

function sameJSON(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

App.store = {
  /** All events (auto-completes an open nursing side older than 15 min first). Array is a copy. */
  events: function () {
    autoCompleteNursing(Date.now());
    return readEvents().slice();
  },
  activeNursing: function () {
    const now = Date.now();
    autoCompleteNursing(now);
    return findActiveNursing(readEvents(), now);
  },
  /** Adds an event. Keeps evt.id if given and unused (e.g. 'vitamin-d-YYYY-MM-DD'), else a new id. */
  add: function (evt) {
    const list = readEvents(), now = Date.now();
    const keepId = typeof evt.id === 'string' && evt.id && !list.some(function (e) { return e.id === evt.id; });
    const e = Object.assign({}, evt, { id: keepId ? evt.id : newId(), updatedAt: now });
    const tombs = readTombstones(now);
    if (tombs.some(function (t) { return t.id === e.id; })) writeTombstones(tombs.filter(function (t) { return t.id !== e.id; }));
    writeEvents(list.concat([e]));
    commitLocal('add');
    return e;
  },
  /** Starts/stops a nursing side → 'started' | 'ended' | 'blocked' (the other side is running). */
  toggleNursing: function (side) {
    const now = Date.now();
    autoCompleteNursing(now);
    const list = readEvents();
    const active = findActiveNursing(list, now);
    if (active && active.subtype !== side) return 'blocked';
    if (!active) {
      const id = newId();
      writeEvents(list.concat([{ id: id, type: 'nursing', subtype: side, timestamp: now, updatedAt: now }]));
      LS.setItem(KEYS.active, id);
      commitLocal('nursing-start');
      return 'started';
    }
    writeEvents(list.map(function (e) {
      return e.id !== active.id ? e : Object.assign({}, e, {
        endTimestamp: Math.min(now, e.timestamp + NURSING_MAX),
        durationMs: Math.min(NURSING_MAX, Math.max(0, now - e.timestamp)),
        updatedAt: now
      });
    }));
    LS.removeItem(KEYS.active);
    commitLocal('nursing-end');
    return 'ended';
  },
  /** Deletes an event and records a tombstone {id, deletedAt}. */
  remove: function (id) {
    const now = Date.now();
    writeTombstones(readTombstones(now).filter(function (t) { return t.id !== id; }).concat([{ id: id, deletedAt: now }]));
    writeEvents(readEvents().filter(function (e) { return e.id !== id; }));
    commitLocal('remove');
  },
  /** Undo of remove: puts the event back (updatedAt bumped) and drops its tombstone. */
  restore: function (evt) {
    const now = Date.now();
    const e = Object.assign({}, evt, { updatedAt: now });
    writeTombstones(readTombstones(now).filter(function (t) { return t.id !== e.id; }));
    const list = readEvents();
    writeEvents(list.some(function (x) { return x.id === e.id; })
      ? list.map(function (x) { return x.id === e.id ? e : x; })
      : list.concat([e]));
    commitLocal('restore');
  },
  /** Patches an event (durationMs recomputed when it has an endTimestamp). */
  edit: function (id, patch) {
    const now = Date.now();
    writeEvents(readEvents().map(function (e) {
      if (e.id !== id) return e;
      const next = Object.assign({}, e, patch, { updatedAt: now });
      if (next.endTimestamp) next.durationMs = Math.max(0, next.endTimestamp - next.timestamp);
      return next;
    }));
    commitLocal('edit');
  },
  /** fn() on any change: this tab (CHANGED_EVENT, incl. settings), other tabs (storage), tab shown again. */
  subscribe: function (fn) {
    const handler = function () { fn(); };
    window.addEventListener(CHANGED_EVENT, handler);
    window.addEventListener('storage', handler);
    document.addEventListener('visibilitychange', handler);
    return function () {
      window.removeEventListener(CHANGED_EVENT, handler);
      window.removeEventListener('storage', handler);
      document.removeEventListener('visibilitychange', handler);
    };
  },
  /** Drops the in-memory cache (e.g. after writing localStorage directly). */
  reload: function () { eventsCache = null; settingsCache = null; emitChanged(); },

  /* ---- family-sharing primitives ---- */
  /** {events, tombstones} — copies, for the sync engine to upload. */
  snapshot: function () {
    return { events: readEvents().slice(), tombstones: readTombstones() };
  },
  /** Merges data from another device (last-writer-wins by updatedAt, falling back to timestamp).
      Writes once and emits CHANGED_EVENT once if anything changed; never fires onLocalChange.
      Returns {changed, added, updated, removed}. */
  applyRemote: function (data) {
    data = data || {};
    const incomingEvents = Array.isArray(data.events) ? data.events.filter(isEventLike) : [];
    const now = Date.now();
    const incomingTombs = Array.isArray(data.tombstones) ? data.tombstones.filter(function (t) {
      return t && typeof t.id === 'string' && typeof t.deletedAt === 'number' && isFinite(t.deletedAt) &&
        now - t.deletedAt <= TOMBSTONE_TTL;
    }) : [];
    const localEvents = readEvents(), localTombs = readTombstones();
    const r = mergeData(localEvents, localTombs, incomingEvents, incomingTombs);
    const eventsChanged = !sameJSON(r.events, localEvents);
    const tombsChanged = !sameJSON(r.tombstones, localTombs);
    if (tombsChanged) writeTombstones(r.tombstones);
    if (eventsChanged) writeEvents(r.events);
    if (eventsChanged || tombsChanged) emitChanged();
    return { changed: eventsChanged || tombsChanged, added: r.added, updated: r.updated, removed: r.removed };
  },
  /** fn({reason}) after each user-originated change ('add', 'edit', 'remove', 'restore',
      'nursing-start', 'nursing-end', 'auto-complete', 'import'). Returns unsubscribe. */
  onLocalChange: function (fn) {
    localChangeListeners.push(fn);
    return function () {
      const i = localChangeListeners.indexOf(fn);
      if (i >= 0) localChangeListeners.splice(i, 1);
    };
  },

  /* ---- backup ---- */
  exportData: function () {
    return {
      app: 'baby-journal', version: 1, exportedAt: Date.now(),
      events: readEvents().slice(), tombstones: readTombstones(), settings: App.settings.get()
    };
  },
  /** Imports a backup (object or JSON string). mode 'merge' (default): last-writer-wins like sync.
      mode 'replace': the file's events become the data (others are deleted with tombstones).
      Throws Error with a Hebrew message on a bad file. Returns {added, updated, removed, total}. */
  importData: function (obj, opts) {
    const mode = (opts && opts.mode) || 'merge';
    if (mode !== 'merge' && mode !== 'replace') throw new Error('מצב ייבוא לא מוכר.');
    if (typeof obj === 'string') {
      try { obj = JSON.parse(obj); } catch (err) { throw new Error('לא ניתן לקרוא את הקובץ. ודאי שבחרת קובץ גיבוי של יומן תינוק.'); }
    }
    if (!obj || typeof obj !== 'object' || obj.app !== 'baby-journal' || !Array.isArray(obj.events)) {
      throw new Error('הקובץ אינו קובץ גיבוי של יומן תינוק.');
    }
    if (typeof obj.version !== 'number' || obj.version > 1) {
      throw new Error('קובץ הגיבוי נוצר בגרסה חדשה יותר של האפליקציה.');
    }
    const TYPES = ['nursing', 'diaper', 'custom', 'sleep'];
    const ids = new Set();
    obj.events.forEach(function (e) {
      if (!isEventLike(e) || TYPES.indexOf(e.type) < 0 || ids.has(e.id) ||
          (e.endTimestamp != null && typeof e.endTimestamp !== 'number') ||
          (e.updatedAt != null && typeof e.updatedAt !== 'number')) {
        throw new Error('קובץ הגיבוי פגום: יש בו רשומה לא תקינה.');
      }
      ids.add(e.id);
    });
    const now = Date.now();
    const fileTombs = Array.isArray(obj.tombstones) ? obj.tombstones.filter(function (t) {
      return t && typeof t.id === 'string' && typeof t.deletedAt === 'number' && now - t.deletedAt <= TOMBSTONE_TTL;
    }) : [];
    const localEvents = readEvents(), localTombs = readTombstones(now);
    let result;
    if (mode === 'replace') {
      const events = obj.events.map(function (e) { return Object.assign({}, e, { updatedAt: now }); });
      const tombs = localTombs.filter(function (t) { return !ids.has(t.id); });
      let removed = 0;
      localEvents.forEach(function (e) {
        if (ids.has(e.id)) return;
        removed++;
        tombs.push({ id: e.id, deletedAt: now });
      });
      writeTombstones(tombs);
      writeEvents(events);
      const localIds = new Set(localEvents.map(function (e) { return e.id; }));
      result = { added: events.filter(function (e) { return !localIds.has(e.id); }).length, updated: events.filter(function (e) { return localIds.has(e.id); }).length, removed: removed };
      if (obj.settings && typeof obj.settings === 'object') {
        try { App.settings.set(obj.settings); } catch (err) { /* keep current settings */ }
      }
    } else {
      const r = mergeData(localEvents, localTombs, obj.events, fileTombs);
      writeTombstones(r.tombstones);
      writeEvents(r.events);
      result = { added: r.added, updated: r.updated, removed: r.removed };
    }
    commitLocal('import');
    result.total = readEvents().length;
    return result;
  }
};

/* ------------------------------------------------------------------ */
/* Icons (lucide)                                                       */
/* ------------------------------------------------------------------ */
const path = function (d) { return '<path d="' + d + '"></path>'; };
const ICONS = {
  baby: { n: 'baby', b: path('M10 16c.5.3 1.2.5 2 .5s1.5-.2 2-.5') + path('M15 12h.01') + path('M19.38 6.813A9 9 0 0 1 20.8 10.2a2 2 0 0 1 0 3.6 9 9 0 0 1-17.6 0 2 2 0 0 1 0-3.6A9 9 0 0 1 12 3c2 0 3.5 1.1 3.5 2.5s-.9 2.5-2 2.5c-.8 0-1.5-.4-1.5-1') + path('M9 12h.01') },
  droplets: { n: 'droplets', b: path('M7 16.3c2.2 0 4-1.83 4-4.05 0-1.16-.57-2.26-1.71-3.19S7.29 6.75 7 5.3c-.29 1.45-1.14 2.84-2.29 3.76S3 11.1 3 12.25c0 2.22 1.8 4.05 4 4.05z') + path('M12.56 6.6A10.97 10.97 0 0 0 14 3.02c.5 2.5 2 4.9 4 6.5s3 3.5 3 5.5a6.98 6.98 0 0 1-11.91 4.97') },
  plus: { n: 'plus', b: path('M5 12h14') + path('M12 5v14') },
  timer: { n: 'timer', b: '<line x1="10" x2="14" y1="2" y2="2"></line><line x1="12" x2="15" y1="14" y2="11"></line><circle cx="12" cy="14" r="8"></circle>' },
  check: { n: 'check', b: path('M20 6 9 17l-5-5') },
  x: { n: 'x', b: path('M18 6 6 18') + path('m6 6 12 12') },
  pencil: { n: 'pencil', b: path('M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z') + path('m15 5 4 4') },
  trash2: { n: 'trash-2', b: path('M10 11v6') + path('M14 11v6') + path('M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6') + path('M3 6h18') + path('M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2') },
  stickyNote: { n: 'sticky-note', b: path('M21 9a2.4 2.4 0 0 0-.706-1.706l-3.588-3.588A2.4 2.4 0 0 0 15 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2z') + path('M15 3v5a1 1 0 0 0 1 1h5') },
  moon: { n: 'moon', b: path('M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401') },
  bell: { n: 'bell', b: path('M10.268 21a2 2 0 0 0 3.464 0') + path('M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326') },
  bellOff: { n: 'bell-off', b: path('M10.268 21a2 2 0 0 0 3.464 0') + path('M17 17H4a1 1 0 0 1-.74-1.673C4.59 13.956 6 12.499 6 8a6 6 0 0 1 .258-1.742') + path('m2 2 20 20') + path('M8.668 3.01A6 6 0 0 1 18 8c0 2.687.77 4.653 1.707 6.05') },
  clock: { n: 'clock', b: '<circle cx="12" cy="12" r="10"></circle>' + path('M12 6v6l4 2') },
  triangleAlert: { n: 'triangle-alert', b: path('m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3') + path('M12 9v4') + path('M12 17h.01') },
  listOrdered: { n: 'list-ordered', b: path('M11 5h10') + path('M11 12h10') + path('M11 19h10') + path('M4 4h1v5') + path('M4 9h2') + path('M6.5 20H3.4c0-1 2.6-1.925 2.6-3.5a1.5 1.5 0 0 0-2.6-1.02') },
  chartColumn: { n: 'chart-column', b: path('M3 3v16a2 2 0 0 0 2 2h16') + path('M18 17V9') + path('M13 17V5') + path('M8 17v-3') },
  settings: { n: 'settings', b: path('M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z') + '<circle cx="12" cy="12" r="3"></circle>' },
  share2: { n: 'share-2', b: '<circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><line x1="8.59" x2="15.42" y1="13.51" y2="17.49"></line><line x1="15.41" x2="8.59" y1="6.51" y2="10.49"></line>' },
  download: { n: 'download', b: path('M12 15V3') + path('M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4') + path('m7 10 5 5 5-5') },
  upload: { n: 'upload', b: path('M12 3v12') + path('m17 8-5-5-5 5') + path('M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4') },
  undo2: { n: 'undo-2', b: path('M9 14 4 9l5-5') + path('M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11') },
  notebookPen: { n: 'notebook-pen', b: path('M13.4 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7.4') + path('M2 6h4') + path('M2 10h4') + path('M2 14h4') + path('M2 18h4') + path('M21.378 5.626a1 1 0 1 0-3.004-3.004l-5.01 5.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z') },
  house: { n: 'house', b: path('M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8') + path('M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z') }
};
/** Lucide SVG markup: class="lucide lucide-<kebab-name> <cls>", aria-hidden. Also accepts kebab names ('share-2'). */
App.icon = function (name, cls) {
  let ic = ICONS[name];
  if (!ic) ic = Object.keys(ICONS).map(function (k) { return ICONS[k]; }).find(function (x) { return x.n === name; });
  if (!ic) return '';
  return '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-' + ic.n + (cls ? ' ' + cls : '') + '" aria-hidden="true">' + ic.b + '</svg>';
};
App.icons = {};
Object.keys(ICONS).forEach(function (k) { App.icons[k] = App.icon(k); });

/* ------------------------------------------------------------------ */
/* Small DOM helpers                                                    */
/* ------------------------------------------------------------------ */
App.esc = function (s) {
  return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
};
App.h = function (html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
};

/* ------------------------------------------------------------------ */
/* Notifications                                                        */
/* ------------------------------------------------------------------ */
/** Shows a system notification. Uses the service worker registration when there is one
    (required on Android Chrome, where `new Notification()` throws), else `new Notification`.
    Rejects if notifications are unsupported/not permitted or showing fails. */
App.notify = function (title, options) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') {
    return Promise.reject(new Error('notifications not permitted'));
  }
  const getReg = 'serviceWorker' in navigator && navigator.serviceWorker.getRegistration
    ? navigator.serviceWorker.getRegistration().catch(function () { return null; })
    : Promise.resolve(null);
  return getReg.then(function (reg) {
    if (reg && reg.showNotification) return reg.showNotification(title, options || {});
    new Notification(title, options || {}); // eslint-disable-line no-new
    return undefined;
  });
};

/* ------------------------------------------------------------------ */
/* Toast (sonner-like)                                                  */
/* ------------------------------------------------------------------ */
const TOAST_ICONS = {
  success: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" height="20" width="20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clip-rule="evenodd"></path></svg>',
  error: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" height="20" width="20"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5A.75.75 0 0110 5zm0 10a1 1 0 100-2 1 1 0 000 2z" clip-rule="evenodd"></path></svg>'
};
App.toast = function (message, opts) {
  opts = opts || {};
  const type = opts.type || 'default';
  const host = document.getElementById('toaster');
  if (!host) return { dismiss: function () {} };
  const li = document.createElement('li');
  li.className = 'toast';
  li.setAttribute('data-type', type);
  li.setAttribute('role', 'status');
  let html = '';
  if (TOAST_ICONS[type]) html += '<span class="toast-icon">' + TOAST_ICONS[type] + '</span>';
  html += '<div class="toast-content"><div class="toast-title">' + App.esc(message) + '</div></div>';
  if (opts.action) html += '<button type="button" class="toast-action">' + App.esc(opts.action.label) + '</button>';
  li.innerHTML = html;
  let timer = null;
  function dismiss() {
    clearTimeout(timer);
    if (!li.parentNode) return;
    li.setAttribute('data-removed', 'true');
    setTimeout(function () { if (li.parentNode) li.parentNode.removeChild(li); }, 200);
  }
  if (opts.action) {
    li.querySelector('.toast-action').addEventListener('click', function () {
      try { if (opts.action.onClick) opts.action.onClick(); } finally { dismiss(); }
    });
  }
  host.insertBefore(li, host.firstChild);
  const live = host.querySelectorAll('.toast:not([data-removed])');
  for (let i = 3; i < live.length; i++) live[i].parentNode.removeChild(live[i]);
  requestAnimationFrame(function () { li.setAttribute('data-mounted', 'true'); });
  timer = setTimeout(dismiss, opts.duration || 4000);
  return { dismiss: dismiss };
};
App.toast.success = function (m, o) { return App.toast(m, Object.assign({}, o, { type: 'success' })); };
App.toast.error = function (m, o) { return App.toast(m, Object.assign({}, o, { type: 'error' })); };

/* ------------------------------------------------------------------ */
/* Dialog                                                               */
/* ------------------------------------------------------------------ */
const FOCUSABLE = 'button:not([disabled]), input:not([disabled]):not([type=hidden]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';
App.openDialog = function (opts) {
  const host = document.getElementById('modal');
  const prevFocus = document.activeElement;
  const overlay = document.createElement('div');
  overlay.className = 'dlg-overlay';
  overlay.setAttribute('data-state', 'open');
  const dlg = document.createElement('div');
  dlg.className = 'dlg rounded-3xl' + (opts.className ? ' ' + opts.className : '');
  dlg.setAttribute('role', 'dialog');
  dlg.setAttribute('aria-modal', 'true');
  dlg.setAttribute('data-state', 'open');
  dlg.tabIndex = -1;
  const titleId = 'dlg-title-' + Math.floor(Math.random() * 1e9);
  dlg.setAttribute('aria-labelledby', titleId);
  const header = document.createElement('div');
  header.className = 'dlg-header';
  header.innerHTML = '<h2 class="dlg-title" id="' + titleId + '">' + App.esc(opts.title || '') + '</h2>';
  dlg.appendChild(header);
  if (opts.content) dlg.appendChild(opts.content);
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'dlg-close';
  closeBtn.setAttribute('aria-label', 'סגירה');
  closeBtn.innerHTML = App.icon('x', 'h-4 w-4') + '<span class="sr-only">סגירה</span>';
  dlg.appendChild(closeBtn);
  host.appendChild(overlay);
  host.appendChild(dlg);
  const prevOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  let closed = false;
  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key !== 'Tab') return;
    // keep Tab focus inside the dialog
    const focusables = Array.prototype.filter.call(dlg.querySelectorAll(FOCUSABLE), function (n) {
      return n.getClientRects().length > 0;
    });
    if (!focusables.length) return;
    const first = focusables[0], last = focusables[focusables.length - 1], active = document.activeElement;
    if (e.shiftKey ? (active === first || !dlg.contains(active) || active === dlg) : (active === last || !dlg.contains(active))) {
      e.preventDefault();
      (e.shiftKey ? last : first).focus();
    }
  }
  function close() {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey, true);
    overlay.setAttribute('data-state', 'closed');
    dlg.setAttribute('data-state', 'closed');
    document.body.style.overflow = prevOverflow;
    setTimeout(function () {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      if (dlg.parentNode) dlg.parentNode.removeChild(dlg);
    }, 150);
    if (prevFocus && prevFocus.focus) { try { prevFocus.focus({ preventScroll: true }); } catch (e) { /* element gone */ } }
    if (opts.onClose) opts.onClose();
  }
  overlay.addEventListener('click', close);
  closeBtn.addEventListener('click', close);
  document.addEventListener('keydown', onKey, true);
  const firstField = dlg.querySelector('[autofocus], input, textarea, select');
  (firstField || dlg).focus();
  return { close: close, el: dlg };
};

/* ------------------------------------------------------------------ */
/* Router                                                               */
/* ------------------------------------------------------------------ */
const pages = {};
const TITLES = {
  '/': 'יומן תינוק — הנקה, חיתולים וויטמין D',
  '/history': 'היסטוריה — יומן תינוק',
  '/stats': 'סטטיסטיקה ולוח זמנים מוצע — יומן תינוק',
  '/settings': 'הגדרות — יומן תינוק'
};
const currentRoute = { path: null, cleanup: null };
App.registerPage = function (routePath, def) { pages[routePath] = def; if (currentRoute.path === routePath) renderRoute(); };
function routeFromHash() {
  let h = location.hash.replace(/^#/, '');
  if (!h) return '/';
  h = h.split('?')[0];
  if (h.length > 1) h = h.replace(/\/+$/, '');
  return h || '/';
}
function renderRoute() {
  const routePath = routeFromHash();
  const el = document.getElementById('page');
  if (currentRoute.cleanup) { try { currentRoute.cleanup(); } catch (e) { console.error(e); } }
  currentRoute.cleanup = null;
  currentRoute.path = routePath;
  el.innerHTML = '';
  const def = pages[routePath];
  document.querySelectorAll('a[data-route]').forEach(function (a) {
    const on = a.getAttribute('data-route') === routePath;
    a.classList.toggle('text-primary', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    if (on) a.setAttribute('data-status', 'active'); else a.removeAttribute('data-status');
  });
  window.scrollTo(0, 0);
  if (!def) {
    document.title = 'יומן תינוק';
    el.innerHTML = '<div class="flex min-h-screen items-center justify-center bg-background px-4"><div class="max-w-md text-center"><h1 class="text-7xl font-bold text-foreground">404</h1><h2 class="mt-4 text-xl font-semibold text-foreground">העמוד לא נמצא</h2><p class="mt-2 text-sm text-muted-foreground">העמוד שחיפשת לא קיים או שהועבר.</p><div class="mt-6"><a href="#/" class="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90">חזרה לבית</a></div></div></div>';
    return;
  }
  document.title = def.title || TITLES[routePath] || 'יומן תינוק';
  try { currentRoute.cleanup = def.mount(el) || null; } catch (e) { console.error(e); }
}
App.navigate = function (routePath) { location.hash = '#' + routePath; };

/* ------------------------------------------------------------------ */
/* Feed alarm: full-screen reminder when the next feeding is due        */
/* ------------------------------------------------------------------ */
const readNumber = function (key) { const v = LS.getItem(key); return v ? Number(v) : null; };
function startFeedAlarm() {
  const host = document.getElementById('alarm');
  let shown = false;
  function hide() {
    shown = false;
    host.innerHTML = '';
  }
  function show() {
    shown = true;
    host.innerHTML =
      '<div role="alertdialog" aria-label="תזכורת הנקה" class="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-6 bg-[var(--pastel-rose)] p-8 text-center text-[var(--pastel-rose-fg)]">' +
        App.icon('baby', 'h-20 w-20') +
        '<div><p class="text-3xl font-bold">הגיע זמן הנקה</p><p class="mt-2 text-lg opacity-80" data-slot="alarm-text"></p></div>' +
        '<div class="flex w-full max-w-xs flex-col gap-3">' +
          '<button type="button" data-act="snooze" class="min-h-16 rounded-3xl bg-background text-xl font-semibold text-foreground shadow-sm active:scale-95">נודניק (15 דק\')</button>' +
          '<button type="button" data-act="cancel" class="flex min-h-14 items-center justify-center gap-2 rounded-3xl border border-current text-lg font-medium active:scale-95">' + App.icon('bellOff', 'h-5 w-5') + ' ביטול</button>' +
        '</div>' +
      '</div>';
    host.querySelector('[data-act=snooze]').addEventListener('click', function () {
      LS.setItem(KEYS.snoozeUntil, String(Date.now() + SNOOZE_MS));
      hide();
      check();
    });
    host.querySelector('[data-act=cancel]').addEventListener('click', function () {
      LS.setItem(KEYS.feedDismissed, String(lastFeedingStart(App.store.events())));
      hide();
      check();
    });
  }
  function check() {
    const now = Date.now();
    const due = nextFeedAt(App.store.events(), readNumber(KEYS.snoozeUntil), readNumber(KEYS.feedDismissed));
    const ring = due !== null && now >= due && !isShabbat(now);
    if (ring && !shown) {
      show();
      if (LS.getItem(KEYS.alertsEnabled) === '1') {
        App.notify('יומן תינוק', { body: feedOverdueText(), silent: true, tag: 'feed-alarm' }).catch(function () {});
      }
    }
    if (!ring && shown) hide();
    if (shown) {
      const textEl = host.querySelector('[data-slot=alarm-text]');
      const text = feedOverdueText();
      if (textEl && textEl.textContent !== text) textEl.textContent = text;
    }
  }
  check();
  setInterval(check, 15e3);
  App.store.subscribe(check);
}

/* ------------------------------------------------------------------ */
/* Daily 21:00 diaper notification (local; skipped when server push is on) */
/* ------------------------------------------------------------------ */
function startDailyNotification() {
  function notifyIfNeeded() {
    if (LS.getItem(KEYS.pushEnabled) === '1') return;
    const now = Date.now();
    const lastDay = LS.getItem(KEYS.alertLastDay);
    const lines = eveningWarnings(readEvents(), now, LS.getItem(KEYS.alertsEnabled) === '1', lastDay);
    if (!lines.length || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    // mark first so the many triggers below can't double-notify while the promise is pending
    LS.setItem(KEYS.alertLastDay, dayKey(now));
    App.notify('יומן תינוק', { body: lines.join('\n'), tag: 'diapers-' + dayKey(now) }).catch(function () {
      if (lastDay === null) LS.removeItem(KEYS.alertLastDay); else LS.setItem(KEYS.alertLastDay, lastDay);
    });
  }
  function everyMinute() { notifyIfNeeded(); setTimeout(everyMinute, 6e4 - (Date.now() % 6e4)); }
  everyMinute();
  document.addEventListener('visibilitychange', notifyIfNeeded);
  window.addEventListener('storage', notifyIfNeeded);
  window.addEventListener(CHANGED_EVENT, notifyIfNeeded);
}

/* ------------------------------------------------------------------ */
/* Start (called from js/main.js after every page module has loaded)    */
/* ------------------------------------------------------------------ */
let started = false;
App.start = function () {
  if (started) return;
  started = true;
  autoCompleteNursing(Date.now());
  // end a running nursing side at 15 min even when no page is reading the store (uses the cache)
  setInterval(function () { autoCompleteNursing(Date.now()); }, 1e3);
  window.addEventListener('hashchange', renderRoute);
  renderRoute();
  startFeedAlarm();
  startDailyNotification();
};

export default App;
