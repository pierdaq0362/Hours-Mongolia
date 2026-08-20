/* =========================================================================
   TIME CLOCK (logic unchanged from the original app)
   ========================================================================= */
async function clockIn(person) {
  activeShifts[person] = new Date().toISOString();
  saveActiveShifts();
  renderPersonRow();
}
async function clockOut(person) {
  const startIso = activeShifts[person];
  if (!startIso) return;
  const start = new Date(startIso);
  const end = new Date();
  const hours = (end - start) / (1000 * 60 * 60);
  delete activeShifts[person];
  saveActiveShifts();
  if (hours > 0) {
    const entry = { id: `${person}-${end.getTime()}`, person, start: start.toISOString(), end: end.toISOString(), hours };
    entries.unshift(entry);
    renderTimeTab();
    try { await apiAddEntry(entry); } catch (e) { console.error('Failed to save entry', e); }
  } else {
    renderPersonRow();
  }
}
async function addManualEntry() {
  const person = document.getElementById('manual-person').value;
  const date = document.getElementById('manual-date').value;
  const startStr = document.getElementById('manual-start').value;
  const endStr = document.getElementById('manual-end').value;
  if (!date || !startStr || !endStr) return;
  const start = new Date(`${date}T${startStr}:00`);
  const end = new Date(`${date}T${endStr}:00`);
  let hours = (end - start) / (1000 * 60 * 60);
  if (hours <= 0) hours += 24;
  const entry = { id: `${person}-${Date.now()}`, person, start: start.toISOString(), end: end.toISOString(), hours };
  entries.unshift(entry);
  renderTimeTab();
  try { await apiAddEntry(entry); } catch (e) { console.error('Failed to save entry', e); }
}
async function deleteEntry(id) {
  entries = entries.filter((e) => e.id !== id);
  renderTimeTab();
  try { await apiDeleteEntry(id); } catch (e) { console.error('Failed to delete entry', e); }
}
function computeStats(period) {
  return PEOPLE.map((person) => {
    let personEntries = entries.filter((e) => e.person === person);
    if (period === 'month' || period === 'ytd') {
      const range = getOvertimeRange(period === 'month' ? 'thisMonth' : 'ytd', person);
      personEntries = personEntries.filter((e) => {
        const d = e.start.slice(0, 10);
        return d >= range.start && d <= range.end;
      });
    }
    const totalHours = personEntries.reduce((sum, e) => sum + e.hours, 0);
    const days = new Set(personEntries.map((e) => e.start.slice(0, 10))).size;
    const avgHours = days > 0 ? totalHours / days : 0;
    return { person, totalHours, avgHours, shifts: personEntries.length, days };
  });
}
function renderPersonRow() {
  const now = new Date();
  const container = document.getElementById('person-row');
  container.innerHTML = '';
  PEOPLE.forEach((person) => {
    const shiftStart = activeShifts[person];
    const isActive = !!shiftStart;
    const isEggMaster = hasAllEggs(person);
    const card = document.createElement('div');
    card.className = 'person-card'
      + (person === whoAmI ? ' is-you' : '')
      + (isEggMaster && person === whoAmI ? ' egg-master-mine' : '');
    card.style.borderColor = isActive ? COLORS[person] : '#E4DDD0';
    card.style.background = isActive ? `${COLORS[person]}0D` : '#FFFFFF';

    const nameDiv = document.createElement('div');
    nameDiv.className = 'person-name';
    const dot = document.createElement('span');
    dot.className = 'dot' + (isActive ? ' pulsing' : '');
    dot.style.background = COLORS[person];
    dot.style.cursor = 'pointer';
    dot.addEventListener('click', (ev) => { ev.stopPropagation(); handleDotTap(person); });
    nameDiv.appendChild(dot);
    nameDiv.appendChild(document.createTextNode(person));
    if (isEggMaster) {
      const medal = document.createElement('span');
      medal.className = 'egg-medal';
      medal.textContent = '🥇';
      medal.title = person === whoAmI ? '10/10 secrets found' : 'Found every secret in the app';
      nameDiv.appendChild(medal);
    }
    if (settings.birthdayMode === 'true' && settings.birthdayPerson === person) {
      const cake = document.createElement('span');
      cake.className = 'birthday-cake-badge';
      cake.textContent = '🎂';
      cake.title = `Happy birthday, ${person}!`;
      nameDiv.appendChild(cake);
    }
    if (person === whoAmI) {
      const badge = document.createElement('span');
      badge.className = 'you-badge';
      badge.textContent = 'YOU';
      nameDiv.appendChild(badge);
    }
    card.appendChild(nameDiv);
    if (isEggMaster && person === whoAmI) {
      const detail = document.createElement('div');
      detail.className = 'egg-master-detail';
      detail.textContent = '🥇 10/10 secrets found';
      card.appendChild(detail);
    }

    if (isActive) {
      const elapsedHours = (now - new Date(shiftStart)) / (1000 * 60 * 60);
      const info = document.createElement('div');
      info.className = 'shift-info';
      info.textContent = `In since ${formatClock(new Date(shiftStart))}`;
      card.appendChild(info);
      const elapsed = document.createElement('div');
      elapsed.className = 'shift-elapsed';
      elapsed.style.color = COLORS[person];
      elapsed.textContent = formatDuration(elapsedHours);
      card.appendChild(elapsed);
      const btn = document.createElement('button');
      btn.className = 'action-btn';
      btn.style.background = COLORS[person];
      btn.textContent = 'Clock out';
      btn.onclick = () => clockOut(person);
      card.appendChild(btn);
    } else {
      const info = document.createElement('div');
      info.className = 'shift-info';
      info.textContent = 'Not clocked in';
      card.appendChild(info);
      const btn = document.createElement('button');
      btn.className = 'action-btn';
      btn.style.background = '#2B2823';
      btn.textContent = 'Clock in';
      btn.onclick = () => clockIn(person);
      card.appendChild(btn);
    }
    container.appendChild(card);
  });
}
function renderLeaderboard() {
  const statsPeriod = viewMode === 'month' ? 'month' : viewMode === 'ytd' ? 'ytd' : 'lifetime';
  const stats = computeStats(statsPeriod);
  const sorted = [...stats].sort((a, b) => viewMode === 'average' ? b.avgHours - a.avgHours : b.totalHours - a.totalHours);
  const maxValue = Math.max(1, ...sorted.map((s) => (viewMode === 'average' ? s.avgHours : s.totalHours)));
  const container = document.getElementById('leaderboard');
  container.innerHTML = '';
  if (sorted.every((s) => s.shifts === 0)) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No shifts logged yet. Clock in above or add a past shift below to start the board.';
    container.appendChild(empty);
    return;
  }
  const list = document.createElement('div');
  list.className = 'leaderboard-list';
  sorted.forEach((s, idx) => {
    const value = viewMode === 'average' ? s.avgHours : s.totalHours;
    const pct = (value / maxValue) * 100;
    const row = document.createElement('div');
    row.className = 'leader-row';
    const rank = document.createElement('div');
    rank.className = 'leader-rank';
    rank.textContent = idx + 1;
    row.appendChild(rank);
    const main = document.createElement('div');
    main.className = 'leader-main';
    const topLine = document.createElement('div');
    topLine.className = 'leader-top-line';
    const name = document.createElement('span');
    name.className = 'leader-name';
    name.textContent = s.person;
    const val = document.createElement('span');
    val.className = 'leader-value';
    val.textContent = formatDuration(value);
    if (viewMode === 'average') {
      const suffix = document.createElement('span');
      suffix.className = 'leader-suffix';
      suffix.textContent = ' / day';
      val.appendChild(suffix);
    }
    topLine.appendChild(name);
    topLine.appendChild(val);
    main.appendChild(topLine);
    const track = document.createElement('div');
    track.className = 'bar-track';
    const fill = document.createElement('div');
    fill.className = 'bar-fill';
    fill.style.width = `${pct}%`;
    fill.style.background = COLORS[s.person];
    track.appendChild(fill);
    main.appendChild(track);
    const meta = document.createElement('div');
    meta.className = 'leader-meta';
    meta.textContent = `${s.shifts} shift${s.shifts !== 1 ? 's' : ''} · ${s.days} day${s.days !== 1 ? 's' : ''} logged`;
    main.appendChild(meta);
    row.appendChild(main);
    list.appendChild(row);
  });
  container.appendChild(list);
}
function renderRecentLog() {
  const recent = [...entries].sort((a, b) => new Date(b.start) - new Date(a.start)).slice(0, 12);
  const container = document.getElementById('recent-log');
  container.innerHTML = '';
  if (recent.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'Nothing logged yet — shifts will appear here.';
    container.appendChild(empty);
    return;
  }
  const list = document.createElement('div');
  list.className = 'log-list';
  recent.forEach((e) => {
    const row = document.createElement('div');
    row.className = 'log-row';
    const dot = document.createElement('span');
    dot.className = 'log-dot';
    dot.style.background = COLORS[e.person];
    row.appendChild(dot);
    const person = document.createElement('span');
    person.className = 'log-person';
    person.textContent = e.person;
    row.appendChild(person);
    const date = document.createElement('span');
    date.className = 'log-date';
    date.textContent = formatDate(new Date(e.start));
    row.appendChild(date);
    const times = document.createElement('span');
    times.className = 'log-times';
    times.textContent = `${formatClock(new Date(e.start))} – ${formatClock(new Date(e.end))}`;
    row.appendChild(times);
    const dur = document.createElement('span');
    dur.className = 'log-duration';
    dur.textContent = formatDuration(e.hours);
    row.appendChild(dur);
    const del = document.createElement('button');
    del.className = 'delete-btn';
    del.textContent = '✕';
    del.title = 'Remove this entry';
    del.onclick = () => deleteEntry(e.id);
    row.appendChild(del);
    list.appendChild(row);
  });
  container.appendChild(list);
}
function renderTimeTab() {
  renderPersonRow();
  renderLeaderboard();
  renderRecentLog();
  renderHolidays();
  renderOvertimePanel();
}

