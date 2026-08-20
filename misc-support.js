/* =========================================================================
   TAB SWITCHING
   ========================================================================= */
document.getElementById('tab-time').onclick = () => switchMainTab('time');
document.getElementById('tab-mood').onclick = () => switchMainTab('mood');
document.getElementById('tab-awards').onclick = () => switchMainTab('awards');
document.getElementById('tab-bets').onclick = () => switchMainTab('bets');
document.getElementById('tab-patchnotes').onclick = () => switchMainTab('patchnotes');
document.getElementById('tab-support').onclick = () => switchMainTab('support');
document.getElementById('tab-vault').onclick = () => switchMainTab('vault');
function switchMainTab(which) {
  document.getElementById('tab-time').classList.toggle('active', which === 'time');
  document.getElementById('tab-mood').classList.toggle('active', which === 'mood');
  document.getElementById('tab-awards').classList.toggle('active', which === 'awards');
  document.getElementById('tab-bets').classList.toggle('active', which === 'bets');
  document.getElementById('tab-patchnotes').classList.toggle('active', which === 'patchnotes');
  document.getElementById('tab-support').classList.toggle('active', which === 'support');
  document.getElementById('tab-vault').classList.toggle('active', which === 'vault');
  document.getElementById('view-time').classList.toggle('active', which === 'time');
  document.getElementById('view-mood').classList.toggle('active', which === 'mood');
  document.getElementById('view-awards').classList.toggle('active', which === 'awards');
  document.getElementById('view-bets').classList.toggle('active', which === 'bets');
  document.getElementById('view-patchnotes').classList.toggle('active', which === 'patchnotes');
  document.getElementById('view-support').classList.toggle('active', which === 'support');
  document.getElementById('view-vault').classList.toggle('active', which === 'vault');
  if (which === 'time') renderTimeTab();
  if (which === 'mood') renderMoodTab();
  if (which === 'awards') renderAwardsTab();
  if (which === 'bets') renderBetsTab();
  if (which === 'patchnotes') renderPatchNotes();
  if (which === 'support') renderSupportTab();
  if (which === 'vault') renderVaultTab();
}

/* ---------------------------------------------------------------------
   Misc — Decision Roulette + Quick Poll. No gate; always visible.
   --------------------------------------------------------------------- */
function renderVaultTab() {
  renderPolls();
}
function renderSupportTab() {
  renderTickets();
  renderSuggestions();
}

/* ---------------------------------------------------------------------
   Patch Notes — same settings-based storage trick as holidays and
   archived matches, so it works immediately with no backend changes.
   --------------------------------------------------------------------- */
/* ---------------------------------------------------------------------
   Shared: a small inline <select> to reassign an entry's category
   without opening full Edit mode — used by both Patch Notes and
   Ticket rows. "+ New category…" prompts for a name.
   --------------------------------------------------------------------- */
function buildCategorySelect(categories, currentValue, onChange) {
  const select = document.createElement('select');
  select.className = 'entry-category-select';
  categories.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c;
    opt.textContent = c;
    if (c === currentValue) opt.selected = true;
    select.appendChild(opt);
  });
  const newOpt = document.createElement('option');
  newOpt.value = '__new__';
  newOpt.textContent = '+ New…';
  select.appendChild(newOpt);
  select.onchange = () => {
    if (select.value === '__new__') {
      const name = prompt('New category name:');
      if (name && name.trim()) {
        onChange(name.trim());
      } else {
        select.value = currentValue;
      }
    } else {
      onChange(select.value);
    }
  };
  return select;
}

function getPatchNotes() {
  try { return JSON.parse(settings.patchNotes || '[]'); } catch (e) { return []; }
}
async function savePatchNotes(list) {
  settings.patchNotes = JSON.stringify(list);
  try { await apiSetSetting('patchNotes', settings.patchNotes); } catch (e) { console.error('Failed to save patch notes', e); }
}

let editingPatchId = null;
let collapsedPatchCategories = new Set();

function renderPatchCategoryDatalist() {
  const dl = document.getElementById('patch-category-datalist');
  if (!dl) return;
  const cats = [...new Set(getPatchNotes().map(n => n.category || 'General'))].sort();
  dl.innerHTML = cats.map(c => `<option value="${c}"></option>`).join('');
}
function getPatchCategoriesList() {
  const cats = new Set(getPatchNotes().map(n => n.category || 'General'));
  cats.add('General');
  return [...cats].sort();
}

