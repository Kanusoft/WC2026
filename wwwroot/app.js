let user = JSON.parse(localStorage.getItem('wcUser') || 'null');
let matches = [];
let predictions = {};
let todayPredictions = [];
let predictionsLocked = false;
let scheduleOpen = false;
let scheduleOpenAtUtc = null;
let countdownTimer = null;

const WORLD_CUP_KICKOFF_UTC = '2026-06-11T19:00:00Z';
const PREDICTIONS_LOCK_UTC = '2026-06-10T19:00:00Z';

const TEAM_FLAG_CODES = {
  argentina: 'ar',
  australia: 'au',
  austria: 'at',
  belgium: 'be',
  bolivia: 'bo',
  bosniaandherzegovina: 'ba',
  brazil: 'br',
  caboverde: 'cv',
  cameroon: 'cm',
  canada: 'ca',
  chile: 'cl',
  colombia: 'co',
  congodr: 'cd',
  cotedivoire: 'ci',
  croatia: 'hr',
  curacao: 'cw',
  czechia: 'cz',
  denmark: 'dk',
  ecuador: 'ec',
  egypt: 'eg',
  england: 'gb',
  france: 'fr',
  germany: 'de',
  ghana: 'gh',
  haiti: 'ht',
  iran: 'ir',
  iraq: 'iq',
  italy: 'it',
  ivorycoast: 'ci',
  japan: 'jp',
  jordan: 'jo',
  korea: 'kr',
  southkorea: 'kr',
  mexico: 'mx',
  morocco: 'ma',
  netherlands: 'nl',
  newzealand: 'nz',
  nigeria: 'ng',
  norway: 'no',
  panama: 'pa',
  paraguay: 'py',
  peru: 'pe',
  poland: 'pl',
  portugal: 'pt',
  qatar: 'qa',
  saudiarabia: 'sa',
  scotland: 'gb',
  senegal: 'sn',
  serbia: 'rs',
  southafrica: 'za',
  spain: 'es',
  sweden: 'se',
  switzerland: 'ch',
  tunisia: 'tn',
  turkiye: 'tr',
  turkey: 'tr',
  usa: 'us',
  unitedstates: 'us',
  uzbekistan: 'uz',
  uruguay: 'uy',
  venezuela: 've',
  wales: 'gb'
};

window.onload = () => {
  initCountdown();
  if (user) showApp();
};

async function login() {
  document.getElementById('loginError').textContent = '';
  const name = document.getElementById('loginName').value;
  const pin = document.getElementById('loginPin').value;
  const res = await fetch('/api/login', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ name, pin }) });
  if (!res.ok) { document.getElementById('loginError').textContent = 'Invalid name or PIN.'; return; }
  user = await res.json();
  localStorage.setItem('wcUser', JSON.stringify(user));
  showApp();
}

function logout() { localStorage.removeItem('wcUser'); location.reload(); }

async function showApp() {
  document.getElementById('loginPanel').classList.add('d-none');
  document.getElementById('appPanel').classList.remove('d-none');
  document.getElementById('userBadge').textContent = `${user.name}${user.isAdmin ? ' (Admin)' : ''}`;
  document.getElementById('exportCsvBtn').href = `/api/export/${user.id}`;
  document.getElementById('adminPanel').classList.toggle('d-none', !user.isAdmin);
  await refreshAll();
}

async function refreshAll() {
  const [matchData, predictionData, predictionStatusData, todayPredictionData] = await Promise.all([
    fetch('/api/matches').then(r => r.json()),
    fetch(`/api/predictions/${user.id}`).then(r => r.json()),
    fetch(`/api/predictions/status?userId=${encodeURIComponent(user.id)}`).then(r => r.json()),
    fetch('/api/predictions/today').then(r => r.json())
  ]);

  matches = matchData;
  predictions = predictionData;
  todayPredictions = todayPredictionData;
  predictionsLocked = Boolean(predictionStatusData?.isLocked);
  scheduleOpen = Boolean(predictionStatusData?.isScheduleOpen);
  scheduleOpenAtUtc = predictionStatusData?.scheduleOpenAtUtc || null;

  renderPredictions();
  renderTodayPredictions();
  renderPredictionLockBanner();
  renderScheduleAccess();
  renderAdmin();
  renderLeaderboard();
}

