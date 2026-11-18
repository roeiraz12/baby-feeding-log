# Clone of https://mama-helper-app.lovable.app — shared contract

Goal: a pixel-faithful, no-build, vanilla-JS clone (Hebrew, RTL, mobile-first, max-w-md).
Open via a static server (e.g. `python -m http.server <port>` in this folder).

## Files and owners
| File | Owner |
|---|---|
| `index.html` | lead (already written — shell, nav, script tags) |
| `styles.css` | ORIGINAL compiled Tailwind v4 CSS from the site — do NOT edit. Every Tailwind class the original uses exists here, so copy class strings verbatim from the original bundles. |
| `extra.css` | design agent — styles for things the original got from JS libs (dialog, toast/sonner, switch, checkbox check, chart, alarm), plus any class missing from styles.css |
| `js/core.js` | code agent 1 |
| `js/today.js` | code agent 1 |
| `js/history.js` | code agent 2 |
| `js/stats.js` | code agent 2 |

Original de-minified-able bundles (read these for exact logic, strings and classes):
`C:/Users/PC/AppData/Local/Temp/claude/65733623d3d8eb48/244b8b48-d91c-4238-b2ea-17cd5b701204/scratchpad/src/`
- `routes-*.js` = Today page, `history-*.js`, `stats-*.js` (component at the very end; rest is recharts),
- `index-*.js` = store + helpers (search `newborn-tracker:events`, functions Dv..Gv, qv store hook, Yv feed alarm, ry daily 22:00 notification, iv nav),
- `dialog-*.js`, `card-*.js` = shadcn Button/Input/Dialog/Card class strings.
Read with `PYTHONIOENCODING=utf-8` (Hebrew).

## Global API (`window.App`, defined in core.js, loaded first)
Plain script tags, no modules. Everything hangs off `window.App`.

### Constants / keys (same localStorage keys as original, so data is compatible)
`App.KEYS = { events:'newborn-tracker:events', active:'newborn-tracker:active-nursing', alertsEnabled:'newborn-tracker:alerts-enabled', alertLastDay:'newborn-tracker:alert-last-day', vitaminDay:'newborn-tracker:vitamin-d-day', snoozeUntil:'newborn-tracker:snooze-until', feedDismissed:'newborn-tracker:feed-alarm-dismissed' }`
`App.FEED_INTERVAL = 3h (108e5)`, `App.NURSING_MAX = 15min (9e5)`, `App.SNOOZE = 15min`.

### Store
- `App.store.events()` → array (auto-completes an active nursing older than 15 min, like original `Bv`)
- `App.store.add(evt)` → evt with id · `App.store.toggleNursing('right'|'left')` → `'started'|'ended'|'blocked'`
- `App.store.remove(id)` · `App.store.restore(evt)` · `App.store.edit(id, patch)` (recomputes durationMs when endTimestamp)
- `App.store.activeNursing()` → event or null
- `App.store.subscribe(fn)` → unsubscribe. Fires on any change (same tab via `newborn-tracker:changed` window event, other tabs via `storage`, plus `visibilitychange`).

Event shape: `{id, type:'nursing'|'diaper'|'custom'|'sleep', subtype:'right'|'left'|'wet'|'dirty'|'custom', timestamp, endTimestamp?, durationMs?, note?}`

### Helpers (ports of original)
`App.dayKey(ts)` (Fv) · `App.isToday(key, now)` (zv) · `App.fmtDuration(ms)` (Nv) · `App.fmtClock(ms)` (Pv) · `App.label(evt)` (Mv) · `App.timeHM(ts)` (he-IL 2-digit) · `App.lastNursing(events)` (Ov) · `App.nextFeedAt(events, snooze, dismissed)` (Dv) · `App.diaperCounts(events, now)` (Uv) · `App.diaperWarnings(events, now)` (Wv) · `App.dailyStats(events)` (Iv) · `App.predictFeeds(events, now, n)` (Lv) · `App.medianIntervalMin(events)` (Rv) · `App.isShabbat(ts)` (hv, Jerusalem coords) · `App.vitaminEvent(ts)` (Hv)

