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
