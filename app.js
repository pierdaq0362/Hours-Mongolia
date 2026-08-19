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
    const hp = document.getElementById('holiday-person-input');
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
   SECRETS — 10 hidden easter eggs. No hints anywhere in the normal UI;
   each has a different unlock method on purpose. The 🥚 EGGS drawer on
   the right lets anyone check progress (theirs and the crew's) and
   optionally reveal a hint per egg, without spelling out the mechanism
   unless asked. If every person finds every egg, a permanent crew-wide
   badge unlocks — see checkAllEggsMastered().

   1. Tap the app title 7 times fast.
   2. Classic Konami code on a keyboard: ↑ ↑ ↓ ↓ ← → ← → B A
   3. Save a mood check-in with Energy 5, Stress 1, Happiness 5.
   4. Tap the crew color dots on Time Clock in the order:
      Sergio → Luigi → Juan.
   5. Tap the 🎨 theme button 4 times fast.
   6. Leave the app open and untouched for 60 seconds.
   7. Tap the Spain champions banner 3 times fast.
   8. Type the word "campeones" anywhere on the page.
   9. Tap your "You're ___" identity line in the header 5 times fast.
   10. Type the word "cheers" anywhere on the page.
   ========================================================================= */
const EGG_DEFINITIONS = [
  { key: 'title-tap',      name: 'Motormouth',   hint: "Something about the app's own name wants attention. Multiple times. Quickly." },
  { key: 'konami',         name: 'Old School',   hint: "Old-school gamers might recognize this one. Needs a physical keyboard." },
  { key: 'flawless-checkin', name: 'Flawless',    hint: "Today's mood check-in, with every slider pushed exactly the right direction." },
  { key: 'dot-sequence',   name: 'Roll Call',    hint: "The colored dots on Time Clock know an order. Sergio goes first." },
  { key: 'theme-tap',      name: 'Prism',        hint: "The little palette icon up top has more to say if you bother it enough, fast enough." },
  { key: 'idle',           name: 'Statue',       hint: "Sometimes the trick is doing absolutely nothing for a while." },
  { key: 'champion-tap',   name: 'Olé Olé Olé',  hint: "That red and yellow banner isn't just for looking at. Tap it. A few times, quickly." },
  { key: 'campeones-word', name: 'Campeones',    hint: "Somebody's speaking Spanish. Try typing their word for 'champions' — anywhere on the page." },
  { key: 'whoami-tap',     name: 'Self Aware',   hint: "That little line under the title that says who you are — it responds to attention too." },
  { key: 'cheers-word',    name: 'Cheers',       hint: "A friendly toast, typed anywhere on the page, might do something." },
];

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
function spawnEmojiShower(emojis) {
  for (let i = 0; i < 30; i++) {
    const piece = document.createElement('div');
    piece.className = 'confetti-piece emoji-piece';
    piece.textContent = emojis[Math.floor(Math.random() * emojis.length)];
    piece.style.left = `${Math.random() * 100}vw`;
    piece.style.animationDuration = `${2 + Math.random() * 1.5}s`;
    piece.style.animationDelay = `${Math.random() * 0.4}s`;
    document.body.appendChild(piece);
    setTimeout(() => piece.remove(), 4000);
  }
}

/* ---------------------------------------------------------------------
   Per-person "found" tracking — persisted via the same settings-based
   approach as everything else (holidays, patch notes, etc). Requires
   a saved identity (whoAmI) to attribute the find; if nobody's picked
   an identity yet, the egg still fires but isn't recorded.
   --------------------------------------------------------------------- */
function getEggsFound() {
  try { return JSON.parse(settings.eggsFound || '{}'); } catch (e) { return {}; }
}
async function recordEggFound(eggKey) {
  if (!whoAmI || !eggKey) return;
  const found = getEggsFound();
  if (!found[whoAmI]) found[whoAmI] = [];
  if (found[whoAmI].includes(eggKey)) return; // already recorded — nothing new to save
  found[whoAmI].push(eggKey);
  settings.eggsFound = JSON.stringify(found);
  try { await apiSetSetting('eggsFound', settings.eggsFound); } catch (e) { console.error('Failed to save egg find', e); }
  renderEggDrawer();
  await checkIndividualMastery(whoAmI, found);
  await checkAllEggsMastered(found);
}

/* ---------------------------------------------------------------------
   Individual mastery — if ONE person finds all 10 on their own, they
   get a small gold medal badge next to their name wherever it appears
   (Time Clock, mood tabs, etc) — visible to everyone. But only they
   see the full detail (the "10/10" caption and the gold outline on
   their own card), since that only renders when person === whoAmI on
   that device. Shared/permanent via settings, same as everything else.
   --------------------------------------------------------------------- */
function hasAllEggs(person) {
  const found = getEggsFound();
  return EGG_DEFINITIONS.every(d => (found[person] || []).includes(d.key));
}
function getIndividualMasteryCelebrated() {
  try { return JSON.parse(settings.individualMasteryCelebrated || '[]'); } catch (e) { return []; }
}
const INDIVIDUAL_MASTERY_MESSAGES = [
  "Every secret in this app, found by you alone. Impressive, honestly.",
  "10 for 10. The others will just see a medal — they won't know the details unless you tell them.",
  "You've officially run out of hidden things to find here. Achievement unlocked, for real this time.",
];
async function checkIndividualMastery(person, found) {
  const allFound = EGG_DEFINITIONS.every(d => (found[person] || []).includes(d.key));
  if (!allFound) return;
  const celebrated = getIndividualMasteryCelebrated();
  if (celebrated.includes(person)) return;
  celebrated.push(person);
  settings.individualMasteryCelebrated = JSON.stringify(celebrated);
  try { await apiSetSetting('individualMasteryCelebrated', settings.individualMasteryCelebrated); } catch (e) { console.error('Failed to save individual mastery', e); }
  renderPersonRow();
  if (person === whoAmI) {
    showEgg({ eyebrow: '🥇 SOLO MASTERY', title: `${person}, you found everything.`, messages: INDIVIDUAL_MASTERY_MESSAGES, shower: 'confetti' });
  }
}

/* ---------------------------------------------------------------------
   Grand finale — if every person has found every egg, a permanent,
   shared badge unlocks. Checked after every new find. Persisted via
   settings, so once it's unlocked it stays unlocked for good, for
   the whole crew, on every device.
   --------------------------------------------------------------------- */
const MASTERY_MESSAGES = [
  "Every secret in this app, found by all three of you. That's dedication bordering on concerning.",
  "The Punch Board has nothing left to hide from this crew. Wear that badge with pride.",
  "All ten. All three of you. Legendary status, permanently recorded.",
];
async function checkAllEggsMastered(found) {
  if (settings.allEggsMastered === 'true') return; // already unlocked, nothing to do
  const allKeys = EGG_DEFINITIONS.map(d => d.key);
  const everyoneFoundEverything = PEOPLE.every(p => allKeys.every(k => (found[p] || []).includes(k)));
  if (!everyoneFoundEverything) return;

  settings.allEggsMastered = 'true';
  try { await apiSetSetting('allEggsMastered', 'true'); } catch (e) { console.error('Failed to save mastery flag', e); }
  renderMasteryDecoration();
  showEgg({ eyebrow: '🏅 LEGENDARY', title: 'Every secret. Everyone. Forever.', messages: MASTERY_MESSAGES, shower: 'confetti' });
  spawnConfetti(); // extra burst for the occasion
}
function renderMasteryDecoration() {
  const isMastered = settings.allEggsMastered === 'true';
  const badge = document.getElementById('mastery-badge');
  if (badge) badge.style.display = isMastered ? 'inline' : 'none';
  const drawerToggle = document.getElementById('egg-drawer-toggle');
  if (drawerToggle) drawerToggle.textContent = isMastered ? '🏅 EGGS' : '🥚 EGGS';
  const drawerBanner = document.getElementById('mastery-drawer-banner');
  if (drawerBanner) {
    drawerBanner.style.display = isMastered ? 'block' : 'none';
    if (isMastered) drawerBanner.innerHTML = '<div class="mastery-banner">🏅 LEGENDARY — every secret found, by everyone</div>';
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

function showEgg({ eyebrow, title, messages, shower, eggKey }) {
  if (shower === 'confetti') spawnConfetti();
  if (shower === 'beer') spawnEmojiShower(['🍺', '🍻']);
  document.getElementById('egg-eyebrow').textContent = eyebrow;
  document.getElementById('egg-title').textContent = title;
  document.getElementById('egg-message').textContent =
    messages[Math.floor(Math.random() * messages.length)];
  document.getElementById('egg-modal').style.display = 'flex';
  recordEggFound(eggKey);
}
document.getElementById('egg-close-btn').onclick = () => {
  document.getElementById('egg-modal').style.display = 'none';
};

/* ---------------------------------------------------------------------
   The drawer itself — toggle button pinned to the right edge, slides
   a panel in. Hint-open state is local/session-only, not persisted.
   --------------------------------------------------------------------- */
let openHintKeys = new Set();
function renderEggDrawer() {
  const wrap = document.getElementById('egg-drawer-list');
  if (!wrap) return;
  wrap.innerHTML = '';
  const found = getEggsFound();
  EGG_DEFINITIONS.forEach(def => {
    const anyoneFound = PEOPLE.some(p => (found[p] || []).includes(def.key));
    const row = document.createElement('div');
    row.className = 'egg-row' + (anyoneFound ? ' found' : '');

    const top = document.createElement('div');
    top.className = 'egg-row-top';
    const icon = document.createElement('span');
    icon.className = 'egg-row-icon';
    icon.textContent = anyoneFound ? '🏆' : '🥚';
    top.appendChild(icon);
    const name = document.createElement('span');
    name.className = 'egg-row-name';
    name.textContent = def.name;
    top.appendChild(name);
    const dots = document.createElement('div');
    dots.className = 'egg-row-dots';
    PEOPLE.forEach(p => {
      const d = document.createElement('span');
      const got = (found[p] || []).includes(def.key);
      d.className = 'egg-mini-dot' + (got ? ' got' : '');
      d.style.background = got ? COLORS[p] : '#fff';
      d.title = got ? `${p} found this` : p;
      dots.appendChild(d);
    });
    top.appendChild(dots);
    row.appendChild(top);

    const hintBtn = document.createElement('button');
    hintBtn.className = 'egg-hint-btn';
    const isOpen = openHintKeys.has(def.key);
    hintBtn.textContent = isOpen ? 'Hide hint' : 'Show hint';
    hintBtn.onclick = () => {
      if (openHintKeys.has(def.key)) openHintKeys.delete(def.key);
      else openHintKeys.add(def.key);
      renderEggDrawer();
    };
    row.appendChild(hintBtn);

    const hintText = document.createElement('div');
    hintText.className = 'egg-hint-text' + (isOpen ? ' open' : '');
    hintText.textContent = def.hint;
    row.appendChild(hintText);

    wrap.appendChild(row);
  });
}
document.getElementById('egg-drawer-toggle').onclick = () => {
  document.getElementById('egg-drawer').classList.add('open');
  renderEggDrawer();
};
document.getElementById('egg-drawer-close').onclick = () => {
  document.getElementById('egg-drawer').classList.remove('open');
};

/* --- Secret 1: tap the title 7 times fast --- */
const EGG_MESSAGES = [
  "The Punch Board has been watching. It approves of your dedication to nonsense.",
  "You found the secret. There is no prize. The prize was the taps you made along the way.",
  "Legend says whoever finds this gets first pick of beers forever. Legend is wrong.",
  "Achievement unlocked: Has Too Much Time On Their Hands.",
  "Somewhere, Luigi, Juan, or Sergio is proud of you. Probably.",
];
let titleTapCount = 0;
let titleTapResetTimer = null;
document.getElementById('app-title').addEventListener('click', () => {
  titleTapCount++;
  clearTimeout(titleTapResetTimer);
  titleTapResetTimer = setTimeout(() => { titleTapCount = 0; }, 1500);
  if (titleTapCount >= 7) {
    titleTapCount = 0;
    showEgg({ eyebrow: '🥚 SECRET FOUND', title: 'Nice tapping.', messages: EGG_MESSAGES, shower: 'confetti', eggKey: 'title-tap' });
  }
});

/* --- Secret 2: classic Konami code on a keyboard --- */
const KONAMI_SEQUENCE = ['ArrowUp','ArrowUp','ArrowDown','ArrowDown','ArrowLeft','ArrowRight','ArrowLeft','ArrowRight','KeyB','KeyA'];
const KONAMI_MESSAGES = [
  "Up up down down left right left right B A. Some things never die.",
  "30 extra lives added to your beer tally. (Not really. We checked. It's not really.)",
  "You've unlocked... nothing. But we respect the muscle memory.",
];
let konamiBuffer = [];
document.addEventListener('keydown', (e) => {
  konamiBuffer.push(e.code);
  konamiBuffer = konamiBuffer.slice(-KONAMI_SEQUENCE.length);
  if (konamiBuffer.join(',') === KONAMI_SEQUENCE.join(',')) {
    konamiBuffer = [];
    showEgg({ eyebrow: '🎮 KONAMI MASTER', title: 'Old school.', messages: KONAMI_MESSAGES, shower: 'confetti', eggKey: 'konami' });
  }
});

/* --- Secret 3: log a perfect mood check-in (Energy 5, Stress 1, Happiness 5) --- */
const FLAWLESS_MESSAGES = [
  "Energy maxed, stress at rock bottom, happiness maxed. A genuinely flawless day, logged flawlessly.",
  "Every slider in exactly the right direction. Statistically rare. Suspiciously rare, even.",
  "Whatever you did today, do it again.",
];
document.getElementById('save-checkin-btn').addEventListener('click', () => {
  if (ratings.energy === 5 && ratings.stress === 1 && ratings.happiness === 5) {
    showEgg({ eyebrow: '✨ FLAWLESS', title: 'A perfect day.', messages: FLAWLESS_MESSAGES, shower: 'confetti', eggKey: 'flawless-checkin' });
  }
});

/* --- Secret 4: tap the crew color dots on Time Clock in the right order --- */
const DOT_MESSAGES = [
  "Order acknowledged. Someone's been paying attention to the little details.",
  "You found the roll call. Nobody else will ever know what order it is.",
  "Correct sequence. This message self-destructs in... nothing, actually, it just closes when you tap Close.",
];
const SECRET_DOT_ORDER = ['Sergio', 'Luigi', 'Juan'];
let dotTapSequence = [];
let dotTapResetTimer = null;
function handleDotTap(person) {
  dotTapSequence.push(person);
  clearTimeout(dotTapResetTimer);
  dotTapResetTimer = setTimeout(() => { dotTapSequence = []; }, 2000);
  dotTapSequence = dotTapSequence.slice(-SECRET_DOT_ORDER.length);
  if (dotTapSequence.join(',') === SECRET_DOT_ORDER.join(',')) {
    dotTapSequence = [];
    showEgg({ eyebrow: '🎯 CREW ROLL CALL', title: 'Order acknowledged.', messages: DOT_MESSAGES, shower: 'confetti', eggKey: 'dot-sequence' });
  }
}

/* --- Secret 5: tap the 🎨 theme button 4 times fast --- */
const PRISM_MESSAGES = [
  "Four taps on a palette icon. The app has no more themes to give you, but it appreciates the enthusiasm.",
  "You really wanted a 5th theme, didn't you. This isn't it. Sorry.",
  "The palette icon noticed. That's the whole secret.",
];
let themeTapCount = 0;
let themeTapResetTimer = null;
const themeSwitchBtnEl = document.getElementById('theme-switch-btn');
if (themeSwitchBtnEl) {
  themeSwitchBtnEl.addEventListener('click', () => {
    themeTapCount++;
    clearTimeout(themeTapResetTimer);
    themeTapResetTimer = setTimeout(() => { themeTapCount = 0; }, 1500);
    if (themeTapCount >= 4) {
      themeTapCount = 0;
      showEgg({ eyebrow: '🎨 PRISM', title: 'Four taps, noted.', messages: PRISM_MESSAGES, shower: 'confetti', eggKey: 'theme-tap' });
    }
  });
}

/* --- Secret 6: leave the app untouched for 60 seconds --- */
const IDLE_MESSAGES = [
  "You didn't move. Respect for the stillness.",
  "60 seconds of doing nothing, tracked and rewarded. Efficient use of a break.",
  "The app got bored waiting, so it made this instead.",
];
let lastActivityTime = Date.now();
['click', 'keydown', 'touchstart', 'scroll'].forEach(evt => {
  document.addEventListener(evt, () => { lastActivityTime = Date.now(); }, { passive: true });
});
setInterval(() => {
  if (Date.now() - lastActivityTime >= 60000) {
    lastActivityTime = Date.now(); // reset so it can fire again after another idle stretch, not on a loop
    showEgg({ eyebrow: '🗿 STILL THERE?', title: "You didn't move.", messages: IDLE_MESSAGES, shower: 'confetti', eggKey: 'idle' });
  }
}, 5000);

/* --- Secret 7: tap the Spain champions banner 3 times fast --- */
const CHAMPION_TAP_MESSAGES = [
  "Olé olé olé, olé olé — you found it.",
  "Spain approves of this level of enthusiasm.",
  "Three taps for the champions. Seems fair.",
];
let championTapCount = 0;
let championTapResetTimer = null;
const championBannerEl = document.getElementById('champion-banner');
if (championBannerEl) {
  championBannerEl.style.cursor = 'pointer';
  championBannerEl.addEventListener('click', () => {
    championTapCount++;
    clearTimeout(championTapResetTimer);
    championTapResetTimer = setTimeout(() => { championTapCount = 0; }, 1500);
    if (championTapCount >= 3) {
      championTapCount = 0;
      showEgg({ eyebrow: '🇪🇸 OLÉ', title: 'Olé olé olé.', messages: CHAMPION_TAP_MESSAGES, shower: 'confetti', eggKey: 'champion-tap' });
    }
  });
}

/* --- Secret 8: type "campeones" anywhere on the page --- */
const CAMPEONES_WORD = 'campeones';
const CAMPEONES_MESSAGES = [
  "Campeones del mundo. You typed it, so it's official now.",
  "Somewhere, a Spanish commentator is very proud of you.",
  "That word has been said a lot this year. Add it to the list.",
];
let campeonesBuffer = '';
document.addEventListener('keydown', (e) => {
  const tag = (document.activeElement && document.activeElement.tagName) || '';
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return; // don't hijack typing in forms
  if (e.key.length === 1 && /[a-zA-Z]/.test(e.key)) {
    campeonesBuffer = (campeonesBuffer + e.key.toLowerCase()).slice(-CAMPEONES_WORD.length);
    if (campeonesBuffer === CAMPEONES_WORD) {
      campeonesBuffer = '';
      showEgg({ eyebrow: '🏆 CAMPEONES', title: 'Campeones del mundo.', messages: CAMPEONES_MESSAGES, shower: 'confetti', eggKey: 'campeones-word' });
    }
  }
});

/* --- Secret 9: tap your "You're ___" identity line 5 times fast --- */
const SELF_AWARE_MESSAGES = [
  "You noticed yourself. That's the whole trick.",
  "Yes, that's you. Congratulations on being aware of it.",
  "The app has been quietly tracking who you are this whole time. Now it knows you know.",
];
let whoamiTapCount = 0;
let whoamiTapResetTimer = null;
const whoamiTextEl = document.getElementById('whoami-text');
if (whoamiTextEl) {
  whoamiTextEl.style.cursor = 'pointer';
  whoamiTextEl.addEventListener('click', () => {
    whoamiTapCount++;
    clearTimeout(whoamiTapResetTimer);
    whoamiTapResetTimer = setTimeout(() => { whoamiTapCount = 0; }, 1500);
    if (whoamiTapCount >= 5) {
      whoamiTapCount = 0;
      showEgg({ eyebrow: '🪞 SELF AWARE', title: 'You noticed yourself.', messages: SELF_AWARE_MESSAGES, shower: 'confetti', eggKey: 'whoami-tap' });
    }
  });
}

/* --- Secret 10: type "cheers" anywhere on the page --- */
const CHEERS_WORD = 'cheers';
const CHEERS_MESSAGES = [
  "Cheers to that. Someone add it to the beer scoreboard.",
  "A toast, typed into a time-tracking app. Very on brand for this crew.",
  "🍻 to whoever found this one.",
];
let cheersBuffer = '';
document.addEventListener('keydown', (e) => {
  const tag = (document.activeElement && document.activeElement.tagName) || '';
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return; // don't hijack typing in forms
  if (e.key.length === 1 && /[a-zA-Z]/.test(e.key)) {
    cheersBuffer = (cheersBuffer + e.key.toLowerCase()).slice(-CHEERS_WORD.length);
    if (cheersBuffer === CHEERS_WORD) {
      cheersBuffer = '';
      showEgg({ eyebrow: '🍻 CHEERS', title: 'Cheers to that.', messages: CHEERS_MESSAGES, shower: 'beer', eggKey: 'cheers-word' });
    }
  }
});

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
  renderEggDrawer();
  renderMasteryDecoration();
  renderBirthdayDecorations();
  renderMissingDaysBanners();
}

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

/* =========================================================================
   CREW AWARDS
   ========================================================================= */
function personMoodStats(p) {
  const map = personMoodMap(p);
  const dates = Object.keys(map).sort();
  const values = dates.map(d => map[d]);
  if (values.length === 0) return { avg: null, stdev: null, biggestJump: 0, jumpDesc: '' };
  const avg = values.reduce((a,b) => a+b, 0) / values.length;
  const variance = values.reduce((a,b) => a + Math.pow(b - avg, 2), 0) / values.length;
  const stdev = Math.sqrt(variance);
  let biggestJump = 0, jumpDesc = '';
  for (let i = 1; i < dates.length; i++) {
    const prev = new Date(dates[i-1]), cur = new Date(dates[i]);
    const dayGap = Math.round((cur - prev) / 86400000);
    if (dayGap === 1) {
      const diff = map[dates[i]] - map[dates[i-1]];
      if (Math.abs(diff) > Math.abs(biggestJump)) {
        biggestJump = diff;
        jumpDesc = `${dates[i-1]} → ${dates[i]}`;
      }
    }
  }
  return { avg, stdev, biggestJump, jumpDesc };
}
function personCrossStats(p) {
  const now = new Date();
  const monthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const hoursByDay = {};
  entries.filter(e => e.person === p && e.start.slice(0,7) === monthPrefix).forEach(e => {
    const day = e.start.slice(0, 10);
    hoursByDay[day] = (hoursByDay[day] || 0) + e.hours;
  });
  const totalHours = Object.values(hoursByDay).reduce((a,b) => a+b, 0);
  const moodMap = personMoodMap(p);

  const highHourMoods = Object.keys(hoursByDay)
    .filter(d => hoursByDay[d] >= 8 && moodMap[d] !== undefined)
    .map(d => moodMap[d]);
  const highHourAvg = highHourMoods.length ? highHourMoods.reduce((a,b)=>a+b,0) / highHourMoods.length : null;

  const dayOffMoods = Object.keys(moodMap)
    .filter(d => d.slice(0,7) === monthPrefix && !hoursByDay[d])
    .map(d => moodMap[d]);
  const bestDayOff = dayOffMoods.length ? Math.max(...dayOffMoods) : null;

  return { totalHours, highHourAvg, bestDayOff };
}
function renderAwardsList() {
  const wrap = document.getElementById('awards-list');
  wrap.innerHTML = '';
  const stats = {}, cross = {};
  PEOPLE.forEach(p => { stats[p] = personMoodStats(p); cross[p] = personCrossStats(p); });

  const withMood = PEOPLE.filter(p => stats[p].avg !== null);
  if (withMood.length === 0) {
    wrap.innerHTML = '<div class="empty-state">No mood check-ins yet this month — awards will appear once everyone starts logging.</div>';
    return;
  }
  const topVibes = withMood.reduce((a,b) => stats[a].avg > stats[b].avg ? a : b);
  const mostConsistent = withMood.reduce((a,b) => stats[a].stdev < stats[b].stdev ? a : b);
  const withJump = withMood.filter(p => stats[p].jumpDesc);
  const biggestGlowUp = withJump.length ? withJump.reduce((a,b) => Math.abs(stats[a].biggestJump) > Math.abs(stats[b].biggestJump) ? a : b) : null;

  const withHours = PEOPLE.filter(p => cross[p].totalHours > 0);
  const grindMode = withHours.length ? withHours.reduce((a,b) => cross[a].totalHours > cross[b].totalHours ? a : b) : null;
  const withHighHour = PEOPLE.filter(p => cross[p].highHourAvg !== null);
  const ironWill = withHighHour.length ? withHighHour.reduce((a,b) => cross[a].highHourAvg > cross[b].highHourAvg ? a : b) : null;
  const withDayOff = PEOPLE.filter(p => cross[p].bestDayOff !== null);
  const bestDayOffPerson = withDayOff.length ? withDayOff.reduce((a,b) => cross[a].bestDayOff > cross[b].bestDayOff ? a : b) : null;

  const awards = [
    { icon: '🏆', bg: '#F2A03D', title: 'Top Vibes', detail: `Highest average mood this month — ${stats[topVibes].avg.toFixed(1)} / 5`, winner: topVibes },
    { icon: '🧘', bg: '#4A7C7C', title: 'Steadiest Ship', detail: 'Least day-to-day swing in mood', winner: mostConsistent },
  ];
  if (biggestGlowUp) awards.push({ icon: '📈', bg: '#2E9B5C', title: 'Biggest Glow-Up', detail: `Sharpest overnight turnaround (${stats[biggestGlowUp].jumpDesc})`, winner: biggestGlowUp });
  if (grindMode) awards.push({ icon: '💪', bg: '#D97757', title: 'Grind Mode', detail: `Most hours punched this month — ${cross[grindMode].totalHours.toFixed(1)}h total`, winner: grindMode });
  if (ironWill) awards.push({ icon: '⚖️', bg: '#8B6F47', title: 'Iron Will', detail: `Kept mood highest (avg ${cross[ironWill].highHourAvg.toFixed(1)}) on their own longest shifts (8h+)`, winner: ironWill });
  if (bestDayOffPerson) awards.push({ icon: '🌅', bg: '#F2A03D', title: 'Best Day Off', detail: `Highest mood logged on a day with no shift — ${cross[bestDayOffPerson].bestDayOff.toFixed(1)} / 5`, winner: bestDayOffPerson });

  awards.forEach(a => {
    const row = document.createElement('div');
    row.className = 'award-row';
    const icon = document.createElement('div');
    icon.className = 'award-icon';
    icon.style.background = a.bg + '22';
    icon.textContent = a.icon;
    row.appendChild(icon);
    const body = document.createElement('div');
    body.className = 'award-body';
    const title = document.createElement('div');
    title.className = 'award-title';
    title.textContent = a.title;
    const detail = document.createElement('div');
    detail.className = 'award-detail';
    detail.textContent = a.detail;
    body.appendChild(title); body.appendChild(detail);
    row.appendChild(body);
    const winner = document.createElement('div');
    winner.className = 'award-winner';
    winner.textContent = a.winner;
    winner.style.background = COLORS[a.winner];
    row.appendChild(winner);
    wrap.appendChild(row);
  });
}
function renderStreaks() {
  const wrap = document.getElementById('streak-list');
  wrap.innerHTML = '';
  PEOPLE.forEach(p => {
    const map = personMoodMap(p);
    let streak = 0;
    let d = new Date();
    while (true) {
      const dateStr = d.toISOString().slice(0, 10);
      if (map[dateStr] !== undefined) { streak++; d.setDate(d.getDate() - 1); }
      else break;
    }
    const row = document.createElement('div');
    row.className = 'streak-row';
    const name = document.createElement('div');
    name.className = 'streak-name';
    name.textContent = p;
    row.appendChild(name);
    const flames = document.createElement('div');
    flames.className = 'streak-flames';
    flames.textContent = streak > 0 ? '🔥'.repeat(Math.min(streak, 5)) : '—';
    row.appendChild(flames);
    const count = document.createElement('div');
    count.className = 'streak-count';
    count.textContent = `${streak} day${streak !== 1 ? 's' : ''}`;
    row.appendChild(count);
    wrap.appendChild(row);
  });
}
/* ---------------------------------------------------------------------
   Weekly Recap — auto-summarizes the last 7 days, zero input required.
   --------------------------------------------------------------------- */
function last7Dates() {
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}
function getRecapDates(period) {
  if (period === 'week') return last7Dates();
  const now = new Date();
  const start = period === 'month'
    ? new Date(now.getFullYear(), now.getMonth(), 1)
    : new Date(now.getFullYear(), 0, 1);
  const days = [];
  let d = new Date(start);
  while (d <= now) {
    days.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() + 1);
  }
  return days;
}
function computeWeeklyRecap(period) {
  const days = getRecapDates(period || 'week');
  const dayLabel = (dateStr) => new Date(dateStr + 'T00:00:00').toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });

  // Busiest day: combined crew hours per day
  const hoursByDay = {};
  days.forEach(d => { hoursByDay[d] = 0; });
  entries.forEach(e => {
    const d = e.start.slice(0, 10);
    if (hoursByDay[d] !== undefined) hoursByDay[d] += e.hours;
  });
  let busiestDay = null, busiestHours = 0;
  days.forEach(d => {
    if (hoursByDay[d] > busiestHours) { busiestHours = hoursByDay[d]; busiestDay = d; }
  });

  // Best mood day: crew average mood per day
  const moodByDay = {};
  days.forEach(d => { moodByDay[d] = []; });
  PEOPLE.forEach(p => {
    const map = personMoodMap(p);
    days.forEach(d => { if (map[d] !== undefined) moodByDay[d].push(map[d]); });
  });
  let bestMoodDay = null, bestMoodAvg = -1;
  days.forEach(d => {
    if (moodByDay[d].length === 0) return;
    const avg = moodByDay[d].reduce((a,b) => a+b, 0) / moodByDay[d].length;
    if (avg > bestMoodAvg) { bestMoodAvg = avg; bestMoodDay = d; }
  });

  return {
    busiestDay: busiestDay ? dayLabel(busiestDay) : null,
    busiestHours,
    bestMoodDay: bestMoodDay ? dayLabel(bestMoodDay) : null,
    bestMoodAvg
  };
}
let recapPeriod = 'week';
function setRecapPeriod(period) {
  recapPeriod = period;
  ['week', 'month', 'ytd'].forEach(p => {
    document.getElementById(`toggle-recap-${p}`).classList.toggle('active', p === period);
  });
  renderWeeklyRecap();
}
document.getElementById('toggle-recap-week').onclick = () => setRecapPeriod('week');
document.getElementById('toggle-recap-month').onclick = () => setRecapPeriod('month');
document.getElementById('toggle-recap-ytd').onclick = () => setRecapPeriod('ytd');

