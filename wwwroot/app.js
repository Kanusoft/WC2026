let user = JSON.parse(localStorage.getItem('wcUser') || 'null');
let matches = [];
let predictions = {};
let countdownTimer = null;

const WORLD_CUP_KICKOFF_UTC = '2026-06-11T19:00:00Z';

const TEAM_FLAG_CODES = {
  argentina: 'ar',
  australia: 'au',
  belgium: 'be',
  bolivia: 'bo',
  brazil: 'br',
  cameroon: 'cm',
  canada: 'ca',
  chile: 'cl',
  colombia: 'co',
  croatia: 'hr',
  denmark: 'dk',
  ecuador: 'ec',
  egypt: 'eg',
  england: 'gb',
  france: 'fr',
  germany: 'de',
  ghana: 'gh',
  iran: 'ir',
  iraq: 'iq',
  italy: 'it',
  ivorycoast: 'ci',
  japan: 'jp',
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
  senegal: 'sn',
  serbia: 'rs',
  spain: 'es',
  switzerland: 'ch',
  tunisia: 'tn',
  turkey: 'tr',
  usa: 'us',
  unitedstates: 'us',
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
  matches = await (await fetch('/api/matches')).json();
  predictions = await (await fetch(`/api/predictions/${user.id}`)).json();
  renderPredictions();
  renderAdmin();
  renderLeaderboard();
}

function renderPredictions() {
  const table = document.getElementById('predictionTable');
  let html = `<thead><tr><th>#</th><th>Group</th><th>Match</th><th>Actual</th><th>Your prediction</th><th></th></tr></thead><tbody>`;
  let lastGroup = '';
  for (const m of matches) {
    if (m.groupName !== lastGroup) { html += `<tr class="group-row"><td colspan="6">Group ${m.groupName}</td></tr>`; lastGroup = m.groupName; }
    const p = predictions[m.id] || {};
    const isPending = m.actualHomeGoals == null;
    const actual = isPending ? 'Pending' : `${m.actualHomeGoals} - ${m.actualAwayGoals}`;
    const resultClass = isPending ? 'text-bg-warning' : 'text-bg-success';
    const resultIcon = isPending ? 'bi-hourglass-split' : 'bi-check-circle-fill';
    html += `<tr>
      <td>${m.id}</td><td>${m.groupName}</td><td><i class="bi bi-dribbble me-1"></i><strong>${renderTeamName(m.homeTeam)}</strong> vs <strong>${renderTeamName(m.awayTeam)}</strong><div class="small text-muted">${esc(m.venue || '')}</div></td>
      <td><span class="badge ${resultClass} badge-result"><i class="bi ${resultIcon} me-1"></i>${actual}</span></td>
      <td><input type="number" min="0" class="form-control form-control-sm score-input" id="ph_${m.id}" value="${p.homeGoals ?? ''}"> - <input type="number" min="0" class="form-control form-control-sm score-input" id="pa_${m.id}" value="${p.awayGoals ?? ''}"></td>
      <td><button class="btn btn-sm btn-primary" onclick="savePrediction(${m.id})">Save</button></td>
    </tr>`;
  }
  table.innerHTML = html + '</tbody>';
}

async function savePrediction(matchId) {
  const hg = valOrNull(`ph_${matchId}`);
  const ag = valOrNull(`pa_${matchId}`);
  await fetch('/api/predictions', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ userId:user.id, matchId, homeGoals:hg, awayGoals:ag }) });
  await refreshAll();
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
  await fetch('/api/admin/matches', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({
    adminUserId:user.id, matchId, groupName:document.getElementById(`g_${matchId}`).value, homeTeam:document.getElementById(`h_${matchId}`).value,
    awayTeam:document.getElementById(`a_${matchId}`).value, kickoffUtc:null, venue:document.getElementById(`v_${matchId}`).value
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
  return String(name || '').toLowerCase().replace(/[^a-z]/g, '');
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
