/* =========================================================================
   🧪 ALPHA: QUICK POLL — everyone votes, results update live. Same
   settings-based storage as everything else, so it's shared across the
   crew immediately. Marked alpha since it's new and still simple
   (single choice, no editing options after creation).
   ========================================================================= */
function getPolls() {
  try { return JSON.parse(settings.polls || '[]'); } catch (e) { return []; }
}
async function savePolls(list) {
  settings.polls = JSON.stringify(list);
  try { await apiSetSetting('polls', settings.polls); } catch (e) { console.error('Failed to save polls', e); }
}
let showClosedPolls = false;

function buildPollCard(poll, isClosed) {
  const card = document.createElement('div');
  card.className = 'goal-card' + (isClosed ? ' archived' : '');

  const top = document.createElement('div');
  top.className = 'goal-top';
  const q = document.createElement('div');
  q.className = 'poll-question';
  q.textContent = poll.question;
  top.appendChild(q);
  const btnRow = document.createElement('div');
  btnRow.className = 'goal-btn-row';
  const closeBtn = document.createElement('button');
  closeBtn.className = 'archive-btn';
  closeBtn.textContent = isClosed ? 'Reopen' : 'Close';
  closeBtn.onclick = async () => {
    const updated = getPolls().map(x => x.id === poll.id ? { ...x, closed: !isClosed } : x);
    await savePolls(updated);
    renderPolls();
  };
  btnRow.appendChild(closeBtn);
  const del = document.createElement('button');
  del.className = 'delete-btn';
  del.textContent = '✕';
  del.title = 'Delete this poll entirely';
  del.onclick = async () => {
    if (!confirm(`Delete "${poll.question}"? This can't be undone.`)) return;
    const updated = getPolls().filter(x => x.id !== poll.id);
    await savePolls(updated);
    renderPolls();
  };
  btnRow.appendChild(del);
  top.appendChild(btnRow);
  card.appendChild(top);

  const votes = poll.votes || {};
  const totalVoters = PEOPLE.length;
  poll.options.forEach((opt, i) => {
    const voters = PEOPLE.filter(p => votes[p] === i);
    const myVote = whoAmI && votes[whoAmI] === i;

    const row = document.createElement('div');
    row.className = 'poll-option-row' + (myVote ? ' voted-mine' : '');
    if (!isClosed) {
      row.onclick = async () => {
        if (!whoAmI) { alert("Pick who you are first (the header at the top of the app) to vote."); return; }
        const updated = getPolls().map(x => {
          if (x.id !== poll.id) return x;
          const newVotes = { ...(x.votes || {}) };
          newVotes[whoAmI] = i;
          return { ...x, votes: newVotes };
        });
        await savePolls(updated);
        renderPolls();
      };
    }

    const rowTop = document.createElement('div');
    rowTop.className = 'poll-option-top';
    const label = document.createElement('span');
    label.className = 'poll-option-label';
    label.textContent = opt;
    rowTop.appendChild(label);
    const count = document.createElement('span');
    count.className = 'poll-option-count';
    count.textContent = `${voters.length}/${totalVoters}`;
    rowTop.appendChild(count);
    row.appendChild(rowTop);

    const track = document.createElement('div');
    track.className = 'hours-bar-track';
    const fill = document.createElement('div');
    fill.className = 'hours-bar-fill';
    fill.style.width = `${(voters.length / totalVoters) * 100}%`;
    fill.style.background = '#6B6354';
    track.appendChild(fill);
    row.appendChild(track);

    if (voters.length > 0) {
      const dots = document.createElement('div');
      dots.className = 'poll-voter-dots';
      voters.forEach(p => {
        const d = document.createElement('span');
        d.className = 'dot';
        d.style.background = COLORS[p];
        d.title = p;
        dots.appendChild(d);
      });
      row.appendChild(dots);
    }

    card.appendChild(row);
  });

  return card;
}