function renderWeeklyRecap() {
  const wrap = document.getElementById('recap-grid');
  const rangeEl = document.getElementById('recap-range');
  const days = getRecapDates(recapPeriod);
  const rangeLabels = { week: 'Last 7 days', month: 'This month so far', ytd: 'Year to date' };
  rangeEl.textContent = days.length
    ? `${rangeLabels[recapPeriod]} · ${formatDate(new Date(days[0]))} – ${formatDate(new Date(days[days.length - 1]))}`
    : rangeLabels[recapPeriod];

  const r = computeWeeklyRecap(recapPeriod);
  wrap.innerHTML = '';

  const busyItem = document.createElement('div');
  busyItem.className = 'recap-item full';
  busyItem.innerHTML = `<div class="recap-tag">Busiest Day</div>
    <div class="recap-val">${r.busiestDay || '—'}</div>
    <div class="recap-sub">${r.busiestDay ? `${r.busiestHours.toFixed(1)} combined hrs` : 'No shifts logged yet'}</div>`;
  wrap.appendChild(busyItem);

  const moodItem = document.createElement('div');
  moodItem.className = 'recap-item full';
  moodItem.innerHTML = `<div class="recap-tag">Best Mood Day</div>
    <div class="recap-val">${r.bestMoodDay || '—'}</div>
    <div class="recap-sub">${r.bestMoodDay ? `Crew avg ${r.bestMoodAvg.toFixed(1)} / 5` : 'No check-ins yet'}</div>`;
  wrap.appendChild(moodItem);
}