function renderPatchNotes() {
  renderPatchCategoryDatalist();

  const wrap = document.getElementById('patch-notes-list');
  if (!wrap) return;
  wrap.innerHTML = '';
  const notes = getPatchNotes();
  if (notes.length === 0) {
    wrap.innerHTML = '<div class="empty-state">No patch notes yet — add the first one above.</div>';
    return;
  }

  const byCategory = {};
  notes.forEach(n => {
    const cat = n.category || 'General';
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(n);
  });

  Object.keys(byCategory).sort().forEach(cat => {
    const catNotes = byCategory[cat].sort((a, b) => b.date.localeCompare(a.date));
    const isOpen = !collapsedPatchCategories.has(cat);

    const group = document.createElement('div');
    group.className = 'category-group';

    const header = document.createElement('div');
    header.className = 'category-header' + (isOpen ? ' open' : '');
    header.innerHTML = `<span class="chevron">▸</span><span class="category-name">${cat}</span><span class="category-count">${catNotes.length}</span>`;
    header.onclick = () => {
      if (collapsedPatchCategories.has(cat)) collapsedPatchCategories.delete(cat);
      else collapsedPatchCategories.add(cat);
      renderPatchNotes();
    };
    group.appendChild(header);

    const body = document.createElement('div');
    body.className = 'category-body' + (isOpen ? ' open' : '');

    catNotes.forEach(n => {
      const entry = document.createElement('div');
      entry.className = 'patch-entry';
      const top = document.createElement('div');
      top.className = 'patch-top-line';
      const left = document.createElement('div');
      const date = document.createElement('div');
      date.className = 'patch-date';
      date.textContent = new Date(n.date + 'T00:00:00').toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' });
      left.appendChild(date);
      const title = document.createElement('div');
      title.className = 'patch-title';
      title.textContent = n.title;
      left.appendChild(title);
      top.appendChild(left);

      const btnGroup = document.createElement('div');
      btnGroup.style.cssText = 'display:flex; gap:6px; flex-shrink:0; align-items:center;';
      const catSelect = buildCategorySelect(getPatchCategoriesList(), n.category || 'General', async (newCat) => {
        const updated = getPatchNotes().map(x => x.id === n.id ? { ...x, category: newCat } : x);
        await savePatchNotes(updated);
        renderPatchNotes();
      });
      btnGroup.appendChild(catSelect);
      const edit = document.createElement('button');
      edit.className = 'entry-edit-btn';
      edit.textContent = 'Edit';
      edit.onclick = () => startEditPatch(n);
      btnGroup.appendChild(edit);
      const del = document.createElement('button');
      del.className = 'delete-btn';
      del.textContent = '✕';
      del.title = 'Remove this patch note';
      del.onclick = async () => {
        const updated = getPatchNotes().filter(x => x.id !== n.id);
        await savePatchNotes(updated);
        renderPatchNotes();
      };
      btnGroup.appendChild(del);
      top.appendChild(btnGroup);
      entry.appendChild(top);

      if (n.details) {
        const details = document.createElement('div');
        details.className = 'patch-details';
        details.textContent = n.details;
        entry.appendChild(details);
      }
      body.appendChild(entry);
    });

    group.appendChild(body);
    wrap.appendChild(group);
  });
}