function renderPolls() {
  const polls = getPolls();
  const active = polls.filter(p => !p.closed);
  const closed = polls.filter(p => p.closed);

  const activeWrap = document.getElementById('poll-list');
  if (activeWrap) {
    activeWrap.innerHTML = '';
    if (active.length === 0) {
      activeWrap.innerHTML = '<div class="empty-state">No polls yet — create one above.</div>';
    } else {
      active.slice().sort((a, b) => b.date.localeCompare(a.date)).forEach(p => activeWrap.appendChild(buildPollCard(p, false)));
    }
  }

  const toggleBtn = document.getElementById('toggle-closed-polls-btn');
  const closedWrap = document.getElementById('closed-poll-list');
  if (toggleBtn) toggleBtn.textContent = showClosedPolls ? 'Hide closed polls' : `Show closed polls (${closed.length})`;
  if (closedWrap) {
    closedWrap.style.display = showClosedPolls ? 'block' : 'none';
    if (showClosedPolls) {
      closedWrap.innerHTML = '';
      if (closed.length === 0) {
        closedWrap.innerHTML = '<div class="empty-state">Nothing closed yet.</div>';
      } else {
        closed.slice().sort((a, b) => b.date.localeCompare(a.date)).forEach(p => closedWrap.appendChild(buildPollCard(p, true)));
      }
    }
  }
}
document.getElementById('toggle-closed-polls-btn').onclick = () => {
  showClosedPolls = !showClosedPolls;
  renderPolls();
};
document.getElementById('add-poll-btn').onclick = async () => {
  const questionInput = document.getElementById('poll-question-input');
  const question = questionInput.value.trim();
  const optionInputs = [0, 1, 2, 3].map(i => document.getElementById(`poll-option-${i}-input`));
  const options = optionInputs.map(el => el.value.trim()).filter(Boolean);
  if (!question) { alert('Write a question first.'); return; }
  if (options.length < 2) { alert('Add at least 2 options.'); return; }
  const poll = { id: `poll-${Date.now()}`, question, options, votes: {}, date: todayISO(), closed: false };
  const updated = [...getPolls(), poll];
  await savePolls(updated);
  questionInput.value = '';
  optionInputs.forEach(el => { el.value = ''; });
  renderPolls();
};

/* =========================================================================
   GOAL TRACKER — shared progress trackers like "Audit 2026". Each
   person logs their own current/target; percentage is computed.
   Same settings-based storage as everything else, and the same
   archive pattern as wagers (archived goals move out but aren't
   lost). Categories work exactly like Patch Notes/Tickets. A goal's
   `mode` is either 'completion' (x of y, e.g. 16/26 audits) or
   'target' (working toward a number, e.g. 420/500 hours) — both use
   the same completed/total fields under the hood, just labeled and
   displayed differently.
   ========================================================================= */
function getGoals() {
  try { return JSON.parse(settings.goals || '[]'); } catch (e) { return []; }
}
async function saveGoals(list) {
  settings.goals = JSON.stringify(list);
  try { await apiSetSetting('goals', settings.goals); } catch (e) { console.error('Failed to save goals', e); }
}
function getGoalCategoriesList() {
  const cats = new Set(getGoals().map(g => g.category || 'General'));
  cats.add('General');
  return [...cats].sort();
}
function renderGoalCategoryDatalist() {
  const dl = document.getElementById('goal-category-datalist');
  if (!dl) return;
  dl.innerHTML = getGoalCategoriesList().map(c => `<option value="${c}"></option>`).join('');
}
function escapeXml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

let showArchivedGoals = false;
let collapsedGoalCategories = new Set();

function blankGoalProgress() {
  const progress = {};
  PEOPLE.forEach(p => { progress[p] = { completed: 0, total: 0 }; });
  return progress;
}