/* ---------------------------------------------------------------------
   Extra Hours — assumes an 8h/day expectation, Mon–Fri only. Weekends
   never count against anyone; a date in a person's holidays (or an
   "Everyone" holiday) doesn't either. Panel is hidden by default and
   toggled per device via localStorage. Period is switchable between
   this month (elapsed so far), last month (full), and year to date.
   --------------------------------------------------------------------- */
const OVERTIME_VISIBLE_KEY = 'punchboard-overtime-visible';
const OVERTIME_PERIOD_KEY = 'punchboard-overtime-period';
function isOvertimeVisible() { return localStorage.getItem(OVERTIME_VISIBLE_KEY) === 'true'; }
function setOvertimeVisible(v) { localStorage.setItem(OVERTIME_VISIBLE_KEY, v ? 'true' : 'false'); }
function getOvertimePeriod() { return localStorage.getItem(OVERTIME_PERIOD_KEY) || 'thisMonth'; }
function setOvertimePeriod(p) { localStorage.setItem(OVERTIME_PERIOD_KEY, p); }

function countExpectedWorkdays(startStr, endStr, person) {
  const holidaySet = new Set(
    getHolidays().filter(h => h.person === 'All' || h.person === person).map(h => h.date)
  );
  let count = 0;
  let d = new Date(startStr + 'T00:00:00');
  const end = new Date(endStr + 'T00:00:00');
  while (d <= end) {
    const dow = d.getDay(); // 0 = Sunday, 6 = Saturday
    const dateStr = d.toISOString().slice(0, 10);
    if (dow !== 0 && dow !== 6 && !holidaySet.has(dateStr)) count++;
    d.setDate(d.getDate() + 1);
  }
  return count;
}
function sumHoursInRange(person, startStr, endStr) {
  return entries
    .filter(e => e.person === person && e.start.slice(0, 10) >= startStr && e.start.slice(0, 10) <= endStr)
    .reduce((sum, e) => sum + e.hours, 0);
}
function getOvertimeRange(period, person) {
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  if (period === 'lastMonth') {
    const firstOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthEnd = new Date(firstOfThisMonth.getTime() - 86400000);
    const lastMonthStart = new Date(lastMonthEnd.getFullYear(), lastMonthEnd.getMonth(), 1);
    return { start: iso(lastMonthStart), end: iso(lastMonthEnd), label: 'last month' };
  }
  if (period === 'ytd') {
    const yearStartStr = iso(new Date(now.getFullYear(), 0, 1));
    const todayStr = todayISO();
    // Don't count expected days before this person's very first logged
    // entry ever, if that happens to fall after Jan 1 — otherwise someone
    // who only started using the app in June looks "behind" for the
    // five months before it existed for them.
    const personEntries = entries.filter(e => e.person === person);
    if (personEntries.length === 0) {
      return { start: todayStr, end: todayStr, label: 'year to date (no entries yet)' };
    }
    const earliestStr = personEntries.reduce((min, e) => {
      const d = e.start.slice(0, 10);
      return d < min ? d : min;
    }, personEntries[0].start.slice(0, 10));
    if (earliestStr > yearStartStr) {
      const niceDate = new Date(earliestStr + 'T00:00:00').toLocaleDateString([], { day: '2-digit', month: 'short' });
      return { start: earliestStr, end: todayStr, label: `year to date (since ${niceDate})` };
    }
    return { start: yearStartStr, end: todayStr, label: 'year to date' };
  }
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  return { start: iso(monthStart), end: todayISO(), label: 'this month so far' };
}

