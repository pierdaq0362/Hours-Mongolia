/* =========================================================================
   STATS TAB — work ratio vs schedule, weekly hours trend with 4-week
   forecast, and a day-of-week heatmap. All auto-computed from entries,
   holidays and shift settings (reuses computeExpectedHours/getOvertimeRange).
   ========================================================================= */
let statsPeriod = 'thisMonth';

function isoAddDays(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function shortDM(iso) { return iso.slice(8, 10) + '/' + iso.slice(5, 7); }

function renderWorkRatio() {
  const wrap = document.getElementById('ratio-rows');
  if (!wrap) return;
  wrap.innerHTML = '';
  PEOPLE.forEach(p => {
    const range = getOvertimeRange(statsPeriod, p);
    const { expected, recoveryDeduction } = computeExpectedHours(range.start, range.end, p);
    const target = expected + recoveryDeduction;
    const actual = sumHoursInRange(p, range.start, range.end);
    const pct = target > 0 ? (actual / target) * 100 : null;

    const row = document.createElement('div');
    row.className = 'leader-row';
    const main = document.createElement('div');
    main.className = 'leader-main';
    const top = document.createElement('div');
    top.className = 'leader-top-line';
    const name = document.createElement('span');
    name.className = 'leader-name';
    name.textContent = p;
    const val = document.createElement('span');
    val.className = 'leader-value';
    val.textContent = pct === null ? '—' : `${Math.round(pct)}%`;
    top.appendChild(name); top.appendChild(val);
    main.appendChild(top);

    const track = document.createElement('div');
    track.className = 'bar-track';
    track.style.position = 'relative';
    const fill = document.createElement('div');
    fill.className = 'bar-fill';
    fill.style.width = pct === null ? '0%' : `${Math.min(pct, 130) / 130 * 100}%`;
    fill.style.background = COLORS[p];
    track.appendChild(fill);
    const mark = document.createElement('div'); // 100% marker
    mark.style.cssText = 'position:absolute;top:-2px;bottom:-2px;width:2px;background:var(--ink);opacity:.55;left:' + (100 / 130 * 100) + '%;';
    track.appendChild(mark);
    main.appendChild(track);

    const sub = document.createElement('div');
    sub.className = 'leader-meta';
    sub.textContent = `${actual.toFixed(1)}h logged vs ${target.toFixed(1)}h scheduled (${range.label})`;
    main.appendChild(sub);

    row.appendChild(main);
    wrap.appendChild(row);
  });
}

function linearFit(ys) {
  const n = ys.length;
  const xs = ys.map((_, i) => i);
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  xs.forEach((x, i) => { num += (x - mx) * (ys[i] - my); den += (x - mx) * (x - mx); });
  const slope = den === 0 ? 0 : num / den;
  return { slope, intercept: my - slope * mx };
}

function renderHoursTrend() {
  const chart = document.getElementById('trend-chart');
  const legend = document.getElementById('trend-legend');
  const fc = document.getElementById('trend-forecast');
  if (!chart) return;
  chart.innerHTML = ''; legend.innerHTML = ''; fc.innerHTML = '';

  const HIST = 8, FUT = 4;
  const thisMonday = weekStartISO(todayISO());
  const weekStarts = [];
  for (let i = HIST; i >= 1; i--) weekStarts.push(isoAddDays(thisMonday, -7 * i));
  const futureStarts = [];
  for (let i = 0; i < FUT; i++) futureStarts.push(isoAddDays(thisMonday, 7 * i));
  const totals = weeklyTotals();

  const series = PEOPLE.map(p => {
    const hist = weekStarts.map(w => (totals[w] && totals[w][p]) || 0);
    const { slope, intercept } = linearFit(hist);
    const fut = futureStarts.map((_, i) => Math.max(0, intercept + slope * (HIST + i)));
    return { p, hist, fut, slope };
  });

  const W = 600, H = 230, L = 36, R = 12, T = 12, B = 28;
  const maxV = Math.max(10, ...series.flatMap(s => [...s.hist, ...s.fut]));
  const yMax = Math.ceil(maxV * 1.1 / 10) * 10;
  const nPts = HIST + FUT;
  const x = i => L + (i / (nPts - 1)) * (W - L - R);
  const y = v => T + (1 - v / yMax) * (H - T - B);
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || '#999';

  let svg = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block;" role="img" aria-label="Weekly hours trend with forecast">`;
  for (let g = 0; g <= 4; g++) {
    const v = (yMax / 4) * g;
    svg += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="${css('--line')}" stroke-width="1"/>`;
    svg += `<text x="${L - 6}" y="${y(v) + 3}" text-anchor="end" font-size="10" fill="${css('--muted')}" font-family="IBM Plex Mono, monospace">${Math.round(v)}</text>`;
  }
  // forecast zone divider
  svg += `<line x1="${x(HIST - 0.5)}" x2="${x(HIST - 0.5)}" y1="${T}" y2="${H - B}" stroke="${css('--faint')}" stroke-dasharray="3 3"/>`;
  svg += `<text x="${x(HIST - 0.5) + 4}" y="${T + 9}" font-size="9" fill="${css('--faint')}" font-family="IBM Plex Mono, monospace">forecast →</text>`;
  const labels = [...weekStarts, ...futureStarts];
  labels.forEach((w, i) => {
    if (i % 2 === 0 || i === nPts - 1) {
      svg += `<text x="${x(i)}" y="${H - 8}" text-anchor="middle" font-size="9" fill="${css('--muted')}" font-family="IBM Plex Mono, monospace">${shortDM(w)}</text>`;
    }
  });
  series.forEach(s => {
    const color = COLORS[s.p];
    const hp = s.hist.map((v, i) => `${x(i)},${y(v)}`).join(' ');
    svg += `<polyline points="${hp}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linejoin="round"/>`;
    s.hist.forEach((v, i) => { svg += `<circle cx="${x(i)}" cy="${y(v)}" r="2.8" fill="${color}"/>`; });
    const fp = [`${x(HIST - 1)},${y(s.hist[HIST - 1])}`, ...s.fut.map((v, i) => `${x(HIST + i)},${y(v)}`)].join(' ');
    svg += `<polyline points="${fp}" fill="none" stroke="${color}" stroke-width="2" stroke-dasharray="5 4" stroke-linejoin="round" opacity=".75"/>`;
  });
  svg += '</svg>';
  chart.innerHTML = svg;

  PEOPLE.forEach(p => {
    const item = document.createElement('div');
    item.className = 'legend-item';
    item.innerHTML = `<span class="legend-swatch" style="background:${COLORS[p]}"></span> ${p}`;
    legend.appendChild(item);
  });

  series.forEach(s => {
    const avgFut = s.fut.reduce((a, b) => a + b, 0) / s.fut.length;
    const arrow = Math.abs(s.slope) < 0.25 ? '→ steady' : s.slope > 0 ? `↑ +${s.slope.toFixed(1)}h/wk` : `↓ ${s.slope.toFixed(1)}h/wk`;
    const line = document.createElement('div');
    line.className = 'leader-meta';
    line.style.marginBottom = '4px';
    line.textContent = `${s.p}: ~${avgFut.toFixed(0)}h/week over the next ${FUT} weeks (${arrow})`;
    fc.appendChild(line);
  });
  const note = document.createElement('div');
  note.className = 'leader-meta';
  note.style.cssText = 'margin-top:6px;opacity:.7;';
  note.textContent = 'Based on the last 8 completed weeks; forecast is a straight-line trend, not a promise.';
  fc.appendChild(note);
}