/* ---------------------------------------------------------------------
   Fact of the Day — curated weird/ridiculous facts, any topic.
   Local list, no network call, so it's 100% reliable. Deterministic
   per calendar day so the whole crew sees the same fact.
   --------------------------------------------------------------------- */
const dailyFacts = [
  "Platypuses don't have nipples — they sweat milk through their skin.",
  "Wombat poop is cube-shaped so it doesn't roll away.",
  "The inventor of the Pringles can is buried in one.",
  "A group of flamingos is called a 'flamboyance'.",
  "Sea otters hold hands while sleeping so they don't drift apart.",
  "There's a species of jellyfish that can revert to a baby state and become immortal.",
  "A shrimp's heart is in its head.",
  "Cows have best friends and get stressed when separated from them.",
  "Scotland's national animal is the unicorn.",
  "A crocodile can't stick its tongue out.",
  "Slugs have four noses.",
  "Some turtles breathe through their butts.",
  "The dot over a lowercase 'i' or 'j' has a name: a tittle.",
  "A single cloud can weigh over a million pounds.",
  "Starfish don't have brains or blood.",
  "Bees can get drunk on fermented nectar and get 'bounced' from the hive by guard bees.",
  "The 'sound' of silence you hear in a quiet room is actually your own blood flow.",
  "Hippos sweat a natural red-tinted, sunscreen-like substance.",
  "There's a town in Norway called Hell, and it freezes over most winters.",
  "A crowd of jellyfish is called a 'smack'.",
  "Snails can sleep for up to three years.",
  "A live cockroach can survive for weeks without its head before starving to death.",
  "Wolves can hear each other howling from up to 6 miles away in the forest, and 10 in open tundra.",
  "Tardigrades ('water bears') can survive being shot out of a gun and the vacuum of space.",
  "The 'five second rule' for dropped food was tested and is basically nonsense — bacteria transfers instantly.",
  "Some pistol shrimp snap their claw so fast it briefly creates heat close to the sun's surface temperature.",
  "There's a fish called the ocean sunfish that can lay 300 million eggs at once.",
  "Male seahorses are the ones who get pregnant and give birth.",
  "Duck quacks technically do echo — the myth that they don't is false.",
  "A blue whale's heart is the size of a small car and can be heard from over 2 miles away.",
  "Kangaroos can't walk backwards.",
  "Jackrabbits can reach speeds of up to 40 mph and use their giant ears to cool off, not just to hear.",
  "The world's oldest known joke is a 3,900-year-old Sumerian proverb about flatulence.",
  "Cows moo in regional accents.",
  "An octopus can taste with its entire body through its skin.",
];
function dayOfYear(d) {
  const start = new Date(d.getFullYear(), 0, 0);
  return Math.floor((d - start) / 86400000);
}
function renderFactOfDay() {
  const idx = dayOfYear(new Date()) % dailyFacts.length;
  document.getElementById('fact-of-day').textContent = dailyFacts[idx];
}