### UI primitives (core.js builds DOM; extra.css styles it — use EXACTLY these class names)
- `App.icons.<name>` → lucide SVG string, takes class via `App.icon(name, cls)`. Needed: baby, droplets, plus, timer, check, x, pencil, trash2, stickyNote, moon, bell, bellOff, clock, triangleAlert, listOrdered, chartColumn.
- `App.toast(message, {type:'success'|'error'|'default', action:{label, onClick}})` → appends `<li class="toast" data-type="success">` with `<span class="toast-icon">` + `<div class="toast-content"><div class="toast-title">` + optional `<button class="toast-action">` into `#toaster` (`ol.toaster`, top-center like sonner). Auto-dismiss 4s, max 3 visible.
- `App.openDialog({title, content: HTMLElement})` → `{close}`. DOM in `#modal`: `div.dlg-overlay` + `div.dlg[role=dialog].rounded-3xl` containing `div.dlg-header > h2.dlg-title`, the content, and `button.dlg-close` (x icon). Esc / overlay click closes. Original shadcn classes for reference: overlay `fixed inset-0 z-50 bg-black/80`; content `fixed left-1/2 top-1/2 grid w-full max-w-lg -translate-1/2 gap-4 border bg-background p-6 shadow-lg sm:rounded-lg` (+ rounded-3xl override); title `text-lg font-semibold leading-none tracking-tight`; header `flex flex-col space-y-1.5 text-center sm:text-left`.
- Form controls inside dialogs: `input.input` (shadcn input + `h-12 text-base`), `label.label`, `button.btn-primary-lg` (shadcn default button size lg, `w-full`), `div.dlg-footer`.
- Switch: `button.switch[role=switch][data-state=checked|unchecked] > span.switch-thumb`.
- Checkbox (vitamin D): `button.checkbox[role=checkbox][data-state]` using original Tailwind classes `h-7 w-7 ...`.

### Router / pages
- Hash routes: `#/`, `#/history`, `#/stats`. Active nav link gets class `text-primary` (plus `aria-current="page"`).
- `App.registerPage(path, {title, mount(el) → cleanup})`. core calls `mount(#page)` on route change and the cleanup on leave. Pages subscribe to the store themselves and re-render; pages own their own 1s/60s intervals.
- Titles: `/` "יומן תינוק — הנקה, חיתולים וויטמין D" · `/history` "היסטוריה — יומן תינוק" · `/stats` "סטטיסטיקה ולוח זמנים מוצע — יומן תינוק".
- `App.start()` is called from index.html after all scripts load: starts router, feed alarm (Yv: fullscreen `div#alarm` rose overlay with snooze/cancel, suppressed on Shabbat, local Notification if alerts enabled), daily 22:00 diaper notification (ry). No server push (original used a backend) — local Notification only.

## Fidelity rules
- Copy Hebrew strings, class strings and SVG paths verbatim from the bundles.
- Font: system stack from styles.css. Colors: CSS vars already in styles.css (`--pastel-*`, oklch).
- Compare against the live site in the browser at 800px-wide and 375px (mobile).

## Changes
- (agent 1, core.js) Additions only, nothing renamed:
  - `App.toast.success(msg, opts)` / `App.toast.error(msg, opts)` shorthands. `App.toast(...)` returns `{dismiss}`; opts also take `duration` (ms). The toast `li` gets `data-mounted="true"` one frame after insertion and `data-removed="true"` ~200ms before removal (for enter/exit animation). Newest toast is inserted first in `#toaster`.
  - `App.openDialog({title, content, onClose?, className?})` → `{close, el}`. `div.dlg-overlay` and `div.dlg` carry `data-state="open"`, which becomes `"closed"` 150ms before removal. Body scroll is locked while open. The close button is `button.dlg-close` > lucide x `h-4 w-4` + `span.sr-only`.
  - Helpers: `App.h(html)` → first element from an HTML string, `App.esc(str)` HTML-escape, `App.navigate(path)`, `App.newId()` (kv), `App.eveningWarnings(events, now, alertsOn, lastDay)` (Gv), `App.shabbatWindow(ts)` (mv → `[start,end]`), `App.dayHours(dayKey)` (gv), `App.CHANGED_EVENT`, `App.KEYS.pushEnabled`.
  - `App.icon(name, cls)` emits `class="lucide lucide-<kebab-name> <cls>"` with `aria-hidden="true"`, matching the original markup. `App.icons.<name>` is the same SVG without an extra class.
  - Unknown hash routes render the original 404 markup. Active nav links also get `data-status="active"`.
  - Vitamin D checkbox: `button.checkbox[role=checkbox][data-state=unchecked]` plus the original shadcn classes with `h-7 w-7`. It never renders checked, because it disappears once clicked, as in the original.
