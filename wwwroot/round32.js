let user = JSON.parse(localStorage.getItem('wcUser') || 'null');
let round32Matches = [];
let round32Predictions = {};
let round32Leaderboard = [];

window.onload = async () => {
  if (!user) {
    location.href = '/index.html';
    return;
  }

  const badge = document.getElementById('round32UserBadge');
  if (badge) {
    badge.textContent = `${user.name}${user.isAdmin ? ' (Admin)' : ''}`;
  }

  const refreshBtn = document.getElementById('round32RefreshBtn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', refreshRound32);
  }

  await refreshRound32();
};

async function refreshRound32() {
  const [matchData, predictionData, leaderboardData] = await Promise.all([
    fetch('/api/round32/matches').then(r => r.json()),
    fetch(`/api/round32/predictions/${user.id}`).then(r => r.json()),
    fetch('/api/round32/leaderboard').then(r => r.json())
  ]);

  round32Matches = Array.isArray(matchData) ? matchData : [];
  round32Predictions = predictionData || {};
  round32Leaderboard = Array.isArray(leaderboardData) ? leaderboardData : [];
  renderRound32Leaderboard();
  renderRound32();
}

function renderRound32Leaderboard() {
  const box = document.getElementById('round32Leaderboard');
  if (!box) return;

  if (round32Leaderboard.length === 0) {
    box.innerHTML = '<div class="text-muted">No Round of 32 leaderboard data yet.</div>';
    return;
  }

  let html = '<div class="table-responsive"><table class="table table-sm"><thead><tr><th>Rank</th><th>Name</th><th>Predictions</th><th>Points</th></tr></thead><tbody>';
  round32Leaderboard.forEach((r, i) => {
    const rank = i + 1;
    const cls = rank === 1 ? 'leaderboard-gold' : rank === 2 ? 'leaderboard-silver' : rank === 3 ? 'leaderboard-bronze' : '';
    const icon = rank === 1 ? 'bi-trophy-fill' : rank === 2 ? 'bi-award-fill' : rank === 3 ? 'bi-patch-check-fill' : '';
    const decoratedName = icon ? `<i class="bi ${icon} me-1"></i>${esc(r.name)}` : esc(r.name);
    html += `<tr class="${cls}"><td>${rank}</td><td>${decoratedName}</td><td>${r.predictions}</td><td><strong>${r.points}</strong></td></tr>`;
  });

  box.innerHTML = html + '</tbody></table></div>';
}

function renderRound32() {
  const table = document.getElementById('round32Table');
  if (!table) return;

  if (round32Matches.length === 0) {
    table.innerHTML = '<tbody><tr><td class="text-muted">No Round of 32 matches found.</td></tr></tbody>';
    return;
  }

  let html = '<thead><tr><th>#</th><th>Match</th><th>Kickoff (Pacific)</th><th>Result</th><th>Your prediction</th><th></th></tr></thead><tbody>';
  for (const m of round32Matches) {
    const p = round32Predictions[m.id] || {};
    const hasResult = m.actualHomeGoals != null && m.actualAwayGoals != null;
    const result = hasResult ? `${m.actualHomeGoals} - ${m.actualAwayGoals}` : 'Pending';
    const badgeClass = hasResult ? 'text-bg-success' : 'text-bg-warning';

    html += `<tr>
      <td>${m.id}</td>
      <td>
        <strong>${esc(m.homeTeam)}</strong> vs <strong>${esc(m.awayTeam)}</strong>
        <div class="small text-muted">${esc(m.venue || '')}${m.location ? ` | ${esc(m.location)}` : ''}</div>
      </td>
      <td>${formatPacificDateTime(m.kickoffUtc)}</td>
      <td><span class="badge ${badgeClass}">${result}</span></td>
      <td>
        <input type="number" min="0" class="form-control form-control-sm score-input" id="r32h_${m.id}" value="${p.homeGoals ?? ''}"> -
        <input type="number" min="0" class="form-control form-control-sm score-input" id="r32a_${m.id}" value="${p.awayGoals ?? ''}">
      </td>
      <td><button class="btn btn-sm btn-primary" onclick="saveRound32Prediction(${m.id})">Save</button></td>
    </tr>`;
  }

  table.innerHTML = html + '</tbody>';
}

async function saveRound32Prediction(matchId) {
  const homeGoals = valOrNull(`r32h_${matchId}`);
  const awayGoals = valOrNull(`r32a_${matchId}`);
  const response = await fetch('/api/round32/predictions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: user.id, matchId, homeGoals, awayGoals })
  });

  if (!response.ok) return;
  await refreshRound32();
}

function formatPacificDateTime(value) {
  const date = parseKickoffDate(value);
  if (Number.isNaN(date.getTime())) return 'N/A';
  return date.toLocaleString('en-US', {
    timeZone: 'America/Los_Angeles',
    month: 'numeric',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short'
  });
}

function parseKickoffDate(value) {
  if (!value) return new Date(NaN);
  const raw = String(value).trim();
  const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw);
  return new Date(hasTimezone ? raw : `${raw}Z`);
}

function valOrNull(id) {
  const val = document.getElementById(id)?.value ?? '';
  return val === '' ? null : Number(val);
}

function esc(s) {
  return String(s).replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[c]));
}