function renderScheduleAccess() {
  const scheduleBtn = document.getElementById('scheduleLinkBtn');
  if (!scheduleBtn) return;

  if (scheduleOpen) {
    scheduleBtn.classList.remove('disabled');
    scheduleBtn.removeAttribute('aria-disabled');
    scheduleBtn.removeAttribute('tabindex');
    scheduleBtn.removeAttribute('title');
    scheduleBtn.setAttribute('href', '/schedule.html');
    return;
  }

  const openDate = scheduleOpenAtUtc ? new Date(scheduleOpenAtUtc).toUTCString() : 'kickoff day';
  scheduleBtn.classList.add('disabled');
  scheduleBtn.setAttribute('aria-disabled', 'true');
  scheduleBtn.setAttribute('tabindex', '-1');
  scheduleBtn.setAttribute('title', `Full Schedule unlocks on ${openDate}`);
  scheduleBtn.setAttribute('href', '#');
}

function renderPredictions() {
  const table = document.getElementById('predictionTable');
  let html = `<thead><tr><th>#</th><th>Group</th><th>Match</th><th>Match Date/Time</th><th>Actual</th><th>Your prediction</th><th></th></tr></thead><tbody>`;
  let lastGroup = '';
  for (const m of matches) {
    if (m.groupName !== lastGroup) { html += `<tr class="group-row"><td colspan="7">Group ${m.groupName}</td></tr>`; lastGroup = m.groupName; }
    const p = predictions[m.id] || {};
    const isPending = m.actualHomeGoals == null;
    const disabledAttr = predictionsLocked ? 'disabled' : '';
    const actual = isPending ? 'Pending' : `${m.actualHomeGoals} - ${m.actualAwayGoals}`;
    const resultClass = isPending ? 'text-bg-warning' : 'text-bg-success';
    const resultIcon = isPending ? 'bi-hourglass-split' : 'bi-check-circle-fill';
    const matchDateTime = formatPredictionMatchDateTime(m.kickoffUtc);
    html += `<tr>
      <td>${m.id}</td><td>${m.groupName}</td><td><i class="bi bi-dribbble me-1"></i><strong>${renderTeamName(m.homeTeam)}</strong> vs <strong>${renderTeamName(m.awayTeam)}</strong><div class="small text-muted">${esc(m.venue || '')}</div></td>
      <td>${matchDateTime}</td>
      <td><span class="badge ${resultClass} badge-result"><i class="bi ${resultIcon} me-1"></i>${actual}</span></td>
      <td><input type="number" min="0" class="form-control form-control-sm score-input" id="ph_${m.id}" value="${p.homeGoals ?? ''}" ${disabledAttr}> - <input type="number" min="0" class="form-control form-control-sm score-input" id="pa_${m.id}" value="${p.awayGoals ?? ''}" ${disabledAttr}></td>
      <td><button class="btn btn-sm btn-primary" onclick="savePrediction(${m.id})" ${disabledAttr}>Save</button></td>
    </tr>`;
  }
  table.innerHTML = html + '</tbody>';
}

async function savePrediction(matchId) {
  if (predictionsLocked) {
    renderPredictionLockBanner();
    return;
  }

  const hg = valOrNull(`ph_${matchId}`);
  const ag = valOrNull(`pa_${matchId}`);
  const response = await fetch('/api/predictions', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ userId:user.id, matchId, homeGoals:hg, awayGoals:ag })
  });

  if (!response.ok) {
    if (response.status === 403) {
      predictionsLocked = true;
      renderPredictionLockBanner();
    }
    return;
  }

  await refreshAll();
}

function isPredictionWindowLocked() {
  return Date.now() >= Date.parse(PREDICTIONS_LOCK_UTC);
}

