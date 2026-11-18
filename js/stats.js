/* Stats page — port of the component at the end of stats-*.js (Mk + jk tile).
   The recharts BarChart is recreated as a hand-made responsive SVG. */
(function () {
  'use strict';

  var SVGNS = 'http://www.w3.org/2000/svg';

  // Merged (tailwind-merge) class strings exactly as the original renders them.
  var CLS = {
    root: 'space-y-6',
    header: 'pt-2',
    h1: 'text-3xl font-bold tracking-tight',
    sub: 'text-sm text-muted-foreground',
    warn: 'border shadow flex flex-row items-start gap-3 rounded-3xl border-none bg-[var(--pastel-sand)] p-4 text-[var(--pastel-sand-fg)]',
    warnText: 'min-w-0 text-sm',
    tiles: 'grid grid-cols-2 gap-3',
    tile: 'border text-card-foreground shadow gap-1 rounded-3xl border-none bg-secondary/60 p-4',
    tileLabel: 'text-xs uppercase tracking-wide text-muted-foreground',
    tileValue: 'text-2xl font-bold',
    tileHint: 'text-xs text-muted-foreground',
    card: 'border bg-card text-card-foreground shadow gap-3 rounded-3xl p-4',
    cardRow: 'border bg-card text-card-foreground shadow flex flex-row items-center gap-3 rounded-3xl p-4',
    cardTitle: 'text-sm font-semibold',
    split: 'flex h-3 overflow-hidden rounded-full bg-secondary',
    splitLeft: 'bg-[var(--pastel-rose)]',
    splitRight: 'flex-1 bg-[var(--pastel-lavender)]',
    splitLegend: 'flex justify-between text-xs text-muted-foreground',
    chartBox: 'h-48 w-full',
    schedTitle: 'flex items-center gap-2 text-sm font-semibold',
    muted: 'text-sm text-muted-foreground',
    mutedXs: 'text-xs text-muted-foreground',
    schedList: 'space-y-2',
    schedItem: 'flex items-center justify-between rounded-2xl bg-secondary/60 px-4 py-3',
    schedTime: 'font-medium',
    notifBody: 'min-w-0 flex-1',
    notifTitle: 'font-medium',
    switchBtn: 'switch peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input',
    switchThumb: 'switch-thumb pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0'
  };

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function svgEl(tag, attrs) {
    var n = document.createElementNS(SVGNS, tag);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  }

  // jk(): stat tile
  function tile(label, value, hint) {
    var c = el('div', CLS.tile);
    c.appendChild(el('p', CLS.tileLabel, label));
    c.appendChild(el('p', CLS.tileValue, value));
    if (hint) c.appendChild(el('p', CLS.tileHint, hint));
    return c;
  }

  /* ---------------- chart (recharts look-alike) ---------------- */

  // recharts getNiceTickValues([0, max], tickCount = 5, allowDecimals = true)
  function niceDomainMax(max) {
    var TICKS = 5;
    if (!(max > 0)) return 4; // single value 0 -> ticks 0..4
    function formatStep(rough, corr) {
      var digitCount = Math.floor(Math.log10(Math.abs(rough))) + 1;
      var dcv = Math.pow(10, digitCount);
      var ratio = rough / dcv;
      var scale = digitCount !== 1 ? 0.05 : 0.1;
      var amend = (Math.ceil(ratio / scale) + corr) * scale;
      return amend * dcv;
    }
    for (var corr = 0; corr < 50; corr++) {
      var step = formatStep(max / (TICKS - 1), corr);
      var up = Math.ceil(+(max / step).toFixed(10));
      if (up + 1 <= TICKS) return +(step * (TICKS - 1)).toFixed(10);
    }
    return max;
  }

  // recharts getRectanglePath with radius [6,6,0,0]
  function barPath(x, y, w, h) {
    var r = Math.min(6, Math.abs(w) / 2, Math.abs(h) / 2);
    var b = y + h;
    return 'M' + x + ',' + (y + r) +
      'A ' + r + ',' + r + ',0,0,1,' + (x + r) + ',' + y +
      'L ' + (x + w - r) + ',' + y +
      'A ' + r + ',' + r + ',0,0,1,' + (x + w) + ',' + (y + r) +
      'L ' + (x + w) + ',' + b + 'L ' + x + ',' + b + 'Z';
  }

  // Builds the chart into `box` (div.h-48.w-full). Returns cleanup.
  function buildChart(box, data, animate) {
    var M = 5, XAXIS_H = 30, TICK_OFFSET = 8;
    var wrap = el('div', 'chart-wrapper');
    wrap.style.cssText = 'position:relative;width:100%;height:100%;cursor:default;';
    box.appendChild(wrap);

    var tip = el('div', 'chart-tooltip');
    tip.style.cssText = 'visibility:hidden;pointer-events:none;position:absolute;top:0;left:0;z-index:1;' +
      'margin:0;padding:10px;background-color:#fff;border:1px solid #ccc;white-space:nowrap;';
    var tipLabel = el('p', 'chart-tooltip-label');
    tipLabel.style.margin = '0';
    var tipList = el('ul', 'chart-tooltip-items');
    tipList.style.cssText = 'padding:0;margin:0;list-style:none;';
    var tipItem = el('li', 'chart-tooltip-item');
    tipItem.style.cssText = 'display:block;padding-top:4px;padding-bottom:4px;color:var(--pastel-rose);';
    var tipName = el('span', 'chart-tooltip-item-name', 'הנקות');
    var tipSep = el('span', 'chart-tooltip-item-separator', ' : ');
    var tipValue = el('span', 'chart-tooltip-item-value');
    tipItem.appendChild(tipName);
    tipItem.appendChild(tipSep);
    tipItem.appendChild(tipValue);
    tipList.appendChild(tipItem);
    tip.appendChild(tipLabel);
    tip.appendChild(tipList);

    var maxVal = data.reduce(function (m, d) { return Math.max(m, d.nursing); }, 0);
    var domMax = niceDomainMax(maxVal);
    var geo = null, raf = 0, svg = null, cursor = null, bars = [];

    function draw(progress) {
      var W = wrap.clientWidth, H = wrap.clientHeight || 192;
      if (!W) return;
      var left = M, top = M, pw = W - 2 * M, bottom = H - M - XAXIS_H, ph = bottom - top;
      var band = pw / data.length;
      var offset = band * 0.1;
      var size = band - 2 * offset;
      if (size > 1) size = Math.floor(size);
      geo = { W: W, H: H, left: left, top: top, band: band, pw: pw, ph: ph, bottom: bottom };

      svg = svgEl('svg', { 'class': 'chart-surface', width: W, height: H, viewBox: '0 0 ' + W + ' ' + H });
      svg.style.cssText = 'width:100%;height:100%;display:block;overflow:visible;';

      var grid = svgEl('g', { 'class': 'chart-grid' });
      for (var i = 0; i <= 4; i++) {
        var gy = bottom - (ph * i) / 4;
        grid.appendChild(svgEl('line', {
          'class': 'chart-grid-line', 'stroke-dasharray': '3 3', opacity: '0.3', stroke: '#ccc', fill: 'none',
          x1: left, y1: gy, x2: left + pw, y2: gy
        }));
      }
      svg.appendChild(grid);

      cursor = svgEl('rect', { 'class': 'chart-cursor', x: 0, y: top + 0.5, width: band, height: ph - 1, fill: '#ccc', opacity: '0.1', 'pointer-events': 'none' });
      cursor.style.visibility = 'hidden';
      svg.appendChild(cursor);

      var axis = svgEl('g', { 'class': 'chart-x-axis' });
      data.forEach(function (d, idx) {
        var cx = left + band * idx + band / 2;
        var t = svgEl('text', {
          'class': 'chart-tick', x: cx, y: bottom + TICK_OFFSET, 'font-size': '12', 'text-anchor': 'middle', fill: '#666', stroke: 'none'
        });
        var ts = svgEl('tspan', { x: cx, dy: '0.71em' });
        ts.textContent = d.label;
        t.appendChild(ts);
        axis.appendChild(t);
      });
      svg.appendChild(axis);

      var g = svgEl('g', { 'class': 'chart-bars' });
      bars = data.map(function (d, idx) {
        var p = svgEl('path', { 'class': 'chart-bar', fill: 'var(--pastel-rose)', name: 'הנקות' });
        g.appendChild(p);
        return { p: p, x: left + band * idx + offset, w: size, h: domMax ? (d.nursing / domMax) * ph : 0 };
      });
      svg.appendChild(g);
      setBars(progress);

      wrap.replaceChildren(svg, tip);
    }

    function setBars(progress) {
      bars.forEach(function (b) {
        var h = b.h * progress;
        if (h <= 0) { b.p.removeAttribute('d'); return; }
        b.p.setAttribute('d', barPath(b.x, geo.bottom - h, b.w, h));
      });
    }

    function hideTip() {
      tip.style.visibility = 'hidden';
      if (cursor) cursor.style.visibility = 'hidden';
    }
    function onMove(ev) {
      if (!geo) return;
      var r = wrap.getBoundingClientRect();
      var mx = ev.clientX - r.left, my = ev.clientY - r.top;
      if (mx < geo.left || mx > geo.left + geo.band * data.length || my < geo.top || my > geo.bottom) { hideTip(); return; }
      var idx = Math.min(data.length - 1, Math.max(0, Math.floor((mx - geo.left) / geo.band)));
      var d = data[idx];
      cursor.setAttribute('x', geo.left + geo.band * idx);
      cursor.style.visibility = 'visible';
      tipLabel.textContent = d.label;
      tipValue.textContent = String(d.nursing);
      var wasVisible = tip.style.visibility === 'visible';
      if (!wasVisible) tip.style.transition = 'none';
      tip.style.visibility = 'visible';
      var cx = geo.left + geo.band * idx + geo.band / 2;
      var tw = tip.offsetWidth, th = tip.offsetHeight;
      // recharts getTooltipTranslateXY against the plot viewBox
      var tx = cx + 10 + tw > geo.left + geo.pw ? Math.max(cx - tw - 10, geo.left) : Math.max(cx + 10, geo.left);
      var ty = my + 10 + th > geo.top + geo.ph ? Math.max(my - th - 10, geo.top) : Math.max(my + 10, geo.top);
      tip.style.transform = 'translate(' + tx + 'px, ' + ty + 'px)';
      if (!wasVisible) { void tip.offsetWidth; tip.style.transition = 'transform 400ms'; }
    }

    wrap.addEventListener('pointermove', onMove);
    wrap.addEventListener('pointerdown', onMove);
    wrap.addEventListener('pointerleave', hideTip);

    function start() {
      if (!animate) { draw(1); return; }
      draw(0);
      var t0 = null, DUR = 400;
      var step = function (ts) {
        if (t0 == null) t0 = ts;
        var k = Math.min(1, (ts - t0) / DUR);
        var e = 1 - Math.pow(1 - k, 3);
        if (geo) setBars(e);
        if (k < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    }
    start();

    var lastW = wrap.clientWidth;
    var ro = new ResizeObserver(function () {
      var w = wrap.clientWidth;
      if (w && w !== lastW) { lastW = w; cancelAnimationFrame(raf); draw(1); }
    });
    ro.observe(wrap);

    return function () { ro.disconnect(); cancelAnimationFrame(raf); };
  }

  /* ---------------- notifications switch ---------------- */

  function alertsEnabled() {
    try { return localStorage.getItem(App.KEYS.alertsEnabled) === '1'; } catch (e) { return false; }
  }

  // C(): port of the original handler, including the server push registration.
  function onToggle(next, rerender) {
    if (!next) {
      return App.push.sync(false).then(function () {
        localStorage.setItem(App.KEYS.alertsEnabled, '0');
        localStorage.removeItem(App.KEYS.pushEnabled);
        rerender();
      }, function (err) {
        App.toast(err instanceof Error ? err.message : 'ביטול ההתראות נכשל', { type: 'error' });
      });
    }
    if (typeof Notification === 'undefined') {
      App.toast('התראות אינן זמינות כאן. באייפון יש להוסיף את האתר למסך הבית ולפתוח אותו משם.', { type: 'error' });
      return Promise.resolve();
    }
    if (window.top !== window.self && Notification.permission !== 'granted') {
      App.toast('פתחי את האפליקציה בלשונית נפרדת כדי לאפשר התראות.', { type: 'error' });
      return Promise.resolve();
    }
    var perm = Notification.permission === 'granted'
      ? Promise.resolve('granted')
      : new Promise(function (res) {
          var p = Notification.requestPermission(res);
          if (p && p.then) p.then(res, function () { res('denied'); });
        });
    return perm.then(function (r) {
      if (r !== 'granted') {
        App.toast('ההתראות חסומות בהגדרות הדפדפן.', { type: 'error' });
        return;
      }
      return App.push.enable().then(function () {
        localStorage.setItem(App.KEYS.alertsEnabled, '1');
        rerender();
        App.toast('התראות יומיות מופעלות גם כשהאפליקציה סגורה.', { type: 'success' });
      }, function (err) {
        App.toast(err instanceof Error ? err.message : 'הפעלת התראות ברקע נכשלה', { type: 'error' });
      });
    });
  }

  /* ---------------- page ---------------- */

  function render(root, state) {
    if (!state.alive) return; // e.g. a permission prompt resolved after leaving the page
    if (state.chartCleanup) { state.chartCleanup(); state.chartCleanup = null; }
    var hadFocus = !!document.activeElement && document.activeElement.classList.contains('switch') && root.contains(document.activeElement);
    var events = App.store.events();
    var now = state.now;
    var v = App.dailyStats(events);
    var median = App.medianIntervalMin(events);
    var feeds = App.predictFeeds(events, Date.now());
    var warnings = App.diaperWarnings(events, now);
    var counts = App.diaperCounts(events, now);
    var total = v.leftCount + v.rightCount;
    var leftPct = total ? Math.round((v.leftCount / total) * 100) : 50;

    var wrap = el('div', CLS.root);

    var header = el('header', CLS.header);
    header.appendChild(el('h1', CLS.h1, 'סטטיסטיקה'));
    header.appendChild(el('p', CLS.sub, v.days > 0 ? 'מבוסס על ' + v.days + ' ימים של רישומים.' : 'רשמי מספר אירועים כדי לראות מגמות.'));
    wrap.appendChild(header);

    if (warnings.length > 0) {
      var w = el('div', CLS.warn);
      w.insertAdjacentHTML('beforeend', App.icon('triangleAlert', 'mt-0.5 h-5 w-5 shrink-0'));
      var wt = el('div', CLS.warnText);
      warnings.forEach(function (m) { wt.appendChild(el('p', null, m)); });
      w.appendChild(wt);
      wrap.appendChild(w);
    }

    var tiles = el('div', CLS.tiles);
    tiles.appendChild(tile('פיפי היום', counts.wet + ' / 6', counts.wet >= 6 ? 'היעד היומי הושג' : 'יעד יומי: לפחות 6'));
    tiles.appendChild(tile('קקי היום', counts.dirty + ' / 3', counts.dirty >= 3 ? 'היעד היומי הושג' : 'יעד יומי: לפחות 3'));
    tiles.appendChild(tile('הנקות / יום', String(v.avgNursing), 'ממוצע'));
    wrap.appendChild(tiles);

    var lr = el('div', CLS.card);
    lr.appendChild(el('p', CLS.cardTitle, 'שמאל מול ימין'));
    var bar = el('div', CLS.split);
    var lpart = el('div', CLS.splitLeft);
    lpart.style.width = leftPct + '%';
    bar.appendChild(lpart);
    bar.appendChild(el('div', CLS.splitRight));
    lr.appendChild(bar);
    var legend = el('div', CLS.splitLegend);
    legend.appendChild(el('span', null, 'שמאל · ' + v.leftCount));
    legend.appendChild(el('span', null, 'ימין · ' + v.rightCount));
    lr.appendChild(legend);
    wrap.appendChild(lr);

    var chartBox = null;
    if (v.daily.length > 0) {
      var cc = el('div', CLS.card);
      cc.appendChild(el('p', CLS.cardTitle, '7 ימים אחרונים'));
      chartBox = el('div', CLS.chartBox);
      cc.appendChild(chartBox);
      wrap.appendChild(cc);
    }

    var sc = el('div', CLS.card);
    var st = el('p', CLS.schedTitle);
    st.innerHTML = App.icon('clock', 'h-4 w-4');
    st.appendChild(document.createTextNode(' לוח זמנים מוצע'));
    sc.appendChild(st);
    if (feeds.length === 0) {
      sc.appendChild(el('p', CLS.muted, 'רשמי עוד מספר הנקות וזמני הזנה צפויים יופיעו כאן.'));
    } else {
      var m = median || 0;
      sc.appendChild(el('p', CLS.mutedXs, 'בדרך כלל בערך ' + Math.floor(m / 60) + ' שעות ו-' + (m % 60) + ' דקות בין הזנות.'));
      var ul = el('ul', CLS.schedList);
      var todayKey = App.dayKey(Date.now());
      feeds.forEach(function (ts) {
        var li = el('li', CLS.schedItem);
        li.appendChild(el('span', CLS.schedTime, new Date(ts).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })));
        li.appendChild(el('span', CLS.mutedXs, App.dayKey(ts) === todayKey ? 'היום' : 'מחר'));
        ul.appendChild(li);
      });
      sc.appendChild(ul);
    }
    wrap.appendChild(sc);

    var nc = el('div', CLS.cardRow);
    nc.insertAdjacentHTML('beforeend', App.icon('bell', 'h-5 w-5 shrink-0 text-muted-foreground'));
    var nb = el('div', CLS.notifBody);
    nb.appendChild(el('p', CLS.notifTitle, 'התראות יומיות'));
    nb.appendChild(el('p', CLS.mutedXs, 'בסביבות 22:00 לפי שעון ישראל, גם כשהאפליקציה סגורה, רק אם נרשמו פחות מ־6 פיפי או מ־3 קקי.'));
    nc.appendChild(nb);
    var on = alertsEnabled();
    var sw = el('button', CLS.switchBtn);
    sw.type = 'button';
    sw.setAttribute('role', 'switch');
    sw.setAttribute('aria-checked', String(on));
    sw.setAttribute('data-state', on ? 'checked' : 'unchecked');
    sw.setAttribute('aria-label', 'התראות יומיות');
    sw.value = 'on';
    var thumb = el('span', CLS.switchThumb);
    thumb.setAttribute('data-state', on ? 'checked' : 'unchecked');
    sw.appendChild(thumb);
    sw.addEventListener('click', function () {
      if (state.toggling) return; // permission prompt still open
      state.toggling = true;
      var done = function () { state.toggling = false; };
      onToggle(!on, function () { render(root, state); }).then(done, done);
    });
    nc.appendChild(sw);
    wrap.appendChild(nc);

    root.replaceChildren(wrap);
    if (hadFocus) sw.focus({ preventScroll: true });
    if (chartBox) {
      state.chartCleanup = buildChart(chartBox, v.daily, !state.animated);
      state.animated = true;
    }
  }

  App.registerPage('/stats', {
    title: 'סטטיסטיקה ולוח זמנים מוצע — יומן תינוק',
    mount: function (root) {
      var state = { now: Date.now(), animated: false, chartCleanup: null, alive: true, toggling: false };
      render(root, state);
      var unsub = App.store.subscribe(function () { render(root, state); });
      var iv = setInterval(function () { state.now = Date.now(); render(root, state); }, 6e4);
      return function () {
        state.alive = false;
        unsub();
        clearInterval(iv);
        if (state.chartCleanup) state.chartCleanup();
      };
    }
  });
})();