/* ---------------------------------------------------------------------
   Random Animal Pic — separate from the fact above. Uses a direct
   <img src="..."> pointing at an image-serving URL (not a JSON API),
   so it doesn't depend on fetch()/CORS. Locked to one photo per
   calendar day via localStorage so the whole crew sees the same one.
   --------------------------------------------------------------------- */
const ANIMAL_PIC_KEY = 'punchboard-animal-pic';
const ANIMAL_KEYWORDS = ['dog', 'cat', 'fox', 'panda', 'koala', 'owl', 'elephant', 'penguin', 'otter', 'hedgehog', 'rabbit', 'giraffe', 'wolf', 'seal', 'raccoon'];
function pickAnimalUrl() {
  const keyword = ANIMAL_KEYWORDS[Math.floor(Math.random() * ANIMAL_KEYWORDS.length)];
  return `https://loremflickr.com/640/360/${keyword}?random=${Date.now()}`;
}
function renderAnimalPic(forceNew) {
  const wrap = document.getElementById('animal-pic-wrap');
  const today = todayISO();
  let stored = null;
  try { stored = JSON.parse(localStorage.getItem(ANIMAL_PIC_KEY) || 'null'); } catch (e) {}
  let url;
  if (!forceNew && stored && stored.date === today) {
    url = stored.url;
  } else {
    url = pickAnimalUrl();
    localStorage.setItem(ANIMAL_PIC_KEY, JSON.stringify({ date: today, url }));
  }
  wrap.innerHTML = `<img src="${url}" alt="random animal" onerror="this.parentElement.innerHTML='<span class=&quot;empty-state&quot;>couldn\\'t load a photo — tap 🔄 New photo above to retry</span>'">`;
}
document.getElementById('animal-pic-retry-btn').onclick = () => renderAnimalPic(true);