function renderOvertimePanel() {
  const content = document.getElementById('overtime-content');
  const btn = document.getElementById('overtime-toggle-btn');
  if (!content || !btn) return;
  const visible = isOvertimeVisible();
  content.style.display = visible ? 'block' : 'none';
  btn.textContent = visible ? 'Hide' : 'Show';
  if (!visible) return;

  const period = getOvertimePeriod();
  document.querySelectorAll('#overtime-period-toggle .toggle-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.period === period);
  });

  const rows = document.getElementById('overtime-rows');
  rows.innerHTML = '';

  PEOPLE.forEach(p => {
    const range = getOvertimeRange(period, p);
    const expectedDays = countExpectedWorkdays(range.start, range.end, p);
    const expectedHours = expectedDays * 8;
    const actualHours = sumHoursInRange(p, range.start, range.end);
    const extra = actualHours - expectedHours;

    const row = document.createElement('div');
    row.className = 'hours-row';
    const top = document.createElement('div');
    top.className = 'hours-top-line';
    const name = document.createElement('span');
    name.className = 'hours-name';
    name.textContent = p;
    const val = document.createElement('span');
    val.className = 'hours-value';
    val.style.color = extra >= 0 ? '#2E9B5C' : '#E0503C';
    val.textContent = formatSignedDuration(extra);
    top.appendChild(name);
    top.appendChild(val);
    row.appendChild(top);
    const sub = document.createElement('div');
    sub.className = 'leader-meta';
    sub.textContent = `${actualHours.toFixed(1)}h logged vs ${expectedHours}h expected (${expectedDays} weekdays, ${range.label})`;
    row.appendChild(sub);
    rows.appendChild(row);
  });
}
document.getElementById('overtime-toggle-btn').onclick = () => {
  setOvertimeVisible(!isOvertimeVisible());
  renderOvertimePanel();
};
document.querySelectorAll('#overtime-period-toggle .toggle-btn').forEach(b => {
  b.onclick = () => {
    setOvertimePeriod(b.dataset.period);
    renderOvertimePanel();
  };
});