function startEditPatch(n) {
  editingPatchId = n.id;
  document.getElementById('patch-category-input').value = n.category || '';
  document.getElementById('patch-date-input').value = n.date;
  document.getElementById('patch-title-input').value = n.title;
  document.getElementById('patch-details-input').value = n.details || '';
  document.getElementById('add-patch-btn').textContent = 'Save changes';
  document.getElementById('cancel-patch-edit-btn').style.display = 'inline-block';
  document.getElementById('patch-title-input').scrollIntoView({ behavior: 'smooth', block: 'center' });
}
function resetPatchForm() {
  editingPatchId = null;
  document.getElementById('patch-category-input').value = '';
  document.getElementById('patch-date-input').value = todayISO();
  document.getElementById('patch-title-input').value = '';
  document.getElementById('patch-details-input').value = '';
  document.getElementById('add-patch-btn').textContent = 'Add patch note';
  document.getElementById('cancel-patch-edit-btn').style.display = 'none';
}
document.getElementById('cancel-patch-edit-btn').onclick = resetPatchForm;
document.getElementById('patch-expand-all-btn').onclick = () => {
  collapsedPatchCategories.clear();
  renderPatchNotes();
};
document.getElementById('patch-collapse-all-btn').onclick = () => {
  collapsedPatchCategories = new Set(getPatchCategoriesList());
  renderPatchNotes();
};
document.getElementById('add-patch-btn').onclick = async () => {
  const categoryInput = document.getElementById('patch-category-input');
  const dateInput = document.getElementById('patch-date-input');
  const titleInput = document.getElementById('patch-title-input');
  const detailsInput = document.getElementById('patch-details-input');
  const category = categoryInput.value.trim() || 'General';
  const date = dateInput.value || todayISO();
  const title = titleInput.value.trim();
  const details = detailsInput.value.trim();
  if (!title) { alert('Give it a title at least.'); return; }

  const current = getPatchNotes();
  let updated;
  if (editingPatchId) {
    updated = current.map(n => n.id === editingPatchId ? { ...n, category, date, title, details } : n);
  } else {
    updated = [...current, { id: `p-${Date.now()}`, category, date, title, details }];
  }
  await savePatchNotes(updated);
  resetPatchForm();
  renderPatchNotes();
};

/* ---------------------------------------------------------------------
   Ticket Log — FAQ-style. Question always visible; tap to reveal the
   resolution. Open/closed state is local to the session (not saved).
   --------------------------------------------------------------------- */
function getTickets() {
  try { return JSON.parse(settings.tickets || '[]'); } catch (e) { return []; }
}
async function saveTickets(list) {
  settings.tickets = JSON.stringify(list);
  try { await apiSetSetting('tickets', settings.tickets); } catch (e) { console.error('Failed to save tickets', e); }
}
const TICKET_LOG_VISIBLE_KEY = 'punchboard-ticketlog-visible';
function isTicketLogVisible() { return localStorage.getItem(TICKET_LOG_VISIBLE_KEY) === 'true'; }
function setTicketLogVisible(v) { localStorage.setItem(TICKET_LOG_VISIBLE_KEY, v ? 'true' : 'false'); }

let openTicketIds = new Set();
let collapsedTicketCategories = new Set();
let editingTicketId = null;

function renderTicketCategoryDatalist() {
  const dl = document.getElementById('ticket-category-datalist');
  if (!dl) return;
  const cats = [...new Set(getTickets().map(t => t.category || 'General'))].sort();
  dl.innerHTML = cats.map(c => `<option value="${c}"></option>`).join('');
}
function getTicketCategoriesList() {
  const cats = new Set(getTickets().map(t => t.category || 'General'));
  cats.add('General');
  return [...cats].sort();
}