/* ---------------------------------------------------------------------
   Crew Pulse — one-line-per-person banner, computed live from this
   week's hours + mood. No input required, just real numbers.
   --------------------------------------------------------------------- */
function renderCrewPulse() {
  const el = document.getElementById('pulse-text');
  if (!el) return;
  const days = last7Dates();

  const stats = PEOPLE.map(p => {
    const hours7 = entries
      .filter(e => e.person === p && days.includes(e.start.slice(0, 10)))
      .reduce((sum, e) => sum + e.hours, 0);
    const map = personMoodMap(p);
    const moodVals = days.map(d => map[d]).filter(v => v !== undefined);
    const avgMood = moodVals.length ? moodVals.reduce((a,b) => a+b, 0) / moodVals.length : null;
    return { person: p, hours7, avgMood };
  });

  const hasData = stats.some(s => s.hours7 > 0 || s.avgMood !== null);
  if (!hasData) {
    el.textContent = 'Log some hours or check in on mood to light up the Crew Pulse';
    return;
  }

  const withHours = stats.filter(s => s.hours7 > 0);
  const grinder = withHours.length ? withHours.reduce((a,b) => a.hours7 > b.hours7 ? a : b) : null;
  const withMood = stats.filter(s => s.avgMood !== null);
  const vibing = withMood.length ? withMood.reduce((a,b) => a.avgMood > b.avgMood ? a : b) : null;
  const fumes = withMood.length > 1 ? withMood.reduce((a,b) => a.avgMood < b.avgMood ? a : b) : null;

  const lines = stats.map(s => {
    if (grinder && s.person === grinder.person) {
      return `${s.person} is grinding — ${s.hours7.toFixed(1)}h logged this week`;
    }
    if (vibing && s.person === vibing.person && (!fumes || vibing.person !== fumes.person)) {
      return `${s.person} is vibing — best mood this week (${s.avgMood.toFixed(1)}/5)`;
    }
    if (fumes && s.person === fumes.person && fumes.avgMood < 3) {
      return `${s.person} is running on fumes — mood dipped to ${s.avgMood.toFixed(1)}/5`;
    }
    return `${s.person} is holding steady`;
  });

  // simple rotation through the three lines, one at a time, with a fade
  let i = 0;
  const show = () => {
    el.classList.add('fade');
    setTimeout(() => {
      el.textContent = lines[i % lines.length];
      el.classList.remove('fade');
      i++;
    }, 350);
  };
  clearInterval(window.__pulseInterval);
  show();
  window.__pulseInterval = setInterval(show, 5000);
}