function buildGoalCard(g, isArchived) {
  const mode = g.mode || 'completion';
  const unit = g.unit ? ` ${g.unit}` : '';
  const card = document.createElement('div');
  card.className = 'goal-card' + (isArchived ? ' archived' : '');

  const top = document.createElement('div');
  top.className = 'goal-top';
  const name = document.createElement('div');
  name.className = 'goal-name';
  name.textContent = g.name;
  top.appendChild(name);

  const btnRow = document.createElement('div');
  btnRow.className = 'goal-btn-row';
  const catSelect = buildCategorySelect(getGoalCategoriesList(), g.category || 'General', async (newCat) => {
    const updated = getGoals().map(x => x.id === g.id ? { ...x, category: newCat } : x);
    await saveGoals(updated);
    renderGoalTracker();
  });
  btnRow.appendChild(catSelect);
  const archiveBtn = document.createElement('button');
  archiveBtn.className = 'archive-btn';
  archiveBtn.textContent = isArchived ? 'Unarchive' : 'Archive';
  archiveBtn.onclick = async () => {
    const updated = getGoals().map(x => x.id === g.id ? { ...x, archived: !isArchived } : x);
    await saveGoals(updated);
    renderGoalTracker();
  };
  btnRow.appendChild(archiveBtn);
  const del = document.createElement('button');
  del.className = 'delete-btn';
  del.textContent = '✕';
  del.title = 'Delete this goal entirely';
  del.onclick = async () => {
    if (!confirm(`Delete "${g.name}"? This can't be undone.`)) return;
    const updated = getGoals().filter(x => x.id !== g.id);
    await saveGoals(updated);
    renderGoalTracker();
  };
  btnRow.appendChild(del);
  top.appendChild(btnRow);
  card.appendChild(top);

  if (mode === 'target') {
    const sub = document.createElement('div');
    sub.style.cssText = 'font-family:"IBM Plex Mono",monospace; font-size:10px; color:var(--faint); margin:-8px 0 10px; text-transform:uppercase; letter-spacing:0.06em;';
    sub.textContent = `Target${g.unit ? ' · ' + g.unit : ''}`;
    card.appendChild(sub);
  }

  PEOPLE.forEach(p => {
    const prog = (g.progress && g.progress[p]) || { completed: 0, total: 0 };
    const pctRaw = prog.total > 0 ? Math.round((prog.completed / prog.total) * 100) : 0;
    const pct = Math.min(pctRaw, 100);
    const delta = prog.completed - prog.total;

    const row = document.createElement('div');
    row.className = 'goal-progress-row';
    const rowTop = document.createElement('div');
    rowTop.className = 'goal-progress-top';
    const pName = document.createElement('span');
    pName.className = 'goal-progress-name';
    pName.textContent = p;
    pName.style.color = COLORS[p];
    rowTop.appendChild(pName);

    const inputsWrap = document.createElement('span');
    inputsWrap.className = 'goal-progress-inputs';
    const completedInput = document.createElement('input');
    completedInput.type = 'number';
    completedInput.min = '0';
    completedInput.className = 'score-input';
    completedInput.value = prog.completed;
    completedInput.disabled = isArchived;
    const sep = document.createElement('span');
    sep.className = 'score-sep';
    sep.textContent = '/';
    const totalInput = document.createElement('input');
    totalInput.type = 'number';
    totalInput.min = '0';
    totalInput.className = 'score-input';
    totalInput.value = prog.total;
    totalInput.disabled = isArchived;

    const commitChange = async () => {
      const completed = Math.max(0, parseInt(completedInput.value) || 0);
      const total = Math.max(0, parseInt(totalInput.value) || 0);
      const updated = getGoals().map(x => {
        if (x.id !== g.id) return x;
        const newProgress = { ...(x.progress || blankGoalProgress()) };
        newProgress[p] = { completed, total };
        return { ...x, progress: newProgress };
      });
      await saveGoals(updated);
      renderGoalTracker();
    };
    completedInput.onchange = commitChange;
    totalInput.onchange = commitChange;

    inputsWrap.appendChild(completedInput);
    inputsWrap.appendChild(sep);
    inputsWrap.appendChild(totalInput);
    if (unit) {
      const unitLabel = document.createElement('span');
      unitLabel.style.cssText = 'font-size:11px; color:var(--faint); font-family:"IBM Plex Mono",monospace;';
      unitLabel.textContent = unit;
      inputsWrap.appendChild(unitLabel);
    }
    rowTop.appendChild(inputsWrap);

    if (mode === 'target') {
      const deltaBadge = document.createElement('span');
      deltaBadge.className = 'goal-progress-pct';
      deltaBadge.style.color = 'var(--ink)';
      if (prog.total <= 0) {
        deltaBadge.textContent = '—';
      } else if (delta > 0) {
        deltaBadge.textContent = `+${delta}${unit} above`;
      } else if (delta < 0) {
        deltaBadge.textContent = `${delta}${unit} below`;
      } else {
        deltaBadge.textContent = 'on target';
      }
      rowTop.appendChild(deltaBadge);
      row.appendChild(rowTop);
      card.appendChild(row);
      return;
    }

    const pctEl = document.createElement('span');
    pctEl.className = 'goal-progress-pct';
    pctEl.style.color = pct >= 100 ? '#2E9B5C' : 'var(--muted)';
    pctEl.textContent = `${pct}%`;
    rowTop.appendChild(pctEl);
    row.appendChild(rowTop);

    const track = document.createElement('div');
    track.className = 'hours-bar-track';
    const fill = document.createElement('div');
    fill.className = 'hours-bar-fill';
    fill.style.width = `${pct}%`;
    fill.style.background = COLORS[p];
    track.appendChild(fill);
    row.appendChild(track);

    card.appendChild(row);
  });

  return card;
}