function renderTickets() {
  const content = document.getElementById('ticket-log-content');
  const toggleBtn = document.getElementById('ticket-log-toggle-btn');
  if (content && toggleBtn) {
    const visible = isTicketLogVisible();
    content.style.display = visible ? 'block' : 'none';
    toggleBtn.textContent = visible ? 'Hide' : 'Show';
  }
  renderTicketCategoryDatalist();

  const wrap = document.getElementById('ticket-list');
  if (!wrap) return;
  wrap.innerHTML = '';
  const tickets = getTickets();
  if (tickets.length === 0) {
    wrap.innerHTML = '<div class="empty-state">No tickets logged yet — the first one you add builds the FAQ.</div>';
    return;
  }

  const byCategory = {};
  tickets.forEach(t => {
    const cat = t.category || 'General';
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(t);
  });

  Object.keys(byCategory).sort().forEach(cat => {
    const catTickets = byCategory[cat].sort((a, b) => b.date.localeCompare(a.date));
    const isOpen = !collapsedTicketCategories.has(cat);

    const group = document.createElement('div');
    group.className = 'category-group';

    const header = document.createElement('div');
    header.className = 'category-header' + (isOpen ? ' open' : '');
    header.innerHTML = `<span class="chevron">▸</span><span class="category-name">${cat}</span><span class="category-count">${catTickets.length}</span>`;
    header.onclick = () => {
      if (collapsedTicketCategories.has(cat)) collapsedTicketCategories.delete(cat);
      else collapsedTicketCategories.add(cat);
      renderTickets();
    };
    group.appendChild(header);

    const body = document.createElement('div');
    body.className = 'category-body' + (isOpen ? ' open' : '');

    catTickets.forEach(t => {
      const item = document.createElement('div');
      item.className = 'ticket-item' + (openTicketIds.has(t.id) ? ' open' : '');

      const question = document.createElement('div');
      question.className = 'ticket-question';
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = COLORS[t.person] || 'var(--faint)';
      question.appendChild(dot);
      const qText = document.createElement('span');
      qText.className = 'ticket-question-text';
      qText.textContent = t.issue;
      question.appendChild(qText);
      const chevron = document.createElement('span');
      chevron.className = 'ticket-chevron';
      chevron.textContent = '▸';
      question.appendChild(chevron);
      question.onclick = () => {
        if (openTicketIds.has(t.id)) openTicketIds.delete(t.id);
        else openTicketIds.add(t.id);
        renderTickets();
      };
      item.appendChild(question);

      const answer = document.createElement('div');
      answer.className = 'ticket-answer';
      answer.textContent = t.resolution;
      const meta = document.createElement('div');
      meta.className = 'ticket-meta';
      meta.textContent = `Logged by ${t.person} · ${new Date(t.date + 'T00:00:00').toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' })}`;
      answer.appendChild(meta);

      const btnRow = document.createElement('div');
      btnRow.style.cssText = 'display:flex; gap:8px; margin-top:8px; align-items:center; flex-wrap:wrap;';
      const catSelect = buildCategorySelect(getTicketCategoriesList(), t.category || 'General', async (newCat) => {
        const updated = getTickets().map(x => x.id === t.id ? { ...x, category: newCat } : x);
        await saveTickets(updated);
        renderTickets();
      });
      catSelect.onclick = (ev) => ev.stopPropagation();
      btnRow.appendChild(catSelect);
      const edit = document.createElement('button');
      edit.className = 'entry-edit-btn';
      edit.textContent = 'Edit';
      edit.onclick = (ev) => { ev.stopPropagation(); startEditTicket(t); };
      btnRow.appendChild(edit);
      const del = document.createElement('button');
      del.className = 'delete-btn';
      del.textContent = '✕ remove';
      del.style.fontSize = '11px';
      del.style.fontFamily = "'IBM Plex Mono', monospace";
      del.onclick = async (ev) => {
        ev.stopPropagation();
        const updated = getTickets().filter(x => x.id !== t.id);
        await saveTickets(updated);
        openTicketIds.delete(t.id);
        renderTickets();
      };
      btnRow.appendChild(del);
      answer.appendChild(btnRow);

      item.appendChild(answer);
      body.appendChild(item);
    });

    group.appendChild(body);
    wrap.appendChild(group);
  });
}

function startEditTicket(t) {
  editingTicketId = t.id;
  document.getElementById('ticket-category-input').value = t.category || '';
  document.getElementById('ticket-person-input').value = t.person;
  document.getElementById('ticket-issue-input').value = t.issue;
  document.getElementById('ticket-resolution-input').value = t.resolution;
  document.getElementById('add-ticket-btn').textContent = 'Save changes';
  document.getElementById('cancel-ticket-edit-btn').style.display = 'inline-block';
  document.getElementById('ticket-issue-input').scrollIntoView({ behavior: 'smooth', block: 'center' });
}
function resetTicketForm() {
  editingTicketId = null;
  document.getElementById('ticket-category-input').value = '';
  document.getElementById('ticket-issue-input').value = '';
  document.getElementById('ticket-resolution-input').value = '';
  document.getElementById('add-ticket-btn').textContent = 'Log ticket';
  document.getElementById('cancel-ticket-edit-btn').style.display = 'none';
  applyIdentityDefaults(); // restore the person dropdown to whoAmI
}
document.getElementById('cancel-ticket-edit-btn').onclick = resetTicketForm;
document.getElementById('ticket-expand-all-btn').onclick = () => {
  collapsedTicketCategories.clear();
  renderTickets();
};
document.getElementById('ticket-collapse-all-btn').onclick = () => {
  collapsedTicketCategories = new Set(getTicketCategoriesList());
  renderTickets();
};
document.getElementById('ticket-log-toggle-btn').onclick = () => {
  setTicketLogVisible(!isTicketLogVisible());
  renderTickets();
};
document.getElementById('add-ticket-btn').onclick = async () => {
  const categoryInput = document.getElementById('ticket-category-input');
  const personInput = document.getElementById('ticket-person-input');
  const issueInput = document.getElementById('ticket-issue-input');
  const resolutionInput = document.getElementById('ticket-resolution-input');
  const category = categoryInput.value.trim() || 'General';
  const person = personInput.value;
  const issue = issueInput.value.trim();
  const resolution = resolutionInput.value.trim();
  if (!issue || !resolution) { alert('Fill in both the issue and how it was solved.'); return; }

  const current = getTickets();
  let updated;
  if (editingTicketId) {
    updated = current.map(t => t.id === editingTicketId ? { ...t, category, person, issue, resolution } : t);
  } else {
    updated = [...current, { id: `t-${Date.now()}`, date: todayISO(), category, person, issue, resolution }];
  }
  await saveTickets(updated);
  resetTicketForm();
  renderTickets();
};