function renderAwardsTab() {
  renderAwardsList();
  renderStreaks();
  renderWeeklyRecap();
  renderFactOfDay();
  renderAnimalPic();
}

/* =========================================================================
   WAGER BOARD (football bets + goal tracker)
   ========================================================================= */
function findPrediction(matchId, person) {
  return predictions.find(pr => pr.matchId === matchId && pr.person === person) || null;
}
function computeBeerStandings() {
  const totals = {};
  PEOPLE.forEach(p => { totals[p] = Number(settings[`baseBeers_${p}`] || 0); });
  matches.forEach(m => {
    if (!isMatchSettled(m)) return;
    PEOPLE.forEach(p => {
      const pred = findPrediction(m.id, p);
      if (isWinningPrediction(m, pred)) {
        totals[p] = (totals[p] || 0) + 1;
      }
    });
  });
  return totals;
}
function renderBetsScoreboard() {
  const wrap = document.getElementById('bets-scoreboard');
  wrap.innerHTML = '';
  const totals = computeBeerStandings();
  const maxTotal = Math.max(1, ...PEOPLE.map(p => totals[p]));
  const actualWinner = settings.actualWinner;
  const sorted = [...PEOPLE].sort((a,b) => totals[b] - totals[a]);
  sorted.forEach(p => {
    const row = document.createElement('div');
    row.className = 'beer-row';
    const top = document.createElement('div');
    top.className = 'beer-top-line';
    const name = document.createElement('span');
    name.className = 'beer-name';
    name.textContent = p;
    const pick = winnerPicks.find(w => w.person === p);
    const calledLive = actualWinner && pick && pick.prediction && pick.prediction.toLowerCase() === actualWinner.toLowerCase();
    const history = getWorldCupHistory();
    const latestHistory = history.length ? history.slice().sort((a, b) => b.date.localeCompare(a.date))[0] : null;
    const calledHistoric = latestHistory && latestHistory.callers.includes(p);
    if (calledLive || calledHistoric) {
      const tag = document.createElement('span');
      tag.className = 'beer-champ-tag';
      tag.textContent = '🏆 called it';
      name.appendChild(tag);
    }
    const val = document.createElement('span');
    val.className = 'beer-value';
    val.textContent = `${totals[p]} round${totals[p] !== 1 ? 's' : ''}`;
    top.appendChild(name); top.appendChild(val);
    row.appendChild(top);
    const track = document.createElement('div');
    track.className = 'hours-bar-track';
    const fill = document.createElement('div');
    fill.className = 'hours-bar-fill';
    fill.style.width = `${(totals[p] / maxTotal) * 100}%`;
    fill.style.background = COLORS[p];
    track.appendChild(fill);
    row.appendChild(track);
    wrap.appendChild(row);
  });
}
function isCustomBet(m) { return !m.teamB; }
function isMatchSettled(m) {
  if (isCustomBet(m)) return m.resultA !== null && m.resultA !== undefined && m.resultA !== '';
  return m.resultA !== null && m.resultA !== undefined && m.resultB !== null && m.resultB !== undefined;
}
function isWinningPrediction(m, pred) {
  if (!pred) return false;
  if (isCustomBet(m)) {
    if (m.resultA === null || m.resultA === undefined || m.resultA === '') return false;
    return String(pred.scoreA).trim().toLowerCase() === String(m.resultA).trim().toLowerCase();
  }
  return pred.scoreA === m.resultA && pred.scoreB === m.resultB;
}

