
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
  const res = await fetch(`${WEB_APP_URL}?t=${Date.now()}`, { cache: 'no-store' });
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

/* =========================================================================
   BADGES — replaces the old hidden-easter-egg system. Instead of secret
   taps/keywords nobody ever stumbled onto, these are visible, ongoing
   achievements computed straight from real app data (hours, streaks,
   beers, check-ins). Progress is always visible in the drawer, so
   there's something to work toward instead of a one-time secret.
   Persisted via the same generic settings store as everything else.
   ========================================================================= */
function longestMoodStreak(person) {
  const dates = Object.keys(personMoodMap(person)).sort();
  let longest = 0, current = 0, prev = null;
  dates.forEach(d => {
    current = (prev && Math.round((new Date(d) - new Date(prev)) / 86400000) === 1) ? current + 1 : 1;
    longest = Math.max(longest, current);
    prev = d;
  });
  return longest;
}
function personTotalHours(p) {
  return entries.filter(e => e.person === p).reduce((s, e) => s + e.hours, 0);
}
function personDaysWorked(p) {
  return new Set(entries.filter(e => e.person === p).map(e => e.start.slice(0, 10))).size;
}
function personCheckinCount(p) {
  return Object.keys(personMoodMap(p)).length;
}
function personCalledWorldCup(p) {
  return (typeof getWorldCupHistory === 'function' && getWorldCupHistory().some(h => h.callers.includes(p))) ? 1 : 0;
}

const BADGE_DEFINITIONS = [
  { key: 'first-punch',    name: 'First Punch',    icon: '⏱️', unit: 'shift',     desc: 'Log your very first shift.',               target: 1,   metric: p => entries.filter(e => e.person === p).length },
  { key: 'century-club',   name: 'Century Club',   icon: '💯', unit: 'hours',     desc: 'Log 100 total hours.',                     target: 100, metric: personTotalHours },
  { key: 'half-k-club',    name: 'Half-K Club',    icon: '🏔️', unit: 'hours',     desc: 'Log 500 total hours.',                     target: 500, metric: personTotalHours },
  { key: 'first-checkin',  name: 'Checked In',     icon: '📝', unit: 'check-in',  desc: 'Log your first mood check-in.',            target: 1,   metric: personCheckinCount },
  { key: 'week-streak',    name: 'Week Streak',    icon: '🔥', unit: 'days',      desc: 'Hit a 7-day mood check-in streak.',        target: 7,   metric: longestMoodStreak },
  { key: 'month-streak',   name: 'Month Streak',   icon: '🌋', unit: 'days',      desc: 'Hit a 30-day mood check-in streak.',       target: 30,  metric: longestMoodStreak },
  { key: 'vibe-historian', name: 'Vibe Historian', icon: '📚', unit: 'check-ins', desc: 'Log 50 mood check-ins.',                   target: 50,  metric: personCheckinCount },
  { key: 'beer-baron',     name: 'Beer Baron',     icon: '🍺', unit: 'rounds',    desc: 'Reach 5 beer rounds on the scoreboard.',   target: 5,   metric: p => Number(settings[`baseBeers_${p}`] || 0) },
  { key: 'oracle',         name: 'Oracle',         icon: '🔮', unit: 'call',      desc: 'Correctly call a World Cup winner.',       target: 1,   metric: personCalledWorldCup },
  { key: 'dedicated',      name: 'Dedicated',      icon: '📅', unit: 'days',      desc: 'Log shifts on 20 different days.',         target: 20,  metric: personDaysWorked },
];
function formatMetric(v, def) {
  return def.unit === 'hours' ? v.toFixed(1) : Math.round(v);
}

/* ---------------------------------------------------------------------
   Earned-badge tracking — persisted via settings, same approach as
   everything else. A badge is recorded the moment its metric crosses
   the target; only the device belonging to that person sees the
   celebration popup when it happens live.
   --------------------------------------------------------------------- */