/* ---------------------------------------------------------------------
   Holidays — persisted via the same settings-based approach as the
   archived match list, so no backend changes are needed for this to
   work right away.
   --------------------------------------------------------------------- */
function getHolidays() {
  try {
    return JSON.parse(settings.holidays || '[]');
  } catch (e) {
    return [];
  }
}
async function saveHolidays(list) {
  settings.holidays = JSON.stringify(list);
  try { await apiSetSetting('holidays', settings.holidays); } catch (e) { console.error('Failed to save holidays', e); }
}
function renderHolidays() {
  const wrap = document.getElementById('holiday-list');
  if (!wrap) return;
  wrap.innerHTML = '';
  const holidays = getHolidays().slice().sort((a, b) => a.date.localeCompare(b.date));
  if (holidays.length === 0) {
    wrap.innerHTML = '<div class="empty-state">No holidays added yet.</div>';
    return;
  }
  const todayStr = todayISO();
  holidays.forEach(h => {
    const row = document.createElement('div');
    row.className = 'holiday-row';
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = h.person === 'All' ? 'var(--faint)' : COLORS[h.person];
    dot.title = h.person === 'All' ? 'Everyone' : h.person;
    row.appendChild(dot);
    const date = document.createElement('span');
    date.className = 'holiday-date';
    date.textContent = new Date(h.date + 'T00:00:00').toLocaleDateString([], { day: '2-digit', month: 'short' });
    row.appendChild(date);
    const label = document.createElement('span');
    label.className = 'holiday-label';
    label.textContent = h.person === 'All' ? h.label : `${h.label} · ${h.person}`;
    row.appendChild(label);
    if (h.date === todayStr) {
      const tag = document.createElement('span');
      tag.className = 'holiday-today-tag';
      tag.textContent = 'TODAY';
      row.appendChild(tag);
    }
    const del = document.createElement('button');
    del.className = 'delete-btn';
    del.textContent = '✕';
    del.title = 'Remove this holiday';
    del.onclick = async () => {
      const updated = getHolidays().filter(x => x.id !== h.id);
      await saveHolidays(updated);
      renderHolidays();
      renderCalendar();
    };
    row.appendChild(del);
    wrap.appendChild(row);
  });
}
document.getElementById('add-holiday-btn').onclick = async () => {
  const personInput = document.getElementById('holiday-person-input');
  const dateInput = document.getElementById('holiday-date-input');
  const labelInput = document.getElementById('holiday-label-input');
  const person = personInput.value;
  const date = dateInput.value;
  const label = labelInput.value.trim();
  if (!date || !label) { alert('Enter both a date and what it is.'); return; }
  const holiday = { id: `h-${Date.now()}`, date, label, person };
  const updated = [...getHolidays(), holiday];
  await saveHolidays(updated);
  dateInput.value = '';
  labelInput.value = '';
  renderHolidays();
  renderCalendar();
};