function renderPredictionLockBanner() {
  const banner = document.getElementById('predictionLockBanner');
  if (!banner) return;

  const lockDate = new Date(PREDICTIONS_LOCK_UTC);
  if (predictionsLocked) {
    banner.classList.remove('d-none');
    banner.textContent = 'Predictions are locked one day before kickoff and can no longer be edited.';
    return;
  }

  banner.classList.remove('d-none');
  banner.textContent = `Predictions lock at ${lockDate.toUTCString()} (one day before kickoff).`;
}

function renderTodayPredictions() {
  const container = document.getElementById('todayPredictions');
  if (!container) return;

  if (!Array.isArray(todayPredictions) || todayPredictions.length === 0) {
    container.innerHTML = '<div class="text-muted">No games scheduled for today (UTC).</div>';
    return;
  }

  let html = '';
  for (const m of todayPredictions) {
    html += `<div class="today-match mb-3">
      <div class="today-match-header d-flex flex-wrap justify-content-between gap-2">
        <div><span class="badge text-bg-secondary me-2">Group ${esc(m.groupName)}</span><strong>${renderTeamName(m.homeTeam)}</strong> vs <strong>${renderTeamName(m.awayTeam)}</strong></div>
        <div class="small text-muted">Kickoff: ${formatKickoffUtc(m.kickoffUtc)}</div>
      </div>
      <div class="table-responsive mt-2">
        <table class="table table-sm align-middle mb-0">
          <thead><tr><th>User</th><th>Prediction</th></tr></thead>
          <tbody>`;

    for (const p of m.predictions || []) {
      const prediction = (p.homeGoals == null || p.awayGoals == null) ? '<span class="text-muted">Not submitted</span>' : `${p.homeGoals} - ${p.awayGoals}`;
      html += `<tr><td>${esc(p.userName)}</td><td>${prediction}</td></tr>`;
    }

    html += `</tbody></table>
      </div>
    </div>`;
  }

  container.innerHTML = html;
}

function renderAdmin() {
  if (!user?.isAdmin) return;
  const box = document.getElementById('adminMatches');
  let html = '';
  for (const m of matches) {
    html += `<div class="admin-row row g-2 align-items-center">
      <div class="col-md-1"><strong>#${m.id}</strong><input class="form-control form-control-sm mt-1" id="g_${m.id}" value="${esc(m.groupName)}"></div>
      <div class="col-md-3"><input class="form-control form-control-sm team-input" id="h_${m.id}" value="${esc(m.homeTeam)}"></div>
      <div class="col-md-3"><input class="form-control form-control-sm team-input" id="a_${m.id}" value="${esc(m.awayTeam)}"></div>
      <div class="col-md-2"><input class="form-control form-control-sm" id="v_${m.id}" placeholder="Venue" value="${esc(m.venue || '')}"></div>
      <div class="col-md-1"><input type="number" min="0" class="form-control form-control-sm" id="ah_${m.id}" value="${m.actualHomeGoals ?? ''}" placeholder="H"></div>
      <div class="col-md-1"><input type="number" min="0" class="form-control form-control-sm" id="aa_${m.id}" value="${m.actualAwayGoals ?? ''}" placeholder="A"></div>
      <div class="col-md-1 d-grid"><button class="btn btn-sm btn-dark" onclick="saveAdmin(${m.id})">Save</button></div>
    </div>`;
  }
  box.innerHTML = html;
}

async function saveAdmin(matchId) {
  const currentMatch = matches.find(m => m.id === matchId);
  await fetch('/api/admin/matches', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({
    adminUserId:user.id, matchId, groupName:document.getElementById(`g_${matchId}`).value, homeTeam:document.getElementById(`h_${matchId}`).value,
    awayTeam:document.getElementById(`a_${matchId}`).value, kickoffUtc:currentMatch?.kickoffUtc ?? null, venue:document.getElementById(`v_${matchId}`).value
  }) });
  await fetch('/api/admin/result', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ adminUserId:user.id, matchId, actualHomeGoals:valOrNull(`ah_${matchId}`), actualAwayGoals:valOrNull(`aa_${matchId}`) }) });
  await refreshAll();
}