/* =========================================================================
   SUGGESTION BOX — anyone logs a feature idea. Mark-done archives it
   into a collapsible list (same pattern as Goal Tracker/wagers) rather
   than deleting, so ideas aren't lost even once acted on.
   ========================================================================= */
function getSuggestions() {
  try { return JSON.parse(settings.suggestions || '[]'); } catch (e) { return []; }
}
async function saveSuggestions(list) {
  settings.suggestions = JSON.stringify(list);
  try { await apiSetSetting('suggestions', settings.suggestions); } catch (e) { console.error('Failed to save suggestions', e); }
}
let showDoneSuggestions = false;

function buildSuggestionRow(s, isDone) {
  const row = document.createElement('div');
  row.className = 'holiday-row';
  const dot = document.createElement('span');
  dot.className = 'dot';
  dot.style.background = COLORS[s.person] || 'var(--faint)';
  row.appendChild(dot);
  const text = document.createElement('span');
  text.className = 'suggestion-text';
  text.textContent = s.text;
  row.appendChild(text);
  const date = document.createElement('span');
  date.className = 'holiday-date';
  date.textContent = new Date(s.date + 'T00:00:00').toLocaleDateString([], { day: '2-digit', month: 'short' });
  row.appendChild(date);
  const toggle = document.createElement('button');
  toggle.className = 'archive-btn';
  toggle.textContent = isDone ? 'Restore' : 'Mark done';
  toggle.onclick = async () => {
    const updated = getSuggestions().map(x => x.id === s.id ? { ...x, done: !isDone } : x);
    await saveSuggestions(updated);
    renderSuggestions();
  };
  row.appendChild(toggle);
  const del = document.createElement('button');
  del.className = 'delete-btn';
  del.textContent = '✕';
  del.title = 'Remove this suggestion';
  del.onclick = async () => {
    const updated = getSuggestions().filter(x => x.id !== s.id);
    await saveSuggestions(updated);
    renderSuggestions();
  };
  row.appendChild(del);
  return row;
}

function renderSuggestions() {
  const suggestions = getSuggestions();
  const active = suggestions.filter(s => !s.done);
  const done = suggestions.filter(s => s.done);

  const activeWrap = document.getElementById('suggestion-list');
  if (activeWrap) {
    activeWrap.innerHTML = '';
    if (active.length === 0) {
      activeWrap.innerHTML = '<div class="empty-state">No suggestions yet — add the first one above.</div>';
    } else {
      active.slice().sort((a, b) => b.date.localeCompare(a.date)).forEach(s => activeWrap.appendChild(buildSuggestionRow(s, false)));
    }
  }

  const toggleBtn = document.getElementById('toggle-done-suggestions-btn');
  const doneWrap = document.getElementById('done-suggestion-list');
  if (toggleBtn) toggleBtn.textContent = showDoneSuggestions ? 'Hide done suggestions' : `Show done suggestions (${done.length})`;
  if (doneWrap) {
    doneWrap.style.display = showDoneSuggestions ? 'block' : 'none';
    doneWrap.innerHTML = '';
    if (showDoneSuggestions) {
      if (done.length === 0) {
        doneWrap.innerHTML = '<div class="empty-state">Nothing marked done yet.</div>';
      } else {
        done.slice().sort((a, b) => b.date.localeCompare(a.date)).forEach(s => doneWrap.appendChild(buildSuggestionRow(s, true)));
      }
    }
  }
}
document.getElementById('toggle-done-suggestions-btn').onclick = () => {
  showDoneSuggestions = !showDoneSuggestions;
  renderSuggestions();
};
document.getElementById('add-suggestion-btn').onclick = async () => {
  const personInput = document.getElementById('suggestion-person-input');
  const textInput = document.getElementById('suggestion-text-input');
  const text = textInput.value.trim();
  if (!text) { alert('Write the suggestion first.'); return; }
  const suggestion = { id: `s-${Date.now()}`, person: personInput.value, text, date: todayISO(), done: false };
  const updated = [...getSuggestions(), suggestion];
  await saveSuggestions(updated);
  textInput.value = '';
  renderSuggestions();
};

