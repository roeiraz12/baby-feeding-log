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
  var GOAL_NAMES = { wet: 'פיפי', dirty: 'קקי' };
  var UNDO_MS = 6000;

  function minutesPhrase(min) {
    if (min < 1) return 'פחות מדקה';
    if (min === 1) return 'דקה';
    return min + ' דקות';
  }

  function mount(el) {
    var draft = ''; // N state: kept across dialog close, cleared on save
    var root = App.h(
      '<div class="space-y-6">' +
        '<header class="pt-2"><h1 class="text-3xl font-bold tracking-tight">היום</h1><p class="text-sm text-muted-foreground">לחצי פעם אחת לרישום. זהו.</p></header>' +
        '<div class="border text-card-foreground shadow grid grid-cols-3 gap-2 rounded-3xl border-none bg-secondary/60 p-4 text-center">' +
          '<div class="today-count"><div class="text-lg font-bold" data-count="nursing">–</div><div class="text-[11px] uppercase tracking-wide text-muted-foreground">הנקות</div></div>' +
          ['wet', 'dirty'].map(function (k) {
            return '<div class="today-count today-goal" data-goal="' + k + '">' +
              '<span class="sr-only" data-goal-sr></span>' +
              '<div class="today-goal-num text-lg font-bold" dir="ltr" aria-hidden="true">' +
                '<span data-count="' + k + '">–</span><span class="today-goal-of">/<span data-goal-target></span></span>' +
                '<span class="today-goal-check">' + App.icon('check', '') + '</span>' +
              '</div>' +
              '<div class="text-[11px] uppercase tracking-wide text-muted-foreground" aria-hidden="true">' + GOAL_NAMES[k] + '</div>' +
              '<div class="today-goal-bar" aria-hidden="true"><span data-goal-fill></span></div>' +
            '</div>';
          }).join('') +
        '</div>' +
        '<label for="vitamin-d" data-slot="vitamin" data-done="false" class="vitamin-row flex min-h-14 cursor-pointer items-center gap-3 border-b border-border py-3 font-semibold">' +
          '<button type="button" role="checkbox" aria-checked="false" data-state="unchecked" value="on" class="' + CHECKBOX + '" id="vitamin-d"></button><span class="vitamin-label">ויטמין D</span>' +
        '</label>' +
        '<div data-slot="banner" class="feed-banner" data-state="countdown">' +
          '<div class="feed-banner-row">' + App.icon('timer', 'h-4 w-4') + '<span data-slot="banner-text"></span></div>' +
          '<div class="feed-progress" role="progressbar" aria-label="הזמן שעבר מתחילת ההנקה האחרונה" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">' +
            '<span class="feed-progress-fill" data-slot="banner-fill"></span>' +
            '<span class="feed-progress-pct" data-slot="banner-pct" aria-hidden="true"></span>' +
          '</div>' +
        '</div>' +
        '<section class="space-y-3">' +
          '<h2 class="' + H2 + '">' + App.icon('baby', 'h-4 w-4') + ' הנקה</h2>' +
          '<div class="grid grid-cols-2 gap-3">' +
            SIDES.map(function (s) {
              return '<button type="button" data-side="' + s.key + '" class="' + BIG_BTN + ' ' + s.cls + '" aria-pressed="false" aria-describedby="nursing-desc-' + s.key + '">' +
                '<span class="sr-only">הנקה </span>' + s.name +
                '<span class="text-xs font-normal opacity-70" aria-hidden="true">שד</span></button>';
            }).join('') +
          '</div>' +
          SIDES.map(function (s) { return '<span id="nursing-desc-' + s.key + '" class="sr-only"></span>'; }).join('') +
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
    var goalEls = {};
    ['wet', 'dirty'].forEach(function (k) {
      var c = q('[data-goal=' + k + ']');
      goalEls[k] = { cell: c, sr: c.querySelector('[data-goal-sr]'), target: c.querySelector('[data-goal-target]'), fill: c.querySelector('[data-goal-fill]') };
    });
    var vitBtn = q('#vitamin-d');
    // today's vitamin-D events (fixed id vitamin-d-YYYY-MM-DD, or an older custom 'ויטמין D' note)
    function vitaminEventsToday(events, t) {
      var day = App.dayKey(t);
      return events.filter(function (x) {
        return x.id === 'vitamin-d-' + day ||
          (x.type === 'custom' && x.note === 'ויטמין D' && App.dayKey(x.timestamp) === day);
      });
    }
    var banner = q('[data-slot=banner]');
    var bannerText = q('[data-slot=banner-text]');
    var bannerBar = q('[role=progressbar]');
    var bannerFill = q('[data-slot=banner-fill]');
    var bannerPct = q('[data-slot=banner-pct]');
    var sideBtns = {}, sideDesc = {};
    SIDES.forEach(function (s) {
      sideBtns[s.key] = q('[data-side=' + s.key + ']');
      sideDesc[s.key] = root.querySelector('#nursing-desc-' + s.key);
    });

    // conditional nodes: swap with a placeholder comment so position is kept
    function slot(node) {
      var ph = document.createComment('');
      return function (on) {
        if (on && !node.parentNode) ph.parentNode.replaceChild(node, ph);
        else if (!on && node.parentNode) node.parentNode.replaceChild(ph, node);
      };
    }
    var showBanner = slot(banner);

    function setText(n, v) { if (n.textContent !== v) n.textContent = v; }
    function setAttr(n, a, v) { if (n.getAttribute(a) !== v) n.setAttribute(a, v); }

    // Success toast with a one-shot "ביטול" action
    function undoToast(msg, undo) {
      var used = false;
      App.toast(msg, {
        type: 'success',
        duration: UNDO_MS,
        action: {
          label: 'ביטול',
          onClick: function () {
            if (used) return;
            used = true;
            var res = undo(); // store writes re-render via subscribe
            App.toast(typeof res === 'string' ? res : 'בוטל');
          }
        }
      });
    }

    function U(evt, label) {
      var e = App.store.add(evt);
      undoToast('נרשם: ' + label + ' בשעה ' + Q(e.timestamp), function () { App.store.remove(e.id); });
    }

    var bannerMode = null, timerState = {}, descState = {};
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
      Object.keys(counts).forEach(function (k) { setText(counts[k], String(vals[k])); });

      // diaper goals: X/Y + thin bar, mint "done" state when reached
      var goals = App.goals();
      ['wet', 'dirty'].forEach(function (k) {
        var g = goalEls[k], goal = goals[k], v = vals[k], done = v >= goal;
        setText(g.target, String(goal));
        g.fill.style.width = Math.min(100, Math.round(v / goal * 100)) + '%';
        setAttr(g.cell, 'data-done', done ? 'true' : 'false');
        setText(g.sr, GOAL_NAMES[k] + ': ' + v + ' מתוך ' + goal + (done ? ', היעד הושג' : ''));
      });

      // vitamin D: always visible; checked (✓) when today's vitamin-D event exists.
      // Events are the source of truth (they sync between parents), not the local day key.
      var vitDone = vitaminEventsToday(events, T).length > 0;
      if (vitBtn.getAttribute('data-state') !== (vitDone ? 'checked' : 'unchecked')) {
        vitBtn.setAttribute('data-state', vitDone ? 'checked' : 'unchecked');
        vitBtn.setAttribute('aria-checked', vitDone ? 'true' : 'false');
        vitBtn.innerHTML = vitDone ? App.icon('check', 'h-4 w-4') : '';
        vitBtn.parentNode.setAttribute('data-done', vitDone ? 'true' : 'false'); // strikes the label through
      }

      // next-feed banner + progress bar (last feeding start → start + interval)
      var L = App.lastNursing(events);
      var interval = App.feedIntervalMs();
      var R = L ? L + interval - T : 0;
      showBanner(L > 0);
      if (L > 0) {
        var mode = R > 0 ? 'countdown' : 'overdue';
        var overdueText = App.feedOverdueText();
        if (mode !== bannerMode || (mode === 'overdue' && bannerText.textContent !== overdueText)) {
          bannerMode = mode;
          banner.setAttribute('data-state', mode);
          bannerText.innerHTML = mode === 'countdown'
            ? 'ההנקה הבאה בשעה <span class="tabular-nums" dir="ltr"></span> בערך'
            : App.esc(overdueText);
        }
        if (mode === 'countdown') setText(bannerText.firstElementChild, App.timeHM(L + interval));
        var frac = mode === 'overdue' ? 1 : Math.max(0, Math.min(1, (T - L) / interval));
        bannerFill.style.width = (frac * 100).toFixed(2) + '%';
        var pct = String(Math.floor(frac * 100));
        // the percent label rides at the end of the filled part; outside it while the fill is too short
        setText(bannerPct, mode === 'overdue' ? '' : pct + '%');
        bannerPct.style.left = (frac * 100).toFixed(2) + '%';
        setAttr(banner, 'data-pct-outside', frac < 0.14 ? 'true' : 'false');
        if (bannerBar.getAttribute('aria-valuenow') !== pct) {
          bannerBar.setAttribute('aria-valuenow', pct);
          bannerBar.setAttribute('aria-valuetext', mode === 'overdue'
            ? overdueText
            : 'עברו ' + pct + '% מהזמן עד ההנקה הבאה');
        }
      } else {
        bannerMode = null;
      }

      // nursing buttons
      SIDES.forEach(function (s) {
        var b = sideBtns[s.key];
        var isActive = !!active && active.subtype === s.key;
        var disabled = !!active && !isActive;
        if (b.disabled !== disabled) b.disabled = disabled;
        setAttr(b, 'aria-pressed', isActive ? 'true' : 'false');
        var span = b.lastElementChild;
        var elapsed = isActive ? Math.min(App.NURSING_MAX, T - active.timestamp) : 0;
        if (isActive) {
          var txt = App.fmtClock(elapsed);
          if (timerState[s.key] !== 'timer') {
            timerState[s.key] = 'timer';
            span.className = 'font-mono text-2xl tabular-nums';
            span.setAttribute('dir', 'ltr');
          }
          setText(span, txt);
        } else if (timerState[s.key] !== 'idle') {
          timerState[s.key] = 'idle';
          span.className = 'text-xs font-normal opacity-70';
          span.removeAttribute('dir');
          span.textContent = 'שד';
        }
        // description changes at most once a minute (and is not a live region)
        var desc = isActive ? 'פועלת ' + minutesPhrase(Math.floor(elapsed / 60000)) + ', לחצי לסיום'
          : disabled ? 'הצד השני פועל כרגע' : '';
        if (descState[s.key] !== desc) { descState[s.key] = desc; sideDesc[s.key].textContent = desc; }
      });
    }

    // --- interactions ---
    // Radix Checkbox ignores Enter (only Space/click toggles)
    q('#vitamin-d').addEventListener('keydown', function (e) { if (e.key === 'Enter') e.preventDefault(); });
    // un-marking removes every vitamin-D event of today and the local day key
    function clearVitaminToday(t) {
      vitaminEventsToday(App.store.events(), t).forEach(function (x) { App.store.remove(x.id); });
      window.localStorage.removeItem(App.KEYS.vitaminDay);
      App.store.reload();
    }
    function markVitamin(t) {
      var ev = App.store.add(App.vitaminEvent(t));
      window.localStorage.setItem(App.KEYS.vitaminDay, App.dayKey(t));
      return ev;
    }
    vitBtn.addEventListener('click', function (e) {
      e.preventDefault();
      var t = Date.now();
      var existing = vitaminEventsToday(App.store.events(), t);
      if (!existing.length) {
        markVitamin(t);
        undoToast('ויטמין D סומן להיום', function () { clearVitaminToday(Date.now()); });
      } else {
        clearVitaminToday(t);
        undoToast('הסימון של ויטמין D בוטל', function () { markVitamin(Date.now()); });
      }
      update();
    });

    SIDES.forEach(function (s) {
      sideBtns[s.key].addEventListener('click', function () {
        var before = App.store.activeNursing();
        var r = App.store.toggleNursing(s.key);
        if (r === 'started') {
          var started = App.store.activeNursing();
          var id = started && started.id;
          undoToast('הנקה — ' + s.name + ' התחילה בשעה ' + Q(Date.now()), function () {
            if (!id) return;
            if (window.localStorage.getItem(App.KEYS.active) === id) window.localStorage.removeItem(App.KEYS.active);
            App.store.remove(id);
          });
        } else if (r === 'ended') {
          var ended = before;
          undoToast('הנקה — ' + s.name + ' הסתיימה', function () {
            if (!ended || !App.store.events().some(function (e) { return e.id === ended.id; })) return 'לא ניתן לבטל';
            var now = Date.now();
            if (now >= ended.timestamp + App.NURSING_MAX) return 'עברו 15 דקות, ההנקה נשארה סגורה';
            var other = App.store.activeNursing();
            if (other && other.id !== ended.id) return 'הנקה אחרת פועלת, לא ניתן לבטל';
            // reopen: JSON drops the undefined fields, so the side becomes open again
            App.store.edit(ended.id, { endTimestamp: undefined, durationMs: undefined });
            window.localStorage.setItem(App.KEYS.active, ended.id);
            App.store.reload();
          });
        }
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
