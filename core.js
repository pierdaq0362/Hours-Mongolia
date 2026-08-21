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
