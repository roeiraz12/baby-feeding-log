/* push.js — service worker + background (Web Push) daily diaper reminders.
   - registerSW(): registers /diaper-messaging-sw.js at start-up (offline app shell, and
     App.notify needs a registration on Android Chrome).
   - The server (api/) stores the device subscription plus today's diaper counts and pushes
     at ~21:00 Israel time (App.EVENING_NOTIFY_HOUR), using this device's diaper goals.
   - Syncs are debounced and skipped when nothing changed since the last successful one;
     after the device is disabled nothing is sent at all. */
(function () {
  'use strict';
  var App = window.App;
  var KEY_DEVICE = 'newborn-tracker:push-device';
  var KEY_LAST = 'newborn-tracker:push-last-sync';
  var SW_URL = '/diaper-messaging-sw.js';
  var DEBOUNCE_MS = 1500;
  var REFRESH_MS = 12 * 36e5; // resend an unchanged payload at most every 12 h
  App.KEYS.pushDevice = KEY_DEVICE;

  function readJson(key) {
    try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; }
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

  /* ---------------- server sync ---------------- */

  // Wall-clock time in Israel, as a local timestamp (same trick as the original).
  function israelTs(ts) {
    return new Date(new Date(ts).toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' })).getTime();
  }

  var lastSync = readJson(KEY_LAST); // {sig, at} of the last successful request

  // ty(): send this device's state to the server (skipped when unchanged unless force).
  async function send(enabled, force) {
    var d = device();
    if (!d) return;
    var now = israelTs(Date.now());
    var counts = App.diaperCounts(App.store.events().map(function (e) {
      return Object.assign({}, e, { timestamp: israelTs(e.timestamp) });
    }), now);
    var goals = App.goals();
    var state = { enabled: enabled, day: App.dayKey(now), wet: counts.wet, dirty: counts.dirty, wetGoal: goals.wet, dirtyGoal: goals.dirty };
    var sig = JSON.stringify([d.id, d.subscription && d.subscription.endpoint, state]);
    if (!force && lastSync && lastSync.sig === sig && Date.now() - lastSync.at < REFRESH_MS) return;
    var res = await fetch('/api/public/push/device', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({}, d, state))
    });
    if (!res.ok) throw new Error('לא ניתן לעדכן את ההתראות ברקע. נסי שוב כשיש חיבור לאינטרנט.');
    if (enabled) {
      lastSync = { sig: sig, at: Date.now() };
      try { localStorage.setItem(KEY_LAST, JSON.stringify(lastSync)); } catch (e) { /* ignore */ }
    } else {
      // The server forgot this device: forget it here too, so nothing is sent any more.
      // (enable() creates a new device record.)
      lastSync = null;
      remove(KEY_LAST);
      remove(KEY_DEVICE);
    }
  }

  // ey(): serialised sync (one request at a time). Resolves/rejects with that request.
  var queue = Promise.resolve();
  // Background syncs read the switch state when they actually run (not when queued), so a
  // sync queued while enable() is in flight can't unregister the device it just registered.
  function switchedOn() {
    return localStorage.getItem(App.KEYS.alertsEnabled) === '1' || localStorage.getItem(App.KEYS.pushEnabled) === '1';
  }
  function enqueue(enabled, force) {
    var p = queue.catch(function () {}).then(function () {
      return send(enabled === undefined ? switchedOn() : enabled, force);
    });
    queue = p;
    return p;
  }
  /** Public: sync(true|false) always reaches the server when a device is registered. */
  function sync(enabled) { return enqueue(enabled, true); }

  // ny(): register the service worker, subscribe, and register the device.
  var enabling = false;
  async function enable() {
    enabling = true;
    try { await doEnable(); } finally { enabling = false; }
  }
  async function doEnable() {
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
    localStorage.setItem(KEY_DEVICE, JSON.stringify({
      id: (prev && prev.id) || crypto.randomUUID(),
      token: token,
      subscription: { endpoint: json.endpoint, keys: json.keys, expirationTime: sub.expirationTime == null ? null : sub.expirationTime }
    }));
    await sync(true);
    localStorage.setItem(App.KEYS.pushEnabled, '1');
  }

  // iy(): keep the server's counts current whenever data or settings change.
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
    window.addEventListener(App.CHANGED_EVENT, schedule); // data + settings (goals) changes
    window.addEventListener('online', schedule);
    window.addEventListener('storage', schedule);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') schedule();
    });
  }

  App.push = { enable: enable, sync: sync, startSync: startSync, registerSW: registerSW };
})();
