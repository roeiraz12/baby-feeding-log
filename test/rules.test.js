// Unit tests for the pure rules shared by the browser app and the server.
// The app runs in Israel time (the server pins it in lib/diapers.js); do the same here.
process.env.TZ = 'Asia/Jerusalem';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  shabbatWindow, isShabbat, dayKey, trackedHours, diaperWarnings, meetsDiaperGoals, DEFAULT_GOALS,
  mergeData, hoursPhrase, feedOverdueText, feedings, lastFeedingStart, nextFeedAt, FEEDING_GAP_MS,
  dailyStats, feedingIntervals, predictFeeds, medianIntervalMin, diaperCounts,
} from '../shared/rules.js';

const MIN = 6e4, H = 36e5;
const at = (y, mo, d, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();
const hm = ts => { const d = new Date(ts); return d.getHours() + d.getMinutes() / 60; };
const nursing = (start, minutes, side = 'left', id = 'n' + start) =>
  ({ id, type: 'nursing', subtype: side, timestamp: start, endTimestamp: start + minutes * MIN, durationMs: minutes * MIN });
const diaper = (ts, subtype, id = 'd' + ts + subtype) => ({ id, type: 'diaper', subtype, timestamp: ts });

/* ---------- date bucketing ---------- */
test('dayKey buckets by local (Israel) calendar day', () => {
  assert.equal(dayKey(at(2026, 11, 25, 0, 0)), '2026-11-25');
  assert.equal(dayKey(at(2026, 11, 25, 23, 59)), '2026-11-25');
  assert.equal(dayKey(at(2026, 12, 31, 23, 59) + MIN), '2027-01-01');
  assert.equal(dayKey(Date.UTC(2026, 10, 25, 22, 30)), '2026-11-26'); // 00:30 in Israel
});

/* ---------- Shabbat ---------- */
test('shabbatWindow: winter Shabbat runs from Friday sunset to Saturday nightfall', () => {
  const [start, end] = shabbatWindow(at(2026, 11, 28, 12));
  assert.equal(dayKey(start), '2026-11-27');
  assert.equal(dayKey(end), '2026-11-28');
  assert.ok(hm(start) > 16.2 && hm(start) < 16.9, `start ${hm(start)}`);
  assert.ok(hm(end) > 17.1 && hm(end) < 17.8, `end ${hm(end)}`);
});

test('shabbatWindow: summer times are later and the same window is found from any weekday', () => {
  const [start, end] = shabbatWindow(at(2026, 6, 17, 9)); // Wednesday
  assert.equal(dayKey(start), '2026-06-19');
  assert.ok(hm(start) > 19.5 && hm(start) < 20.1, `start ${hm(start)}`);
  assert.ok(hm(end) > 20.2 && hm(end) < 20.9, `end ${hm(end)}`);
  assert.deepEqual(shabbatWindow(at(2026, 6, 20, 10)), [start, end]); // from Saturday
});

test('isShabbat around the edges', () => {
  const [start, end] = shabbatWindow(at(2026, 11, 27, 12));
  assert.equal(isShabbat(start - MIN), false);
  assert.equal(isShabbat(start), true);
  assert.equal(isShabbat(at(2026, 11, 28, 10)), true);
  assert.equal(isShabbat(end - MIN), true);
  assert.equal(isShabbat(end), false);
  assert.equal(isShabbat(at(2026, 11, 25, 12)), false); // Wednesday
});

test('trackedHours excludes Shabbat hours from Friday and Saturday only', () => {
  assert.equal(trackedHours('2026-11-25'), 24); // Wednesday
  assert.equal(trackedHours('2026-11-29'), 24); // Sunday
  const fri = trackedHours('2026-11-27'), sat = trackedHours('2026-11-28');
  assert.ok(fri > 16 && fri < 17, `friday ${fri}`);     // midnight to sunset
  assert.ok(sat > 6 && sat < 7, `saturday ${sat}`);     // nightfall to midnight
});

/* ---------- diaper goals / daily verdict ---------- */
test('diaperWarnings lists each unmet goal (defaults 6 wet / 3 dirty)', () => {
  assert.deepEqual(DEFAULT_GOALS, { wet: 6, dirty: 3 });
  assert.deepEqual(diaperWarnings(6, 3), []);
  const w = diaperWarnings(4, 3);
  assert.equal(w.length, 1);
  assert.ok(w[0].includes('4') && w[0].includes('6'));
  assert.equal(diaperWarnings(0, 0).length, 2);
  assert.deepEqual(diaperWarnings(3, 1, { wet: 3, dirty: 1 }), []);
  assert.equal(diaperWarnings(5, 3, { wet: 'x' }).length, 1); // invalid goal falls back to default
});

test('meetsDiaperGoals is the green/red verdict for a day', () => {
  assert.equal(meetsDiaperGoals(6, 3), true);
  assert.equal(meetsDiaperGoals(8, 4), true);
  assert.equal(meetsDiaperGoals(5, 3), false);
  assert.equal(meetsDiaperGoals(6, 2), false);
  assert.equal(meetsDiaperGoals(4, 2, { wet: 4, dirty: 2 }), true);
});

test('diaperCounts counts only today\'s diapers', () => {
  const now = at(2026, 11, 25, 20);
  const events = [
    diaper(at(2026, 11, 25, 1), 'wet'), diaper(at(2026, 11, 25, 9), 'wet'), diaper(at(2026, 11, 25, 12), 'dirty'),
    diaper(at(2026, 11, 24, 23, 59), 'wet'), nursing(at(2026, 11, 25, 10), 10),
  ];
  assert.deepEqual(diaperCounts(events, now), { wet: 2, dirty: 1 });
});

/* ---------- feedings and next feeding ---------- */
test('feedings: sides within 30 minutes of each other form one feeding', () => {
  const t = at(2026, 11, 25, 8);
  const events = [
    nursing(t + 3 * H, 12, 'left'),
    nursing(t, 15, 'left'),
    nursing(t + 15 * MIN + FEEDING_GAP_MS, 10, 'right'), // exactly at the gap: same feeding
    nursing(t + 2 * H, 10, 'right'),
    diaper(t + 30 * MIN, 'wet'),
  ];
  const f = feedings(events);
  assert.equal(f.length, 3);
  assert.equal(f[0].start, t);
  assert.equal(f[0].events.length, 2);
  assert.equal(f[0].end, t + 15 * MIN + FEEDING_GAP_MS + 10 * MIN);
  assert.equal(lastFeedingStart(events), t + 3 * H);
  assert.equal(lastFeedingStart([]), 0);
});

test('nextFeedAt: last feeding start + interval, snooze pushes it later, dismissal clears it', () => {
  const t = at(2026, 11, 25, 8);
  const events = [nursing(t, 15), nursing(t + 20 * MIN, 10, 'right')];
  assert.equal(nextFeedAt(events, 180 * MIN), t + 3 * H);
  assert.equal(nextFeedAt(events, 180 * MIN, t + 3 * H + 15 * MIN), t + 3 * H + 15 * MIN);
  assert.equal(nextFeedAt(events, 180 * MIN, t + H), t + 3 * H); // an older snooze is ignored
  assert.equal(nextFeedAt(events, 180 * MIN, 0, t), null);
  assert.equal(nextFeedAt([], 180 * MIN), null);
});

test('feedingIntervals, medianIntervalMin and predictFeeds', () => {
  const t = at(2026, 11, 25, 0);
  const gaps = [150, 180, 170, 200, 5, 600]; // minutes; 5 and 600 are implausible and ignored
  const events = []; let s = t;
  events.push(nursing(s, 10));
  for (const g of gaps) { s += g * MIN; events.push(nursing(s, 2, 'right')); }
  const x = feedingIntervals(events);
  assert.equal(x.starts.length, 6); // the 5-minute gap merges into the previous feeding
  assert.deepEqual(x.gaps.map(g => g / MIN), [150, 180, 170, 200]); // the 605-minute gap is dropped
  assert.equal(medianIntervalMin(events), 180);
  const last = x.starts[x.starts.length - 1];
  assert.deepEqual(predictFeeds(events, last + 10 * MIN, 3), [last + 180 * MIN, last + 360 * MIN, last + 540 * MIN]);
  assert.deepEqual(predictFeeds(events, last + 400 * MIN, 1), [last + 540 * MIN]); // skips past slots
  assert.deepEqual(predictFeeds(events.slice(0, 3), last), []); // too little data
  assert.equal(medianIntervalMin(events.slice(0, 3)), null);
});

/* ---------- Shabbat-aware daily stats ---------- */
test('dailyStats averages per tracked day, weighting Shabbat days by their tracked hours', () => {
  const events = [];
  // Wednesday and Thursday: full days with 8 feedings, 6 wet, 3 dirty
  for (const d of [25, 26]) {
    for (let k = 0; k < 8; k++) events.push(nursing(at(2026, 11, d, 1 + k * 3), 10, 'left', `n${d}-${k}`));
    for (let k = 0; k < 6; k++) events.push(diaper(at(2026, 11, d, 2 + k * 3), 'wet'));
    for (let k = 0; k < 3; k++) events.push(diaper(at(2026, 11, d, 3 + k * 5), 'dirty'));
  }
  const s = dailyStats(events);
  assert.equal(s.days, 2);
  assert.equal(s.avgNursing, 8);
  assert.equal(s.avgWet, 6);
  assert.equal(s.avgDirty, 3);
  assert.equal(s.leftCount, 16);
  assert.equal(s.daily.length, 2);
  assert.equal(s.daily[0].partial, false);

  // Add a Friday with logging only before Shabbat: it counts as a partial day
  const fri = [nursing(at(2026, 11, 27, 6), 10, 'right', 'f1'), diaper(at(2026, 11, 27, 7), 'wet')];
  const s2 = dailyStats(events.concat(fri));
  const friday = s2.daily.find(d => d.key === '2026-11-27');
  assert.equal(friday.partial, true);
  assert.ok(friday.label.endsWith('*'));
  const dayEq = (48 + trackedHours('2026-11-27')) / 24;
  assert.equal(s2.avgNursing, Math.round((17 / dayEq) * 10) / 10);
  assert.equal(s2.rightCount, 1);
});

test('dailyStats keeps only the last 7 days in the daily chart', () => {
  const events = [];
  for (let d = 1; d <= 10; d++) events.push(diaper(at(2026, 11, d, 10), 'wet'));
  const s = dailyStats(events);
  assert.equal(s.days, 10);
  assert.equal(s.daily.length, 7);
  assert.equal(s.daily[6].key, '2026-11-10');
});

/* ---------- family sync merge ---------- */
test('mergeData: last writer wins, tombstones delete, re-created events survive', () => {
  const a = { id: 'a', type: 'diaper', subtype: 'wet', timestamp: 100 };
  const b = { id: 'b', type: 'diaper', subtype: 'dirty', timestamp: 200 };
  const bNewer = { ...b, subtype: 'wet', updatedAt: 500 };
  const c = { id: 'c', type: 'nursing', subtype: 'left', timestamp: 300 };
  const r = mergeData([a, b], [], [bNewer, c], [{ id: 'a', deletedAt: 150 }]);
  assert.deepEqual(r.events.map(e => e.id), ['b', 'c']);
  assert.equal(r.events[0].subtype, 'wet');
  assert.deepEqual([r.added, r.updated, r.removed], [1, 1, 1]);
  assert.deepEqual(r.tombstones, [{ id: 'a', deletedAt: 150 }]);

  const restored = { ...a, updatedAt: 900 };
  const r2 = mergeData([], [{ id: 'a', deletedAt: 150 }], [restored], []);
  assert.deepEqual(r2.events, [restored]);
  assert.deepEqual(r2.tombstones, []);
});

test('mergeData is deterministic on ties and does not mutate its inputs', () => {
  const x1 = { id: 'x', type: 'diaper', subtype: 'wet', timestamp: 1 };
  const x2 = { id: 'x', type: 'diaper', subtype: 'dirty', timestamp: 1 };
  const local = [x1], incoming = [x2];
  const snapshot = JSON.stringify([local, incoming]);
  const ab = mergeData([x1], [], [x2], []).events[0];
  const ba = mergeData([x2], [], [x1], []).events[0];
  assert.deepEqual(ab, ba);
  mergeData(local, [], incoming, []);
  assert.equal(JSON.stringify([local, incoming]), snapshot);
});

/* ---------- Hebrew duration text ---------- */
test('hoursPhrase and feedOverdueText use natural Hebrew forms', () => {
  assert.equal(hoursPhrase(45), '45 דקות');
  assert.equal(hoursPhrase(30), 'חצי שעה');
  assert.equal(hoursPhrase(60), 'שעה');
  assert.equal(hoursPhrase(150), 'שעתיים וחצי');
  assert.equal(hoursPhrase(180), '3 שעות');
  assert.equal(hoursPhrase(80), 'שעה ו-20 דקות');
  assert.equal(feedOverdueText(180), 'עברו 3 שעות מההנקה האחרונה');
  assert.equal(feedOverdueText(75), 'עברה שעה ו-15 דקות מההנקה האחרונה');
  assert.equal(feedOverdueText(30), 'עברה חצי שעה מההנקה האחרונה');
});