function getBadgesEarned() {
  try { return JSON.parse(settings.badgesEarned || '{}'); } catch (e) { return {}; }
}
function hasAllBadges(person) {
  const earned = getBadgesEarned();
  return BADGE_DEFINITIONS.every(d => (earned[person] || []).includes(d.key));
}
async function checkBadges() {
  const earned = getBadgesEarned();
  let changed = false;
  PEOPLE.forEach(p => {
    if (!earned[p]) earned[p] = [];
    BADGE_DEFINITIONS.forEach(b => {
      if (!earned[p].includes(b.key) && b.metric(p) >= b.target) {
        earned[p].push(b.key);
        changed = true;
        if (p === whoAmI) {
          showBadge({ icon: b.icon, title: `${b.name} unlocked!`, message: b.desc });
        }
      }
    });
  });
  if (changed) {
    settings.badgesEarned = JSON.stringify(earned);
    try { await apiSetSetting('badgesEarned', settings.badgesEarned); } catch (e) { console.error('Failed to save badges', e); }
    renderPersonRow();
    for (const p of PEOPLE) {
      await checkIndividualBadgeMastery(p, earned);
    }
    await checkAllBadgesMastered(earned);
  }
  renderBadgeDrawer();
}

/* ---------------------------------------------------------------------
   Individual mastery — if ONE person earns all 10 badges on their own,
   they get a small gold medal badge next to their name wherever it
   appears, visible to everyone. Only they see the full "10/10" detail.
   --------------------------------------------------------------------- */
function getIndividualMasteryCelebrated() {
  try { return JSON.parse(settings.individualMasteryCelebrated || '[]'); } catch (e) { return []; }
}
const INDIVIDUAL_MASTERY_MESSAGES = [
  "Every badge in this app, earned by you alone. Impressive, honestly.",
  "10 for 10. The others will just see a medal — they won't know the breakdown unless you tell them.",
  "You've officially run out of badges to chase here. Achievement unlocked, for real this time.",
];
async function checkIndividualBadgeMastery(person, earned) {
  const allFound = BADGE_DEFINITIONS.every(d => (earned[person] || []).includes(d.key));
  if (!allFound) return;
  const celebrated = getIndividualMasteryCelebrated();
  if (celebrated.includes(person)) return;
  celebrated.push(person);
  settings.individualMasteryCelebrated = JSON.stringify(celebrated);
  try { await apiSetSetting('individualMasteryCelebrated', settings.individualMasteryCelebrated); } catch (e) { console.error('Failed to save individual mastery', e); }
  renderPersonRow();
  if (person === whoAmI) {
    showBadge({ icon: '🥇', title: `${person}, you earned everything.`, message: INDIVIDUAL_MASTERY_MESSAGES[Math.floor(Math.random() * INDIVIDUAL_MASTERY_MESSAGES.length)] });
  }
}

/* ---------------------------------------------------------------------
   Grand finale — if every person has earned every badge, a permanent,
   shared badge unlocks for good, for the whole crew, on every device.
   --------------------------------------------------------------------- */
const MASTERY_MESSAGES = [
  "Every badge in this app, earned by all three of you. That's dedication bordering on concerning.",
  "The Punch Board has nothing left to unlock for this crew. Wear that badge with pride.",
  "All ten. All three of you. Legendary status, permanently recorded.",
];
async function checkAllBadgesMastered(earned) {
  if (settings.allBadgesMastered === 'true') return;
  const allKeys = BADGE_DEFINITIONS.map(d => d.key);
  const everyoneEarnedEverything = PEOPLE.every(p => allKeys.every(k => (earned[p] || []).includes(k)));
  if (!everyoneEarnedEverything) return;
  settings.allBadgesMastered = 'true';
  try { await apiSetSetting('allBadgesMastered', 'true'); } catch (e) { console.error('Failed to save badge mastery flag', e); }
  renderBadgeMasteryDecoration();
  showBadge({ icon: '🏅', title: 'Every badge. Everyone. Forever.', message: MASTERY_MESSAGES[Math.floor(Math.random() * MASTERY_MESSAGES.length)] });
  spawnConfetti();
}
function renderBadgeMasteryDecoration() {
  const isMastered = settings.allBadgesMastered === 'true';
  const badge = document.getElementById('mastery-badge');
  if (badge) badge.style.display = isMastered ? 'inline' : 'none';
  const drawerToggle = document.getElementById('egg-drawer-toggle');
  if (drawerToggle) drawerToggle.textContent = isMastered ? '🏅 BADGES ✓' : '🏅 BADGES';
  const drawerBanner = document.getElementById('mastery-drawer-banner');
  if (drawerBanner) {
    drawerBanner.style.display = isMastered ? 'block' : 'none';
    if (isMastered) drawerBanner.innerHTML = '<div class="mastery-banner">🏅 LEGENDARY — every badge earned, by everyone</div>';
  }
}