function setLeaderboardViewMode(mode) {
  viewMode = mode;
  ['lifetime', 'month', 'ytd', 'average'].forEach(m => {
    document.getElementById(`toggle-${m}`).classList.toggle('active', m === mode);
  });
  renderLeaderboard();
}
document.getElementById('toggle-lifetime').onclick = () => setLeaderboardViewMode('lifetime');
document.getElementById('toggle-month').onclick = () => setLeaderboardViewMode('month');
document.getElementById('toggle-ytd').onclick = () => setLeaderboardViewMode('ytd');
document.getElementById('toggle-average').onclick = () => setLeaderboardViewMode('average');
document.getElementById('add-shift-btn').onclick = addManualEntry;
document.getElementById('manual-date').value = todayISO();
setInterval(renderPersonRow, 30000);

/* =========================================================================
   MOOD TRACKER
   ========================================================================= */
function personMoodMap(person) {
  // most recent entry wins per date
  const map = {};
  moodEntries.filter(m => m.person === person).forEach(m => {
    const score = (m.energy + m.happiness + (6 - m.stress)) / 3;
    map[m.date] = score;
  });
  return map;
}
function findMoodEntry(person, date) {
  const matches = moodEntries.filter(m => m.person === person && m.date === date);
  return matches.length ? matches[matches.length - 1] : null;
}

