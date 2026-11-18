/* History page — port of history-*.js (component I + edit dialog F). */
(function () {
  'use strict';

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

  function render(root) {
    var events = App.store.events()
      .filter(function (e) { return e.type !== 'sleep'; })
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

    groups.forEach(function (list, key) {
      var sec = el('section', CLS.section);
      sec.appendChild(el('h2', CLS.h2, dayHeading(key)));
      var ul = el('ul', CLS.ul);
      list.forEach(function (e) {
        var li = el('li');
        var card = el('div', CLS.row);
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
      sec.appendChild(ul);
      wrap.appendChild(sec);
    });

    root.replaceChildren(wrap);
  }

  App.registerPage('/history', {
    title: 'היסטוריה — יומן תינוק',
    mount: function (root) {
      render(root);
      var unsub = App.store.subscribe(function () { render(root); });
      return function () { unsub(); if (openDlg) openDlg.close(); };
    }
  });
})();
