
/* =========================================================================
   CONFIG — paste your Apps Script Web App URL below between the quotes.
   ========================================================================= */
const WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbwm1XTMSf_1sz_KmwvoEEbllJxkZLIVM1wvIcB81vaGJJsA_4KKuO9dLBCLrdWmxebP/exec';

const PEOPLE = ['Luigi', 'Juan', 'Sergio'];
const COLORS = { Luigi: '#D97757', Juan: '#4A7C7C', Sergio: '#8B6F47' };
const ACTIVE_SHIFTS_KEY = 'punchboard-active-shifts';
const WHOAMI_KEY = 'punchboard-whoami';
const NUDGE_DISMISS_KEY = 'punchboard-mood-nudge-dismissed';

/* ---------------------------------------------------------------------
   Shared state (populated from one combined GET call)
   --------------------------------------------------------------------- */
let entries = [];
let moodEntries = [];
let matches = [];
let predictions = [];      // [{matchId, person, scoreA, scoreB}]
let winnerPicks = [];      // [{person, prediction}]
let settings = {};         // {baseBeers_Luigi, baseBeers_Juan, baseBeers_Sergio, actualWinner}

let activeShifts = JSON.parse(localStorage.getItem(ACTIVE_SHIFTS_KEY) || '{}');
let viewMode = 'lifetime';
let whoAmI = localStorage.getItem(WHOAMI_KEY) || null;

/* mood check-in state */
let moodPerson = 'Luigi';
let ratings = { energy: null, stress: null, happiness: null };
let backfillRatings = { energy: null, stress: null, happiness: null };
let moodFilters = new Set(PEOPLE);
let calMonthOffset = 0; // 0 = current month

/* ---------------------------------------------------------------------
   Formatting helpers
   --------------------------------------------------------------------- */
