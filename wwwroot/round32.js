let user = JSON.parse(localStorage.getItem('wcUser') || 'null');
let round32Matches = [];
let round32Predictions = {};
let round32Leaderboard = [];
let round32ScheduleMatches = [];
let round32Locked = false;
let round32LockAtUtc = null;

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
  const statusFallback = { isLocked: false, lockAtUtc: null };

  const [matchDataPrimary, predictionDataPrimary, leaderboardDataPrimary, scheduleDataPrimary, statusData] = await Promise.all([
    fetchJsonSafe('/api/round32/matches', null),
    fetchJsonSafe(`/api/round32/predictions/${user.id}`, null),
    fetchJsonSafe('/api/round32/leaderboard', null),
    fetchJsonSafe('/api/round32/schedule', null),
    fetchJsonSafe('/api/round32/status', statusFallback)
  ]);

  let matchData = Array.isArray(matchDataPrimary) ? matchDataPrimary : null;
  if (!matchData) {
    const allMatches = await fetchJsonSafe('/api/matches', []);
    matchData = Array.isArray(allMatches) ? allMatches.filter(m => String(m.groupName).toUpperCase() === 'R32') : [];
  }

  let predictionData = predictionDataPrimary && typeof predictionDataPrimary === 'object' ? predictionDataPrimary : null;
  if (!predictionData) {
    predictionData = await fetchJsonSafe(`/api/predictions/${user.id}`, {});
  }

  let scheduleData = Array.isArray(scheduleDataPrimary) ? scheduleDataPrimary : null;
  if (!scheduleData) {
    const fullSchedule = await fetchJsonSafe('/api/predictions/schedule', []);
    scheduleData = Array.isArray(fullSchedule)
      ? fullSchedule.filter(m => String(m.groupName).toUpperCase() === 'R32')
      : [];
  }

  const leaderboardData = Array.isArray(leaderboardDataPrimary)
    ? leaderboardDataPrimary
    : computeLeaderboardFromSchedule(Array.isArray(scheduleData) ? scheduleData : []);

  round32Matches = Array.isArray(matchData) ? matchData : [];
  round32Predictions = predictionData || {};
  round32Leaderboard = Array.isArray(leaderboardData) ? leaderboardData : [];
  round32ScheduleMatches = Array.isArray(scheduleData) ? scheduleData : [];
  round32Locked = Boolean(statusData?.isLocked);
  round32LockAtUtc = statusData?.lockAtUtc || null;
  setRound32ScheduleVisibility();
  renderRound32LockBanner();
  renderRound32Leaderboard();
  if (round32Locked) {
    renderRound32ScheduleCards();
  }
  renderRound32();
}

function setRound32ScheduleVisibility() {
  const section = document.getElementById('round32ScheduleSection');
  if (!section) return;
  section.classList.toggle('d-none', !round32Locked);
}

function renderRound32LockBanner() {
  const banner = document.getElementById('round32LockBanner');
  if (!banner) return;

  const lockText = round32LockAtUtc
    ? new Date(round32LockAtUtc).toLocaleString('en-US', {
      timeZone: 'America/Los_Angeles',
      month: 'numeric',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZoneName: 'short'
    })
    : 'end of day 6/29/2026 Pacific';

  banner.textContent = round32Locked
    ? 'Round of 32 predictions are locked.'
    : `Round of 32 predictions lock at ${lockText}.`;
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
    const disabledAttr = round32Locked ? 'disabled' : '';

    html += `<tr>
      <td>${m.id}</td>
      <td>
        <strong>${esc(m.homeTeam)}</strong> vs <strong>${esc(m.awayTeam)}</strong>
        <div class="small text-muted">${esc(m.venue || '')}${m.location ? ` | ${esc(m.location)}` : ''}</div>
      </td>
      <td>${formatPacificDateTime(m.kickoffUtc)}</td>
      <td><span class="badge ${badgeClass}">${result}</span></td>
      <td>
        <input type="number" min="0" class="form-control form-control-sm score-input" id="r32h_${m.id}" value="${p.homeGoals ?? ''}" ${disabledAttr}> -
        <input type="number" min="0" class="form-control form-control-sm score-input" id="r32a_${m.id}" value="${p.awayGoals ?? ''}" ${disabledAttr}>
      </td>
      <td><button class="btn btn-sm btn-primary" onclick="saveRound32Prediction(${m.id})" ${disabledAttr}>Save</button></td>
    </tr>`;
  }

  table.innerHTML = html + '</tbody>';
}