function renderMoodPersonTabs() {
  const wrap = document.getElementById('mood-person-tabs');
  wrap.innerHTML = '';
  PEOPLE.forEach(p => {
    const tab = document.createElement('div');
    tab.className = 'person-tab' + (p === moodPerson ? ' active' : '');
    tab.textContent = p;
    tab.style.background = p === moodPerson ? COLORS[p] : '#fff';
    tab.style.borderColor = p === moodPerson ? COLORS[p] : 'var(--line)';
    tab.onclick = () => {
      moodPerson = p;
      const existing = findMoodEntry(p, todayISO());
      ratings = existing
        ? { energy: existing.energy, stress: existing.stress, happiness: existing.happiness }
        : { energy: null, stress: null, happiness: null };
      renderCheckin();
    };
    wrap.appendChild(tab);
  });
}
function renderScale(key, containerId) {
  const wrap = document.getElementById(containerId);
  wrap.innerHTML = '';
  for (let i = 1; i <= 5; i++) {
    const dot = document.createElement('div');
    dot.className = 'rating-dot' + (ratings[key] === i ? ' selected' : '');
    dot.textContent = i;
    if (ratings[key] === i) dot.style.background = COLORS[moodPerson];
    dot.onclick = () => { ratings[key] = i; renderCheckin(); };
    wrap.appendChild(dot);
  }
}
function renderMoodResult() {
  const { energy, stress, happiness } = ratings;
  const scoreEl = document.getElementById('mood-score');
  const wordEl = document.getElementById('mood-word');
  if (energy === null || stress === null || happiness === null) {
    scoreEl.textContent = '—'; scoreEl.style.color = 'var(--faint)';
    wordEl.textContent = 'Rate all three to see today\'s mood';
    return;
  }
  const avg = (energy + happiness + (6 - stress)) / 3;
  scoreEl.textContent = avg.toFixed(1);
  scoreEl.style.color = COLORS[moodPerson];
  wordEl.textContent = `${moodWord(avg)} for ${moodPerson}`;
}
function renderCheckin() {
  renderMoodPersonTabs();
  renderScale('energy', 'scale-energy');
  renderScale('stress', 'scale-stress');
  renderScale('happiness', 'scale-happiness');
  renderMoodResult();
}
document.getElementById('save-checkin-btn').onclick = async () => {
  const { energy, stress, happiness } = ratings;
  if (energy === null || stress === null || happiness === null) {
    alert('Rate energy, stress, and happiness first.');
    return;
  }
  const date = todayISO();
  const existing = findMoodEntry(moodPerson, date);
  if (existing) {
    moodEntries = moodEntries.filter(m => m.id !== existing.id);
    try { await apiDeleteMood(existing.id); } catch (e) { console.error(e); }
  }
  const entry = { id: `${moodPerson}-${date}-${Date.now()}`, person: moodPerson, date, energy, stress, happiness };
  moodEntries.push(entry);
  renderMoodTab();
  try { await apiAddMood(entry); } catch (e) { console.error('Failed to save mood', e); }
};

function renderMini(key, containerId) {
  const wrap = document.getElementById(containerId);
  wrap.innerHTML = '';
  for (let i = 1; i <= 5; i++) {
    const dot = document.createElement('div');
    dot.className = 'mini-dot' + (backfillRatings[key] === i ? ' selected' : '');
    dot.textContent = i;
    if (backfillRatings[key] === i) dot.style.background = '#2B2823';
    dot.onclick = () => { backfillRatings[key] = i; renderMini(key, containerId); };
    wrap.appendChild(dot);
  }
}
document.getElementById('backfill-btn').onclick = async () => {
  const p = document.getElementById('backfill-person').value;
  const d = document.getElementById('backfill-date').value;
  const { energy, stress, happiness } = backfillRatings;
  if (!d || energy === null || stress === null || happiness === null) {
    alert('Pick a date and all three ratings first.');
    return;
  }
  const existing = findMoodEntry(p, d);
  if (existing) {
    moodEntries = moodEntries.filter(m => m.id !== existing.id);
    try { await apiDeleteMood(existing.id); } catch (e) { console.error(e); }
  }
  const entry = { id: `${p}-${d}-${Date.now()}`, person: p, date: d, energy, stress, happiness };
  moodEntries.push(entry);
  backfillRatings = { energy: null, stress: null, happiness: null };
  renderMini('energy', 'mini-energy');
  renderMini('stress', 'mini-stress');
  renderMini('happiness', 'mini-happiness');
  renderMoodTab();
  try { await apiAddMood(entry); } catch (e) { console.error('Failed to save mood', e); }
};