/* =========================================================================
   🧪 ALPHA: DECISION ROULETTE — pure client-side fun, nothing persisted
   yet (including who's excluded / custom options — resets on reload).
   Spins through whatever's in the pool then lands on one at random.
   ========================================================================= */
const ROULETTE_FALLBACK_COLORS = ['#C98A3D', '#6B6354', '#2E9B5C', '#8B6F47', '#D97757', '#4A7C7C'];
let rouletteCustomOptions = [];

function renderRouletteChecks() {
  const wrap = document.getElementById('roulette-people-checks');
  if (!wrap) return;
  wrap.innerHTML = '';
  PEOPLE.forEach(p => {
    const label = document.createElement('label');
    label.className = 'roulette-check-item';
    label.style.color = COLORS[p];
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.id = `roulette-check-${p}`;
    cb.checked = true;
    label.appendChild(cb);
    label.appendChild(document.createTextNode(p));
    wrap.appendChild(label);
  });
}
function renderRouletteCustomList() {
  const wrap = document.getElementById('roulette-custom-list');
  if (!wrap) return;
  wrap.innerHTML = '';
  rouletteCustomOptions.forEach((opt, i) => {
    const chip = document.createElement('span');
    chip.className = 'roulette-chip';
    const text = document.createElement('span');
    text.textContent = opt;
    chip.appendChild(text);
    const del = document.createElement('button');
    del.textContent = '✕';
    del.onclick = () => {
      rouletteCustomOptions.splice(i, 1);
      renderRouletteCustomList();
    };
    chip.appendChild(del);
    wrap.appendChild(chip);
  });
}
document.getElementById('roulette-add-custom-btn').onclick = () => {
  const input = document.getElementById('roulette-custom-input');
  const val = input.value.trim();
  if (!val) return;
  rouletteCustomOptions.push(val);
  input.value = '';
  renderRouletteCustomList();
};

function getRouletteColor(item, index) {
  return COLORS[item] || ROULETTE_FALLBACK_COLORS[index % ROULETTE_FALLBACK_COLORS.length];
}

function spinRoulette() {
  const includedPeople = PEOPLE.filter(p => {
    const cb = document.getElementById(`roulette-check-${p}`);
    return cb && cb.checked;
  });
  const pool = [...includedPeople, ...rouletteCustomOptions];
  const resultEl = document.getElementById('roulette-result');
  if (pool.length === 0) {
    resultEl.innerHTML = '<div class="empty-state">Nothing to spin — include at least one person or add a custom option.</div>';
    return;
  }

  const questionInput = document.getElementById('roulette-question-input');
  const question = questionInput.value.trim();
  const finalPick = pool[Math.floor(Math.random() * pool.length)];
  const finalColor = getRouletteColor(finalPick, pool.indexOf(finalPick));

  resultEl.innerHTML = `<div class="roulette-spinning" id="roulette-spinning">—</div><div class="roulette-caption" id="roulette-caption"></div>`;
  const spinEl = document.getElementById('roulette-spinning');
  const captionEl = document.getElementById('roulette-caption');

  let ticks = 0;
  const maxTicks = 14 + Math.floor(Math.random() * 6);
  const spinInterval = setInterval(() => {
    const item = pool[ticks % pool.length];
    spinEl.textContent = item;
    spinEl.style.color = getRouletteColor(item, ticks % pool.length);
    ticks++;
    if (ticks >= maxTicks) {
      clearInterval(spinInterval);
      spinEl.textContent = finalPick;
      spinEl.style.color = finalColor;
      captionEl.textContent = question ? `"${question}" → ${finalPick}` : `${finalPick} it is.`;
      spawnConfetti();
    }
  }, 90);
}
document.getElementById('roulette-spin-btn').onclick = spinRoulette;
renderRouletteChecks();
renderRouletteCustomList();