async function renderLeaderboard() {
  const data = await (await fetch('/api/leaderboard')).json();
  let html = '<div class="table-responsive"><table class="table table-sm"><thead><tr><th>Rank</th><th>Name</th><th>Predictions</th><th>Points</th></tr></thead><tbody>';
  data.forEach((r, i) => {
    const rank = i + 1;
    const cls = rank === 1 ? 'leaderboard-gold' : rank === 2 ? 'leaderboard-silver' : rank === 3 ? 'leaderboard-bronze' : '';
    const icon = rank === 1 ? 'bi-trophy-fill' : rank === 2 ? 'bi-award-fill' : rank === 3 ? 'bi-patch-check-fill' : '';
    const decoratedName = icon ? `<i class="bi ${icon} me-1"></i>${esc(r.name)}` : esc(r.name);
    html += `<tr class="${cls}"><td>${rank}</td><td>${decoratedName}</td><td>${r.predictions}</td><td><strong>${r.points}</strong></td></tr>`;
  });
  document.getElementById('leaderboard').innerHTML = html + '</tbody></table></div>';
}

function valOrNull(id) { const v = document.getElementById(id).value; return v === '' ? null : Number(v); }
function esc(s) { return String(s).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[c])); }

function normalizeTeamName(name) {
  return String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}

function getTeamFlagCode(teamName) {
  return TEAM_FLAG_CODES[normalizeTeamName(teamName)] || null;
}

function renderTeamName(teamName) {
  const safeName = esc(teamName);
  const code = getTeamFlagCode(teamName);
  if (!code) return safeName;
  return `<img class="team-flag" src="https://flagcdn.com/24x18/${code}.png" alt="${safeName} flag" loading="lazy"> ${safeName}`;
}

function formatKickoffUtc(value) {
  const date = parseKickoffDate(value);
  if (Number.isNaN(date.getTime())) return esc(value || 'N/A');
  return date.toUTCString();
}

function formatPredictionMatchDateTime(value) {
  const date = parseKickoffDate(value);
  if (Number.isNaN(date.getTime())) return 'N/A';

  return date.toLocaleString('en-US', {
    month: 'numeric',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
}

function parseKickoffDate(value) {
  if (!value) return new Date(NaN);

  const raw = String(value).trim();
  const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw);
  return new Date(hasTimezone ? raw : `${raw}Z`);
}

function initCountdown() {
  if (countdownTimer) clearInterval(countdownTimer);
  updateCountdown();
  countdownTimer = setInterval(updateCountdown, 1000);
}

function updateCountdown() {
  const target = Date.parse(WORLD_CUP_KICKOFF_UTC);
  const now = Date.now();
  const diff = target - now;
  const daysEl = document.getElementById('cdDays');
  const hoursEl = document.getElementById('cdHours');
  const minutesEl = document.getElementById('cdMinutes');
  const secondsEl = document.getElementById('cdSeconds');
  const noteEl = document.getElementById('countdownNote');

  if (!daysEl || !hoursEl || !minutesEl || !secondsEl || !noteEl) return;

  if (diff <= 0) {
    daysEl.textContent = '0';
    hoursEl.textContent = '0';
    minutesEl.textContent = '0';
    secondsEl.textContent = '0';
    noteEl.textContent = 'World Cup 2026 is live. Time to lock in your predictions.';
    return;
  }

  const totalSeconds = Math.floor(diff / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  daysEl.textContent = String(days);
  hoursEl.textContent = String(hours).padStart(2, '0');
  minutesEl.textContent = String(minutes).padStart(2, '0');
  secondsEl.textContent = String(seconds).padStart(2, '0');
  noteEl.textContent = 'Countdown to World Cup 2026 kickoff: June 11, 2026';
}