function renderGoalCategoryGroups(wrap, goalsList, isArchived) {
  wrap.innerHTML = '';
  if (goalsList.length === 0) {
    wrap.innerHTML = isArchived
      ? '<div class="empty-state">Nothing archived yet.</div>'
      : '<div class="empty-state">No goals yet — add one above, e.g. "Audit 2026".</div>';
    return;
  }
  const byCategory = {};
  goalsList.forEach(g => {
    const cat = g.category || 'General';
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(g);
  });
  Object.keys(byCategory).sort().forEach(cat => {
    const catGoals = byCategory[cat];
    const isOpen = !collapsedGoalCategories.has(cat);

    const group = document.createElement('div');
    group.className = 'category-group';
    const header = document.createElement('div');
    header.className = 'category-header' + (isOpen ? ' open' : '');
    header.innerHTML = `<span class="chevron">▸</span><span class="category-name">${cat}</span><span class="category-count">${catGoals.length}</span>`;
    header.onclick = () => {
      if (collapsedGoalCategories.has(cat)) collapsedGoalCategories.delete(cat);
      else collapsedGoalCategories.add(cat);
      renderGoalTracker();
    };
    group.appendChild(header);

    const body = document.createElement('div');
    body.className = 'category-body' + (isOpen ? ' open' : '');
    catGoals.forEach(g => body.appendChild(buildGoalCard(g, isArchived)));
    group.appendChild(body);

    wrap.appendChild(group);
  });
}

