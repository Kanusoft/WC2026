let scheduleMatches = [];
let showPastScheduleMatches = false;

const PACIFIC_TIME_ZONE = 'America/Los_Angeles';
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

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

window.onload = async () => {
  bindPrintButton();
  await loadSchedule();
};

function bindPrintButton() {
  const btn = document.getElementById('printScheduleBtn');
  if (!btn) return;

  btn.addEventListener('click', () => {
    window.print();
  });
}

async function loadSchedule() {
  const box = document.getElementById('scheduleGrid');
  if (!box) return;

  box.innerHTML = '<div class="text-muted">Loading schedule...</div>';

  const response = await fetch('/api/predictions/schedule');
  if (!response.ok) {
    box.innerHTML = '<div class="alert alert-danger">Unable to load schedule data.</div>';
    return;
  }

  scheduleMatches = await response.json();
  renderSchedule();
}

function renderSchedule() {
  const box = document.getElementById('scheduleGrid');
  if (!box) return;

  if (!Array.isArray(scheduleMatches) || scheduleMatches.length === 0) {
    box.innerHTML = '<div class="card wc-card shadow-sm"><div class="card-body text-muted">No schedule data found.</div></div>';
    return;
  }

  const sorted = [...scheduleMatches].sort((a, b) => parseKickoffDate(a.kickoffUtc) - parseKickoffDate(b.kickoffUtc));
  const cutoff = Date.now() - ONE_DAY_MS;
  const recentMatches = sorted.filter(m => {
    const kickoff = parseKickoffDate(m.kickoffUtc);
    return Number.isNaN(kickoff.getTime()) || kickoff.getTime() >= cutoff;
  });
  const pastMatches = sorted.filter(m => {
    const kickoff = parseKickoffDate(m.kickoffUtc);
    return !Number.isNaN(kickoff.getTime()) && kickoff.getTime() < cutoff;
  });

  let html = '';
  if (!showPastScheduleMatches && pastMatches.length > 0) {
    html += `<div class="card wc-card shadow-sm schedule-actions-card">
      <div class="card-body d-flex flex-wrap justify-content-between align-items-center gap-2">
        <div class="small text-muted">${pastMatches.length} past game(s) are hidden (older than 1 day).</div>
        <button class="btn btn-outline-primary btn-sm" onclick="togglePastScheduleMatches()">Show more</button>
      </div>
    </div>`;
  }

  if (showPastScheduleMatches && pastMatches.length > 0) {
    html += `<div class="card wc-card shadow-sm schedule-actions-card">
      <div class="card-body d-flex flex-wrap justify-content-between align-items-center gap-2">
        <div class="small text-muted">Showing all games, including ${pastMatches.length} past game(s).</div>
        <button class="btn btn-outline-secondary btn-sm" onclick="togglePastScheduleMatches()">Hide past games</button>
      </div>
    </div>`;
  }

  for (const m of (showPastScheduleMatches ? sorted : recentMatches)) {
    const hasActual = m.actualHomeGoals != null && m.actualAwayGoals != null;
    const actual = (m.actualHomeGoals == null || m.actualAwayGoals == null)
      ? '<span class="badge text-bg-warning">Pending</span>'
      : `<span class="badge text-bg-success">${m.actualHomeGoals} - ${m.actualAwayGoals}</span>`;
    const actualText = hasActual
      ? `${m.actualHomeGoals} vs ${m.actualAwayGoals}`
      : 'Not available yet';

    html += `<article class="card wc-card shadow-sm schedule-card">
      <div class="card-body">
        <div class="d-flex flex-wrap justify-content-between align-items-start gap-2 mb-2">
          <div>
            <div class="small text-muted">Game ${m.id} | Group ${esc(m.groupName)}</div>
            <h2 class="h5 mb-1"><strong>${renderTeamName(m.homeTeam)}</strong> vs <strong>${renderTeamName(m.awayTeam)}</strong></h2>
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

function togglePastScheduleMatches() {
  showPastScheduleMatches = !showPastScheduleMatches;
  renderSchedule();
}

function formatPacificDateTime(value) {
  const date = parseKickoffDate(value);
  if (Number.isNaN(date.getTime())) return 'N/A';
  return date.toLocaleString('en-US', {
    timeZone: PACIFIC_TIME_ZONE,
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

function esc(s) {
  return String(s).replace(/[&<>'"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#039;', '"':'&quot;' }[c]));
}
