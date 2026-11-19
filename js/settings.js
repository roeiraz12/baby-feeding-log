/* settings.js — Settings page (#/settings): feed reminder interval, daily diaper goals,
   family sharing (UI for js/sync.js) and backup export / import. Owned by the settings agent.
   Works offline and without sharing; only the sharing buttons need the network. */
(function () {
  'use strict';
  var App = window.App;

  var MINUS = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-minus" aria-hidden="true"><path d="M5 12h14"></path></svg>';
  var PLUS = App.icon('plus');
  var esc = App.esc;

  /* ---------------------------------------------------------------- helpers */
  function el(html) { return App.h(html); }

  /** "סונכרן עכשיו" / "סונכרן לפני דקה" / "סונכרן לפני 5 דקות" / "סונכרן לפני שעתיים" / "סונכרן ב-18.11 14:05" */
  function syncedAgo(ts, now) {
    var s = Math.max(0, Math.round((now - ts) / 1e3));
    if (s < 45) return 'סונכרן עכשיו';
    var m = Math.round(s / 60);
    if (m <= 1) return 'סונכרן לפני דקה';
    if (m < 60) return 'סונכרן לפני ' + m + ' דקות';
    var h = Math.round(m / 60);
    if (h < 24) return 'סונכרן לפני ' + (h === 1 ? 'שעה' : h === 2 ? 'שעתיים' : h + ' שעות');
    return 'סונכרן ב־' + new Date(ts).toLocaleString('he-IL', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  function mmss(ms) {
    var s = Math.max(0, Math.ceil(ms / 1e3));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  /* One success toast per burst of taps on a stepper (saving itself is immediate). */
  var savedToast = { timer: null, handle: null };
  function toastSaved(text) {
    clearTimeout(savedToast.timer);
    savedToast.timer = setTimeout(function () {
      if (savedToast.handle) savedToast.handle.dismiss();
      savedToast.handle = App.toast.success(text, { duration: 2500 });
    }, 650);
  }

  /* ---------------------------------------------------------------- stepper */
  /* opts: {label, hint?, get(), set(v), min, max, step, format(v), describe(v), aria} */
  function stepper(opts) {
    var node = el(
      '<div class="st-field' + (opts.stack ? ' st-field-stack' : '') + '">' +
        '<div class="st-field-text"><p class="st-label">' + esc(opts.label) + '</p>' +
          (opts.hint ? '<p class="st-hint">' + esc(opts.hint) + '</p>' : '') + '</div>' +
        '<div class="st-stepper" role="group" aria-label="' + esc(opts.label) + '">' +
          '<button type="button" class="st-step" data-d="-1" aria-label="הפחתה">' + MINUS + '</button>' +
          '<output class="st-value" aria-live="polite"></output>' +
          '<button type="button" class="st-step" data-d="1" aria-label="הוספה">' + PLUS + '</button>' +
        '</div>' +
      '</div>'
    );
    var out = node.querySelector('.st-value');
    var dec = node.querySelector('[data-d="-1"]'), inc = node.querySelector('[data-d="1"]');
    function next(v, d) {
      // snap to the step grid first (an older stored value may be off-grid)
      var n = d > 0 ? Math.floor(v / opts.step) * opts.step + opts.step : Math.ceil(v / opts.step) * opts.step - opts.step;
      return Math.min(opts.max, Math.max(opts.min, n));
    }
    function paint() {
      var v = opts.get();
      out.innerHTML = opts.format(v);
      dec.disabled = v <= opts.min;
      inc.disabled = v >= opts.max;
    }
    function onClick(e) {
      var d = Number(e.currentTarget.getAttribute('data-d'));
      var v = opts.get(), n = next(v, d);
      if (n === v) return;
      try {
        opts.set(n);
        toastSaved(opts.describe(n));
      } catch (err) {
        App.toast.error(err.message);
      }
      paint();
    }
    dec.addEventListener('click', onClick);
    inc.addEventListener('click', onClick);
    paint();
    return { node: node, paint: paint };
  }

  /* ---------------------------------------------------------------- backup */
  function exportBackup() {
    var data = App.store.exportData();
    var name = 'baby-journal-' + App.dayKey(Date.now()) + '.json';
    var json = JSON.stringify(data);
    var blob = new Blob([json], { type: 'application/json' });
    // iPhone home-screen apps can't download; the share sheet can "Save to Files"
    var standaloneIOS = window.navigator.standalone === true;
    if (standaloneIOS && typeof File !== 'undefined' && navigator.canShare) {
      var file = new File([json], name, { type: 'application/json' });
      if (navigator.canShare({ files: [file] })) {
        navigator.share({ files: [file], title: name }).then(function () {
          App.toast.success('הגיבוי נשמר');
        }, function () { /* cancelled */ });
        return;
      }
    }
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1000);
    App.toast.success('הגיבוי נשמר: ' + name + ' (' + data.events.length + ' רשומות)');
  }

  function importSummary(r, mode) {
    if (mode === 'replace') return 'הנתונים הוחלפו — ' + r.total + ' רשומות ביומן.';
    var parts = [];
    if (r.added) parts.push('נוספו ' + r.added);
    if (r.updated) parts.push('עודכנו ' + r.updated);
    if (r.removed) parts.push('נמחקו ' + r.removed);
    return parts.length ? 'הייבוא הושלם: ' + parts.join(' · ') + ' (סה"כ ' + r.total + ' רשומות).' : 'הייבוא הושלם — לא נמצאו רשומות חדשות.';
  }

  function openImportDialog(obj, fileName) {
    var count = obj.events.length;
    var dates = obj.events.map(function (e) { return e.timestamp; }).filter(function (t) { return typeof t === 'number'; });
    var range = '';
    if (dates.length) {
      var fmt = function (t) { return new Date(t).toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric', year: '2-digit' }); };
      var lo = Math.min.apply(null, dates), hi = Math.max.apply(null, dates);
      range = fmt(lo) === fmt(hi) ? ' מתאריך ' + fmt(lo) : ' מ־' + fmt(lo) + ' עד ' + fmt(hi);
    }
    var linked = App.sync && App.sync.status().linked;
    var content = el(
      '<div class="st-dlg">' +
        '<p class="st-dlg-text"><b>' + esc(fileName) + '</b><br>' + count + ' רשומות' + esc(range) + '.</p>' +
        '<div class="st-choice">' +
          '<button type="button" class="st-btn st-btn-primary" data-mode="merge">מיזוג עם הנתונים הקיימים</button>' +
          '<p class="st-hint">מוסיף את מה שחסר ומעדכן רשומות לפי השינוי האחרון. מה שכבר בטלפון נשאר.</p>' +
        '</div>' +
        '<div class="st-choice">' +
          '<button type="button" class="st-btn st-btn-danger" data-mode="replace">החלפת כל הנתונים</button>' +
          '<div class="st-warn" role="note">' + App.icon('triangleAlert', 'st-warn-icon') +
            '<p>כל הרשומות שבטלפון ואינן בקובץ יימחקו' + (linked ? ' — גם אצל ההורה השני, כי היומן משותף' : '') +
            '. גם ההגדרות יוחלפו בהגדרות שבקובץ.</p></div>' +
        '</div>' +
        '<p class="st-error" role="alert" hidden></p>' +
      '</div>'
    );
    var dlg = App.openDialog({ title: 'ייבוא גיבוי', content: content });
    var errEl = content.querySelector('.st-error');
    var replaceBtn = content.querySelector('[data-mode=replace]');
    var armed = false;
    function run(mode) {
      try {
        var r = App.store.importData(obj, { mode: mode });
        dlg.close();
        App.toast.success(importSummary(r, mode), { duration: 5000 });
      } catch (err) {
        errEl.textContent = err.message;
        errEl.hidden = false;
      }
    }
    content.querySelector('[data-mode=merge]').addEventListener('click', function () { run('merge'); });
    replaceBtn.addEventListener('click', function () {
      if (!armed) { // two-step: the first tap only arms the button
        armed = true;
        replaceBtn.textContent = 'לחצי שוב כדי למחוק ולהחליף';
        replaceBtn.classList.add('st-armed');
        return;
      }
      run('replace');
    });
  }

  function onImportFile(input) {
    var file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) { App.toast.error('הקובץ גדול מדי לקובץ גיבוי.'); return; }
    var reader = new FileReader();
    reader.onload = function () {
      var obj;
      try { obj = JSON.parse(String(reader.result)); } catch (e) {
        App.toast.error('לא ניתן לקרוא את הקובץ. ודאי שבחרת קובץ גיבוי של יומן תינוק.');
        return;
      }
      if (!obj || typeof obj !== 'object' || obj.app !== 'baby-journal' || !Array.isArray(obj.events)) {
        App.toast.error('הקובץ אינו קובץ גיבוי של יומן תינוק.');
        return;
      }
      openImportDialog(obj, file.name);
    };
    reader.onerror = function () { App.toast.error('לא ניתן לקרוא את הקובץ.'); };
    reader.readAsText(file);
  }

  /* ---------------------------------------------------------------- sharing dialogs */
  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    return new Promise(function (resolve, reject) {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      ta.remove();
      if (ok) resolve(); else reject(new Error('copy failed'));
    });
  }

  function openInviteDialog() {
    var content = el(
      '<div class="st-dlg">' +
        '<p class="st-dlg-text">בטלפון של ההורה השני פתחו את הקישור, או היכנסו ל<b>הגדרות ← יש לי קוד</b> והקלידו:</p>' +
        '<div class="st-code-box">' +
          '<p class="st-code" dir="ltr" aria-live="polite">······</p>' +
          '<p class="st-hint st-countdown">יוצר קוד…</p>' +
        '</div>' +
        '<div class="st-actions" data-slot="actions"></div>' +
        '<p class="st-error" role="alert" hidden></p>' +
      '</div>'
    );
    var codeEl = content.querySelector('.st-code');
    var countEl = content.querySelector('.st-countdown');
    var actions = content.querySelector('[data-slot=actions]');
    var errEl = content.querySelector('.st-error');
    var tick = null, current = null, devicesAtOpen = null;
    // close by itself once the other phone has joined (seen on the next sync / poll)
    var unsub = App.sync.onStatus(function (s) {
      if (!s.linked || devicesAtOpen === null) return;
      if (s.devices > devicesAtOpen) {
        dlg.close();
        App.toast.success('הטלפון השני הצטרף — היומן משותף עכשיו.', { duration: 5000 });
      }
    });
    var dlg = App.openDialog({ title: 'שיתוף עם הורה נוסף', content: content, onClose: function () { clearInterval(tick); unsub(); } });

    function renderActions(expired) {
      actions.innerHTML = '';
      if (expired || !current) {
        var again = el('<button type="button" class="st-btn st-btn-primary">' + App.icon('undo2') + ' קוד חדש</button>');
        again.addEventListener('click', load);
        actions.appendChild(again);
        return;
      }
      if (navigator.share) {
        var share = el('<button type="button" class="st-btn st-btn-primary">' + App.icon('share2') + ' שליחת הקישור</button>');
        share.addEventListener('click', function () {
          navigator.share({ title: 'יומן תינוק', text: 'הצטרפות ליומן התינוק המשותף (קוד ' + current.code + '):', url: current.url })
            .catch(function () { /* cancelled */ });
        });
        actions.appendChild(share);
      }
      var copy = el('<button type="button" class="st-btn ' + (navigator.share ? 'st-btn-soft' : 'st-btn-primary') + '">' + App.icon('stickyNote') + ' העתקת הקישור</button>');
      copy.addEventListener('click', function () {
        copyText(current.url).then(function () { App.toast.success('הקישור הועתק'); }, function () {
          App.toast.error('ההעתקה נכשלה. אפשר להקליד את הקוד בטלפון השני.');
        });
      });
      actions.appendChild(copy);
    }
    function countdown() {
      var left = current.expiresAt - Date.now();
      if (left <= 0) {
        clearInterval(tick);
        codeEl.classList.add('st-expired');
        countEl.textContent = 'תוקף הקוד פג.';
        renderActions(true);
        return;
      }
      countEl.textContent = 'בתוקף עוד ' + mmss(left) + ' דק\' · לשימוש חד־פעמי';
    }
    function load() {
      clearInterval(tick);
      current = null;
      errEl.hidden = true;
      codeEl.classList.remove('st-expired');
      codeEl.textContent = '······';
      countEl.textContent = 'יוצר קוד…';
      actions.innerHTML = '';
      App.sync.invite().then(function (r) {
        current = r;
        if (devicesAtOpen === null) devicesAtOpen = typeof r.devices === 'number' ? r.devices : App.sync.status().devices;
        // the server clock decides validity; use our own clock for the display (15 min from now)
        current.expiresAt = Date.now() + Math.min(15 * 6e4, Math.max(0, r.expiresAt - Date.now()) || 15 * 6e4);
        codeEl.textContent = r.code.slice(0, 3) + ' ' + r.code.slice(3);
        codeEl.setAttribute('aria-label', r.code.split('').join(' '));
        renderActions(false);
        countdown();
        tick = setInterval(countdown, 1000);
      }, function (err) {
        codeEl.textContent = '——';
        countEl.textContent = '';
        errEl.textContent = err.message;
        errEl.hidden = false;
        renderActions(true);
      });
    }
    load();
    return dlg;
  }

  function openJoinDialog(code, onDone) {
    var content = el(
      '<div class="st-dlg">' +
        '<p class="st-code st-code-sm" dir="ltr">' + esc(code.slice(0, 3) + ' ' + code.slice(3)) + '</p>' +
        '<p class="st-dlg-text">הטלפון הזה יחובר ליומן של ההורה השני. <b>הרשומות משני הטלפונים יאוחדו</b> לרשימה אחת, ומעכשיו כל רישום יופיע אצל שניכם.</p>' +
        '<p class="st-hint">ההגדרות (מרווח הנקה ויעדים) נשארות נפרדות בכל טלפון.</p>' +
        '<p class="st-error" role="alert" hidden></p>' +
        '<div class="st-actions">' +
          '<button type="button" class="st-btn st-btn-primary" data-act="join">הצטרפות</button>' +
          '<button type="button" class="st-btn st-btn-soft" data-act="cancel">ביטול</button>' +
        '</div>' +
      '</div>'
    );
    var dlg = App.openDialog({ title: 'הצטרפות ליומן משותף', content: content });
    var btn = content.querySelector('[data-act=join]');
    var errEl = content.querySelector('.st-error');
    content.querySelector('[data-act=cancel]').addEventListener('click', dlg.close);
    btn.addEventListener('click', function () {
      btn.disabled = true;
      btn.textContent = 'מצטרפת…';
      errEl.hidden = true;
      App.sync.join(code).then(function (s) {
        dlg.close();
        if (onDone) onDone();
        App.toast.success(s && s.state === 'ok' ? 'מחוברים! הנתונים משני הטלפונים אוחדו.' : 'מחוברים! הנתונים יסונכרנו כשיהיה חיבור.', { duration: 5000 });
      }, function (err) {
        btn.disabled = false;
        btn.textContent = 'הצטרפות';
        errEl.textContent = err.message;
        errEl.hidden = false;
      });
    });
  }

  function openLeaveDialog() {
    var content = el(
      '<div class="st-dlg">' +
        '<p class="st-dlg-text">הטלפון הזה יפסיק להתעדכן מההורה השני ולשלוח אליו רישומים.</p>' +
        '<p class="st-hint">כל הנתונים שכבר נמצאים כאן נשארים בטלפון. אפשר להתחבר שוב בכל עת עם קוד חדש.</p>' +
        '<div class="st-actions">' +
          '<button type="button" class="st-btn st-btn-danger" data-act="leave">הפסקת שיתוף</button>' +
          '<button type="button" class="st-btn st-btn-soft" data-act="cancel">ביטול</button>' +
        '</div>' +
      '</div>'
    );
    var dlg = App.openDialog({ title: 'הפסקת שיתוף', content: content });
    content.querySelector('[data-act=cancel]').addEventListener('click', dlg.close);
    content.querySelector('[data-act=leave]').addEventListener('click', function () {
      App.sync.leave();
      dlg.close();
      App.toast.success('השיתוף הופסק. הנתונים נשארו בטלפון.');
    });
  }

  /* ---------------------------------------------------------------- sharing card */
  function shareCard() {
    var node = el(
      '<section class="st-card st-lavender" aria-labelledby="st-share-h">' +
        '<h2 class="st-title" id="st-share-h">' + App.icon('share2') + ' שיתוף בין הורים</h2>' +
        '<div data-slot="body"></div>' +
      '</section>'
    );
    var body = node.querySelector('[data-slot=body]');
    var mode = null, statusLine = null, devicesLine = null, dot = null;

    function renderUnlinked(s) {
      body.innerHTML = '';
      if (s.notice === 'revoked') {
        body.appendChild(el('<p class="st-note">השיתוף בטלפון הזה הופסק. הנתונים נשארו כאן — אפשר להתחבר מחדש.</p>'));
      }
      body.appendChild(el('<p class="st-text">חברו את הטלפון של ההורה השני כדי ששניכם תראו ותעדכנו את אותו יומן. בלי הרשמה ובלי סיסמה.</p>'));
      var shareBtn = el('<button type="button" class="st-btn st-btn-primary">' + App.icon('share2') + ' שיתוף עם הורה נוסף</button>');
      shareBtn.addEventListener('click', function () { openInviteDialog(); });
      body.appendChild(shareBtn);
      var form = el(
        '<form class="st-join" novalidate>' +
          '<label class="st-label" for="st-join-code">יש לי קוד</label>' +
          '<div class="st-join-row">' +
            '<input id="st-join-code" class="input st-code-input" dir="ltr" inputmode="text" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="8" placeholder="ABC 234" aria-describedby="st-join-hint">' +
            '<button type="submit" class="st-btn st-btn-soft st-join-btn">הצטרפות</button>' +
          '</div>' +
          '<p class="st-hint" id="st-join-hint">את הקוד מקבלים בטלפון השני: הגדרות ← שיתוף עם הורה נוסף.</p>' +
        '</form>'
      );
      var input = form.querySelector('input');
      input.addEventListener('input', function () {
        var v = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (input.value !== v) input.value = v;
      });
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var code = input.value.replace(/\s/g, '').toUpperCase();
        if (!/^[A-HJ-NP-Z2-9]{6}$/.test(code)) {
          App.toast.error(code.length !== 6 ? 'הקוד צריך להכיל 6 תווים.' : 'הקוד לא תקין — בדקי שוב את האותיות.');
          input.focus();
          return;
        }
        openJoinDialog(code, function () { input.value = ''; });
      });
      body.appendChild(form);
    }

    function renderLinked() {
      body.innerHTML = '';
      var head = el(
        '<div class="st-linked">' +
          '<span class="st-dot" aria-hidden="true"></span>' +
          '<div class="min-w-0"><p class="st-linked-title">מחוברים ✓</p>' +
          '<p class="st-hint" data-slot="devices"></p>' +
          '<p class="st-hint" data-slot="status" aria-live="polite"></p></div>' +
        '</div>'
      );
      dot = head.querySelector('.st-dot');
      devicesLine = head.querySelector('[data-slot=devices]');
      statusLine = head.querySelector('[data-slot=status]');
      body.appendChild(head);
      var actions = el('<div class="st-actions"></div>');
      var syncBtn = el('<button type="button" class="st-btn st-btn-soft">' + App.icon('undo2', 'st-flip') + ' סנכרון עכשיו</button>');
      syncBtn.addEventListener('click', function () {
        syncBtn.disabled = true;
        App.sync.syncNow().then(function (s) {
          syncBtn.disabled = false;
          if (s.linked && (s.state === 'offline' || s.state === 'error')) App.toast.error('אין חיבור לשרת כרגע. ננסה שוב אוטומטית.');
        });
      });
      var inviteBtn = el('<button type="button" class="st-btn st-btn-soft">' + App.icon('plus') + ' הצגת קוד הצטרפות</button>');
      inviteBtn.addEventListener('click', function () { openInviteDialog(); });
      var leaveBtn = el('<button type="button" class="st-btn st-btn-ghost-danger">הפסקת שיתוף</button>');
      leaveBtn.addEventListener('click', openLeaveDialog);
      actions.appendChild(syncBtn);
      actions.appendChild(inviteBtn);
      actions.appendChild(leaveBtn);
      body.appendChild(actions);
    }

    function paintLinked(s) {
      devicesLine.textContent = s.devices >= 2
        ? (s.devices === 2 ? 'היומן משותף בין 2 טלפונים.' : 'היומן משותף בין ' + s.devices + ' טלפונים.')
        : 'עוד לא הצטרף טלפון נוסף — שלחי לו קוד הצטרפות.';
      var text, bad = false;
      if (s.state === 'offline' || s.state === 'error') { text = 'לא מחובר — ינסה שוב'; bad = true; }
      else if (s.state === 'syncing' && !s.lastSyncAt) text = 'מסנכרן…';
      else if (s.lastSyncAt) text = syncedAgo(s.lastSyncAt, Date.now());
      else text = 'ממתין לסנכרון…';
      statusLine.textContent = text;
      dot.classList.toggle('st-dot-bad', bad);
    }

    function update() {
      var s = App.sync ? App.sync.status() : { linked: false };
      var want = s.linked ? 'linked' : 'unlinked';
      if (want !== mode || (want === 'unlinked' && s.notice && !body.querySelector('.st-note'))) {
        mode = want;
        if (want === 'linked') renderLinked(); else renderUnlinked(s);
      }
      if (mode === 'linked') paintLinked(s);
    }
    update();
    return { node: node, update: update };
  }

  /* ---------------------------------------------------------------- page */
  function joinCodeFromHash() {
    var h = location.hash, i = h.indexOf('?');
    if (i < 0) return null;
    var params = new URLSearchParams(h.slice(i + 1));
    var code = params.get('join');
    // clean the query from the URL (no hashchange → no re-render)
    try { history.replaceState(history.state, '', location.pathname + location.search + h.slice(0, i)); } catch (e) { /* ignore */ }
    return code;
  }

  /* ---------------- daily notifications (moved from the stats page) ---------------- */
  var SWITCH = 'switch peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input';
  var THUMB = 'switch-thumb pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0';

  function alertsEnabled() {
    try { return localStorage.getItem(App.KEYS.alertsEnabled) === '1'; } catch (e) { return false; }
  }

  // turns the daily notifications on (permission + server push registration) or off
  function toggleAlerts(next) {
    if (!next) {
      return App.push.sync(false).then(function () {
        localStorage.setItem(App.KEYS.alertsEnabled, '0');
        localStorage.removeItem(App.KEYS.pushEnabled);
      }, function (err) {
        App.toast.error(err instanceof Error ? err.message : 'ביטול ההתראות נכשל');
      });
    }
    if (typeof Notification === 'undefined') {
      App.toast.error('התראות אינן זמינות כאן. באייפון יש להוסיף את האתר למסך הבית ולפתוח אותו משם.');
      return Promise.resolve();
    }
    if (window.top !== window.self && Notification.permission !== 'granted') {
      App.toast.error('פתחי את האפליקציה בלשונית נפרדת כדי לאפשר התראות.');
      return Promise.resolve();
    }
    var perm = Notification.permission === 'granted'
      ? Promise.resolve('granted')
      : new Promise(function (res) {
          var p = Notification.requestPermission(res);
          if (p && p.then) p.then(res, function () { res('denied'); });
        });
    return perm.then(function (r) {
      if (r !== 'granted') { App.toast.error('ההתראות חסומות בהגדרות הדפדפן.'); return; }
      return App.push.enable().then(function () {
        localStorage.setItem(App.KEYS.alertsEnabled, '1');
        App.toast.success('התראות יומיות מופעלות גם כשהאפליקציה סגורה.');
      }, function (err) {
        App.toast.error(err instanceof Error ? err.message : 'הפעלת התראות ברקע נכשלה');
      });
    });
  }

  function notifCard() {
    var node = el(
      '<section class="st-card st-lavender" aria-labelledby="st-notif-h">' +
        '<h2 class="st-title" id="st-notif-h">' + App.icon('bell') + ' התראות</h2>' +
        '<div class="st-field">' +
          '<div class="st-field-text"><p class="st-label" id="st-notif-label">התראות יומיות</p>' +
            '<p class="st-hint" data-slot="desc"></p></div>' +
          '<button type="button" role="switch" class="' + SWITCH + '" aria-labelledby="st-notif-label" value="on">' +
            '<span class="' + THUMB + '"></span></button>' +
        '</div>' +
      '</section>'
    );
    var sw = node.querySelector('[role=switch]'), thumb = sw.firstElementChild, desc = node.querySelector('[data-slot=desc]');
    var card = { node: node, alive: true, busy: false, paint: paint };
    function paint() {
      var on = alertsEnabled(), g = App.goals(), h = App.EVENING_NOTIFY_HOUR;
      var s = on ? 'checked' : 'unchecked';
      sw.setAttribute('aria-checked', String(on));
      sw.setAttribute('data-state', s);
      thumb.setAttribute('data-state', s);
      desc.textContent = 'בין ' + h + ':00 ל־' + (h + 1) + ':00 לפי שעון ישראל, גם כשהאפליקציה סגורה, רק אם נרשמו פחות מ־' + g.wet + ' פיפי או מ־' + g.dirty + ' קקי.';
    }
    sw.addEventListener('click', function () {
      if (card.busy) return; // permission prompt still open
      card.busy = true;
      sw.disabled = true;
      var done = function () { card.busy = false; sw.disabled = false; if (card.alive) { paint(); sw.focus({ preventScroll: true }); } };
      toggleAlerts(!alertsEnabled()).then(done, done);
    });
    paint();
    return card;
  }

  function mount(root) {
    var page = el(
      '<div class="space-y-6 st-page">' +
        '<header class="pt-2"><h1 class="text-3xl font-bold tracking-tight">הגדרות</h1>' +
          '<p class="text-sm text-muted-foreground">השינויים נשמרים מיד.</p></header>' +
      '</div>'
    );

    // 1. nursing
    var feed = el('<section class="st-card st-rose" aria-labelledby="st-feed-h"><h2 class="st-title" id="st-feed-h">' + App.icon('baby') + ' הנקה</h2></section>');
    var feedStepper = stepper({
      label: 'תזכורת להנקה הבאה',
      hint: 'אחרי כמה זמן מתחילת ההנקה האחרונה להזכיר.',
      min: 30, max: 480, step: 15, stack: true,
      get: function () { return App.settings.get().feedIntervalMin; },
      set: function (v) { App.settings.set({ feedIntervalMin: v }); },
      format: function (v) { return '<span class="st-value-main">' + esc(App.hoursPhrase(v)) + '</span>'; },
      describe: function (v) { return 'נשמר: תזכורת אחרי ' + App.hoursPhrase(v); }
    });
    feed.appendChild(feedStepper.node);
    page.appendChild(feed);

    // 2. daily goals
    var goals = el('<section class="st-card st-sky" aria-labelledby="st-goals-h"><h2 class="st-title" id="st-goals-h">' + App.icon('droplets') + ' יעדים יומיים</h2></section>');
    var wet = stepper({
      label: 'פיפי', min: 1, max: 20, step: 1,
      get: function () { return App.settings.get().wetGoal; },
      set: function (v) { App.settings.set({ wetGoal: v }); },
      format: function (v) { return '<span class="st-value-main">' + v + '</span><span class="st-value-unit">ביום</span>'; },
      describe: function (v) { return 'נשמר: יעד פיפי ' + v + ' ביום'; }
    });
    var dirty = stepper({
      label: 'קקי', min: 1, max: 20, step: 1,
      get: function () { return App.settings.get().dirtyGoal; },
      set: function (v) { App.settings.set({ dirtyGoal: v }); },
      format: function (v) { return '<span class="st-value-main">' + v + '</span><span class="st-value-unit">ביום</span>'; },
      describe: function (v) { return 'נשמר: יעד קקי ' + v + ' ביום'; }
    });
    goals.appendChild(wet.node);
    goals.appendChild(dirty.node);
    goals.appendChild(el('<p class="st-hint">לפיהם מוצגת אזהרה בסטטיסטיקה ונשלחת התראת הערב כשיש פחות חיתולים מהיעד.</p>'));
    page.appendChild(goals);

    // 3. daily notifications (moved here from the stats page)
    var notif = notifCard();
    page.appendChild(notif.node);

    // 4. backup
    var backup = el(
      '<section class="st-card st-sand" aria-labelledby="st-backup-h">' +
        '<h2 class="st-title" id="st-backup-h">' + App.icon('download') + ' גיבוי נתונים</h2>' +
        '<p class="st-text" data-slot="count"></p>' +
        '<div class="st-actions st-actions-2">' +
          '<button type="button" class="st-btn st-btn-soft" data-act="export">' + App.icon('download') + ' ייצוא לקובץ</button>' +
          '<button type="button" class="st-btn st-btn-soft" data-act="import">' + App.icon('upload') + ' ייבוא מקובץ</button>' +
        '</div>' +
        '<input type="file" accept=".json,application/json" hidden data-slot="file">' +
        '<p class="st-hint">באייפון הנתונים נשמרים בצורה הבטוחה ביותר כשהאתר מותקן במסך הבית (שיתוף ← הוספה למסך הבית). כדאי לייצא גיבוי מדי פעם.</p>' +
      '</section>'
    );
    var fileInput = backup.querySelector('[data-slot=file]');
    var countEl = backup.querySelector('[data-slot=count]');
    backup.querySelector('[data-act=export]').addEventListener('click', exportBackup);
    backup.querySelector('[data-act=import]').addEventListener('click', function () { fileInput.click(); });
    fileInput.addEventListener('change', function () { onImportFile(fileInput); });
    page.appendChild(backup);

    // 5. sharing
    var share = shareCard();
    page.appendChild(share.node);

    root.appendChild(page);

    function paintCount() {
      var n = App.store.events().length;
      countEl.textContent = n === 0 ? 'אין עדיין רשומות בטלפון הזה.' : (n === 1 ? 'רשומה אחת' : n + ' רשומות') + ' שמורות בטלפון הזה.';
    }
    function refresh() {
      feedStepper.paint(); wet.paint(); dirty.paint();
      notif.paint();
      paintCount();
      share.update();
    }
    paintCount();

    var unsubStore = App.store.subscribe(refresh);
    var unsubSync = App.sync ? App.sync.onStatus(function () { share.update(); }) : function () {};
    var clock = setInterval(function () { share.update(); }, 20e3);

    var code = joinCodeFromHash();
    if (code) {
      var clean = code.toUpperCase().replace(/[\s-]/g, '');
      if (App.sync && App.sync.status().linked) {
        App.toast('הטלפון הזה כבר מחובר ליומן משותף. כדי להצטרף ליומן אחר, הפסיקי קודם את השיתוף.', { duration: 6000 });
      } else if (!/^[A-HJ-NP-Z2-9]{6}$/.test(clean)) {
        App.toast.error('קישור ההצטרפות לא תקין. בקשי קישור חדש.');
      } else {
        share.node.scrollIntoView({ block: 'start' });
        openJoinDialog(clean);
      }
    }

    return function () {
      notif.alive = false;
      unsubStore();
      unsubSync();
      clearInterval(clock);
    };
  }

  App.registerPage('/settings', { title: 'הגדרות — יומן תינוק', mount: mount });
})();
