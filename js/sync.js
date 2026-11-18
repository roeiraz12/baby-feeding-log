/* sync.js — family sharing sync engine (two parents, no accounts). Owned by the settings agent.
   App.sync = { status(), onStatus(fn), link(), invite(), join(code), leave(), syncNow(), joinUrl(code) }

   Credentials live in localStorage `newborn-tracker:family` = {familyId, deviceId, secret, rev,
   lastSyncAt, devices}. `newborn-tracker:family-pushed` = {e:{id:updatedAt}, t:{id:deletedAt}} is
   what the server is known to have; anything in App.store.snapshot() that differs is pushed (so
   imported events with old updatedAt values are pushed too, and nothing depends on clocks).
   Sync: on start, on every local change (debounced 1.5 s), every 30 s while the page is visible,
   when the page becomes visible and when the browser comes back online. Errors are quiet: the
   status says "לא מחובר — ינסה שוב" and the next trigger retries. */
(function () {
  'use strict';
  var App = window.App;
  var LS = window.localStorage;
  var KEY = 'newborn-tracker:family';
  var PUSHED_KEY = 'newborn-tracker:family-pushed';
  App.KEYS.family = KEY;
  App.KEYS.familyPushed = PUSHED_KEY;
  var BATCH = 300, POLL_MS = 30e3, DEBOUNCE_MS = 1500, TIMEOUT_MS = 15e3;

  var state = 'idle'; // idle | syncing | ok | offline | error
  var notice = null; // 'revoked' after the server rejected this device
  var listeners = [];
  var inflight = null, again = false, debounceTimer = null, pollTimer = null;

  function readJSON(key) {
    try { return JSON.parse(LS.getItem(key) || 'null'); } catch (e) { return null; }
  }
  function writeJSON(key, v) {
    try { LS.setItem(key, JSON.stringify(v)); } catch (e) { /* storage full: keep going */ }
  }
  function creds() {
    var c = readJSON(KEY);
    return c && typeof c.familyId === 'string' && typeof c.deviceId === 'string' && typeof c.secret === 'string' ? c : null;
  }
  function readPushed() {
    var p = readJSON(PUSHED_KEY);
    return { e: (p && p.e) || {}, t: (p && p.t) || {} };
  }
  function uOf(e) { return typeof e.updatedAt === 'number' ? e.updatedAt : e.timestamp; }

  function status() {
    var c = creds();
    return {
      linked: !!c,
      state: c ? state : 'idle',
      lastSyncAt: c ? c.lastSyncAt || null : null,
      devices: c ? c.devices || 1 : 0,
      notice: notice
    };
  }
  function emit() {
    var s = status();
    listeners.slice().forEach(function (fn) { try { fn(s); } catch (e) { console.error(e); } });
  }
  function setState(s) { if (state !== s) { state = s; } emit(); }

  /* ---------------------------------------------------------------- network */
  function api(path, body) {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      var off = new Error('offline'); off.offline = true;
      return Promise.reject(off);
    }
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, TIMEOUT_MS) : null;
    return fetch('/api/family/' + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
      cache: 'no-store',
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (res) {
      clearTimeout(timer);
      return res.json().catch(function () { return {}; }).then(function (j) {
        if (!res.ok) { var err = new Error(j.error || 'http ' + res.status); err.status = res.status; throw err; }
        return j;
      });
    }, function (e) {
      clearTimeout(timer);
      var err = new Error('network'); err.offline = true; err.cause = e;
      throw err;
    });
  }
  function credBody(c) { return { familyId: c.familyId, deviceId: c.deviceId, secret: c.secret }; }

  /* ---------------------------------------------------------------- sync */
  function forget() {
    LS.removeItem(KEY);
    LS.removeItem(PUSHED_KEY);
    clearTimeout(debounceTimer);
    state = 'idle';
  }

  function doSync() {
    var c = creds();
    if (!c) return Promise.resolve();
    setState('syncing');
    var pushed = readPushed();
    var snap = App.store.snapshot();
    var dirtyE = snap.events.filter(function (e) { return pushed.e[e.id] !== uOf(e); });
    var dirtyT = snap.tombstones.filter(function (t) { return pushed.t[t.id] !== t.deletedAt; });
    var rounds = 0;

    function round() {
      var be = dirtyE.splice(0, BATCH);
      var bt = dirtyT.splice(0, BATCH - be.length);
      var body = credBody(c);
      body.since = c.rev || 0;
      body.events = be;
      body.tombstones = bt;
      return api('sync', body).then(function (r) {
        // the server now has what we sent, and what it sent us
        be.forEach(function (e) { pushed.e[e.id] = uOf(e); });
        bt.forEach(function (t) { pushed.t[t.id] = t.deletedAt; });
        var evs = Array.isArray(r.events) ? r.events : [], tbs = Array.isArray(r.tombstones) ? r.tombstones : [];
        evs.forEach(function (e) { if (e && typeof e.id === 'string') pushed.e[e.id] = uOf(e); });
        tbs.forEach(function (t) { if (t && typeof t.id === 'string') pushed.t[t.id] = t.deletedAt; });
        if (evs.length || tbs.length) App.store.applyRemote({ events: evs, tombstones: tbs });
        c.rev = r.rev;
        c.devices = r.devices;
        writeJSON(PUSHED_KEY, pushed);
        writeJSON(KEY, c);
        rounds++;
        if ((r.more || dirtyE.length || dirtyT.length) && rounds < 200) return round();
      });
    }

    return round().then(function () {
      // forget ids that no longer exist locally (keeps the map small)
      var now = App.store.snapshot(), keepE = {}, keepT = {};
      now.events.forEach(function (e) { if (e.id in pushed.e) keepE[e.id] = pushed.e[e.id]; });
      now.tombstones.forEach(function (t) { if (t.id in pushed.t) keepT[t.id] = pushed.t[t.id]; });
      writeJSON(PUSHED_KEY, { e: keepE, t: keepT });
      var cur = creds();
      if (cur && cur.familyId === c.familyId) { cur.lastSyncAt = Date.now(); cur.rev = c.rev; cur.devices = c.devices; writeJSON(KEY, cur); }
      notice = null;
      setState('ok');
    }, function (err) {
      if (err.status === 401) { // this device was removed / the family no longer exists
        forget();
        notice = 'revoked';
        emit();
        return;
      }
      setState(err.offline ? 'offline' : 'error');
    });
  }

  /** Runs a sync now (or right after the running one). Resolves with the status; never rejects. */
  function syncNow() {
    if (!creds()) return Promise.resolve(status());
    if (inflight) { again = true; return inflight.then(function () { return inflight || Promise.resolve(); }).then(status); }
    inflight = doSync().then(function () {
      inflight = null;
      if (again) { again = false; return syncNow(); }
    }, function (e) { inflight = null; console.error(e); });
    return inflight.then(status);
  }
  function scheduleSync(ms) {
    if (!creds()) return;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(syncNow, ms);
  }

  /* ---------------------------------------------------------------- linking */
  function newLink(r) {
    LS.removeItem(PUSHED_KEY); // first sync pushes everything on this phone (merge)
    writeJSON(KEY, { familyId: r.familyId, deviceId: r.deviceId, secret: r.secret, rev: 0, lastSyncAt: null, devices: r.devices || 1 });
    notice = null;
    state = 'idle';
    startPolling();
    emit();
  }
  /** Starts a family with this phone (no-op when already linked). */
  function link() {
    if (creds()) return Promise.resolve(status());
    return api('create', {}).then(function (r) {
      if (creds()) return status(); // another tab linked meanwhile
      newLink(r);
      syncNow();
      return status();
    }, function (err) { throw friendly(err); });
  }
  function joinUrl(code) {
    return location.origin + location.pathname + '#/settings?join=' + encodeURIComponent(code);
  }
  /** New single-use join code → {code, expiresAt, url}. Links this phone first if needed. */
  function invite() {
    return link().then(function () {
      var c = creds();
      return api('invite', credBody(c)).then(function (r) {
        var cur = creds();
        if (cur && typeof r.devices === 'number' && cur.devices !== r.devices) { cur.devices = r.devices; writeJSON(KEY, cur); emit(); }
        return { code: r.code, expiresAt: r.expiresAt, url: joinUrl(r.code), devices: r.devices };
      }, function (err) {
        if (err.status === 401) { forget(); notice = 'revoked'; emit(); }
        throw friendly(err);
      });
    });
  }
  /** Joins the family of `code`; this phone's data is merged into the shared journal. */
  function join(code) {
    var clean = String(code || '').toUpperCase().replace(/[\s-]/g, '');
    if (creds()) return Promise.reject(new Error('הטלפון הזה כבר משותף. כדי להצטרף ליומן אחר הפסיקי קודם את השיתוף.'));
    if (!/^[A-HJ-NP-Z2-9]{6}$/.test(clean)) return Promise.reject(new Error('הקוד צריך להכיל 6 תווים (אותיות באנגלית וספרות).'));
    return api('join', { code: clean }).then(function (r) {
      newLink(r);
      return syncNow();
    }, function (err) {
      if (err.status === 404) throw new Error('הקוד לא נמצא או שפג תוקפו. בקשי מההורה השני קוד חדש.');
      throw friendly(err);
    });
  }
  /** Stops sharing on this phone. Data stays here; the server forgets this device. */
  function leave() {
    var c = creds();
    if (!c) return Promise.resolve(status());
    var req = api('leave', credBody(c)).catch(function () { /* offline: forget locally anyway */ });
    forget();
    notice = null;
    stopPolling();
    emit();
    return req.then(status);
  }
  function friendly(err) {
    if (err.offline) return new Error('אין חיבור לאינטרנט. נסי שוב כשיש חיבור.');
    if (err.status === 429) return new Error('יותר מדי ניסיונות. נסי שוב בעוד כמה דקות.');
    if (err.status === 400) return new Error('הקוד לא תקין.');
    return new Error('משהו השתבש. נסי שוב בעוד רגע.');
  }

  /* ---------------------------------------------------------------- triggers */
  function visible() { return document.visibilityState !== 'hidden'; }
  function startPolling() {
    if (pollTimer || !creds()) return;
    pollTimer = setInterval(function () {
      if (!creds()) { stopPolling(); return; }
      if (visible()) syncNow();
    }, POLL_MS);
  }
  function stopPolling() { clearInterval(pollTimer); pollTimer = null; }

  App.store.onLocalChange(function () { scheduleSync(DEBOUNCE_MS); });
  document.addEventListener('visibilitychange', function () { if (visible()) scheduleSync(300); });
  window.addEventListener('online', function () { scheduleSync(500); });
  window.addEventListener('offline', function () { if (creds()) setState('offline'); });
  window.addEventListener('storage', function (e) {
    if (e.key !== null && e.key !== KEY) return; // another tab linked / left
    if (creds()) startPolling(); else stopPolling();
    emit();
  });

  App.sync = {
    status: status,
    onStatus: function (fn) {
      listeners.push(fn);
      return function () { var i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); };
    },
    link: link,
    invite: invite,
    join: join,
    leave: leave,
    syncNow: syncNow,
    joinUrl: joinUrl
  };

  if (creds()) { startPolling(); scheduleSync(800); }
})();
