/* Stats page — port of the component at the end of stats-*.js (Mk + jk tile).
   The recharts BarChart is recreated as a hand-made responsive SVG. */
(function () {
  'use strict';
  var App = window.App;

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
    // In RTL the first flex child sits on the RIGHT: ימין first, שמאל second, so each
    // side shows up on its own side of the screen (matching the Today page buttons).
    split: 'stats-split',
    splitRight: 'stats-split-seg stats-split-right',
    splitLeft: 'stats-split-seg stats-split-left',
    splitLegend: 'stats-split-legend',
    chartBox: 'stats-chart h-48 w-full',
    schedTitle: 'flex items-center gap-2 text-sm font-semibold',
    muted: 'text-sm text-muted-foreground',
    mutedXs: 'text-xs text-muted-foreground',
    schedList: 'space-y-2',
    schedItem: 'flex items-center justify-between rounded-2xl bg-secondary/60 px-4 py-3',
    schedTime: 'font-medium',
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

  // Diaper tile with a calm progress bar toward today's goal (`kind`: 'wet' | 'dirty').
  function goalTile(label, kind, count, goal) {
    var done = count >= goal;
    var c = el('div', CLS.tile + ' stats-goal stats-goal-' + kind + (done ? ' is-done' : ''));
    c.appendChild(el('p', CLS.tileLabel, label));
    // dir=ltr on an inline span so "2 / 3" isn't flipped to "3 / 2" by RTL bidi, while the line stays right-aligned
    var val = el('p', CLS.tileValue);
    var num = el('span', null, count + ' / ' + goal);
    num.setAttribute('dir', 'ltr');
    val.appendChild(num);
    c.appendChild(val);
    var track = el('div', 'stats-progress');
    track.setAttribute('role', 'progressbar');
    track.setAttribute('aria-label', label);
    track.setAttribute('aria-valuemin', '0');
    track.setAttribute('aria-valuemax', String(goal));
    track.setAttribute('aria-valuenow', String(Math.min(count, goal)));
    var fill = el('span', 'stats-progress-fill');
    fill.style.width = Math.min(100, Math.round((count / goal) * 100)) + '%';
    track.appendChild(fill);
    c.appendChild(track);
    var hint = el('p', CLS.tileHint + ' stats-goal-hint');
    if (done) hint.insertAdjacentHTML('beforeend', App.icon('check', 'stats-goal-check'));
    hint.appendChild(document.createTextNode(done ? 'היעד היומי הושג' : 'יעד יומי: לפחות ' + goal));
    c.appendChild(hint);
    return c;
  }

  // Average total nursing time per finished feeding (both sides) over the last 7 days.
  function avgFeedingMs(events, now) {
    var from = now - 7 * 864e5, sum = 0, n = 0;
    App.feedings(events).forEach(function (f) {
      if (f.start < from) return;
      var open = f.events.some(function (e) { return e.endTimestamp == null && e.durationMs == null; });
      if (open) return;
      var ms = f.events.reduce(function (s, e) {
        var d = e.durationMs != null ? e.durationMs : e.endTimestamp - e.timestamp;
        return s + (d > 0 ? d : 0);
      }, 0);
      if (ms <= 0) return;
      sum += ms; n += 1;
    });
    return n ? sum / n : null;
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

  /* Builds a (stacked) bar chart into `box` (div.h-48.w-full). Returns cleanup.
     opts = {
       data:   [{label, ...}],
       series: [{key, name, cls}]  — stacked bottom-up in this order; `cls` = 'rose'|'sky'|'sand'
               (fill + label colours live in css/stats.css, keyed by .stats-series-<cls>),
       animate: bool               — bar-grow on first render (skipped with prefers-reduced-motion)
     }
     Values are drawn on the bars (phones have no hover): one series → the value above the bar;
     several series → each segment's value inside it when it fits, the day total above. */
  function buildChart(box, opts) {
    var data = opts.data, series = opts.series;
    var M = 5, TOP_PAD = 18, XAXIS_H = 30, TICK_OFFSET = 8, MIN_INSIDE = 16;
    var stacked = series.length > 1;
    var wrap = el('div', 'chart-wrapper');
    box.appendChild(wrap);

    var tip = el('div', 'chart-tooltip');
    tip.style.visibility = 'hidden';
    var tipLabel = el('p', 'chart-tooltip-label');
    var tipList = el('ul', 'chart-tooltip-items');
    var tipValues = series.map(function (s) {
      var li = el('li', 'chart-tooltip-item stats-series-' + s.cls);
      li.appendChild(el('span', 'chart-tooltip-item-name', s.name));
      li.appendChild(el('span', 'chart-tooltip-item-separator', ' : '));
      var v = el('span', 'chart-tooltip-item-value');
      li.appendChild(v);
      tipList.appendChild(li);
      return v;
    });
    tip.appendChild(tipLabel);
    tip.appendChild(tipList);

    function total(d) { return series.reduce(function (s, x) { return s + (d[x.key] || 0); }, 0); }
    var maxVal = data.reduce(function (m, d) { return Math.max(m, total(d)); }, 0);
    var domMax = niceDomainMax(maxVal);
    var geo = null, raf = 0, svg = null, cursor = null, bars = [], labels = null;

    function text(cls, x, y, value) {
      var t = svgEl('text', { 'class': cls, x: x, y: y, 'text-anchor': 'middle' });
      t.textContent = String(value);
      return t;
    }

    function draw(progress) {
      var W = wrap.clientWidth, H = wrap.clientHeight || 192;
      if (!W) return;
      var left = M, top = M + TOP_PAD, pw = W - 2 * M, bottom = H - M - XAXIS_H, ph = bottom - top;
      var band = pw / data.length;
      var offset = band * (stacked ? 0.18 : 0.1);
      var size = band - 2 * offset;
      if (size > 1) size = Math.floor(size);
      geo = { W: W, H: H, left: left, top: top, band: band, pw: pw, ph: ph, bottom: bottom };

      svg = svgEl('svg', { 'class': 'chart-surface', width: W, height: H, viewBox: '0 0 ' + W + ' ' + H, 'aria-hidden': 'true' });

      var grid = svgEl('g', { 'class': 'chart-grid' });
      for (var i = 0; i <= 4; i++) {
        var gy = bottom - (ph * i) / 4;
        grid.appendChild(svgEl('line', { x1: left, y1: gy, x2: left + pw, y2: gy }));
      }
      svg.appendChild(grid);

      cursor = svgEl('rect', { 'class': 'chart-cursor', x: 0, y: top + 0.5, width: band, height: ph - 1 });
      cursor.style.visibility = 'hidden';
      svg.appendChild(cursor);

      var axis = svgEl('g', { 'class': 'chart-x-axis' });
      data.forEach(function (d, idx) {
        var cx = left + band * idx + band / 2;
        var t = svgEl('text', { 'class': 'chart-tick', x: cx, y: bottom + TICK_OFFSET, 'text-anchor': 'middle' });
        var ts = svgEl('tspan', { x: cx, dy: '0.71em' });
        ts.textContent = d.label;
        t.appendChild(ts);
        axis.appendChild(t);
      });
      svg.appendChild(axis);

      var g = svgEl('g', { 'class': 'chart-bars' });
      labels = svgEl('g', { 'class': 'stats-chart-values' });
      bars = [];
      data.forEach(function (d, idx) {
        var x = left + band * idx + offset, cx = x + size / 2, base = 0, segs = [];
        series.forEach(function (s) {
          var v = d[s.key] || 0;
          if (v > 0) segs.push({ s: s, v: v, y0: (base / domMax) * ph, y1: ((base + v) / domMax) * ph });
          base += v;
        });
        segs.forEach(function (seg, k) {
          var p = svgEl('path', { 'class': 'chart-bar stats-series-' + seg.s.cls });
          g.appendChild(p);
          bars.push({ p: p, x: x, w: size, y0: seg.y0, y1: seg.y1, round: k === segs.length - 1 });
          if (stacked && seg.y1 - seg.y0 >= MIN_INSIDE) {
            labels.appendChild(text('stats-chart-value-in stats-series-' + seg.s.cls, cx, bottom - (seg.y0 + seg.y1) / 2 + 4, seg.v));
          }
        });
        var tot = total(d);
        if (tot > 0) labels.appendChild(text('stats-chart-value', cx, bottom - (tot / domMax) * ph - 5, tot));
      });
      svg.appendChild(g);
      svg.appendChild(labels);
      setBars(progress);

      wrap.replaceChildren(svg, tip);
    }

    function setBars(progress) {
      bars.forEach(function (b) {
        var y0 = b.y0 * progress, h = (b.y1 - b.y0) * progress;
        if (h <= 0) { b.p.removeAttribute('d'); return; }
        var y = geo.bottom - y0 - h;
        b.p.setAttribute('d', b.round ? barPath(b.x, y, b.w, h) : 'M' + b.x + ',' + y + 'h' + b.w + 'v' + h + 'h' + (-b.w) + 'Z');
      });
      if (labels) labels.style.opacity = progress >= 1 ? '1' : String(Math.max(0, progress * 2 - 1));
    }

    function hideTip() {
      tip.style.visibility = 'hidden';
      if (cursor) cursor.style.visibility = 'hidden';
    }
    function onMove(ev) {
      if (!geo) return;
      var r = wrap.getBoundingClientRect();
      var mx = ev.clientX - r.left, my = ev.clientY - r.top;
      if (mx < geo.left || mx > geo.left + geo.band * data.length || my < geo.top - TOP_PAD || my > geo.bottom) { hideTip(); return; }
      var idx = Math.min(data.length - 1, Math.max(0, Math.floor((mx - geo.left) / geo.band)));
      var d = data[idx];
      cursor.setAttribute('x', geo.left + geo.band * idx);
      cursor.style.visibility = 'visible';
      tipLabel.textContent = d.label;
      series.forEach(function (s, k) { tipValues[k].textContent = String(d[s.key] || 0); });
      var wasVisible = tip.style.visibility === 'visible';
      if (!wasVisible) tip.style.transition = 'none';
      tip.style.visibility = 'visible';
      var cx = geo.left + geo.band * idx + geo.band / 2;
      var tw = tip.offsetWidth, th = tip.offsetHeight;
      // recharts getTooltipTranslateXY against the plot viewBox
      var tx = cx + 10 + tw > geo.left + geo.pw ? Math.max(cx - tw - 10, geo.left) : Math.max(cx + 10, geo.left);
      var ty = my + 10 + th > geo.top + geo.ph ? Math.max(my - th - 10, geo.top) : Math.max(my + 10, geo.top);
      tip.style.transform = 'translate(' + tx + 'px, ' + ty + 'px)';
      if (!wasVisible && !reducedMotion()) { void tip.offsetWidth; tip.style.transition = 'transform 400ms'; }
    }

    wrap.addEventListener('pointermove', onMove);
    wrap.addEventListener('pointerdown', onMove);
    wrap.addEventListener('pointerleave', hideTip);

    function start() {
      if (!opts.animate || reducedMotion()) { draw(1); return; }
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

  function reducedMotion() {
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
  }

  // Card with a title, the chart box and an HTML legend (series swatches + the `*` note).
  function chartCard(title, series, data) {
    var cc = el('div', CLS.card);
    cc.appendChild(el('p', CLS.cardTitle, title));
    var box = el('div', CLS.chartBox);
    var summary = data.map(function (d) {
      return d.label + ': ' + series.map(function (s) { return s.name + ' ' + (d[s.key] || 0); }).join(', ');
    }).join('; ');
    box.setAttribute('role', 'img');
    box.setAttribute('aria-label', title + '. ' + summary);
    cc.appendChild(box);
    var partial = data.some(function (d) { return d.partial; });
    if (series.length > 1 || partial) {
      var lg = el('div', 'stats-chart-legend');
      if (series.length > 1) {
        series.forEach(function (s) {
          var it = el('span', 'stats-legend-item');
          it.appendChild(el('span', 'stats-swatch stats-series-' + s.cls));
          it.appendChild(document.createTextNode(s.name));
          lg.appendChild(it);
        });
      }
      if (partial) lg.appendChild(el('span', 'stats-legend-note', '* יום חלקי (שבת)'));
      cc.appendChild(lg);
    }
    return { card: cc, box: box, key: title, data: data, series: series };
  }

  /* ---------------- page ---------------- */

  function render(root, state) {
    if (!state.alive) return; // e.g. a permission prompt resolved after leaving the page
    cleanupCharts(state);
    var events = App.store.events();
    var now = state.now;
    var v = App.dailyStats(events);
    var median = App.medianIntervalMin(events);
    var feeds = App.predictFeeds(events, Date.now());
    // The goal-warning card is only meaningful in the evening (diaperWarnings is already [] on Shabbat).
    var warnings = new Date(now).getHours() >= App.WARNING_FROM_HOUR ? App.diaperWarnings(events, now) : [];
    var counts = App.diaperCounts(events, now);
    var goals = App.goals();
    var total = v.leftCount + v.rightCount;
    var rightPct = total ? Math.round((v.rightCount / total) * 100) : 0;
    var leftPct = total ? 100 - rightPct : 0;
    var avgMs = avgFeedingMs(events, now);

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
    tiles.appendChild(goalTile('פיפי היום', 'wet', counts.wet, goals.wet));
    tiles.appendChild(goalTile('קקי היום', 'dirty', counts.dirty, goals.dirty));
    tiles.appendChild(tile('הנקות / יום', String(v.avgNursing), 'ממוצע'));
    tiles.appendChild(avgMs != null
      ? tile('משך הנקה ממוצע', App.fmtDuration(avgMs), 'לכל הנקה (שני הצדדים)')
      : tile('משך הנקה ממוצע', '–', 'יופיע אחרי הנקות שהסתיימו'));
    wrap.appendChild(tiles);

    var lr = el('div', CLS.card);
    lr.appendChild(el('p', CLS.cardTitle, 'שמאל מול ימין'));
    var bar = el('div', CLS.split + (total ? '' : ' is-empty'));
    bar.setAttribute('role', 'img');
    bar.setAttribute('aria-label', total
      ? 'ימין ' + v.rightCount + ' (' + rightPct + '%), שמאל ' + v.leftCount + ' (' + leftPct + '%)'
      : 'עדיין אין הנקות');
    // First child in RTL → right side of the screen. Flex-grow by count; empty sides are omitted.
    [[CLS.splitRight, v.rightCount], [CLS.splitLeft, v.leftCount]].forEach(function (p) {
      if (!p[1]) return;
      var seg = el('div', p[0]);
      seg.style.flex = p[1] + ' 1 0';
      bar.appendChild(seg);
    });
    lr.appendChild(bar);
    var legend = el('div', CLS.splitLegend);
    function legendItem(cls, name, count, pct) {
      var it = el('span', 'stats-legend-item');
      it.appendChild(el('span', 'stats-swatch ' + cls));
      it.appendChild(document.createTextNode(name + ' · ' + count + (total ? ' (' + pct + '%)' : '')));
      return it;
    }
    legend.appendChild(legendItem('stats-split-right', 'ימין', v.rightCount, rightPct));
    legend.appendChild(legendItem('stats-split-left', 'שמאל', v.leftCount, leftPct));
    lr.appendChild(legend);
    if (!total) lr.appendChild(el('p', CLS.mutedXs, 'עדיין אין הנקות רשומות.'));
    wrap.appendChild(lr);

    var charts = [];
    function sumOf(key) { return v.daily.reduce(function (s, d) { return s + (d[key] || 0); }, 0); }
    if (sumOf('nursing') > 0) {
      var nc1 = chartCard('הנקות — 7 ימים אחרונים', [{ key: 'nursing', name: 'הנקות', cls: 'rose' }], v.daily);
      wrap.appendChild(nc1.card);
      charts.push(nc1);
    }
    if (sumOf('wet') + sumOf('dirty') > 0) {
      var dc = chartCard('חיתולים — 7 ימים אחרונים', [
        { key: 'wet', name: 'פיפי', cls: 'sky' },
        { key: 'dirty', name: 'קקי', cls: 'sand' }
      ], v.daily);
      wrap.appendChild(dc.card);
      charts.push(dc);
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
      sc.appendChild(el('p', CLS.mutedXs, 'בדרך כלל בערך ' + App.hoursPhrase(m) + ' בין הזנות.'));
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

    root.replaceChildren(wrap);
    charts.forEach(function (c) {
      state.chartCleanups.push(buildChart(c.box, { data: c.data, series: c.series, animate: !state.animated[c.key] }));
      state.animated[c.key] = true; // grow only the first time each chart appears on this visit
    });
  }

  function cleanupCharts(state) {
    state.chartCleanups.forEach(function (fn) { fn(); });
    state.chartCleanups = [];
  }

  App.registerPage('/stats', {
    title: 'סטטיסטיקה ולוח זמנים מוצע — יומן תינוק',
    mount: function (root) {
      var state = { now: Date.now(), animated: {}, chartCleanups: [], alive: true, toggling: false };
      render(root, state);
      var unsub = App.store.subscribe(function () { render(root, state); });
      var iv = setInterval(function () { state.now = Date.now(); render(root, state); }, 6e4);
      return function () {
        state.alive = false;
        unsub();
        clearInterval(iv);
        cleanupCharts(state);
      };
    }
  });
})();
