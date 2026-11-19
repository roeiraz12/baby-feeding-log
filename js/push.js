/* push.js — service worker + background (Web Push) notifications.
   - registerSW(): registers /diaper-messaging-sw.js at start-up (offline app shell, and
     App.notify needs a registration on Android Chrome).
   - Daily diaper alert: the server (api/) stores the device subscription plus today's diaper
     counts and pushes at ~21:00 Israel time (App.EVENING_NOTIFY_HOUR), using this device's goals.
   - "Next feeding" reminder: one push at (start of the last feeding + feed interval), even when
     the app is closed. Armed for one feeding by the bell on the Today page, or for every feeding
     by the feedReminderAlways setting. The server schedules it with Upstash QStash.
   - ensureSubscribed(): permission + push subscription + a local device record (shared by both).
   - Syncs are debounced and skipped when nothing changed since the last successful one; the
     device is deleted on the server once neither the diaper alert nor feed reminders are wanted. */
(function () {
  'use strict';
  var App = window.App;
  var KEY_DEVICE = 'newborn-tracker:push-device';
  var KEY_LAST = 'newborn-tracker:push-last-sync';
  var KEY_FEED_FOR = 'newborn-tracker:feed-reminder-for'; // {start, on}: bell choice for one feeding
  var KEY_FEED_LAST = 'newborn-tracker:feed-reminder-sync'; // {sig, at}: what the server has
  var SW_URL = '/diaper-messaging-sw.js';
  var DEBOUNCE_MS = 1500;
  var REFRESH_MS = 12 * 36e5; // resend an unchanged payload at most every 12 h
  var RETRY_UNCONFIGURED_MS = 36e5; // server without QStash: ask again after an hour
  var MIN_LEAD_MS = 15e3; // a reminder due sooner than this is not scheduled
  var MSG_UNAVAILABLE = 'התראות אינן זמינות כאן. באייפון יש להוסיף את האתר למסך הבית ולפתוח אותו משם.';
  var MSG_UNCONFIGURED = 'תזכורת ברקע עדיין לא הוגדרה בשרת — בינתיים התזכורת מופיעה רק כשהאפליקציה פתוחה.';
  App.KEYS.pushDevice = KEY_DEVICE;
  App.KEYS.feedReminderFor = KEY_FEED_FOR;

  function readJson(key) {
    try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; }
  }
  function writeJson(key, v) {
    try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) { /* ignore */ }
  }
  function remove(key) {
    try { localStorage.removeItem(key); } catch (e) { /* ignore */ }
  }
  function device() { return readJson(KEY_DEVICE); }

  /* ---------------- service worker ---------------- */

  var swPromise = null;
  function swSupported() {
    return !!window.isSecureContext && 'serviceWorker' in navigator;
  }
  /** Registers the service worker once; resolves to the registration or null (never rejects). */
  function registerSW() {
    if (!swPromise) {
      swPromise = swSupported()
        ? navigator.serviceWorker.register(SW_URL).catch(function () { return null; })
        : Promise.resolve(null);
    }
    return swPromise;
  }

  // Notification clicks: the service worker asks an open page to show a route.
  if (swSupported()) {
    navigator.serviceWorker.addEventListener('message', function (e) {
      var msg = e.data;
      if (!msg || msg.type !== 'open-url' || typeof msg.url !== 'string') return;
      try {
        var u = new URL(msg.url, location.href);
        if (u.origin !== location.origin) return;
        var path = u.hash.replace(/^#/, '') || '/';
        if (App.navigate) App.navigate(path); else location.hash = '#' + path;
        window.focus();
      } catch (err) { /* ignore */ }
    });
  }

  /* ---------------- what this device wants ---------------- */

  function diaperOn() {
    return localStorage.getItem(App.KEYS.alertsEnabled) === '1' || localStorage.getItem(App.KEYS.pushEnabled) === '1';
  }
  function feedAlways() { return App.settings.get().feedReminderAlways === true; }

  /** The next-feed reminder for the current last feeding:
      {start, dueAt, armed, always}. armed = the bell's choice for this feeding, else the setting. */
  function feedReminder(events) {
    var start = App.lastNursing(events || App.store.events());
    var always = feedAlways();
    if (!start) return { start: 0, dueAt: null, armed: false, always: always };
    var o = readJson(KEY_FEED_FOR);
    var armed = o && o.start === start ? o.on === true : always;
    return { start: start, dueAt: start + App.feedIntervalMs(), armed: armed, always: always };
  }
  /** {dueAt, lastStart} the server should have scheduled now, or null. */
  function desiredFeed() {
    var r = feedReminder();
    return r.armed && r.dueAt - Date.now() > MIN_LEAD_MS ? { dueAt: r.dueAt, lastStart: r.start } : null;
  }

  /* ---------------- server sync ---------------- */

  // Wall-clock time in Israel, as a local timestamp (same trick as the original).
  function israelTs(ts) {
    return new Date(new Date(ts).toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' })).getTime();
  }
  function post(url, body) {
    return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  }

  var lastSync = readJson(KEY_LAST); // {sig, at} of the last successful device request

  // The device record: subscription, diaper counts/goals, which alerts are on.
  async function syncDevice(d, diaper, keep, force) {
    var now = israelTs(Date.now());
    var counts = App.diaperCounts(App.store.events().map(function (e) {
      return Object.assign({}, e, { timestamp: israelTs(e.timestamp) });
    }), now);
    var goals = App.goals();
    var state = { enabled: keep, diaperAlerts: diaper, day: App.dayKey(now), wet: counts.wet, dirty: counts.dirty, wetGoal: goals.wet, dirtyGoal: goals.dirty };
    var sig = JSON.stringify([d.id, d.subscription && d.subscription.endpoint, state]);
    if (!force && lastSync && lastSync.sig === sig && Date.now() - lastSync.at < REFRESH_MS) return;
    var res = await post('/api/public/push/device', Object.assign({}, d, state));
    if (!res.ok) throw new Error('לא ניתן לעדכן את ההתראות ברקע. נסי שוב כשיש חיבור לאינטרנט.');
    if (keep) {
      lastSync = { sig: sig, at: Date.now() };
      writeJson(KEY_LAST, lastSync);
    } else {
      // The server forgot this device (and cancelled its feed reminder): forget it here too,
      // so nothing is sent any more. (ensureSubscribed() creates a new device record.)
      lastSync = null;
      remove(KEY_LAST);
      remove(KEY_FEED_LAST);
      remove(KEY_DEVICE);
    }
  }

  var unconfiguredShown = false;
  function noticeUnconfigured(userAction) {
    if (unconfiguredShown && !userAction) return;
    unconfiguredShown = true;
    App.toast(MSG_UNCONFIGURED, { duration: 6000 });
  }

  // The one scheduled "next feeding" reminder → {ok} | {unconfigured} | {skipped}.
  async function syncFeed(d, force) {
    var want = desiredFeed();
    var last = readJson(KEY_FEED_LAST);
    if (!want && !last) return { skipped: true }; // nothing scheduled, nothing wanted
    var sig = JSON.stringify([d.id, want && want.dueAt, want && want.lastStart]);
    if (!force && last && last.sig === sig && Date.now() - last.at < REFRESH_MS) return { skipped: true };
    var body = { id: d.id, token: d.token, dueAt: want ? want.dueAt : null, lastStart: want ? want.lastStart : null };
    var res = await post('/api/public/push/feed', body);
    if (res.status === 404) { // the server lost the device (e.g. expired subscription): register it again
      await syncDevice(d, diaperOn(), true, true);
      res = await post('/api/public/push/feed', body);
    }
    if (res.status === 503) {
      writeJson(KEY_FEED_LAST, { sig: sig, at: Date.now() - REFRESH_MS + RETRY_UNCONFIGURED_MS });
      noticeUnconfigured(force);
      return { unconfigured: true };
    }
    if (!res.ok) throw new Error('לא ניתן לעדכן את תזכורת ההנקה ברקע. נסי שוב כשיש חיבור לאינטרנט.');
    if (want) writeJson(KEY_FEED_LAST, { sig: sig, at: Date.now() });
    else remove(KEY_FEED_LAST);
    return { ok: true, dueAt: want ? want.dueAt : null };
  }

  // One full sync. opts.diaper overrides the daily-alert switch (used while toggling it).
  async function runSync(opts, force) {
    var d = device();
    if (!d) return { noDevice: true };
    var diaper = opts && typeof opts.diaper === 'boolean' ? opts.diaper : diaperOn();
    var keep = diaper || feedAlways() || !!desiredFeed();
    await syncDevice(d, diaper, keep, force);
    if (!keep) return { removed: true };
    return syncFeed(device() || d, force);
  }

  // Serialised sync (one request chain at a time). Background syncs read the state when they
  // actually run (not when queued), so a sync queued during ensureSubscribed() can't undo it.
  var queue = Promise.resolve();
  function enqueue(opts, force) {
    var p = queue.catch(function () {}).then(function () { return runSync(opts, force); });
    queue = p;
    return p;
  }
  /** Public: a forced sync now (user action). opts: {diaper: bool} (a bare boolean also works). */
  function sync(opts) {
    if (typeof opts === 'boolean') opts = { diaper: opts };
    return enqueue(opts || null, true);
  }

  /* ---------------- permission + subscription ---------------- */

  var enabling = false;
  /** Asks for notification permission and creates the push subscription and the local device
      record. Turns nothing on by itself; callers set their own switch and then call sync().
      Rejects with a Hebrew message when notifications can't be used here. */
  async function ensureSubscribed() {
    if (typeof Notification === 'undefined') throw new Error(MSG_UNAVAILABLE);
    if (window.top !== window.self && Notification.permission !== 'granted') {
      throw new Error('פתחי את האפליקציה בלשונית נפרדת כדי לאפשר התראות.');
    }
    var perm = Notification.permission === 'granted' ? 'granted' : await new Promise(function (res) {
      var p = Notification.requestPermission(res);
      if (p && p.then) p.then(res, function () { res('denied'); });
    });
    if (perm !== 'granted') throw new Error('ההתראות חסומות בהגדרות הדפדפן.');
    enabling = true;
    try { return await subscribe(); } finally { enabling = false; }
  }
  async function subscribe() {
    if (!swSupported() || !('PushManager' in window)) {
      throw new Error('התראות ברקע אינן זמינות בדפדפן הזה. באייפון יש להוסיף את האתר למסך הבית ולפתוח אותו משם.');
    }
    var r = await fetch('/api/public/push/key');
    if (!r.ok) throw new Error('שירות ההתראות לא זמין כרגע.');
    var publicKey = (await r.json()).publicKey;
    if (!publicKey) throw new Error('שירות ההתראות לא זמין כרגע.');
    var reg = (await registerSW()) || (await navigator.serviceWorker.register(SW_URL));
    await navigator.serviceWorker.ready;
    var b64 = publicKey.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (publicKey.length % 4)) % 4);
    var key = Uint8Array.from(atob(b64), function (c) { return c.charCodeAt(0); });
    var sub = (await reg.pushManager.getSubscription()) ||
      (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }));
    var prev = device();
    var token = (prev && prev.token) || Array.from(crypto.getRandomValues(new Uint8Array(32)), function (b) {
      return b.toString(16).padStart(2, '0');
    }).join('');
    var json = sub.toJSON();
    var d = {
      id: (prev && prev.id) || crypto.randomUUID(),
      token: token,
      subscription: { endpoint: json.endpoint, keys: json.keys, expirationTime: sub.expirationTime == null ? null : sub.expirationTime }
    };
    localStorage.setItem(KEY_DEVICE, JSON.stringify(d));
    return d;
  }

  /** Older entry point: subscribe and turn the daily diaper alert on at the server. */
  async function enable() {
    await ensureSubscribed();
    await sync({ diaper: true });
    localStorage.setItem(App.KEYS.pushEnabled, '1');
  }

  /* ---------------- next-feed reminder controls ---------------- */

  /** The bell: on/off for the current last feeding only (a new feeding falls back to the setting).
      Resolves to the sync result ({ok}|{unconfigured}|…); rejects with a Hebrew message. */
  async function setFeedReminder(on) {
    var r = feedReminder();
    if (!r.start) throw new Error('עוד לא נרשמה הנקה.');
    var before = localStorage.getItem(KEY_FEED_FOR);
    writeJson(KEY_FEED_FOR, { start: r.start, on: !!on });
    if (!on) return device() ? sync() : { ok: true };
    try {
      await ensureSubscribed();
    } catch (err) {
      if (before === null) remove(KEY_FEED_FOR); else localStorage.setItem(KEY_FEED_FOR, before);
      throw err;
    }
    return sync();
  }

  /** The "every feeding" setting. Turning it on asks for permission first. */
  async function setFeedAlways(on) {
    if (on) await ensureSubscribed();
    remove(KEY_FEED_FOR); // a fresh start: the setting now decides for the current feeding too
    App.settings.set({ feedReminderAlways: !!on });
    return device() ? sync() : { ok: true };
  }

  /* ---------------- background sync ---------------- */

  // Keep the server current whenever data or settings change (counts, goals, a new feeding).
  var started = false;
  function startSync() {
    registerSW();
    if (started) return;
    started = true;
    var shown = false;
    var timer = null;
    function run() {
      timer = null;
      if (enabling || !device() || navigator.onLine === false) return;
      enqueue(undefined, false).then(function () { shown = false; }).catch(function (err) {
        if (!shown) App.toast(err instanceof Error ? err.message : 'עדכון ההתראות ברקע נכשל', { type: 'error' });
        shown = true;
      });
    }
    function schedule() {
      if (!device()) return; // nothing registered: no timers, no requests
      clearTimeout(timer);
      timer = setTimeout(run, DEBOUNCE_MS);
    }
    run();
    // data + settings changes, incl. a partner's feeding arriving via App.store.applyRemote
    window.addEventListener(App.CHANGED_EVENT, schedule);
    window.addEventListener('online', schedule);
    window.addEventListener('storage', schedule);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') schedule();
    });
  }

  App.push = {
    enable: enable,
    ensureSubscribed: ensureSubscribed,
    sync: sync,
    startSync: startSync,
    registerSW: registerSW,
    feedReminder: feedReminder,
    setFeedReminder: setFeedReminder,
    setFeedAlways: setFeedAlways
  };
})();
