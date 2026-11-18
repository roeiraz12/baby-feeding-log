/* core.js — global App API (store, helpers, icons, toast, dialog, router, alarm).
   Faithful port of the original index-*.js bundle logic. */
(function () {
  'use strict';
  var App = (window.App = window.App || {});
  var LS = window.localStorage;

  /* ------------------------------------------------------------------ */
  /* Keys / constants                                                     */
  /* ------------------------------------------------------------------ */
  var KEYS = (App.KEYS = {
    events: 'newborn-tracker:events',
    active: 'newborn-tracker:active-nursing',
    alertsEnabled: 'newborn-tracker:alerts-enabled',
    alertLastDay: 'newborn-tracker:alert-last-day',
    vitaminDay: 'newborn-tracker:vitamin-d-day',
    snoozeUntil: 'newborn-tracker:snooze-until',
    feedDismissed: 'newborn-tracker:feed-alarm-dismissed',
    pushEnabled: 'newborn-tracker:push-enabled'
  });
  var FEED_INTERVAL = (App.FEED_INTERVAL = 108e5); // wv: 3h
  var NURSING_MAX = (App.NURSING_MAX = 9e5); // Tv: 15 min
  var SNOOZE = (App.SNOOZE = 9e5); // Ev: 15 min
  var CHANGED = (App.CHANGED_EVENT = 'newborn-tracker:changed'); // Kv

  /* ------------------------------------------------------------------ */
  /* Shabbat calc (av..gv) — Jerusalem coordinates                        */
  /* ------------------------------------------------------------------ */
  var av = 31.778, ov = Math.PI / 180, sv = 864e5, cv = 2440588, lv = 2451545, uv = ov * 23.4397;
  var dv = function (e) { return e / sv - 0.5 + cv - lv; };
  var fv = function (e) { return (e + 0.5 - cv) * sv; };
  function pv(e, t) {
    var n = ov * -35.235, r = ov * av;
    var i = dv(new Date(e.getFullYear(), e.getMonth(), e.getDate(), 12).getTime());
    var a = Math.round(i - 9e-4 - n / (2 * Math.PI));
    var o = 9e-4 + n / (2 * Math.PI) + a;
    var s = ov * (357.5291 + 0.98560028 * o);
    var c = s + ov * (1.9148 * Math.sin(s) + 0.02 * Math.sin(2 * s) + 3e-4 * Math.sin(3 * s)) + ov * 102.9372 + Math.PI;
    var l = Math.asin(Math.sin(uv) * Math.sin(c));
    var u = ov * t;
    return fv(lv + (9e-4 + (Math.acos((Math.sin(u) - Math.sin(r) * Math.sin(l)) / (Math.cos(r) * Math.cos(l))) + n) / (2 * Math.PI) + a) + 0.0053 * Math.sin(s) - 0.0069 * Math.sin(2 * c));
  }
  function mv(e) {
    var t = new Date(e);
    var n = t.getDay() === 6 ? -1 : 5 - t.getDay();
    var r = new Date(t.getFullYear(), t.getMonth(), t.getDate() + n);
    var i = new Date(r.getFullYear(), r.getMonth(), r.getDate() + 1);
    return [pv(r, -0.833), pv(i, -8.5)];
  }
  function hv(e) { var w = mv(e); return e >= w[0] && e < w[1]; }
  function gv(e) {
    var p = e.split('-').map(Number), t = p[0], n = p[1], r = p[2];
    var i = new Date(t, n - 1, r).getTime(), a = new Date(t, n - 1, r + 1).getTime();
    var w = mv(i + 432e5), o = w[0], s = w[1];
    var c = Math.max(0, Math.min(a, s) - Math.max(i, o));
    return (a - i - c) / 36e5;
  }
  App.isShabbat = hv;
  App.shabbatWindow = mv;
  App.dayHours = gv;

  /* ------------------------------------------------------------------ */
  /* Helpers (Dv..Gv)                                                     */
  /* ------------------------------------------------------------------ */
  /* Feedings (user rule, differs from the original): sides nursed one after
     the other count as ONE feeding when the next side starts within
     FEEDING_GAP of the previous side's end. A single side is also a feeding.
     A feeding's time is the start of its first side. */
  var FEEDING_GAP = (App.FEEDING_GAP = 30 * 6e4);
  function feedings(e) {
    var list = e.filter(function (x) { return x.type === 'nursing'; })
      .slice().sort(function (a, b) { return a.timestamp - b.timestamp; });
    var out = [], cur = null;
    list.forEach(function (x) {
      var end = Math.max(x.timestamp, x.endTimestamp != null ? x.endTimestamp : x.timestamp + (x.durationMs || 0));
      if (cur && x.timestamp - cur.end <= FEEDING_GAP) {
        cur.end = Math.max(cur.end, end);
        cur.events.push(x);
      } else {
        cur = { start: x.timestamp, end: end, events: [x] };
        out.push(cur);
      }
    });
    return out;
  }
  App.feedings = feedings;
  function Ov(e) {
    var f = feedings(e);
    return f.length ? f[f.length - 1].start : 0;
  }
  function Dv(e, t, n) {
    var r = Ov(e);
    if (!r || n === r) return null;
    var i = r + FEED_INTERVAL;
    return t && t > i ? t : i;
  }
  function kv() { return Date.now() + '-' + Math.floor(Math.random() * 1e6); }
  function Nv(e) {
    var t = Math.max(0, Math.round(e / 6e4)), n = Math.floor(t / 60), r = t % 60;
    return n === 0 ? r + " דק'" : n + " ש' " + r + " דק'";
  }
  function Pv(e) {
    var t = Math.max(0, Math.floor(e / 1e3)), n = Math.floor(t / 3600), r = Math.floor((t % 3600) / 60), i = t % 60;
    var a = function (x) { return String(x).padStart(2, '0'); };
    return n > 0 ? n + ':' + a(r) + ':' + a(i) : a(r) + ':' + a(i);
  }
  function Fv(e) {
    var t = new Date(e);
    return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');
  }
  function Mv(e) {
    if (e.type === 'custom') return e.note || 'אירוע';
    if (e.type === 'nursing') return 'הנקה — ' + (e.subtype === 'left' ? 'שמאל' : 'ימין') + (e.durationMs === undefined ? '' : ' · ' + Nv(e.durationMs));
    if (e.type === 'diaper') return 'חיתול — ' + (e.subtype === 'wet' ? 'פיפי' : 'קקי');
    return 'שינה — ' + Nv(e.durationMs != null ? e.durationMs : 0);
  }
  function Iv(e) {
    var t = new Map();
    e.forEach(function (n) {
      if (n.type !== 'diaper') return;
      var k = Fv(n.timestamp), r = t.get(k) || { nursing: 0, wet: 0, dirty: 0 };
      if (n.subtype === 'wet') r.wet += 1; else r.dirty += 1;
      t.set(k, r);
    });
    feedings(e).forEach(function (f) {
      var k = Fv(f.start), r = t.get(k) || { nursing: 0, wet: 0, dirty: 0 };
      r.nursing += 1;
      t.set(k, r);
    });
    var n = Array.from(t.entries()).sort(function (a, b) { return a[0] < b[0] ? -1 : 1; }).map(function (en) {
      var k = en[0], v = en[1];
      return {
        key: k, hours: gv(k), partial: gv(k) < 24,
        label: new Date(k + 'T12:00:00').toLocaleDateString('he-IL', { weekday: 'short' }),
        nursing: v.nursing, wet: v.wet, dirty: v.dirty
      };
    });
    var r = Math.max(1, n.reduce(function (s, x) { return s + x.hours; }, 0) / 24);
    var i = function (f) { return n.reduce(function (s, x) { return s + f(x); }, 0); };
    var a = function (x) { return Math.round(x * 10) / 10; };
    return {
      days: n.length,
      avgWet: a(i(function (x) { return x.wet; }) / r),
      avgDirty: a(i(function (x) { return x.dirty; }) / r),
      avgNursing: a(i(function (x) { return x.nursing; }) / r),
      leftCount: e.filter(function (x) { return x.type === 'nursing' && x.subtype === 'left'; }).length,
      rightCount: e.filter(function (x) { return x.type === 'nursing' && x.subtype === 'right'; }).length,
      daily: n.slice(-7).map(function (x) { return Object.assign({}, x, { label: x.partial ? x.label + '*' : x.label }); })
    };
  }
  function nursingIntervals(e) {
    var r = feedings(e).map(function (f) { return f.start; });
    var i = [];
    for (var k = 1; k < r.length; k++) { var d = r[k] - r[k - 1]; if (d > 6e5 && d < 288e5) i.push(d); }
    return { stamps: r, intervals: i };
  }
  function Lv(e, t, n) {
    if (t === undefined) t = Date.now();
    if (n === undefined) n = 4;
    var x = nursingIntervals(e), r = x.stamps, i = x.intervals;
    if (r.length < 4) return [];
    if (i.length < 3) return [];
    i.sort(function (a, b) { return a - b; });
    var a = i[Math.floor(i.length / 2)], o = r[r.length - 1], s = [], c = o + a;
    while (c <= t) c += a;
    for (var k = 0; k < n; k++) { s.push(c); c += a; }
    return s;
  }
  function Rv(e) {
    var n = nursingIntervals(e).intervals;
    if (n.length < 3) return null;
    n.sort(function (a, b) { return a - b; });
    return Math.round(n[Math.floor(n.length / 2)] / 6e4);
  }
  function zv(e, t) { return e === Fv(t === undefined ? Date.now() : t); }
  function Bv(e, t, n) {
    var r = e.find(function (x) { return x.id === t && x.type === 'nursing' && x.endTimestamp === undefined; });
    if (!r || n < r.timestamp + 9e5) return { events: e, activeId: t, completed: false };
    return {
      events: e.map(function (x) { return x.id === r.id ? Object.assign({}, x, { endTimestamp: x.timestamp + NURSING_MAX, durationMs: NURSING_MAX }) : x; }),
      activeId: null, completed: true
    };
  }
  function Vv(e, t, n, r, i) {
    var a = e.find(function (x) { return x.id === t && x.type === 'nursing' && x.endTimestamp === undefined; });
    if (!a) return { events: e.concat([{ id: i, type: 'nursing', subtype: n, timestamp: r }]), activeId: i, status: 'started' };
    if (a.subtype !== n) return { events: e, activeId: a.id, status: 'blocked' };
    return {
      events: e.map(function (x) {
        return x.id === a.id ? Object.assign({}, x, { endTimestamp: Math.min(r, x.timestamp + NURSING_MAX), durationMs: Math.min(NURSING_MAX, Math.max(0, r - x.timestamp)) }) : x;
      }),
      activeId: null, status: 'ended'
    };
  }
  function Hv(e) { return { id: 'vitamin-d-' + Fv(e), type: 'custom', subtype: 'custom', timestamp: e, note: 'ויטמין D' }; }
  function Uv(e, t) {
    var n = Fv(t === undefined ? Date.now() : t);
    var r = e.filter(function (x) { return x.type === 'diaper' && Fv(x.timestamp) === n; });
    return { wet: r.filter(function (x) { return x.subtype === 'wet'; }).length, dirty: r.filter(function (x) { return x.subtype === 'dirty'; }).length };
  }
  function Wv(e, t) {
    if (t === undefined) t = Date.now();
    if (hv(t)) return [];
    var c = Uv(e, t), i = [];
    if (c.wet < 6) i.push('פיפי היום: ' + c.wet + ' מתוך יעד של 6.');
    if (c.dirty < 3) i.push('קקי היום: ' + c.dirty + ' מתוך יעד של 3.');
    return i;
  }
  function Gv(e, t, n, r) { return !n || new Date(t).getHours() < 22 || r === Fv(t) ? [] : Wv(e, t); }

  App.dayKey = Fv;
  App.isToday = zv;
  App.fmtDuration = Nv;
  App.fmtClock = Pv;
  App.label = Mv;
  App.timeHM = function (ts) { return new Date(ts).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }); };
  App.lastNursing = Ov;
  App.nextFeedAt = Dv;
  App.diaperCounts = Uv;
  App.diaperWarnings = Wv;
  App.eveningWarnings = Gv;
  App.dailyStats = Iv;
  App.predictFeeds = Lv;
  App.medianIntervalMin = Rv;
  App.vitaminEvent = Hv;
  App.newId = kv;

  /* ------------------------------------------------------------------ */
  /* Store (port of qv)                                                   */
  /* ------------------------------------------------------------------ */
  function Av() {
    try {
      var e = LS.getItem(KEYS.events);
      if (!e) return [];
      var t = JSON.parse(e);
      // drop non-object entries (e.g. null) so one bad item can't crash every page and timer
      return Array.isArray(t) ? t.filter(function (x) { return x && typeof x === 'object'; }) : [];
    } catch (err) { return []; }
  }
  function jv(e) { LS.setItem(KEYS.events, JSON.stringify(e)); }
  function emit() { window.dispatchEvent(new Event(CHANGED)); }
  function sync() {
    var r = Bv(Av(), LS.getItem(KEYS.active), Date.now());
    if (r.completed) { jv(r.events); LS.removeItem(KEYS.active); emit(); }
    return r;
  }
  function save(e) { jv(e); emit(); }

  App.store = {
    events: function () { return sync().events; },
    activeNursing: function () {
      var r = sync();
      return r.events.find(function (x) { return x.id === r.activeId && x.type === 'nursing' && x.endTimestamp === undefined; }) || null;
    },
    add: function (evt) { var t = Object.assign({}, evt, { id: kv() }); save(Av().concat([t])); return t; },
    toggleNursing: function (side) {
      var t = Vv(Av(), LS.getItem(KEYS.active), side, Date.now(), kv());
      if (t.status === 'blocked') return t.status;
      if (t.activeId) LS.setItem(KEYS.active, t.activeId); else LS.removeItem(KEYS.active);
      save(t.events);
      return t.status;
    },
    remove: function (id) { save(Av().filter(function (x) { return x.id !== id; })); },
    restore: function (evt) { save(Av().concat([evt])); },
    edit: function (id, patch) {
      save(Av().map(function (n) {
        if (n.id !== id) return n;
        var r = Object.assign({}, n, patch);
        if (r.endTimestamp) r.durationMs = Math.max(0, r.endTimestamp - r.timestamp);
        return r;
      }));
    },
    subscribe: function (fn) {
      var h = function () { fn(); };
      window.addEventListener(CHANGED, h);
      window.addEventListener('storage', h);
      document.addEventListener('visibilitychange', h);
      return function () {
        window.removeEventListener(CHANGED, h);
        window.removeEventListener('storage', h);
        document.removeEventListener('visibilitychange', h);
      };
    }
  };

  /* ------------------------------------------------------------------ */
  /* Icons (lucide paths copied from the bundles)                         */
  /* ------------------------------------------------------------------ */
  var P = function (d) { return '<path d="' + d + '"></path>'; };
  var ICONS = {
    baby: { n: 'baby', b: P('M10 16c.5.3 1.2.5 2 .5s1.5-.2 2-.5') + P('M15 12h.01') + P('M19.38 6.813A9 9 0 0 1 20.8 10.2a2 2 0 0 1 0 3.6 9 9 0 0 1-17.6 0 2 2 0 0 1 0-3.6A9 9 0 0 1 12 3c2 0 3.5 1.1 3.5 2.5s-.9 2.5-2 2.5c-.8 0-1.5-.4-1.5-1') + P('M9 12h.01') },
    droplets: { n: 'droplets', b: P('M7 16.3c2.2 0 4-1.83 4-4.05 0-1.16-.57-2.26-1.71-3.19S7.29 6.75 7 5.3c-.29 1.45-1.14 2.84-2.29 3.76S3 11.1 3 12.25c0 2.22 1.8 4.05 4 4.05z') + P('M12.56 6.6A10.97 10.97 0 0 0 14 3.02c.5 2.5 2 4.9 4 6.5s3 3.5 3 5.5a6.98 6.98 0 0 1-11.91 4.97') },
    plus: { n: 'plus', b: P('M5 12h14') + P('M12 5v14') },
    timer: { n: 'timer', b: '<line x1="10" x2="14" y1="2" y2="2"></line><line x1="12" x2="15" y1="14" y2="11"></line><circle cx="12" cy="14" r="8"></circle>' },
    check: { n: 'check', b: P('M20 6 9 17l-5-5') },
    x: { n: 'x', b: P('M18 6 6 18') + P('m6 6 12 12') },
    pencil: { n: 'pencil', b: P('M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z') + P('m15 5 4 4') },
    trash2: { n: 'trash-2', b: P('M10 11v6') + P('M14 11v6') + P('M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6') + P('M3 6h18') + P('M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2') },
    stickyNote: { n: 'sticky-note', b: P('M21 9a2.4 2.4 0 0 0-.706-1.706l-3.588-3.588A2.4 2.4 0 0 0 15 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2z') + P('M15 3v5a1 1 0 0 0 1 1h5') },
    moon: { n: 'moon', b: P('M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401') },
    bell: { n: 'bell', b: P('M10.268 21a2 2 0 0 0 3.464 0') + P('M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326') },
    bellOff: { n: 'bell-off', b: P('M10.268 21a2 2 0 0 0 3.464 0') + P('M17 17H4a1 1 0 0 1-.74-1.673C4.59 13.956 6 12.499 6 8a6 6 0 0 1 .258-1.742') + P('m2 2 20 20') + P('M8.668 3.01A6 6 0 0 1 18 8c0 2.687.77 4.653 1.707 6.05') },
    clock: { n: 'clock', b: '<circle cx="12" cy="12" r="10"></circle>' + P('M12 6v6l4 2') },
    triangleAlert: { n: 'triangle-alert', b: P('m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3') + P('M12 9v4') + P('M12 17h.01') },
    listOrdered: { n: 'list-ordered', b: P('M11 5h10') + P('M11 12h10') + P('M11 19h10') + P('M4 4h1v5') + P('M4 9h2') + P('M6.5 20H3.4c0-1 2.6-1.925 2.6-3.5a1.5 1.5 0 0 0-2.6-1.02') },
    chartColumn: { n: 'chart-column', b: P('M3 3v16a2 2 0 0 0 2 2h16') + P('M18 17V9') + P('M13 17V5') + P('M8 17v-3') }
  };
  App.icon = function (name, cls) {
    var ic = ICONS[name];
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
    var t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  };

  /* ------------------------------------------------------------------ */
  /* Toast (sonner-like)                                                  */
  /* ------------------------------------------------------------------ */
  var TOAST_ICONS = {
    success: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" height="20" width="20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clip-rule="evenodd"></path></svg>',
    error: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" height="20" width="20"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5A.75.75 0 0110 5zm0 10a1 1 0 100-2 1 1 0 000 2z" clip-rule="evenodd"></path></svg>'
  };
  App.toast = function (message, opts) {
    opts = opts || {};
    var type = opts.type || 'default';
    var host = document.getElementById('toaster');
    if (!host) return { dismiss: function () {} };
    var li = document.createElement('li');
    li.className = 'toast';
    li.setAttribute('data-type', type);
    li.setAttribute('role', 'status');
    var html = '';
    if (TOAST_ICONS[type]) html += '<span class="toast-icon">' + TOAST_ICONS[type] + '</span>';
    html += '<div class="toast-content"><div class="toast-title">' + App.esc(message) + '</div></div>';
    if (opts.action) html += '<button type="button" class="toast-action">' + App.esc(opts.action.label) + '</button>';
    li.innerHTML = html;
    var timer = null;
    function dismiss() {
      clearTimeout(timer);
      if (!li.parentNode) return;
      li.setAttribute('data-removed', 'true');
      setTimeout(function () { if (li.parentNode) li.parentNode.removeChild(li); }, 200);
    }
    if (opts.action) {
      li.querySelector('.toast-action').addEventListener('click', function () {
        try { opts.action.onClick && opts.action.onClick(); } finally { dismiss(); }
      });
    }
    host.insertBefore(li, host.firstChild);
    var live = host.querySelectorAll('.toast:not([data-removed])');
    for (var i = 3; i < live.length; i++) live[i].parentNode.removeChild(live[i]);
    requestAnimationFrame(function () { li.setAttribute('data-mounted', 'true'); });
    timer = setTimeout(dismiss, opts.duration || 4000);
    return { dismiss: dismiss };
  };
  App.toast.success = function (m, o) { return App.toast(m, Object.assign({}, o, { type: 'success' })); };
  App.toast.error = function (m, o) { return App.toast(m, Object.assign({}, o, { type: 'error' })); };

  /* ------------------------------------------------------------------ */
  /* Dialog                                                               */
  /* ------------------------------------------------------------------ */
  App.openDialog = function (opts) {
    var host = document.getElementById('modal');
    var prevFocus = document.activeElement;
    var overlay = document.createElement('div');
    overlay.className = 'dlg-overlay';
    overlay.setAttribute('data-state', 'open');
    var dlg = document.createElement('div');
    dlg.className = 'dlg rounded-3xl' + (opts.className ? ' ' + opts.className : '');
    dlg.setAttribute('role', 'dialog');
    dlg.setAttribute('aria-modal', 'true');
    dlg.setAttribute('data-state', 'open');
    dlg.tabIndex = -1;
    var titleId = 'dlg-title-' + Math.floor(Math.random() * 1e9);
    dlg.setAttribute('aria-labelledby', titleId);
    var header = document.createElement('div');
    header.className = 'dlg-header';
    header.innerHTML = '<h2 class="dlg-title" id="' + titleId + '">' + App.esc(opts.title || '') + '</h2>';
    dlg.appendChild(header);
    if (opts.content) dlg.appendChild(opts.content);
    var closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'dlg-close';
    closeBtn.innerHTML = App.icon('x', 'h-4 w-4') + '<span class="sr-only">Close</span>';
    dlg.appendChild(closeBtn);
    host.appendChild(overlay);
    host.appendChild(dlg);
    var prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    var closed = false;
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); close(); return; }
      if (e.key !== 'Tab') return;
      // keep Tab focus inside the dialog, like Radix's FocusScope
      var f = dlg.querySelectorAll('button:not([disabled]), input:not([disabled])');
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1], a = document.activeElement;
      if (e.shiftKey ? (a === first || !dlg.contains(a) || a === dlg) : (a === last || !dlg.contains(a))) {
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
      if (prevFocus && prevFocus.focus) { try { prevFocus.focus({ preventScroll: true }); } catch (e) {} }
      if (opts.onClose) opts.onClose();
    }
    overlay.addEventListener('click', close);
    closeBtn.addEventListener('click', close);
    document.addEventListener('keydown', onKey, true);
    var f = dlg.querySelector('[autofocus], input, textarea, select');
    (f || dlg).focus();
    return { close: close, el: dlg };
  };

  /* ------------------------------------------------------------------ */
  /* Router                                                               */
  /* ------------------------------------------------------------------ */
  var pages = {};
  var TITLES = {
    '/': 'יומן תינוק — הנקה, חיתולים וויטמין D',
    '/history': 'היסטוריה — יומן תינוק',
    '/stats': 'סטטיסטיקה ולוח זמנים מוצע — יומן תינוק'
  };
  var current = { path: null, cleanup: null };
  App.registerPage = function (path, def) { pages[path] = def; if (current.path === path) render(); };
  function currentPath() {
    var h = location.hash.replace(/^#/, '');
    if (!h) return '/';
    h = h.split('?')[0];
    if (h.length > 1) h = h.replace(/\/+$/, '');
    return h || '/';
  }
  function render() {
    var path = currentPath();
    var el = document.getElementById('page');
    if (current.cleanup) { try { current.cleanup(); } catch (e) { console.error(e); } }
    current.cleanup = null;
    current.path = path;
    el.innerHTML = '';
    var def = pages[path];
    document.querySelectorAll('a[data-route]').forEach(function (a) {
      var on = a.getAttribute('data-route') === path;
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
    document.title = def.title || TITLES[path] || 'יומן תינוק';
    try { current.cleanup = def.mount(el) || null; } catch (e) { console.error(e); }
  }
  App.navigate = function (path) { location.hash = '#' + path; };

  /* ------------------------------------------------------------------ */
  /* Feed alarm (port of Yv)                                              */
  /* ------------------------------------------------------------------ */
  var Jv = function (k) { var t = LS.getItem(k); return t ? Number(t) : null; };
  function startFeedAlarm() {
    var host = document.getElementById('alarm');
    var shown = false;
    function hide() {
      shown = false;
      host.innerHTML = '';
    }
    function show() {
      shown = true;
      host.innerHTML =
        '<div role="alertdialog" aria-label="תזכורת הנקה" class="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-6 bg-[var(--pastel-rose)] p-8 text-center text-[var(--pastel-rose-fg)]">' +
          App.icon('baby', 'h-20 w-20') +
          '<div><p class="text-3xl font-bold">הגיע זמן הנקה</p><p class="mt-2 text-lg opacity-80">עברו 3 שעות מההנקה האחרונה</p></div>' +
          '<div class="flex w-full max-w-xs flex-col gap-3">' +
            '<button type="button" data-act="snooze" class="min-h-16 rounded-3xl bg-background text-xl font-semibold text-foreground shadow-sm active:scale-95">נודניק (15 דק\')</button>' +
            '<button type="button" data-act="cancel" class="flex min-h-14 items-center justify-center gap-2 rounded-3xl border border-current text-lg font-medium active:scale-95">' + App.icon('bellOff', 'h-5 w-5') + ' ביטול</button>' +
          '</div>' +
        '</div>';
      host.querySelector('[data-act=snooze]').addEventListener('click', function () {
        LS.setItem(KEYS.snoozeUntil, String(Date.now() + SNOOZE));
        hide();
        check();
      });
      host.querySelector('[data-act=cancel]').addEventListener('click', function () {
        LS.setItem(KEYS.feedDismissed, String(Ov(App.store.events())));
        hide();
        check();
      });
    }
    function check() {
      var e = App.store.events();
      var i = Dv(e, Jv(KEYS.snoozeUntil), Jv(KEYS.feedDismissed));
      var a = Date.now();
      var o = i !== null && a >= i && !hv(a);
      if (o && !shown) {
        show();
        if (LS.getItem(KEYS.alertsEnabled) === '1' && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          try { new Notification('יומן תינוק', { body: 'עברו 3 שעות מההנקה האחרונה', silent: true }); } catch (err) {}
        }
      }
      if (!o && shown) hide();
    }
    check();
    setInterval(check, 15e3);
    App.store.subscribe(check);
  }

  /* ------------------------------------------------------------------ */
  /* Daily 22:00 diaper notification (port of ry, local only)             */
  /* ------------------------------------------------------------------ */
  function startDailyNotification() {
    function t() {
      if (LS.getItem(KEYS.pushEnabled) === '1') return;
      var e = Date.now();
      var w = Gv(Av(), e, LS.getItem(KEYS.alertsEnabled) === '1', LS.getItem(KEYS.alertLastDay));
      if (!w.length || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
      try {
        new Notification('יומן תינוק', { body: w.join('\n'), tag: 'diapers-' + Fv(e) });
        LS.setItem(KEYS.alertLastDay, Fv(e));
      } catch (err) {}
    }
    function n() { t(); setTimeout(n, 6e4 - (Date.now() % 6e4)); }
    n();
    document.addEventListener('visibilitychange', t);
    window.addEventListener('storage', t);
    window.addEventListener(CHANGED, t);
  }

  /* ------------------------------------------------------------------ */
  /* Start                                                                */
  /* ------------------------------------------------------------------ */
  var started = false;
  App.start = function () {
    if (started) return;
    started = true;
    sync();
    // qv: auto-complete an active nursing past 15 min, checked every second
    setInterval(function () {
      if (Bv(Av(), LS.getItem(KEYS.active), Date.now()).completed) sync();
    }, 1e3);
    window.addEventListener('hashchange', render);
    render();
    startFeedAlarm();
    startDailyNotification();
  };
})();