function renderRound32ScheduleCards() {
  const box = document.getElementById('round32ScheduleCards');
  if (!box) return;

  if (round32ScheduleMatches.length === 0) {
    box.innerHTML = '<div class="text-muted">No Round of 32 schedule cards found.</div>';
    return;
  }

  let html = '';
  for (const m of round32ScheduleMatches) {
    const hasActual = m.actualHomeGoals != null && m.actualAwayGoals != null;
    const actual = hasActual
      ? `<span class="badge text-bg-success">${m.actualHomeGoals} - ${m.actualAwayGoals}</span>`
      : '<span class="badge text-bg-warning">Pending</span>';
    const actualText = hasActual ? `${m.actualHomeGoals} vs ${m.actualAwayGoals}` : 'Not available yet';

    html += `<article class="card wc-card shadow-sm schedule-card">
      <div class="card-body">
        <div class="d-flex flex-wrap justify-content-between align-items-start gap-2 mb-2">
          <div>
            <div class="small text-muted">Game ${m.id} | Round of 32</div>
            <h2 class="h5 mb-1"><strong>${esc(m.homeTeam)}</strong> vs <strong>${esc(m.awayTeam)}</strong></h2>
            <div class="small text-muted"><i class="bi bi-clock"></i> ${formatPacificDateTime(m.kickoffUtc)}${m.venue ? ` | <i class="bi bi-geo-alt"></i> ${esc(m.venue)}` : ''}</div>
            <div class="small ${hasActual ? 'text-success' : 'text-muted'}"><i class="bi bi-flag"></i> Actual Result: ${esc(actualText)}</div>
          </div>
          <div>${actual}</div>
        </div>

        <div class="table-responsive">
          <table class="table table-sm align-middle mb-0">
            <thead>
              <tr><th>User</th><th>Prediction</th><th>Points</th></tr>
            </thead>
            <tbody>`;

    for (const p of m.predictions || []) {
      const points = computePredictionPoints(m, p);
      const pred = (p.homeGoals == null || p.awayGoals == null)
        ? '<span class="text-muted">Not submitted</span>'
        : `<strong>${p.homeGoals}</strong> vs <strong>${p.awayGoals}</strong>`;
      const pointsText = points == null ? '<span class="text-muted">-</span>' : `<strong>${points}</strong>`;
      html += `<tr><td>${esc(p.userName)}</td><td>${pred}</td><td>${pointsText}</td></tr>`;
    }

    html += `</tbody>
          </table>
        </div>
      </div>
    </article>`;
  }

  box.innerHTML = html;
}

async function saveRound32Prediction(matchId) {
  if (round32Locked) return;

  const homeGoals = valOrNull(`r32h_${matchId}`);
  const awayGoals = valOrNull(`r32a_${matchId}`);
  const response = await fetch('/api/round32/predictions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: user.id, matchId, homeGoals, awayGoals })
  });

  if (!response.ok) {
    if (response.status === 403) {
      round32Locked = true;
      setRound32ScheduleVisibility();
      renderRound32LockBanner();
      renderRound32ScheduleCards();
      renderRound32();
    }
    return;
  }
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

function computePredictionPoints(match, prediction) {
  if (match.actualHomeGoals == null || match.actualAwayGoals == null) return null;
  if (prediction.homeGoals == null || prediction.awayGoals == null) return 0;

  if (prediction.homeGoals === match.actualHomeGoals && prediction.awayGoals === match.actualAwayGoals) return 3;

  const predictedDiff = prediction.homeGoals - prediction.awayGoals;
  const actualDiff = match.actualHomeGoals - match.actualAwayGoals;
  const sameOutcome = (predictedDiff === 0 && actualDiff === 0)
    || (predictedDiff > 0 && actualDiff > 0)
    || (predictedDiff < 0 && actualDiff < 0);

  return sameOutcome ? 1 : 0;
}

function computeLeaderboardFromSchedule(scheduleMatches) {
  const byUser = new Map();

  for (const match of scheduleMatches || []) {
    for (const p of match.predictions || []) {
      if (!byUser.has(p.userName)) {
        byUser.set(p.userName, { name: p.userName, predictions: 0, points: 0 });
      }

      const row = byUser.get(p.userName);
      if (p.homeGoals != null && p.awayGoals != null) {
        row.predictions += 1;
      }

      const pts = computePredictionPoints(match, p);
      if (pts != null) {
        row.points += pts;
      }
    }
  }

  return Array.from(byUser.values()).sort((a, b) => b.points - a.points).map(r => ({
    name: r.name,
    predictions: r.predictions,
    points: r.points
  }));
}

async function fetchJsonSafe(url, fallbackValue) {
  try {
    const response = await fetch(url);
    if (!response.ok) return fallbackValue;

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.toLowerCase().includes('application/json')) return fallbackValue;

    return await response.json();
  } catch {
    return fallbackValue;
  }
}

function valOrNull(id) {
  const val = document.getElementById(id)?.value ?? '';
  return val === '' ? null : Number(val);
}

function esc(s) {
  return String(s).replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[c]));
}