function renderMatchList() {
  const wrap = document.getElementById('match-list');
  wrap.innerHTML = '';
  matches.forEach(m => {
    const custom = isCustomBet(m);
    const settled = isMatchSettled(m);
    const card = document.createElement('div');
    card.className = 'match-card' + (settled ? ' settled' : '');

    const top = document.createElement('div');
    top.className = 'match-top';
    const teams = document.createElement('div');
    teams.className = 'match-teams';
    teams.textContent = custom ? m.teamA : `${m.teamA} vs ${m.teamB}`;
    top.appendChild(teams);
    card.appendChild(top);

    const meta = document.createElement('div');
    meta.className = 'match-meta';
    meta.textContent = m.meta;
    card.appendChild(meta);

    const grid = document.createElement('div');
    grid.className = 'predict-grid';
    PEOPLE.forEach(p => {
      const row = document.createElement('div');
      row.className = 'predict-row';
      const name = document.createElement('div');
      name.className = 'predict-name';
      name.textContent = p;
      name.style.color = COLORS[p];
      row.appendChild(name);

      const pred = findPrediction(m.id, p);

      if (custom) {
        let localAnswer = pred ? pred.scoreA : null;
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'score-input';
        input.style.width = '120px';
        input.placeholder = 'answer';
        input.value = localAnswer === null || localAnswer === undefined ? '' : localAnswer;
        input.disabled = settled;
        input.onchange = async () => {
          localAnswer = input.value.trim() === '' ? null : input.value.trim();
          updateLocalPrediction(m.id, p, localAnswer, null);
          if (localAnswer === null) return;
          try { await apiSetPrediction(m.id, p, localAnswer, ''); } catch (e) { console.error(e); }
          renderBetsScoreboard();
        };
        row.appendChild(input);
      } else {
        let localA = pred ? pred.scoreA : null;
        let localB = pred ? pred.scoreB : null;

        const inputA = document.createElement('input');
        inputA.type = 'number'; inputA.min = '0'; inputA.className = 'score-input';
        inputA.value = localA === null ? '' : localA;
        inputA.disabled = settled;
        inputA.onchange = async () => {
          localA = inputA.value === '' ? null : parseInt(inputA.value);
          updateLocalPrediction(m.id, p, localA, localB);
          if (localA === null || localB === null) return;
          try { await apiSetPrediction(m.id, p, localA, localB); } catch (e) { console.error(e); }
          renderBetsScoreboard();
        };
        row.appendChild(inputA);

        const sep = document.createElement('span');
        sep.className = 'score-sep';
        sep.textContent = '–';
        row.appendChild(sep);

        const inputB = document.createElement('input');
        inputB.type = 'number'; inputB.min = '0'; inputB.className = 'score-input';
        inputB.value = localB === null ? '' : localB;
        inputB.disabled = settled;
        inputB.onchange = async () => {
          localB = inputB.value === '' ? null : parseInt(inputB.value);
          updateLocalPrediction(m.id, p, localA, localB);
          if (localA === null || localB === null) return;
          try { await apiSetPrediction(m.id, p, localA, localB); } catch (e) { console.error(e); }
          renderBetsScoreboard();
        };
        row.appendChild(inputB);
      }

      if (settled && isWinningPrediction(m, pred)) {
        const badge = document.createElement('span');
        badge.className = 'predict-win-badge';
        badge.textContent = '🍺';
        row.appendChild(badge);
      }
      grid.appendChild(row);
    });
    card.appendChild(grid);

    if (settled) {
      const tag = document.createElement('div');
      tag.className = 'settled-tag';
      const scoreText = document.createElement('span');
      scoreText.textContent = custom ? `Answer: ${m.resultA}` : `Final score: ${m.teamA} ${m.resultA} – ${m.resultB} ${m.teamB}`;
      tag.appendChild(scoreText);
      const archiveBtn = document.createElement('button');
      archiveBtn.className = 'archive-btn';
      archiveBtn.textContent = 'Archive';
      archiveBtn.title = 'Lock in any won beer rounds permanently, then remove from this list';
      archiveBtn.onclick = () => archiveMatch(m.id);
      tag.appendChild(archiveBtn);
      card.appendChild(tag);
    } else {
      const resultRow = document.createElement('div');
      resultRow.className = 'result-row';
      const label = document.createElement('span');
      label.className = 'result-label';
      label.textContent = custom ? 'ACTUAL ANSWER' : 'REAL RESULT';
      resultRow.appendChild(label);

      if (custom) {
        const rInput = document.createElement('input');
        rInput.type = 'text'; rInput.className = 'score-input'; rInput.style.width = '120px'; rInput.placeholder = 'answer';
        resultRow.appendChild(rInput);
        const saveBtn = document.createElement('button');
        saveBtn.className = 'result-save-btn';
        saveBtn.textContent = 'Save result';
        saveBtn.onclick = async () => {
          const val = rInput.value.trim();
          if (val === '') { alert('Enter the actual answer first.'); return; }
          m.resultA = val; m.resultB = null;
          renderMatchList();
          renderBetsScoreboard();
          try { await apiSetMatchResult(m.id, m.resultA, ''); } catch (e) { console.error(e); }
        };
        resultRow.appendChild(saveBtn);
      } else {
        const rInputA = document.createElement('input');
        rInputA.type = 'number'; rInputA.min = '0'; rInputA.className = 'score-input';
        resultRow.appendChild(rInputA);
        const sep = document.createElement('span');
        sep.className = 'score-sep';
        sep.textContent = '–';
        resultRow.appendChild(sep);
        const rInputB = document.createElement('input');
        rInputB.type = 'number'; rInputB.min = '0'; rInputB.className = 'score-input';
        resultRow.appendChild(rInputB);
        const saveBtn = document.createElement('button');
        saveBtn.className = 'result-save-btn';
        saveBtn.textContent = 'Save result';
        saveBtn.onclick = async () => {
          const a = rInputA.value, b = rInputB.value;
          if (a === '' || b === '') { alert('Enter both scores first.'); return; }
          m.resultA = parseInt(a); m.resultB = parseInt(b);
          renderMatchList();
          renderBetsScoreboard();
          try { await apiSetMatchResult(m.id, m.resultA, m.resultB); } catch (e) { console.error(e); }
        };
        resultRow.appendChild(saveBtn);
      }
      card.appendChild(resultRow);

      const removeBtn = document.createElement('button');
      removeBtn.className = 'archive-btn';
      removeBtn.textContent = 'Remove';
      removeBtn.title = 'Delete this wager — nothing settled yet, so no beer credit to preserve';
      removeBtn.style.marginTop = '8px';
      removeBtn.onclick = () => removeMatch(m.id);
      card.appendChild(removeBtn);
    }
    wrap.appendChild(card);
  });
}
function updateLocalPrediction(matchId, person, scoreA, scoreB) {
  let pred = findPrediction(matchId, person);
  if (!pred) { pred = { matchId, person, scoreA, scoreB }; predictions.push(pred); }
  else { pred.scoreA = scoreA; pred.scoreB = scoreB; }
}

/* ---------------------------------------------------------------------
   Archive a settled wager — permanently locks any won rounds into
   baseBeers_<person> exactly once, then adds the match id to the
   persisted archived list so it's filtered out on every future load.
   This is what stops it from reappearing after a refresh AND stops the
   win from being re-counted (both were the same underlying bug).
   --------------------------------------------------------------------- */
async function archiveMatch(matchId) {
  const m = matches.find(x => x.id === matchId);
  if (!m) return;
  if (!isMatchSettled(m)) { alert('Only settled wagers (with a real result entered) can be archived.'); return; }
  const label = isCustomBet(m) ? m.teamA : `${m.teamA} vs ${m.teamB}`;
  if (!confirm(`Archive "${label}"? Any won beer rounds get locked in permanently, then it's removed from this list.`)) return;

  for (const p of PEOPLE) {
    const pred = findPrediction(matchId, p);
    if (isWinningPrediction(m, pred)) {
      const updated = Number(settings[`baseBeers_${p}`] || 0) + 1;
      settings[`baseBeers_${p}`] = updated;
      try { await apiSetSetting(`baseBeers_${p}`, updated); } catch (e) { console.error('Failed to persist beer credit', e); }
    }
  }

  await addArchivedMatchId(matchId);
  matches = matches.filter(x => x.id !== matchId);
  predictions = predictions.filter(pr => pr.matchId !== matchId);
  renderBetsTab();
  renderWeeklyRecap();

  // Best-effort real cleanup — harmless no-op until a matching backend
  // handler exists; the archived-list filter above is what actually
  // guarantees correctness regardless of whether this succeeds.
  try { await apiPost({ action: 'deleteMatch', matchId }); } catch (e) { /* not required for correctness */ }
}

/* ---------------------------------------------------------------------
   Remove an unsettled wager — no result yet, so nothing's been won
   and there's no beer credit to preserve. Same persisted-hide approach
   so it doesn't come back after a refresh either.
   --------------------------------------------------------------------- */
async function removeMatch(matchId) {
  const m = matches.find(x => x.id === matchId);
  if (!m) return;
  const label = isCustomBet(m) ? m.teamA : `${m.teamA} vs ${m.teamB}`;
  if (!confirm(`Remove "${label}"? It hasn't been settled yet.`)) return;

  await addArchivedMatchId(matchId);
  matches = matches.filter(x => x.id !== matchId);
  predictions = predictions.filter(pr => pr.matchId !== matchId);
  renderBetsTab();
  renderWeeklyRecap();

  try { await apiPost({ action: 'deleteMatch', matchId }); } catch (e) { /* not required for correctness */ }
}

let addBetType = 'football';
function setAddBetType(type) {
  addBetType = type;
  const isCustom = type === 'custom';
  document.getElementById('football-add-fields').style.display = isCustom ? 'none' : 'block';
  document.getElementById('custom-add-fields').style.display = isCustom ? 'block' : 'none';
  document.getElementById('add-bet-label').textContent = isCustom ? 'ADD A CUSTOM BET' : 'ADD A MATCH';
  document.getElementById('add-bet-sub').textContent = isCustom
    ? 'Not football — any question with a written or numeric answer. Settle it once the real answer is known.'
    : 'For the semis, final, or anything else worth a bet.';
  document.getElementById('bet-type-toggle-btn').textContent = isCustom ? '⚽ Switch to football bet' : '📝 Switch to custom bet';
}
document.getElementById('bet-type-toggle-btn').onclick = () => setAddBetType(addBetType === 'football' ? 'custom' : 'football');