function formatDuration(hoursDecimal) {
  const totalMinutes = Math.round(hoursDecimal * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}
function formatSignedDuration(hoursDecimal) {
  const sign = hoursDecimal < 0 ? '−' : '+';
  return `${sign}${formatDuration(Math.abs(hoursDecimal))}`;
}
function formatClock(date) { return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
function formatDate(date) { return date.toLocaleDateString([], { day: '2-digit', month: 'short' }); }
function todayISO() { return new Date().toISOString().slice(0, 10); }
function moodColor(score) {
  if (score === null || score === undefined) return '#F0EBE1';
  if (score < 2) return '#E0503C';
  if (score < 3) return '#F2A03D';
  if (score < 4) return '#8FBF5C';
  return '#2E9B5C';
}
function moodWord(score) {
  if (score < 2) return 'Rough day';
  if (score < 3) return 'Okay day';
  if (score < 4) return 'Good day';
  return 'Great day';
}

/* ---------------------------------------------------------------------
   API layer — one GET returns everything; POST is action-routed
   --------------------------------------------------------------------- */
async function apiGetAll() {
  const res = await fetch(`${WEB_APP_URL}?t=${Date.now()}`);
  return await res.json();
}
async function apiPost(payload) {
  await fetch(WEB_APP_URL, { method: 'POST', body: JSON.stringify(payload) });
}
async function apiAddEntry(entry) { await apiPost({ action: 'add', entry }); }
async function apiDeleteEntry(id) { await apiPost({ action: 'delete', id }); }
async function apiAddMood(entry) { await apiPost({ action: 'addMood', entry }); }
async function apiDeleteMood(id) { await apiPost({ action: 'deleteMood', id }); }
async function apiAddMatch(match) { await apiPost({ action: 'addMatch', match }); }
async function apiSetMatchResult(matchId, resultA, resultB) { await apiPost({ action: 'setMatchResult', matchId, resultA, resultB }); }
async function apiSetPrediction(matchId, person, scoreA, scoreB) { await apiPost({ action: 'setPrediction', matchId, person, scoreA, scoreB }); }
async function apiSetWinnerPick(person, prediction) { await apiPost({ action: 'setWinnerPick', person, prediction }); }
async function apiSetSetting(key, value) { await apiPost({ action: 'setSetting', key, value }); }

function saveActiveShifts() { localStorage.setItem(ACTIVE_SHIFTS_KEY, JSON.stringify(activeShifts)); }

/* ---------------------------------------------------------------------
   Who-are-you identity — remembered per device via localStorage.
   Personalizes defaults (pre-filled dropdowns, highlighted card, mood
   tab). Doesn't restrict or hide anyone else's controls.
   --------------------------------------------------------------------- */
function renderIdentityOptions() {
  const wrap = document.getElementById('identity-options');
  wrap.innerHTML = '';
  PEOPLE.forEach(p => {
    const btn = document.createElement('button');
    btn.className = 'identity-option';
    const dot = document.createElement('span');
    dot.className = 'identity-dot';
    dot.style.background = COLORS[p];
    btn.appendChild(dot);
    btn.appendChild(document.createTextNode(p));
    btn.onclick = () => setIdentity(p);
    wrap.appendChild(btn);
  });
}
function showIdentityModal() {
  renderIdentityOptions();
  document.getElementById('identity-modal').style.display = 'flex';
}
function hideIdentityModal() {
  document.getElementById('identity-modal').style.display = 'none';
}
function setIdentity(person) {
  whoAmI = person;
  localStorage.setItem(WHOAMI_KEY, person);
  hideIdentityModal();
  applyIdentityDefaults();
  syncMoodToIdentity();
  renderTimeTab();
  renderMoodTab();
}
function applyIdentityDefaults() {
  const indicator = document.getElementById('whoami-text');
  if (whoAmI) {
    indicator.textContent = `You're ${whoAmI}`;
    const mp = document.getElementById('manual-person');
    const bp = document.getElementById('backfill-person');
    const hp = document.getElementById('entry-person-input');
    const tp = document.getElementById('ticket-person-input');
    const sp = document.getElementById('suggestion-person-input');
    if (mp) mp.value = whoAmI;
    if (bp) bp.value = whoAmI;
    if (hp) hp.value = whoAmI;
    if (tp) tp.value = whoAmI;
    if (sp) sp.value = whoAmI;
  } else {
    indicator.textContent = "Who's this?";
  }
}
function syncMoodToIdentity() {
  if (!whoAmI) return;
  moodPerson = whoAmI;
  const existing = findMoodEntry(whoAmI, todayISO());
  ratings = existing
    ? { energy: existing.energy, stress: existing.stress, happiness: existing.happiness }
    : { energy: null, stress: null, happiness: null };
}
document.getElementById('whoami-switch-btn').onclick = showIdentityModal;

/* ---------------------------------------------------------------------
   Theme picker — per-device preference via localStorage, so each
   person can pick their own without affecting anyone else. Only the
   page's core palette (backgrounds, text, borders) changes; person
   colors (Luigi/Juan/Sergio) stay constant across all themes.
   --------------------------------------------------------------------- */
const THEME_KEY = 'punchboard-theme';
const THEMES = [
  { key: 'classic', name: 'Classic', swatch: ['#F4F1EA', '#2B2823', '#D97757'] },
  { key: 'ocean',   name: 'Ocean',   swatch: ['#EEF3F5', '#1F3A4D', '#52707F'] },
  { key: 'forest',  name: 'Forest',  swatch: ['#EFF3EC', '#223626', '#55705C'] },
  { key: 'sunset',  name: 'Sunset',  swatch: ['#FBF0EA', '#4A2A22', '#8C6154'] },
];
function getTheme() { return localStorage.getItem(THEME_KEY) || 'classic'; }
function applyTheme(themeKey) {
  if (themeKey === 'classic') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', themeKey);
  localStorage.setItem(THEME_KEY, themeKey);
}
function renderThemeOptions() {
  const wrap = document.getElementById('theme-options');
  wrap.innerHTML = '';
  const current = getTheme();
  THEMES.forEach(t => {
    const btn = document.createElement('button');
    btn.className = 'identity-option';
    if (t.key === current) btn.style.borderColor = t.swatch[2];
    const swatchWrap = document.createElement('span');
    swatchWrap.style.cssText = 'display:flex; gap:3px; flex-shrink:0;';
    t.swatch.forEach(c => {
      const dot = document.createElement('span');
      dot.style.cssText = `width:10px; height:10px; border-radius:50%; background:${c}; display:inline-block; border:1px solid rgba(0,0,0,0.08);`;
      swatchWrap.appendChild(dot);
    });
    btn.appendChild(swatchWrap);
    btn.appendChild(document.createTextNode(t.name + (t.key === current ? ' (current)' : '')));
    btn.onclick = () => {
      applyTheme(t.key);
      renderThemeOptions();
    };
    wrap.appendChild(btn);
  });
}
document.getElementById('theme-switch-btn').onclick = () => {
  renderThemeOptions();
  document.getElementById('theme-modal').style.display = 'flex';
};
document.getElementById('theme-modal-close-btn').onclick = () => {
  document.getElementById('theme-modal').style.display = 'none';
};
applyTheme(getTheme()); // re-apply after DOM ready (head script already set data-theme early to avoid a flash)

/* =========================================================================
   Confetti — kept as a shared celebration effect (used by the Decision
   Roulette and by the Badges system below).
   ========================================================================= */
function spawnConfetti() {
  const colors = [COLORS.Luigi, COLORS.Juan, COLORS.Sergio, '#F2A03D', '#2E9B5C'];
  for (let i = 0; i < 40; i++) {
    const piece = document.createElement('div');
    piece.className = 'confetti-piece';
    piece.style.left = `${Math.random() * 100}vw`;
    piece.style.background = colors[Math.floor(Math.random() * colors.length)];
    piece.style.animationDuration = `${2 + Math.random() * 1.5}s`;
    piece.style.animationDelay = `${Math.random() * 0.4}s`;
    document.body.appendChild(piece);
    setTimeout(() => piece.remove(), 4000);
  }
}
/* ---------------------------------------------------------------------
   Birthday decorations — controlled from the separate developer page
   (dev.html), not from anything in this app. Reads two shared settings:
   birthdayMode ('true'/'false') and birthdayPerson (a name). Same
   settings-based storage as everything else, so no backend changes
   needed — dev.html just calls the same setSetting action.
   --------------------------------------------------------------------- */
function renderBirthdayDecorations() {
  const isOn = settings.birthdayMode === 'true' && settings.birthdayPerson;
  const banner = document.getElementById('birthday-banner');
  if (banner) {
    banner.style.display = isOn ? 'flex' : 'none';
    if (isOn) banner.textContent = `🎉🎂 HAPPY BIRTHDAY, ${settings.birthdayPerson.toUpperCase()}! 🎂🎉`;
  }
}

/* ---------------------------------------------------------------------
   Missing-days warning ribbons — posted from the developer page, read
   here from shared settings (missingDaysAlert). Two fixed ribbons, one
   on each edge, since they're meant to be hard to miss. Dismissing is
   local-only (per device, via localStorage) — it doesn't clear the
   shared alert, which only the developer page can turn off, so it'll
   come back on next load until actually cleared there.
   --------------------------------------------------------------------- */
const MISSING_DAYS_DISMISS_KEY = 'punchboard-missingdays-dismissed';
function getMissingDaysAlert() {
  try { return JSON.parse(settings.missingDaysAlert || 'null'); } catch (e) { return null; }
}
function renderMissingDaysBanners() {
  const alertData = getMissingDaysAlert();
  const leftBtn = document.getElementById('missing-days-ribbon-left');
  const rightBtn = document.getElementById('missing-days-ribbon-right');
  if (!leftBtn || !rightBtn) return;

  let dismissedFor = null;
  try { dismissedFor = localStorage.getItem(MISSING_DAYS_DISMISS_KEY); } catch (e) {}

  const shouldShow = alertData && alertData.active && dismissedFor !== `${alertData.person}:${alertData.days.join(',')}`;
  if (!shouldShow) {
    leftBtn.style.display = 'none';
    rightBtn.style.display = 'none';
    return;
  }

  const label = `⚠️ ${alertData.person} — ${alertData.days.length} day${alertData.days.length !== 1 ? 's' : ''} not recorded: ${alertData.days.join(', ')} (tap to dismiss)`;
  [leftBtn, rightBtn].forEach(btn => {
    btn.textContent = label;
    btn.style.display = 'block';
    btn.onclick = () => {
      try { localStorage.setItem(MISSING_DAYS_DISMISS_KEY, `${alertData.person}:${alertData.days.join(',')}`); } catch (e) {}
      leftBtn.style.display = 'none';
      rightBtn.style.display = 'none';
    };
  });
}

/* ---------------------------------------------------------------------
   Archived wagers — persisted via the existing 'setSetting' action
   (same one actualWinner already uses), so this works without needing
   any new backend support. Once a match id is in this list it's
   filtered out of `matches` on every load — permanently hidden and
   never recounted, which is what makes the beer credit stick exactly
   once instead of being re-earned every refresh.
   --------------------------------------------------------------------- */
function getArchivedMatchIds() {
  try {
    return JSON.parse(settings.archivedMatchIds || '[]');
  } catch (e) {
    return [];
  }
}
async function addArchivedMatchId(matchId) {
  const ids = getArchivedMatchIds();
  if (!ids.includes(matchId)) ids.push(matchId);
  settings.archivedMatchIds = JSON.stringify(ids);
  try { await apiSetSetting('archivedMatchIds', settings.archivedMatchIds); } catch (e) { console.error('Failed to persist archived match list', e); }
}

async function loadData() {
  try {
    const data = await apiGetAll();
    entries = data.entries || [];
    moodEntries = data.moodEntries || [];
    settings = data.settings || {};
    const archivedIds = getArchivedMatchIds();
    matches = (data.matches || []).filter(m => !archivedIds.includes(m.id));
    predictions = (data.predictions || []).filter(pr => !archivedIds.includes(pr.matchId));
    winnerPicks = data.winnerPicks || [];
    syncMoodToIdentity(); // re-derive today's ratings for whoAmI now that real data is in
  } catch (e) {
    console.error('Failed to load data', e);
    const b = document.createElement('div');
    b.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;background:#B3261E;color:#fff;padding:10px 14px;font:13px/1.4 sans-serif;word-break:break-all;';
    b.textContent = 'DATA LOAD FAILED: ' + (e && e.message ? e.message : e) + ' (tap to dismiss)';
    b.onclick = () => b.remove();
    document.body.appendChild(b);
  }
  renderTimeTab(); // default active tab on load — others render on demand via switchMainTab
  renderCrewPulse();
  renderBirthdayDecorations();
  renderMissingDaysBanners();
  if (typeof checkBadges === 'function') checkBadges(whoAmI);
}