function showBadge({ icon, title, message }) {
  spawnConfetti();
  document.getElementById('egg-eyebrow').textContent = `${icon} BADGE EARNED`;
  document.getElementById('egg-title').textContent = title;
  document.getElementById('egg-message').textContent = message;
  document.getElementById('egg-modal').style.display = 'flex';
}
document.getElementById('egg-close-btn').onclick = () => {
  document.getElementById('egg-modal').style.display = 'none';
};

/* ---------------------------------------------------------------------
   The drawer itself — toggle button pinned to the right edge, slides
   a panel in. Each badge shows who's earned it (colored dots) plus an
   expandable per-person progress bar so everyone can see how close
   they are, instead of a one-shot secret with no visible progress.
   --------------------------------------------------------------------- */
let openBadgeKeys = new Set();
function renderBadgeDrawer() {
  const wrap = document.getElementById('egg-drawer-list');
  if (!wrap) return;
  wrap.innerHTML = '';
  const earned = getBadgesEarned();
  BADGE_DEFINITIONS.forEach(def => {
    const anyoneEarned = PEOPLE.some(p => (earned[p] || []).includes(def.key));
    const row = document.createElement('div');
    row.className = 'egg-row' + (anyoneEarned ? ' found' : '');

    const top = document.createElement('div');
    top.className = 'egg-row-top';
    const icon = document.createElement('span');
    icon.className = 'egg-row-icon';
    icon.textContent = def.icon;
    top.appendChild(icon);
    const name = document.createElement('span');
    name.className = 'egg-row-name';
    name.textContent = def.name;
    top.appendChild(name);
    const dots = document.createElement('div');
    dots.className = 'egg-row-dots';
    PEOPLE.forEach(p => {
      const d = document.createElement('span');
      const got = (earned[p] || []).includes(def.key);
      d.className = 'egg-mini-dot' + (got ? ' got' : '');
      d.style.background = got ? COLORS[p] : '#fff';
      d.title = got ? `${p} earned this` : p;
      dots.appendChild(d);
    });
    top.appendChild(dots);
    row.appendChild(top);

    const desc = document.createElement('div');
    desc.className = 'egg-hint-text open';
    desc.style.marginBottom = '8px';
    desc.textContent = def.desc;
    row.appendChild(desc);

    const isOpen = openBadgeKeys.has(def.key);
    const hintBtn = document.createElement('button');
    hintBtn.className = 'egg-hint-btn';
    hintBtn.textContent = isOpen ? 'Hide progress' : 'Show progress';
    hintBtn.onclick = () => {
      if (openBadgeKeys.has(def.key)) openBadgeKeys.delete(def.key);
      else openBadgeKeys.add(def.key);
      renderBadgeDrawer();
    };
    row.appendChild(hintBtn);

    const progressWrap = document.createElement('div');
    progressWrap.className = 'egg-hint-text' + (isOpen ? ' open' : '');
    PEOPLE.forEach(p => {
      const metric = def.metric(p);
      const pct = Math.min(100, (metric / def.target) * 100);
      const pRow = document.createElement('div');
      pRow.style.cssText = 'margin-top:8px;';
      const label = document.createElement('div');
      label.className = 'leader-meta';
      label.style.marginBottom = '2px';
      label.textContent = `${p}: ${formatMetric(metric, def)} / ${formatMetric(def.target, def)} ${def.unit}`;
      pRow.appendChild(label);
      const track = document.createElement('div');
      track.className = 'hours-bar-track';
      const fill = document.createElement('div');
      fill.className = 'hours-bar-fill';
      fill.style.width = `${pct}%`;
      fill.style.background = COLORS[p];
      track.appendChild(fill);
      pRow.appendChild(track);
      progressWrap.appendChild(pRow);
    });
    row.appendChild(progressWrap);

    wrap.appendChild(row);
  });
}
document.getElementById('egg-drawer-toggle').onclick = () => {
  document.getElementById('egg-drawer').classList.add('open');
  renderBadgeDrawer();
};
document.getElementById('egg-drawer-close').onclick = () => {
  document.getElementById('egg-drawer').classList.remove('open');
};

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
  }
  renderTimeTab(); // default active tab on load — others render on demand via switchMainTab
  renderCrewPulse();
  renderBadgeDrawer();
  renderBadgeMasteryDecoration();
  renderBirthdayDecorations();
  renderMissingDaysBanners();
  try { await checkBadges(); } catch (e) { console.error('Failed to check badges', e); }
}