document.getElementById('add-match-btn').onclick = async () => {
  let match;
  if (addBetType === 'custom') {
    const question = document.getElementById('new-match-question').value.trim();
    const date = document.getElementById('new-match-date').value.trim();
    if (!question) { alert('Enter the question first.'); return; }
    match = { id: `m-${Date.now()}`, teamA: question, teamB: '', meta: date || 'Date TBD', resultA: null, resultB: null };
    document.getElementById('new-match-question').value = '';
  } else {
    const teamA = document.getElementById('new-match-teamA').value.trim();
    const teamB = document.getElementById('new-match-teamB').value.trim();
    const date = document.getElementById('new-match-date').value.trim();
    if (!teamA || !teamB) { alert('Enter both team names.'); return; }
    match = { id: `m-${Date.now()}`, teamA, teamB, meta: date || 'Date TBD', resultA: null, resultB: null };
    document.getElementById('new-match-teamA').value = '';
    document.getElementById('new-match-teamB').value = '';
  }
  document.getElementById('new-match-date').value = '';
  matches.push(match);
  renderMatchList();
  try { await apiAddMatch(match); } catch (e) { console.error(e); }
};
function renderWcWinnerVisibility() {
  const isHidden = settings.worldCupHidden === 'true';
  const wrap = document.getElementById('wc-winner-wrap');
  const toggleBtn = document.getElementById('wc-winner-toggle-btn');
  if (wrap) wrap.style.display = isHidden ? 'none' : 'block';
  if (toggleBtn) toggleBtn.textContent = isHidden ? 'Show World Cup winner guess' : 'Hide World Cup winner guess';
}
document.getElementById('wc-winner-toggle-btn').onclick = async () => {
  const nowHidden = settings.worldCupHidden !== 'true';
  settings.worldCupHidden = nowHidden ? 'true' : 'false';
  try { await apiSetSetting('worldCupHidden', settings.worldCupHidden); } catch (e) { console.error(e); }
  renderWcWinnerVisibility();
};

function renderWinnerPredict() {
  renderWcWinnerVisibility();
  const wrap = document.getElementById('winner-predict');
  wrap.innerHTML = '';
  PEOPLE.forEach(p => {
    const row = document.createElement('div');
    row.className = 'winner-pick-row';
    const name = document.createElement('div');
    name.className = 'winner-pick-name';
    name.textContent = p;
    name.style.color = COLORS[p];
    row.appendChild(name);
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'e.g. Argentina';
    const existing = winnerPicks.find(w => w.person === p);
    input.value = existing ? existing.prediction : '';
    input.onchange = async () => {
      const val = input.value.trim();
      let pick = winnerPicks.find(w => w.person === p);
      if (!pick) { pick = { person: p, prediction: val }; winnerPicks.push(pick); }
      else { pick.prediction = val; }
      try { await apiSetWinnerPick(p, val); } catch (e) { console.error(e); }
    };
    row.appendChild(input);
    wrap.appendChild(row);
  });
  const actualInput = document.getElementById('actual-winner-input');
  actualInput.value = settings.actualWinner || '';
  const resultDiv = document.getElementById('winner-result');
  if (settings.actualWinner) {
    const winners = PEOPLE.filter(p => {
      const pick = winnerPicks.find(w => w.person === p);
      return pick && pick.prediction.toLowerCase() === settings.actualWinner.toLowerCase();
    });
    resultDiv.textContent = winners.length
      ? `🏆 ${winners.join(' & ')} called it — free beers all day.`
      : `Nobody guessed ${settings.actualWinner} — standings unaffected.`;
  } else {
    resultDiv.textContent = '';
  }
}
document.getElementById('save-winner-btn').onclick = async () => {
  const val = document.getElementById('actual-winner-input').value.trim();
  if (!val) { alert('Enter the actual World Cup winner first.'); return; }
  settings.actualWinner = val;
  renderWinnerPredict();
  renderBetsScoreboard();
  try { await apiSetSetting('actualWinner', val); } catch (e) { console.error(e); }
};

/* ---------------------------------------------------------------------
   World Cup winner archive — same idea as archiving a wager: the
   result (winner + who called it) gets permanently recorded in
   history BEFORE the pick/winner fields are cleared, so nothing's
   lost when the board gets reset for the next tournament.
   --------------------------------------------------------------------- */
function getWorldCupHistory() {
  try { return JSON.parse(settings.worldCupHistory || '[]'); } catch (e) { return []; }
}
async function saveWorldCupHistory(list) {
  settings.worldCupHistory = JSON.stringify(list);
  try { await apiSetSetting('worldCupHistory', settings.worldCupHistory); } catch (e) { console.error('Failed to save World Cup history', e); }
}
function renderWorldCupHistory() {
  const wrap = document.getElementById('world-cup-history');
  if (!wrap) return;
  const history = getWorldCupHistory().slice().sort((a, b) => b.date.localeCompare(a.date));
  wrap.innerHTML = '';
  if (history.length === 0) return;
  history.forEach(h => {
    const row = document.createElement('div');
    row.className = 'holiday-row';
    const label = document.createElement('span');
    label.className = 'holiday-label';
    label.textContent = h.callers.length
      ? `🏆 ${h.winner} won — called by ${h.callers.join(' & ')}`
      : `🏆 ${h.winner} won — nobody called it`;
    row.appendChild(label);
    const date = document.createElement('span');
    date.className = 'holiday-date';
    date.textContent = new Date(h.date + 'T00:00:00').toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' });
    row.appendChild(date);
    const del = document.createElement('button');
    del.className = 'delete-btn';
    del.textContent = '✕';
    del.title = 'Remove this history entry';
    del.onclick = async () => {
      const updated = getWorldCupHistory().filter(x => x.id !== h.id);
      await saveWorldCupHistory(updated);
      renderWorldCupHistory();
    };
    row.appendChild(del);
    wrap.appendChild(row);
  });
}
document.getElementById('archive-winner-btn').onclick = async () => {
  if (!settings.actualWinner) { alert('Enter and save the actual World Cup winner first.'); return; }
  const winner = settings.actualWinner;
  const callers = PEOPLE.filter(p => {
    const pick = winnerPicks.find(w => w.person === p);
    return pick && pick.prediction && pick.prediction.toLowerCase() === winner.toLowerCase();
  });
  if (!confirm(`Archive "${winner}" as champion${callers.length ? ` (called by ${callers.join(' & ')})` : ''}? This clears everyone's picks, hides this box, and credits the win on the Beer Scoreboard permanently.`)) return;

  const record = { id: `wc-${Date.now()}`, winner, callers, date: todayISO() };
  await saveWorldCupHistory([...getWorldCupHistory(), record]);

  // Clear picks and the winner field, both locally and on the server
  for (const p of PEOPLE) {
    const idx = winnerPicks.findIndex(w => w.person === p);
    if (idx !== -1) winnerPicks.splice(idx, 1);
    try { await apiSetWinnerPick(p, ''); } catch (e) { console.error(e); }
  }
  settings.actualWinner = '';
  try { await apiSetSetting('actualWinner', ''); } catch (e) { console.error(e); }

  settings.worldCupHidden = 'true';
  try { await apiSetSetting('worldCupHidden', 'true'); } catch (e) { console.error(e); }

  renderWinnerPredict();
  renderBetsScoreboard();
  renderWorldCupHistory();
};
function renderBetsTab() { renderBetsScoreboard(); renderMatchList(); renderWinnerPredict(); renderWorldCupHistory(); renderGoalTracker(); }

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
