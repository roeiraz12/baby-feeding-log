/* today.js — Today page (port of routes-*.js). Builds the DOM once and
   patches the dynamic parts in place, so clicks/focus survive the 1s tick. */
(function () {
  'use strict';
  var App = window.App;

  // Q(): original uses the browser default locale
  function Q(ts) { return new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }); }

  // Merged class string of shadcn <Button variant="ghost"> + the page's $ component (as rendered live)
  var BIG_BTN = 'whitespace-nowrap cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 hover:bg-accent hover:text-accent-foreground py-2 flex h-auto min-h-28 flex-col items-center justify-center gap-2 rounded-3xl px-4 text-lg font-semibold shadow-sm transition-transform active:scale-95';
  var H2 = 'flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground';
  var CHECKBOX = 'checkbox grid place-content-center peer shrink-0 rounded-sm border border-primary shadow cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground h-7 w-7';
  var SIDES = [
    { key: 'right', name: 'ימין', cls: 'bg-[var(--pastel-lavender)] text-[var(--pastel-lavender-fg)]' },
    { key: 'left', name: 'שמאל', cls: 'bg-[var(--pastel-rose)] text-[var(--pastel-rose-fg)]' }
  ];

  function mount(el) {
    var draft = ''; // N state: kept across dialog close, cleared on save
    var root = App.h(
      '<div class="space-y-6">' +
        '<header class="pt-2"><h1 class="text-3xl font-bold tracking-tight">היום</h1><p class="text-sm text-muted-foreground">לחצי פעם אחת לרישום. זהו.</p></header>' +
        '<div class="border text-card-foreground shadow grid grid-cols-3 gap-2 rounded-3xl border-none bg-secondary/60 p-4 text-center">' +
          [['nursing', 'הנקות'], ['wet', 'פיפי'], ['dirty', 'קקי']].map(function (c) {
            return '<div><div class="text-lg font-bold" data-count="' + c[0] + '">–</div><div class="text-[11px] uppercase tracking-wide text-muted-foreground">' + c[1] + '</div></div>';
          }).join('') +
        '</div>' +
        '<label for="vitamin-d" data-slot="vitamin" class="flex min-h-14 cursor-pointer items-center gap-3 border-b border-border py-3 font-semibold">' +
          '<button type="button" role="checkbox" aria-checked="false" data-state="unchecked" value="on" class="' + CHECKBOX + '" id="vitamin-d"></button><span>ויטמין D</span>' +
        '</label>' +
        '<div data-slot="banner" class="flex items-center justify-center gap-2 rounded-2xl bg-[var(--pastel-rose)]/50 py-2 text-sm font-medium">' +
          App.icon('timer', 'h-4 w-4') + '<span data-slot="banner-text"></span>' +
        '</div>' +
        '<section class="space-y-3">' +
          '<h2 class="' + H2 + '">' + App.icon('baby', 'h-4 w-4') + ' הנקה</h2>' +
          '<div class="grid grid-cols-2 gap-3">' +
            SIDES.map(function (s) {
              return '<button type="button" data-side="' + s.key + '" class="' + BIG_BTN + ' ' + s.cls + '" aria-label="הנקה ' + s.name + '">' + s.name + '<span class="text-xs font-normal opacity-70">שד</span></button>';
            }).join('') +
          '</div>' +
        '</section>' +
        '<section class="space-y-3">' +
          '<h2 class="' + H2 + '">' + App.icon('droplets', 'h-4 w-4') + ' חיתול</h2>' +
          '<div class="grid grid-cols-2 gap-3">' +
            '<button type="button" data-diaper="wet" class="' + BIG_BTN + ' bg-[var(--pastel-sky)] text-[var(--pastel-sky-fg)]">פיפי</button>' +
            '<button type="button" data-diaper="dirty" class="' + BIG_BTN + ' bg-[var(--pastel-sand)] text-[var(--pastel-sand-fg)]">קקי</button>' +
          '</div>' +
        '</section>' +
        '<button type="button" data-act="new" class="flex min-h-20 w-full items-center justify-center gap-2 rounded-3xl border-2 border-dashed border-border text-lg font-semibold text-muted-foreground transition-transform active:scale-95">' +
          App.icon('plus', 'h-5 w-5') + ' אירוע חדש</button>' +
      '</div>'
    );
    el.appendChild(root);

    var q = function (s) { return root.querySelector(s); };
    var counts = { nursing: q('[data-count=nursing]'), wet: q('[data-count=wet]'), dirty: q('[data-count=dirty]') };
    var vitamin = q('[data-slot=vitamin]');
    var banner = q('[data-slot=banner]');
    var bannerText = q('[data-slot=banner-text]');
    var sideBtns = {};
    SIDES.forEach(function (s) { sideBtns[s.key] = q('[data-side=' + s.key + ']'); });

    // conditional nodes: swap with a placeholder comment so position is kept
    function slot(node) {
      var ph = document.createComment('');
      return function (on) {
        if (on && !node.parentNode) ph.parentNode.replaceChild(node, ph);
        else if (!on && node.parentNode) node.parentNode.replaceChild(ph, node);
      };
    }
    var showVitamin = slot(vitamin);
    var showBanner = slot(banner);

    function U(evt, label) {
      var e = App.store.add(evt);
      App.toast(('נרשם: ' + label + ' בשעה ' + Q(e.timestamp)), { type: 'success' });
    }

    var bannerMode = null, timerState = {};
    function update() {
      var T = Date.now();
      var events = App.store.events();
      var active = App.store.activeNursing();
      var today = App.dayKey(T);
      var z = events.filter(function (e) { return App.dayKey(e.timestamp) === today; });
      var vals = {
        nursing: App.feedings(events).filter(function (f) { return App.dayKey(f.start) === today; }).length,
        wet: z.filter(function (e) { return e.type === 'diaper' && e.subtype === 'wet'; }).length,
        dirty: z.filter(function (e) { return e.type === 'diaper' && e.subtype === 'dirty'; }).length
      };
      Object.keys(counts).forEach(function (k) {
        var v = String(vals[k]);
        if (counts[k].textContent !== v) counts[k].textContent = v;
      });

      // vitamin D: hidden once marked for today
      showVitamin(!App.isToday(window.localStorage.getItem(App.KEYS.vitaminDay), T));

      // next-feed banner
      var L = App.lastNursing(events);
      var R = L ? L + App.FEED_INTERVAL - T : 0;
      showBanner(L > 0);
      if (L > 0) {
        var mode = R > 0 ? 'countdown' : 'overdue';
        if (mode !== bannerMode) {
          bannerMode = mode;
          bannerText.innerHTML = mode === 'countdown'
            ? 'הנקה הבאה בעוד <span class="font-mono tabular-nums"></span>'
            : 'עברו 3 שעות מההנקה האחרונה';
        }
        if (mode === 'countdown') {
          var t = App.fmtClock(R), sp = bannerText.firstElementChild;
          if (sp.textContent !== t) sp.textContent = t;
        }
      }

      // nursing buttons
      SIDES.forEach(function (s) {
        var b = sideBtns[s.key];
        var isActive = !!active && active.subtype === s.key;
        var disabled = !!active && !isActive;
        if (b.disabled !== disabled) b.disabled = disabled;
        var span = b.lastElementChild;
        if (isActive) {
          var txt = App.fmtClock(Math.min(App.NURSING_MAX, T - active.timestamp));
          if (timerState[s.key] !== 'timer') {
            timerState[s.key] = 'timer';
            span.className = 'font-mono text-2xl tabular-nums';
            span.setAttribute('dir', 'ltr');
          }
          if (span.textContent !== txt) span.textContent = txt;
        } else if (timerState[s.key] !== 'idle') {
          timerState[s.key] = 'idle';
          span.className = 'text-xs font-normal opacity-70';
          span.removeAttribute('dir');
          span.textContent = 'שד';
        }
      });
    }

    // --- interactions ---
    // Radix Checkbox ignores Enter (only Space/click toggles)
    q('#vitamin-d').addEventListener('keydown', function (e) { if (e.key === 'Enter') e.preventDefault(); });
    q('#vitamin-d').addEventListener('click', function (e) {
      e.preventDefault();
      var t = Date.now(), n = App.dayKey(t);
      App.store.add(App.vitaminEvent(t));
      window.localStorage.setItem(App.KEYS.vitaminDay, n);
      App.toast('ויטמין D סומן להיום', { type: 'success' });
      update();
    });

    SIDES.forEach(function (s) {
      sideBtns[s.key].addEventListener('click', function () {
        var r = App.store.toggleNursing(s.key);
        if (r === 'started') App.toast('הנקה — ' + s.name + ' התחילה בשעה ' + Q(Date.now()), { type: 'success' });
        if (r === 'ended') App.toast('הנקה — ' + s.name + ' הסתיימה', { type: 'success' });
      });
    });

    q('[data-diaper=wet]').addEventListener('click', function () {
      U({ type: 'diaper', subtype: 'wet', timestamp: Date.now() }, 'חיתול פיפי');
    });
    q('[data-diaper=dirty]').addEventListener('click', function () {
      U({ type: 'diaper', subtype: 'dirty', timestamp: Date.now() }, 'חיתול קקי');
    });

    var dlg = null;
    q('[data-act=new]').addEventListener('click', function () {
      var form = App.h(
        '<form class="space-y-4">' +
          '<input class="input" autofocus maxlength="80" placeholder="למשל: אמבטיה, ויטמין D">' +
          '<div class="dlg-footer"><button type="submit" class="btn-primary-lg" disabled>שמירה</button></div>' +
        '</form>'
      );
      var input = form.querySelector('input');
      var submit = form.querySelector('button[type=submit]');
      input.value = draft;
      submit.disabled = !draft.trim();
      input.addEventListener('input', function () {
        draft = input.value;
        submit.disabled = !draft.trim();
      });
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var t = draft.trim();
        if (!t) return;
        U({ type: 'custom', subtype: 'custom', timestamp: Date.now(), note: t }, t);
        draft = '';
        if (dlg) dlg.close();
      });
      dlg = App.openDialog({ title: 'אירוע חדש', content: form, onClose: function () { dlg = null; } });
    });

    update();
    var unsub = App.store.subscribe(update);
    var iv = setInterval(update, 1000);
    return function () {
      clearInterval(iv);
      unsub();
      if (dlg) dlg.close();
    };
  }

  App.registerPage('/', { title: 'יומן תינוק — הנקה, חיתולים וויטמין D', mount: mount });
})();
