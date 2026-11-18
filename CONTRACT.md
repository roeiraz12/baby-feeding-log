# יומן תינוק (baby journal) — shared contract

A no-build, vanilla-JS PWA (Hebrew, RTL, mobile-first, `max-w-md`). It started as a clone of
mama-helper-app.lovable.app; that phase is over and the app is now being **improved** —
deviating from the original look/behaviour is fine when it is better.
Run it with `node dev-server.mjs 8110` (static files from disk + the `api/` functions, like Vercel).
ES modules need http(s), so `file://` does not work.

Hard rules
- `styles.css` is compiled Tailwind v4 — **never edit it**. It only contains the utility classes
  that were compiled into it (e.g. `grid-cols-4` was missing and lives in `extra.css`). Before
  using a Tailwind class, grep `styles.css`; if it is missing, write plain CSS in your own CSS file.
  Theme tokens live there: `--background --foreground --card --primary --primary-foreground
  --secondary --muted-foreground --border --input --ring --radius --pastel-{rose,lavender,sky,sand}`
  and `--pastel-*-fg`.
- Only edit the files you own (table below). Need something in a shared file? Ask the lead.
- Data must stay compatible: same localStorage keys, same event shape (new optional fields OK).

## Files and owners
| File | Owner |
|---|---|
| `index.html` (shell, nav, `<link>`/`<script>` tags) | lead / foundation |
| `styles.css` | nobody — never edit |
| `extra.css` (font, nav, dialog, inputs, buttons, switch, checkbox, toasts, chart base) | lead / foundation |
| `shared/rules.js` (pure rules for client + server) | lead / foundation |
| `js/core.js` (App API), `js/main.js` (boot) | lead / foundation |
| `js/today.js` + `css/today.css` | today agent |
| `js/history.js` | history agent (if any; else lead) |
| `js/stats.js` + `css/stats.css` | stats agent |
| `js/settings.js` + `css/settings.css` + `js/sync.js` + `api/family/*` + `lib/family.js` | settings agent |
| `js/push.js`, `diaper-messaging-sw.js`, `api/public/push/*`, `api/cron/*` | PWA/notifications agent (if any; else lead) |
| `lib/redis.js`, `lib/store.js`, `lib/ratelimit.js`, `lib/http.js`, `lib/diapers.js` | lead / foundation (use, don't fork) |

## Module layout
`index.html` loads, as `<script type="module">` (deferred, executed **in this order**):
`js/core.js` → `js/push.js` → `js/today.js` → `js/history.js` → `js/stats.js` → `js/settings.js` → `js/sync.js` → `js/main.js`.

- `js/core.js` is an ES module; it `import`s `../shared/rules.js` and defines `window.App`.
- Page files may stay IIFE-style and use `var App = window.App;` (always take it from `window`;
  don't rely on classic-script globals or top-level `this`). They may also be real modules.
- `js/main.js` runs last: `App.start(); App.push.startSync();` — routes must be registered before it.
- CSS order: `styles.css` → `extra.css` → `css/today.css` → `css/stats.css` → `css/settings.css`.
- Font: **Rubik** (Google Fonts, 400/500/600/700) via `--font-sans` in `extra.css`, system stack fallback.

## shared/rules.js (ES module: no DOM, no Node APIs; local-time math)
Browser uses the device time zone; the server pins `Asia/Jerusalem` in `lib/diapers.js`
(which re-exports these and adds `israelHour(ts)` and `warnings(wet, dirty, goals)`).
- `shabbatWindow(ts)` → `[startMs, endMs]` (Friday sunset −0.833° → Saturday nightfall −8.5°, Jerusalem)
- `isShabbat(ts)` → boolean · `dayKey(ts)` → `"YYYY-MM-DD"` · `trackedHours(dayKey)` → non-Shabbat hours of that day
- `sunsetAt(date, altitude)` → ms
- `DEFAULT_GOALS = {wet: 6, dirty: 3}`
- `diaperWarnings(wet, dirty, goals?)` → `['פיפי היום: X מתוך יעד של N.', 'קקי היום: Y מתוך יעד של M.']` (only unmet lines)
- `EVENING_NOTIFY_HOUR = 21` — the daily diaper notification (local + server push) is sent from 21:00 Israel time.
- `WARNING_FROM_HOUR = 20` — the stats page shows the diaper-warning card only from 20:00 (stats agent implements).
- `updatedAtOf(evt)` → `evt.updatedAt ?? evt.timestamp`
- `mergeData(localEvents, localTombs, incomingEvents, incomingTombs)` → `{events, tombstones, added, updated, removed}`.
  Pure last-writer-wins merge (same rule `App.store.applyRemote` uses; the sync server may use it too):
  newer `updatedAtOf` wins (ties broken by JSON string compare, so all devices agree); a tombstone
  deletes an event when `deletedAt >= updatedAtOf(event)`; a tombstone older than the event is dropped.

## Global API (`window.App`, from js/core.js)

### Keys / constants
`App.KEYS = { events:'newborn-tracker:events', active:'newborn-tracker:active-nursing',
alertsEnabled:'newborn-tracker:alerts-enabled', alertLastDay:'newborn-tracker:alert-last-day',
vitaminDay:'newborn-tracker:vitamin-d-day', snoozeUntil:'newborn-tracker:snooze-until',
feedDismissed:'newborn-tracker:feed-alarm-dismissed', pushEnabled:'newborn-tracker:push-enabled',
settings:'newborn-tracker:settings', tombstones:'newborn-tracker:tombstones' }`
(push.js adds `App.KEYS.pushDevice = 'newborn-tracker:push-device'`.)

- `App.NURSING_MAX = 9e5` (15 min, intended) · `App.SNOOZE = 9e5` · `App.FEEDING_GAP = 30 min` · `App.TOMBSTONE_TTL = 30 days`
- `App.FEED_INTERVAL` — **getter**, ms, follows the setting (was a 3h constant). Prefer `App.feedIntervalMs()`.
- `App.EVENING_NOTIFY_HOUR = 21`, `App.WARNING_FROM_HOUR = 20` (from shared/rules.js)
- Events: `App.CHANGED_EVENT = 'newborn-tracker:changed'` (window `Event`, any data or settings change in this tab),
  `App.SETTINGS_EVENT = 'newborn-tracker:settings-changed'` (window `CustomEvent`, `detail` = new settings).

### Settings
- `App.settings.get()` → `{ feedIntervalMin: 180, wetGoal: 6, dirtyGoal: 3 }` (defaults merged with stored; a copy).
- `App.settings.set(patch)` → new settings. Validates: `feedIntervalMin` integer 30–480, `wetGoal`/`dirtyGoal`
  integer 1–20 (numeric strings accepted). **Throws `Error` with a Hebrew message** on an invalid value
  (nothing saved). Unknown keys ignored. Persists to `newborn-tracker:settings`, dispatches
  `SETTINGS_EVENT` then `CHANGED_EVENT` (so every `App.store.subscribe` page re-renders).
- `App.settings.defaults` (frozen).
- `App.feedIntervalMs()` · `App.goals()` → `{wet, dirty}`.
- `App.feedOverdueText(min?)` → e.g. `'עברו 3 שעות מההנקה האחרונה'`, `'עברו שעתיים וחצי מההנקה האחרונה'`,
  `'עברה שעה ו-15 דקות מההנקה האחרונה'` (defaults to the configured interval).
- `App.hoursPhrase(min)` → `'שעתיים וחצי'`, `'3 שעות'`, `'45 דקות'`, `'חצי שעה'`…
- Settings are per device (not synced). They are in `exportData()`.

### Store
Event shape: `{id, type:'nursing'|'diaper'|'custom'|'sleep', subtype:'right'|'left'|'wet'|'dirty'|'custom',
timestamp, endTimestamp?, durationMs?, note?, updatedAt?}` (`updatedAt` ms is set on every add/edit/
toggle-end/auto-complete/restore; older events lack it → treat `timestamp` as `updatedAt`).

The parsed events are cached in memory (invalidated on own writes, `storage` events, and when the tab
becomes visible). **Treat returned event objects as read-only**; change data only through `App.store`.
If you write localStorage directly, call `App.store.reload()`.

- `App.store.events()` → array copy. First auto-completes any open nursing side older than 15 min.
- `App.store.activeNursing()` → the running nursing event or `null`: the one this device started
  (`active-nursing` key) or — e.g. started on the partner's phone — the newest open nursing event
  (`type:'nursing'`, no `endTimestamp`) that started < `NURSING_MAX` ago.
- `App.store.toggleNursing('right'|'left')` → `'started'|'ended'|'blocked'` (works on a derived active side too).
- `App.store.add(evt)` → stored evt. Keeps `evt.id` if given and unused (vitamin D uses
  `vitamin-d-YYYY-MM-DD`, so both parents marking it dedupes); otherwise a new id.
- `App.store.edit(id, patch)` (recomputes `durationMs` when `endTimestamp`) · `App.store.remove(id)` (adds tombstone)
  · `App.store.restore(evt)` (undo: removes tombstone, bumps `updatedAt`).
- `App.store.subscribe(fn)` → unsubscribe. Fires on `CHANGED_EVENT`, `storage`, `visibilitychange`.
- `App.store.reload()` — drop caches + emit change.

#### Family-sharing primitives (sync engine in `js/sync.js` builds on these)
- Tombstones: localStorage `newborn-tracker:tombstones` = `[{id, deletedAt}]`, pruned after 30 days.
- `App.store.snapshot()` → `{events, tombstones}` (copies).
- `App.store.applyRemote({events, tombstones})` → `{changed, added, updated, removed}`. LWW merge
  (`mergeData`), invalid entries ignored, writes once, emits `CHANGED_EVENT` once (only if changed),
  **never** fires `onLocalChange`. Applying the same data again is a no-op.
- `App.store.onLocalChange(fn)` → unsubscribe. `fn({reason})` after each user-originated write, reason ∈
  `'add' 'edit' 'remove' 'restore' 'nursing-start' 'nursing-end' 'auto-complete' 'import'`. Fires only in the
  tab that made the change.
- `App.mergeData` = shared `mergeData`.

#### Backup
- `App.store.exportData()` → `{app:'baby-journal', version:1, exportedAt, events, tombstones, settings}`.
- `App.store.importData(objOrJsonString, {mode:'merge'|'replace'})` → `{added, updated, removed, total}`.
  `merge` (default) = LWW like sync (file tombstones included). `replace` = the file's events become the
  data (`updatedAt` bumped to now; other local events get tombstones so the deletion syncs) and the file's
  settings are applied. Throws `Error` with a Hebrew message on a bad file / unknown version / bad event.
  Fires `onLocalChange('import')`.

### Helpers
`App.dayKey(ts)` · `App.isToday(key, now)` · `App.isShabbat(ts)` · `App.shabbatWindow(ts)` · `App.dayHours(key)`
· `App.fmtDuration(ms)` ("12 דק'" / "1 ש' 5 דק'") · `App.fmtClock(ms)` ("05:09") · `App.label(evt)` · `App.timeHM(ts)`
· `App.feedings(events)` → `[{start, end, events}]` (sides within 30 min = one feeding) · `App.lastNursing(events)`
(start of last feeding, 0 if none) · `App.nextFeedAt(events, snoozeUntil, dismissedStart)` (uses the setting)
· `App.diaperCounts(events, now)` → `{wet, dirty}` · `App.diaperWarnings(events, now)` (configured goals; `[]` on Shabbat)
· `App.eveningWarnings(events, now, alertsOn, lastAlertDay)` (from `EVENING_NOTIFY_HOUR`, once a day)
· `App.dailyStats(events)` · `App.predictFeeds(events, now, n=4)` · `App.medianIntervalMin(events)`
· `App.vitaminEvent(ts)` · `App.vitaminDoneToday(now?)` (true if the `vitamin-d-day` key is today OR a
vitamin-D event exists today — id `vitamin-d-YYYY-MM-DD` or custom note `'ויטמין D'`) · `App.newId()`
· `App.h(html)` → element · `App.esc(str)` · `App.navigate(path)`.

### Notifications
- `App.notify(title, options)` → Promise. Uses `navigator.serviceWorker.getRegistration()` →
  `reg.showNotification` when a registration exists (required on Android Chrome, where `new Notification()`
  throws), else `new Notification`. Rejects when `Notification.permission !== 'granted'` or showing fails.
  Used by the feed alarm (`tag:'feed-alarm'`) and the local evening diaper notification. core.js does not
  register a service worker; whoever owns the SW registers it at startup.
- Server push (`js/push.js` → `/api/public/push/device`) now also sends `wetGoal`/`dirtyGoal`; the cron
  (`api/cron/daily.js`, Vercel cron 18:00 + 19:00 UTC) sends from `EVENING_NOTIFY_HOUR` using those goals.

### UI primitives (class names styled in extra.css)
- Icons: `App.icon(name, cls)` → `<svg class="lucide lucide-<kebab> <cls>" aria-hidden="true">`; `App.icons.<name>`.
  Names: baby, droplets, plus, timer, check, x, pencil, trash2, stickyNote, moon, bell, bellOff, clock,
  triangleAlert, listOrdered, chartColumn, settings, share2, download, upload, undo2, notebookPen, house
  (kebab names like `'share-2'` also work). Need another icon? Ask the lead (ICONS lives in core.js).
- `App.toast(message, {type:'success'|'error'|'default', action:{label,onClick}, duration})` → `{dismiss}`;
  `App.toast.success(m, o)` / `App.toast.error(m, o)`. Sonner-like, top-center, max 3, 4s.
- `App.openDialog({title, content, onClose?, className?})` → `{close, el}`. `#modal` gets `div.dlg-overlay` +
  `div.dlg[role=dialog]` (`data-state` open/closed), `div.dlg-header > h2.dlg-title` (centered on mobile,
  `text-align:start` from 40rem), content, `button.dlg-close[aria-label="סגירה"]` on the inline-end side
  (LEFT in RTL). Esc / overlay closes; Tab is trapped (buttons, inputs, textarea, select, a[href], [tabindex]).
- Form controls: `input.input`, `label.label`, `button.btn-primary-lg`, `div.dlg-footer` (stacked on mobile,
  row at the inline end from 40rem). Switch: `button.switch[role=switch][data-state] > span.switch-thumb`.
  Checkbox: `button.checkbox[role=checkbox][data-state]`.

### Router / pages
- Hash routes: `#/` (יומן), `#/history`, `#/stats`, `#/settings`. Bottom nav = 4 tabs (`grid-cols-4`);
  the active link gets `text-primary`, `aria-current="page"`, `data-status="active"`.
- `App.registerPage(path, {title, mount(el) → cleanup})`. Pages subscribe to the store themselves and own
  their own intervals. Titles: `/` "יומן תינוק — הנקה, חיתולים וויטמין D" · `/history` "היסטוריה — יומן תינוק"
  · `/stats` "סטטיסטיקה ולוח זמנים מוצע — יומן תינוק" · `/settings` "הגדרות — יומן תינוק".
- `App.start()` (from main.js): router, 1s nursing auto-complete (cache only, no parsing), feed alarm
  (fullscreen `#alarm`, text = `feedOverdueText()`, suppressed on Shabbat, `App.notify` if alerts on),
  local evening diaper notification (skipped when server push is enabled).

## Server (api/, Vercel functions, ES modules)
- `lib/redis.js` → `export const redis` (Upstash client or `null`), `usingRedis`. `lib/store.js` re-exports them.
- `lib/ratelimit.js` → `export async function rateLimit(req, bucket, limit, windowSec)` → `true` if allowed.
  Per client IP (`x-forwarded-for` first entry, else `req.socket.remoteAddress`; also `clientIp(req)`);
  Redis `INCR` + `EXPIRE` on first hit; in-memory Map without Redis; fails open on Redis errors.
- `lib/http.js` → `send(res, status, json)`, `readJson(req)`.
- The dev server caches imported api modules: restart it after changing `api/` or `lib/`.

## Family sharing (no accounts)
- Client `App.sync` (js/sync.js): `status()`, `onStatus(fn)`, `link()`, `invite()`, `join(code)`, `leave()`,
  `syncNow()`, `joinUrl(code)`. Keys: `App.KEYS.family = 'newborn-tracker:family'` (`{familyId, deviceId, secret, rev}`),
  `App.KEYS.familyPushed = 'newborn-tracker:family-pushed'` (id → updatedAt the server already has).
  Syncs on start, 1.5s after a local change, every 30s while visible, on visible/online. Errors are quiet (status only).
  A 401 forgets the credentials (sharing stopped, data kept).
- Join link: `#/settings?join=CODE` (6 chars from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, 15 min, single use).
- Server `api/family/{create,invite,join,sync,leave}.js` + `lib/family.js`. Every device has its own secret
  (only `s1:` + sha256 stored). Redis per family F: `fam:F` hash (rev, n, c, `d:<deviceId>` → hash),
  `fam:F:i` hash (id → `"<updatedAt>|e|<json>"` or `"<updatedAt>|t|<json>"`), `fam:F:l` zset (id → rev),
  `fam:code:C` (familyId, TTL 900s). A sync costs 1 command when idle, 2 (HMGET + EVAL) otherwise.
  Max 500 items per request each way (`more` flag), 512 KB body, 60k items per family.
- When adding JS/CSS files, also add them to `APP_SHELL` in `diaper-messaging-sw.js` and bump `CACHE_VERSION`.
