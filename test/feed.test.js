// Server-side "next feeding" push helpers (lib/feed.js). Importing it pins TZ to Asia/Jerusalem.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { feedBody, feedPayload, sameToken, isShabbat, MIN_INTERVAL_MS, MAX_INTERVAL_MS } from '../lib/feed.js';
import { warnings, israelHour } from '../lib/diapers.js';

const at = (y, mo, d, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();

test('lib/diapers.js runs in Israel time', () => {
  assert.equal(process.env.TZ, 'Asia/Jerusalem');
  assert.equal(israelHour(Date.UTC(2026, 10, 25, 19, 0)), 21); // UTC+2 in winter
  assert.equal(israelHour(Date.UTC(2026, 6, 1, 18, 0)), 21);   // UTC+3 in summer
  assert.deepEqual(warnings(6, 3), []);
  assert.equal(warnings(2, 0, { wet: 6, dirty: 3 }).length, 2);
});

test('feedBody: elapsed time since the feeding started, plus its start time', () => {
  const start = at(2026, 11, 25, 14, 5);
  assert.equal(feedBody(start, start + 180 * 6e4), 'עברו 3 שעות מההנקה האחרונה (התחילה ב-14:05)');
  assert.equal(feedBody(start, start + 90 * 6e4), 'עברה שעה וחצי מההנקה האחרונה (התחילה ב-14:05)');
  assert.ok(feedBody(start, start).startsWith('עברו 1 דקות')); // never below one minute
});

test('feedPayload is a persistent, re-alerting notification', () => {
  const start = at(2026, 11, 25, 9), due = start + 3 * 36e5;
  const p = feedPayload(start, due);
  assert.equal(p.tag, 'feed-alarm');
  assert.equal(p.requireInteraction, true);
  assert.equal(p.renotify, true);
  assert.equal(p.timestamp, due);
  assert.equal(p.url, '/#/');
  assert.ok(p.body.includes('09:00'));
});

test('sameToken compares strings only, in constant time, and length-sensitively', () => {
  assert.equal(sameToken('abc', 'abc'), true);
  assert.equal(sameToken('abc', 'abd'), false);
  assert.equal(sameToken('abc', 'abcd'), false);
  assert.equal(sameToken(undefined, 'abc'), false);
  assert.equal(sameToken(123, 123), false);
});

test('interval bounds match the app setting and isShabbat is re-exported', () => {
  assert.equal(MIN_INTERVAL_MS, 30 * 6e4);
  assert.equal(MAX_INTERVAL_MS, 480 * 6e4);
  assert.equal(isShabbat(at(2026, 11, 28, 12)), true);
  assert.equal(isShabbat(at(2026, 11, 25, 12)), false);
});