function renderMoodFilterChips() {
  const wrap = document.getElementById('filter-chips');
  wrap.innerHTML = '';
  PEOPLE.forEach(p => {
    const chip = document.createElement('div');
    const selected = moodFilters.has(p);
    chip.className = 'chip' + (selected ? ' selected' : '');
    chip.textContent = p;
    chip.style.background = selected ? COLORS[p] : '#fff';
    chip.style.borderColor = selected ? COLORS[p] : 'var(--line)';
    chip.onclick = () => {
      if (moodFilters.has(p)) {
        if (moodFilters.size > 1) moodFilters.delete(p);
      } else {
        moodFilters.add(p);
      }
      renderMoodFilterChips();
      renderCalendar();
    };
    wrap.appendChild(chip);
  });
}
function renderCalendar() {
  const now = new Date();
  const viewDate = new Date(now.getFullYear(), now.getMonth() + calMonthOffset, 1);
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  document.getElementById('cal-month-title').textContent =
    viewDate.toLocaleDateString([], { month: 'long', year: 'numeric' });

  const grid = document.getElementById('cal-grid');
  grid.innerHTML = '';
  ['S','M','T','W','T','F','S'].forEach(d => {
    const el = document.createElement('div');
    el.className = 'cal-dow';
    el.textContent = d;
    grid.appendChild(el);
  });

  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayStr = todayISO();
  const selected = [...moodFilters];
  const maps = {};
  selected.forEach(p => { maps[p] = personMoodMap(p); });
  const holidayDates = new Set(
    getHolidays()
      .filter(h => h.person === 'All' || selected.includes(h.person))
      .map(h => h.date)
  );

  for (let i = 0; i < firstDow; i++) {
    const el = document.createElement('div');
    el.className = 'cal-cell empty';
    grid.appendChild(el);
  }

  const monthAverages = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const vals = selected.map(p => maps[p][dateStr]).filter(v => v !== undefined);
    const val = vals.length > 0 ? vals.reduce((a,b) => a+b, 0) / vals.length : null;
    if (val !== null) monthAverages.push(val);
    const el = document.createElement('div');
    el.className = 'cal-cell' + (val === null ? ' no-data' : '') + (dateStr === todayStr ? ' today' : '') + (holidayDates.has(dateStr) ? ' is-holiday' : '');
    el.style.background = moodColor(val);
    el.style.color = val === null ? 'var(--faint)' : 'rgba(255,255,255,0.95)';
    el.style.fontWeight = val === null ? '400' : '600';
    el.textContent = d;
    grid.appendChild(el);
  }
  const avgEl = document.getElementById('cal-avg');
  avgEl.textContent = monthAverages.length
    ? (monthAverages.reduce((a,b) => a+b, 0) / monthAverages.length).toFixed(1)
    : '—';
}
function renderStrip() {
  const wrap = document.getElementById('strip-list');
  wrap.innerHTML = '';
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }
  PEOPLE.forEach(p => {
    const map = personMoodMap(p);
    const row = document.createElement('div');
    row.className = 'strip-row';
    const name = document.createElement('div');
    name.className = 'strip-name';
    name.textContent = p;
    row.appendChild(name);
    const dots = document.createElement('div');
    dots.className = 'strip-dots';
    const weekVals = [];
    days.forEach(dateStr => {
      const v = map[dateStr];
      if (v !== undefined) weekVals.push(v);
      const dot = document.createElement('div');
      dot.className = 'strip-dot';
      dot.style.background = moodColor(v === undefined ? null : v);
      dots.appendChild(dot);
    });
    row.appendChild(dots);
    const avgEl = document.createElement('div');
    avgEl.className = 'strip-avg';
    avgEl.textContent = weekVals.length ? (weekVals.reduce((a,b)=>a+b,0)/weekVals.length).toFixed(1) : '—';
    row.appendChild(avgEl);
    wrap.appendChild(row);
  });
}
function renderMoodTab() {
  renderCheckin();
  renderMoodFilterChips();
  renderCalendar();
  renderStrip();
  updateMoodNudge();
}

/* ---------------------------------------------------------------------
   Check-in nudge — private to whoAmI, doesn't call anyone else out.
   Dot on the tab persists until they actually check in; the dismissible
   card only hides itself for the rest of today.
   --------------------------------------------------------------------- */
function updateMoodNudge() {
  const dot = document.getElementById('mood-tab-dot');
  const card = document.getElementById('mood-nudge-card');
  if (!dot || !card) return;
  if (!whoAmI) { dot.style.display = 'none'; card.style.display = 'none'; return; }
  const done = !!findMoodEntry(whoAmI, todayISO());
  dot.style.display = done ? 'none' : 'block';
  const dismissedToday = localStorage.getItem(NUDGE_DISMISS_KEY) === todayISO();
  card.style.display = (!done && !dismissedToday) ? 'flex' : 'none';
}
document.getElementById('mood-nudge-dismiss').onclick = () => {
  localStorage.setItem(NUDGE_DISMISS_KEY, todayISO());
  updateMoodNudge();
};