function renderDowHeatmap() {
  const wrap = document.getElementById('heatmap-rows');
  if (!wrap) return;
  wrap.innerHTML = '';
  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const WEEKS = 8;
  const start = isoAddDays(weekStartISO(todayISO()), -7 * WEEKS);
  const end = isoAddDays(weekStartISO(todayISO()), -1);

  const head = document.createElement('div');
  head.className = 'heatmap-dow-row';
  head.innerHTML = '<div class="heatmap-name-spacer"></div>' + DAYS.map(d => `<div class="heatmap-dow-label">${d}</div>`).join('');
  wrap.appendChild(head);

  const avgs = PEOPLE.map(p => {
    const sums = [0, 0, 0, 0, 0, 0, 0];
    entries.forEach(e => {
      const d = e.start.slice(0, 10);
      if (e.person !== p || d < start || d > end) return;
      const dow = (new Date(d + 'T00:00:00Z').getUTCDay() + 6) % 7;
      sums[dow] += e.hours;
    });
    return { p, avg: sums.map(s => s / WEEKS) };
  });
  const maxAvg = Math.max(1, ...avgs.flatMap(a => a.avg));

  avgs.forEach(({ p, avg }) => {
    const row = document.createElement('div');
    row.className = 'heatmap-row';
    const name = document.createElement('div');
    name.className = 'heatmap-name';
    name.textContent = p;
    row.appendChild(name);
    avg.forEach(v => {
      const cell = document.createElement('div');
      cell.className = 'heatmap-cell';
      const a = v === 0 ? 0.06 : 0.18 + 0.72 * (v / maxAvg);
      cell.style.background = v === 0 ? 'var(--track)' : COLORS[p];
      if (v !== 0) cell.style.opacity = a.toFixed(2);
      cell.textContent = v === 0 ? '' : v.toFixed(1);
      row.appendChild(cell);
    });
    wrap.appendChild(row);
  });
}

function renderStatsTab() {
  document.querySelectorAll('#stats-period-toggle .toggle-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.period === statsPeriod);
  });
  renderWorkRatio();
  renderHoursTrend();
  renderDowHeatmap();
}

document.querySelectorAll('#stats-period-toggle .toggle-btn').forEach(b => {
  b.onclick = () => { statsPeriod = b.dataset.period; renderStatsTab(); };
});
