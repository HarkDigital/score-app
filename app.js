import {
  LEAGUES, scoreboardUrl, parseScoreboard, groupGames, refreshDelay,
  statusLabel, dayLabel, addDays, weekLabel, adjacentWeek,
} from './espn.js';

const LEAGUE_KEY = 'scores.league';

const view = {
  league: LEAGUES.find((l) => l.id === readStorage(LEAGUE_KEY)) ?? LEAGUES[0],
  dayOffset: 0, // daily leagues: days from today, so "Today" survives midnight
  week: null,   // weekly leagues: null means the current week
  board: null,
  error: null,
  updatedAt: null,
  loading: false,
};

let timer = null;
let requestId = 0;

const els = {
  tabs: document.getElementById('tabs'),
  prev: document.getElementById('prev'),
  next: document.getElementById('next'),
  navLabel: document.getElementById('nav-label'),
  refresh: document.getElementById('refresh'),
  status: document.getElementById('status'),
  games: document.getElementById('games'),
};

async function load() {
  clearTimeout(timer);
  const id = ++requestId;
  const { league } = view;
  const url = scoreboardUrl(league, { date: addDays(new Date(), view.dayOffset), week: view.week });
  view.loading = true;
  renderStatus();
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const board = parseScoreboard(await res.json(), league);
    if (id !== requestId) return; // the view changed while this was in flight
    view.board = board;
    view.error = null;
    view.updatedAt = new Date();
  } catch (err) {
    if (id !== requestId) return;
    view.error = err;
  }
  view.loading = false;
  render();
  schedule();
}

function schedule() {
  clearTimeout(timer);
  if (document.hidden) return;
  const delay = view.error ? 30_000 : refreshDelay(view.board?.games ?? []);
  if (delay) timer = setTimeout(load, delay);
}

function changeView(changes) {
  Object.assign(view, changes, { board: null, error: null, updatedAt: null });
  render();
  load();
}

function render() {
  renderTabs();
  renderNav();
  renderStatus();
  renderGames();
}

function renderTabs() {
  els.tabs.innerHTML = LEAGUES.map((l) => `
    <button class="tab" role="tab" data-league="${l.id}" aria-selected="${l.id === view.league.id}">${esc(l.label)}</button>
  `).join('');
}

function renderNav() {
  if (view.league.weekly) {
    els.navLabel.textContent = view.board
      ? weekLabel(view.board)
      : view.week?.label ?? (view.week ? `Week ${view.week.week}` : 'This week');
    els.prev.disabled = !adjacentWeek(view.board, -1);
    els.next.disabled = !adjacentWeek(view.board, 1);
  } else {
    els.navLabel.textContent = dayLabel(view.dayOffset);
    els.prev.disabled = false;
    els.next.disabled = false;
  }
  const current = view.league.weekly ? view.week === null : view.dayOffset === 0;
  els.navLabel.disabled = current;
  els.navLabel.title = current ? '' : view.league.weekly ? 'Back to this week' : 'Back to today';
}

function renderStatus() {
  els.refresh.classList.toggle('spinning', view.loading);
  const live = view.board?.games.some((g) => g.state === 'in');
  let text = '';
  if (view.error) {
    text = view.updatedAt
      ? `Couldn't reach ESPN. Showing scores from ${formatClock(view.updatedAt)}. Retrying…`
      : `Couldn't reach ESPN. Retrying…`;
  } else if (view.updatedAt) {
    text = `Updated ${formatClock(view.updatedAt)}${live ? ' · refreshing every 15s' : ''}`;
  }
  els.status.textContent = text;
  els.status.classList.toggle('error', Boolean(view.error));
}

function renderGames() {
  if (!view.board) {
    els.games.innerHTML = view.error ? '' : '<p class="empty">Loading…</p>';
    return;
  }
  const groups = groupGames(view.board.games);
  if (!groups.length) {
    els.games.innerHTML = `<p class="empty">No ${esc(view.league.label)} games ${view.league.weekly ? 'this week' : 'on this day'}.</p>`;
    return;
  }
  const now = new Date();
  els.games.innerHTML = groups.map((group) => `
    <section class="group">
      <h2>${group.label}</h2>
      ${group.games.map((game) => gameCard(game, now)).join('')}
    </section>
  `).join('');
}

function gameCard(game, now) {
  const done = game.state === 'post';
  const foot = [game.detail, game.note].filter(Boolean).join(' · ');
  return `
    <article class="game ${game.state}">
      <div class="game-head">
        <span class="game-status">${esc(statusLabel(game, now))}</span>
        <span class="game-tv">${esc(game.broadcast)}</span>
      </div>
      ${game.teams.map((team) => `
        <div class="team${done && game.teams.some((t) => t.winner) && !team.winner ? ' lost' : ''}">
          ${team.logo ? `<img class="logo" src="${esc(team.logo)}" alt="" width="28" height="28" loading="lazy">` : '<span class="logo"></span>'}
          <span class="name">${team.rank ? `<span class="rank">${team.rank}</span>` : ''}${esc(team.name)}</span>
          ${team.possession ? '<span class="poss" title="Possession" aria-label="Possession"></span>' : ''}
          <span class="record">${esc(team.record)}</span>
          <span class="score">${esc(team.score)}</span>
        </div>
      `).join('')}
      ${foot ? `<div class="game-foot">${esc(foot)}</div>` : ''}
    </article>
  `;
}

function formatClock(date) {
  return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' });
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

function readStorage(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function writeStorage(key, value) {
  try { localStorage.setItem(key, value); } catch { /* private mode etc. */ }
}

els.tabs.addEventListener('click', (event) => {
  const tab = event.target.closest('[data-league]');
  if (!tab || tab.dataset.league === view.league.id) return;
  const league = LEAGUES.find((l) => l.id === tab.dataset.league);
  writeStorage(LEAGUE_KEY, league.id);
  changeView({ league, dayOffset: 0, week: null });
  els.tabs.querySelector(`[data-league="${league.id}"]`)?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
});

function step(dir) {
  if (view.league.weekly) {
    const week = adjacentWeek(view.board, dir);
    if (week) changeView({ week });
  } else {
    changeView({ dayOffset: view.dayOffset + dir });
  }
}

els.prev.addEventListener('click', () => step(-1));
els.next.addEventListener('click', () => step(1));
els.navLabel.addEventListener('click', () => changeView({ dayOffset: 0, week: null }));
els.refresh.addEventListener('click', () => load());

// Don't poll in the background; catch up as soon as the app is looked at again.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) clearTimeout(timer);
  else if (!view.updatedAt || Date.now() - view.updatedAt > 10_000) load();
  else schedule();
});

// Hide team logos that fail to load rather than showing a broken image.
document.addEventListener('error', (event) => {
  if (event.target instanceof HTMLImageElement) event.target.classList.add('broken');
}, true);

render();
els.tabs.querySelector('[aria-selected="true"]')?.scrollIntoView({ inline: 'center', block: 'nearest' });
load();
