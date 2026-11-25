/* History page — port of history-*.js (component I + edit dialog F). */
(function () {
  'use strict';
  var App = window.App;

  // Merged (tailwind-merge) class strings as rendered by the original.
  var CLS = {
    root: 'space-y-6',
    header: 'pt-2',
    h1: 'text-3xl font-bold tracking-tight',
    sub: 'text-sm text-muted-foreground',
    empty: 'border bg-card shadow rounded-3xl border-dashed p-8 text-center text-sm text-muted-foreground',
    section: 'space-y-2',
    h2: 'text-sm font-semibold uppercase tracking-wide text-muted-foreground',
    ul: 'space-y-2',
    row: 'border bg-card text-card-foreground shadow flex flex-row items-center gap-3 rounded-2xl p-3',
    iconWrap: 'grid h-10 w-10 shrink-0 place-items-center rounded-full bg-secondary text-secondary-foreground',
    body: 'min-w-0 flex-1',
    label: 'truncate font-medium',
    time: 'text-xs text-muted-foreground',
    note: 'truncate text-xs text-foreground/80',
    editBtn: 'grid h-10 w-10 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-secondary',
    delBtn: 'grid h-10 w-10 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive',
    // dialog form controls (contract names + original shadcn classes)
    form: 'space-y-4',
    field: 'space-y-1',
    flabel: 'label text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70',
    input: 'input flex w-full rounded-md border border-input bg-transparent px-3 py-1 shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm h-12 text-base',
    footer: 'dlg-footer flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2',
    submit: 'btn-primary-lg inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 bg-primary text-primary-foreground shadow hover:bg-primary/90 h-10 rounded-md px-8 w-full'
  };

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  // j(): day heading
  function dayHeading(key) {
    var t = App.dayKey(Date.now());
    var y = App.dayKey(Date.now() - 864e5);
    if (key === t) return 'היום';
    if (key === y) return 'אתמול';
    return new Date(key + 'T12:00:00').toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'short' });
  }

  // M(): icon per type
  function iconFor(e) {
    var name = e.type === 'nursing' ? 'baby' : e.type === 'diaper' ? 'droplets' : e.type === 'custom' ? 'stickyNote' : 'moon';
    return App.icon(name, 'h-5 w-5');
  }

  function hm(ts) {
    var d = new Date(ts);
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }
  function applyHM(ts, v) {
    var p = String(v).split(':').map(Number);
    var d = new Date(ts);
    d.setHours(isNaN(p[0]) ? 0 : p[0], isNaN(p[1]) ? 0 : p[1], 0, 0);
    return d.getTime();
  }

  function field(id, labelText, input) {
    var wrap = el('div', CLS.field);
    var lab = el('label', CLS.flabel, labelText);
    lab.htmlFor = id;
    wrap.appendChild(lab);
    wrap.appendChild(input);
    return wrap;
  }
  function timeInput(id, value) {
    var i = el('input', CLS.input);
    i.id = id; i.type = 'time'; i.value = value;
    return i;
  }

  var openDlg = null; // edit dialog, closed when the page unmounts (as in the original)

  // F(): edit dialog
  function openEdit(evt, root) {
    var form = el('form', CLS.form);
    var start = timeInput('start', hm(evt.timestamp));
    form.appendChild(field('start', evt.endTimestamp ? 'שעת התחלה' : 'שעה', start));
    var end = null;
    if (evt.endTimestamp !== undefined) {
      end = timeInput('end', evt.endTimestamp ? hm(evt.endTimestamp) : '');
      form.appendChild(field('end', 'שעת סיום', end));
    }
    var note = el('input', CLS.input);
    note.id = 'note'; note.maxLength = 80; note.value = evt.note || '';
    note.placeholder = 'טקסט קצר (לא חובה)';
    form.appendChild(field('note', 'הערה', note));
    var footer = el('div', CLS.footer);
    var btn = el('button', CLS.submit, 'שמירה');
    btn.type = 'submit';
    footer.appendChild(btn);
    form.appendChild(footer);

    var saved = false;
    var dlg = openDlg = App.openDialog({
      title: 'עדכון רשומה',
      content: form,
      onClose: function () {
        openDlg = null;
        // the list was re-rendered on save: return focus to this row's (new) edit button
        var b = root.querySelector('button[data-edit-id="' + CSS.escape(String(evt.id)) + '"]');
        if (b) b.focus({ preventScroll: true });
      }
    });
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      if (saved) return; // ignore a second Enter during the close animation
      saved = true;
      var t = applyHM(evt.timestamp, start.value);
      var patch = { timestamp: t, note: note.value.trim() || undefined };
      if (evt.endTimestamp && end && end.value) {
        var e = applyHM(evt.endTimestamp, end.value);
        if (e < t) e += 864e5;
        if (e - t > 864e5) e -= 864e5;
        patch.endTimestamp = e;
      }
      App.store.edit(evt.id, patch);
      dlg.close();
      App.toast('הרשומה עודכנה', { type: 'success' });
    });
  }

  /* ---------- 24-hour day ribbon ---------- */
  function dayBounds(key) {
    var p = key.split('-').map(Number);
    return [new Date(p[0], p[1] - 1, p[2]).getTime(), new Date(p[0], p[1] - 1, p[2] + 1).getTime()];
  }
  function legend() {
    var l = el('div', 'history-legend');
    l.setAttribute('aria-hidden', 'true');
    [['n', 'הנקה'], ['wet', 'פיפי'], ['dirty', 'קקי']].forEach(function (x) {
      var i = el('span', 'history-legend-item');
      i.appendChild(el('span', 'history-swatch history-swatch-' + x[0]));
      i.appendChild(document.createTextNode(x[1]));
      l.appendChild(i);
    });
    return l;
  }
  // 0 → 24h bar, left to right: one mark per feeding on the top lane, diapers as dots on the
  // bottom lane, an hourly grid with a label every 2 hours, "now" for today
  function ribbon(key, list, feeds) {
    var b = dayBounds(key), span = b[1] - b[0], now = Date.now();
    var pos = function (t) { return Math.max(0, Math.min(100, (t - b[0]) / span * 100)); };
    var box = el('div', 'history-ribbon');
    box.setAttribute('role', 'img');
    var track = el('div', 'history-track');
    for (var h = 1; h < 24; h++) {
      var g = el('span', 'history-grid' + (h % 2 === 0 ? ' is-major' : ''));
      g.style.left = (h / 24 * 100) + '%';
      track.appendChild(g);
    }
    var n = 0, w = 0, d = 0;
    // nursing: one mark per feeding, at the start of its first side (sides are not split)
    feeds.forEach(function (f) {
      if (App.dayKey(f.start) !== key) return;
      var mark = el('span', 'history-seg history-swatch-n');
      mark.style.left = pos(f.start) + '%';
      mark.title = 'הנקה · ' + App.timeHM(f.start);
      track.appendChild(mark);
      n++;
    });
    // diapers only (other events are left off the ribbon)
    list.forEach(function (e) {
      if (e.type !== 'diaper') return;
      var kind = e.subtype === 'wet' ? 'wet' : 'dirty';
      if (kind === 'wet') w++; else d++;
      var dot = el('span', 'history-dot history-swatch-' + kind);
      dot.style.left = pos(e.timestamp) + '%';
      dot.title = App.label(e) + ' · ' + App.timeHM(e.timestamp);
      track.appendChild(dot);
    });
    if (App.isToday(key, now)) {
      var nowLine = el('span', 'history-now');
      nowLine.style.left = pos(now) + '%';
      track.appendChild(nowLine);
    }
    box.appendChild(track);
    var axis = el('div', 'history-axis');
    for (var hh = 0; hh <= 24; hh += 2) {
      var lab = el('span', 'history-axis-label', String(hh));
      lab.style.left = (hh / 24 * 100) + '%';
      axis.appendChild(lab);
    }
    box.appendChild(axis);
    box.setAttribute('aria-label', 'ציר של 24 שעות: ' + n + ' הנקות, ' + w + ' פיפי, ' + d + ' קקי');
    return box;
  }
  function summary(key, list, feeds) {
    var nf = feeds.filter(function (f) { return App.dayKey(f.start) === key; }).length;
    var w = list.filter(function (e) { return e.type === 'diaper' && e.subtype === 'wet'; }).length;
    var d = list.filter(function (e) { return e.type === 'diaper' && e.subtype !== 'wet'; }).length;
    var row = el('div', 'history-chips');
    [['n', nf + ' הנקות'], ['wet', w + ' פיפי'], ['dirty', d + ' קקי']].forEach(function (c) {
      row.appendChild(el('span', 'history-chip history-chip-' + c[0], c[1]));
    });
    // binary verdict against the daily diaper goals from the settings (default 6 pee / 3 poop)
    var g = App.goals(), ok = App.meetsDiaperGoals(w, d);
    var badge = el('span', 'history-chip history-chip-' + (ok ? 'ok' : 'bad'));
    badge.innerHTML = App.icon(ok ? 'check' : 'x', 'h-3.5 w-3.5');
    badge.appendChild(document.createTextNode(ok ? 'תקין' : 'לא תקין'));
    badge.title = 'יעד: ' + g.wet + ' פיפי ו-' + g.dirty + ' קקי';
    row.appendChild(badge);
    return row;
  }
  // the detailed list of one day (edit / delete per row), shown when the day is expanded
  function buildList(list, root) {
    var ul = el('ul', CLS.ul + ' history-list');
    list.forEach(function (e) {
      var li = el('li');
      var card = el('div', CLS.row + (e.type === 'diaper' ? ' history-row-' + (e.subtype === 'wet' ? 'wet' : 'dirty') : ''));
      var ic = el('span', CLS.iconWrap);
      ic.innerHTML = iconFor(e);
      card.appendChild(ic);

      var body = el('div', CLS.body);
      body.appendChild(el('p', CLS.label, App.label(e)));
      body.appendChild(el('p', CLS.time,
        App.timeHM(e.timestamp) + (e.endTimestamp ? ' – ' + App.timeHM(e.endTimestamp) : '')));
      if (e.note && e.type !== 'custom') body.appendChild(el('p', CLS.note, e.note));
      card.appendChild(body);

      var edit = el('button', CLS.editBtn);
      edit.setAttribute('aria-label', 'עדכון רשומה');
      edit.setAttribute('data-edit-id', e.id);
      edit.innerHTML = App.icon('pencil', 'h-5 w-5');
      edit.addEventListener('click', function () { openEdit(e, root); });
      card.appendChild(edit);

      var del = el('button', CLS.delBtn);
      del.setAttribute('aria-label', 'מחק רשומה');
      del.innerHTML = App.icon('trash2', 'h-5 w-5');
      del.addEventListener('click', function () {
        App.store.remove(e.id);
        App.toast('הרשומה נמחקה', { action: { label: 'ביטול', onClick: function () { App.store.restore(e); } } });
      });
      card.appendChild(del);

      li.appendChild(card);
      ul.appendChild(li);
    });
    return ul;
  }

  // "load more": days (with events) rendered at first / added per click
  var INITIAL_DAYS = 3;
  var MORE_DAYS = 7;

  function render(root, state) {
    var events = App.store.events()
      .filter(function (e) { return e.type !== 'sleep' && !(e.type === 'custom' && e.subtype === 'drops'); }) // drops live only on the Today page
      .sort(function (a, b) { return b.timestamp - a.timestamp; });
    var groups = new Map();
    events.forEach(function (e) {
      var k = App.dayKey(e.timestamp);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(e);
    });

    var wrap = el('div', CLS.root);
    var header = el('header', CLS.header);
    header.appendChild(el('h1', CLS.h1, 'היסטוריה'));
    header.appendChild(el('p', CLS.sub, 'כל מה שרשמת, החדש ביותר קודם.'));
    wrap.appendChild(header);

    if (events.length === 0) {
      wrap.appendChild(el('div', CLS.empty, 'עוד לא נרשם כלום. עברי ללשונית היומן כדי לרשום את האירוע הראשון.'));
    }

    var keys = Array.from(groups.keys());
    var shown = keys.slice(0, state.days);
    if (shown.length) wrap.appendChild(legend());
    var feeds = App.feedings(events);
    shown.forEach(function (key, i) {
      var list = groups.get(key);
      var open = state.open.has(key);
      var sec = el('section', 'history-day');
      var head = el('button', 'history-day-head');
      head.type = 'button';
      head.setAttribute('aria-expanded', open ? 'true' : 'false');
      head.setAttribute('data-day', key);
      if (i === state.focusIndex) head.setAttribute('data-focus', '');
      head.appendChild(el('h2', 'history-day-title', dayHeading(key)));
      head.appendChild(el('span', 'history-day-toggle', open ? 'הסתרת פירוט' : 'פירוט'));
      head.addEventListener('click', function () {
        if (state.open.has(key)) state.open.delete(key); else state.open.add(key);
        state.refocusDay = key;
        render(root, state);
      });
      sec.appendChild(head);
      sec.appendChild(ribbon(key, list, feeds));
      sec.appendChild(summary(key, list, feeds));
      if (open) sec.appendChild(buildList(list, root));
      wrap.appendChild(sec);
    });

    var rest = keys.length - shown.length;
    if (rest > 0) {
      var more = el('button', 'history-more');
      more.type = 'button';
      more.setAttribute('data-history-more', '');
      more.appendChild(document.createTextNode('הצג עוד '));
      more.appendChild(el('span', 'history-more-hint', '(' + (rest === 1 ? 'יום אחד נוסף' : rest + ' ימים נוספים') + ')'));
      more.addEventListener('click', function () {
        state.focusIndex = shown.length; // first newly revealed day
        state.days = shown.length + MORE_DAYS;
        render(root, state);
      });
      wrap.appendChild(more);
    }

    // keep focus on "load more" across store re-renders
    var hadMoreFocus = !!(document.activeElement && document.activeElement.hasAttribute &&
      document.activeElement.hasAttribute('data-history-more') && root.contains(document.activeElement));
    root.replaceChildren(wrap);
    if (state.focusIndex != null) {
      var target = wrap.querySelector('.history-day-head[data-focus]');
      state.focusIndex = null;
      if (target) target.focus();
    } else if (state.refocusDay) {
      var hb = wrap.querySelector('.history-day-head[data-day="' + state.refocusDay + '"]');
      state.refocusDay = null;
      if (hb) hb.focus({ preventScroll: true });
    } else if (hadMoreFocus) {
      var b = wrap.querySelector('[data-history-more]');
      if (b) b.focus({ preventScroll: true });
    }
  }

  App.registerPage('/history', {
    title: 'היסטוריה — יומן תינוק',
    mount: function (root) {
      var state = { days: INITIAL_DAYS, focusIndex: null, open: new Set([App.dayKey(Date.now())]), refocusDay: null }; // kept while mounted (today starts expanded)
      render(root, state);
      var unsub = App.store.subscribe(function () { render(root, state); });
      return function () { unsub(); if (openDlg) openDlg.close(); };
    }
  });
})();
