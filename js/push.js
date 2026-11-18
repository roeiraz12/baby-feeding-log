/* push.js — background (Web Push) daily diaper reminders.
   Port of the original ny / ty / ey / iy functions. The server (api/) stores the
   device subscription plus today's diaper counts and pushes at ~22:00 Israel time. */
(function () {
  'use strict';
  var App = window.App;
  var KEY_DEVICE = 'newborn-tracker:push-device';
  App.KEYS.pushDevice = KEY_DEVICE;

  function device() {
    try { return JSON.parse(localStorage.getItem(KEY_DEVICE) || 'null'); } catch (e) { return null; }
  }

  // Wall-clock time in Israel, as a local timestamp (same trick as the original).
  function israelTs(ts) {
    return new Date(new Date(ts).toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' })).getTime();
  }

  // ty(): send this device's state to the server.
  async function send(enabled) {
    var d = device();
    if (!d) return;
    var now = israelTs(Date.now());
    var counts = App.diaperCounts(App.store.events().map(function (e) {
      return Object.assign({}, e, { timestamp: israelTs(e.timestamp) });
    }), now);
    var res = await fetch('/api/public/push/device', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({}, d, { enabled: enabled, day: App.dayKey(now), wet: counts.wet, dirty: counts.dirty }))
    });
    if (!res.ok) throw new Error('לא ניתן לעדכן את ההתראות ברקע. נסי שוב כשיש חיבור לאינטרנט.');
  }

  // ey(): serialised sync (one request at a time).
  var queue = Promise.resolve();
  function sync(enabled) {
    if (enabled === undefined) enabled = localStorage.getItem(App.KEYS.alertsEnabled) === '1';
    var p = queue.catch(function () {}).then(function () { return send(enabled); });
    queue = p;
    return p;
  }

  // ny(): register the service worker, subscribe, and register the device.
  async function enable() {
    if (!window.isSecureContext || !('serviceWorker' in navigator) || !('PushManager' in window)) {
      throw new Error('התראות ברקע אינן זמינות בדפדפן הזה. באייפון יש להוסיף את האתר למסך הבית ולפתוח אותו משם.');
    }
    var r = await fetch('/api/public/push/key');
    if (!r.ok) throw new Error('שירות ההתראות לא זמין כרגע.');
    var publicKey = (await r.json()).publicKey;
    if (!publicKey) throw new Error('שירות ההתראות לא זמין כרגע.');
    var reg = await navigator.serviceWorker.register('/diaper-messaging-sw.js');
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

  // iy(): keep the server's counts current whenever data changes.
  function startSync() {
    var shown = false;
    function run() {
      sync().then(function () { shown = false; }).catch(function (err) {
        if (!shown) App.toast(err instanceof Error ? err.message : 'עדכון ההתראות ברקע נכשל', { type: 'error' });
        shown = true;
      });
    }
    run();
    window.addEventListener(App.CHANGED_EVENT, run);
    window.addEventListener('online', run);
    window.addEventListener('storage', run);
    document.addEventListener('visibilitychange', run);
  }

  App.push = { enable: enable, sync: sync, startSync: startSync };
})();