function buildDonutSVG(pct, color) {
  const size = 64, r = 24, stroke = 7, cx = 32, cy = 32;
  const clamped = Math.max(0, Math.min(pct, 100));
  const circumference = 2 * Math.PI * r;
  const offset = circumference * (1 - clamped / 100);
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--track)" stroke-width="${stroke}"></circle>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round"
      stroke-dasharray="${circumference.toFixed(2)}" stroke-dashoffset="${offset.toFixed(2)}"
      transform="rotate(-90 ${cx} ${cy})"></circle>
    <text x="${cx}" y="${cy + 4}" text-anchor="middle" font-family="'IBM Plex Mono', monospace" font-size="12" font-weight="700" fill="var(--ink)">${Math.round(pct)}%</text>
  </svg>`;
}

function buildVarianceSVG(g) {
  const width = 330, centerX = 165, halfWidth = 130, labelMargin = 8;
  const deltas = PEOPLE.map(p => {
    const prog = (g.progress && g.progress[p]) || { completed: 0, total: 0 };
    return prog.completed - prog.total;
  });
  const maxAbsDelta = Math.max(1, ...deltas.map(d => Math.abs(d)));
  const unit = g.unit ? ` ${g.unit}` : '';

  let lanes = '';
  PEOPLE.forEach((p, i) => {
    const delta = deltas[i];
    const laneY = 24 + i * 34;
    const barLen = (Math.abs(delta) / maxAbsDelta) * halfWidth;
    const barX = delta >= 0 ? centerX : centerX - barLen;
    const labelText = delta === 0 ? 'on target' : `${delta > 0 ? '+' : ''}${delta}${unit}`;
    const labelX = delta >= 0 ? centerX + barLen + labelMargin : centerX - barLen - labelMargin;
    const labelAnchor = delta >= 0 ? 'start' : 'end';
    lanes += `
      <text x="4" y="${laneY + 4}" font-family="'IBM Plex Mono', monospace" font-size="10" font-weight="700" fill="${COLORS[p]}">${escapeXml(p[0])}</text>
      <rect x="${Math.min(barX, centerX)}" y="${laneY - 5}" width="${Math.max(barLen, 0.5)}" height="10" rx="3" fill="${COLORS[p]}"></rect>
      <text x="${labelX}" y="${laneY + 4}" text-anchor="${labelAnchor}" font-family="'IBM Plex Mono', monospace" font-size="10" font-weight="600" fill="var(--muted)">${escapeXml(labelText)}</text>
    `;
  });
  const svgHeight = 24 + PEOPLE.length * 34;
  return `<svg viewBox="0 0 ${width} ${svgHeight}" width="100%" style="max-width:100%; height:auto; display:block;">
    <line x1="${centerX}" y1="4" x2="${centerX}" y2="${svgHeight - 4}" stroke="var(--faint)" stroke-width="1.5" stroke-dasharray="3,3"></line>
    <text x="${centerX}" y="12" text-anchor="middle" font-family="'IBM Plex Mono', monospace" font-size="9" fill="var(--faint)">target</text>
    ${lanes}
  </svg>`;
}

function buildGoalChartCard(g) {
  const mode = g.mode || 'completion';
  let inner;
  if (mode === 'target') {
    inner = buildVarianceSVG(g);
  } else {
    inner = `<div class="goal-chart-donuts">` + PEOPLE.map(p => {
      const prog = (g.progress && g.progress[p]) || { completed: 0, total: 0 };
      const pct = prog.total > 0 ? (prog.completed / prog.total) * 100 : 0;
      return `<div class="goal-chart-donut-item">
        ${buildDonutSVG(pct, COLORS[p])}
        <div style="margin-top:4px; font-weight:600; color:${COLORS[p]};">${escapeXml(p)}</div>
        <div style="color:var(--faint);">${prog.completed}/${prog.total}</div>
      </div>`;
    }).join('') + `</div>`;
  }
  return `<div class="goal-chart-card">
    <div class="goal-chart-title">${escapeXml(g.name)}${mode === 'target' ? ' <span style="font-size:10px; font-weight:400; color:var(--faint); font-family:\'IBM Plex Mono\',monospace;">(variance from target)</span>' : ''}</div>
    ${inner}
  </div>`;
}

function renderGoalTracker() {
  renderGoalCategoryDatalist();
  const goals = getGoals();
  const active = goals.filter(g => !g.archived);
  const archived = goals.filter(g => g.archived);

  const chartWrap = document.getElementById('goal-chart');
  if (chartWrap) {
    chartWrap.innerHTML = active.length === 0
      ? '<div class="empty-state">No active goals to chart yet.</div>'
      : active.map(g => buildGoalChartCard(g)).join('');
  }

  const activeWrap = document.getElementById('goal-list');
  if (activeWrap) renderGoalCategoryGroups(activeWrap, active, false);

  const archivedToggleBtn = document.getElementById('toggle-archived-goals-btn');
  const archivedWrap = document.getElementById('archived-goal-list');
  if (archivedToggleBtn) archivedToggleBtn.textContent = showArchivedGoals ? 'Hide archived goals' : `Show archived goals (${archived.length})`;
  if (archivedWrap) {
    archivedWrap.style.display = showArchivedGoals ? 'block' : 'none';
    if (showArchivedGoals) renderGoalCategoryGroups(archivedWrap, archived, true);
  }
}
document.getElementById('toggle-archived-goals-btn').onclick = () => {
  showArchivedGoals = !showArchivedGoals;
  renderGoalTracker();
};
document.getElementById('goal-expand-all-btn').onclick = () => {
  collapsedGoalCategories.clear();
  renderGoalTracker();
};
document.getElementById('goal-collapse-all-btn').onclick = () => {
  collapsedGoalCategories = new Set(getGoalCategoriesList());
  renderGoalTracker();
};
document.getElementById('add-goal-btn').onclick = async () => {
  const categoryInput = document.getElementById('goal-category-input');
  const modeInput = document.getElementById('goal-mode-input');
  const unitInput = document.getElementById('goal-unit-input');
  const input = document.getElementById('goal-name-input');
  const category = categoryInput.value.trim() || 'General';
  const mode = modeInput.value;
  const unit = unitInput.value.trim();
  const name = input.value.trim();
  if (!name) { alert('Give the goal a name.'); return; }
  const goal = { id: `g-${Date.now()}`, name, category, mode, unit, date: todayISO(), archived: false, progress: blankGoalProgress() };
  const updated = [...getGoals(), goal];
  await saveGoals(updated);
  categoryInput.value = '';
  unitInput.value = '';
  input.value = '';
  renderGoalTracker();
};

/* ---------------------------------------------------------------------
   Init
   --------------------------------------------------------------------- */
document.getElementById('backfill-date').value = todayISO();
document.getElementById('patch-date-input').value = todayISO();
renderMini('energy', 'mini-energy');
renderMini('stress', 'mini-stress');
renderMini('happiness', 'mini-happiness');
renderFactOfDay();
renderAnimalPic();
applyIdentityDefaults();
if (!whoAmI) showIdentityModal();

if (!WEB_APP_URL) {
  const banner = document.getElementById('config-banner');
  banner.style.display = 'block';
  banner.innerHTML = 'Setup needed: paste your Google Apps Script Web App URL into the <code>WEB_APP_URL</code> constant near the top of the script in this file, then re-upload to GitHub.';
  document.getElementById('add-shift-btn').disabled = true;
} else {
  loadData();
}
