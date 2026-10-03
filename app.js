import {
  LEAGUES, leagueById, scoreboardUrl, parseScoreboard, groupGames, refreshDelay,
  statusLabel, dayLabel, addDays, weekLabel, weekInfo, adjacentWeek,
} from './espn.js';
import { standingsUrl, parseStandings, rankingsUrl, parseRankings, teamsFromStandings } from './standings.js';
import {
  loadFollowed, saveFollowed, isFollowed, toggleFollowed, followedLeagues, countFollowed, gamesForTeams,
  alertsFor, setAlerts, alertTeams,
} from './myteams.js';
import {
  ICONS, getJson, TROUBLE, oddsHtml, failedLogos, logoHtml, fallbackLogo, emptyState, errorState, fullDate, formatClock, esc,
} from './ui.js';
import {
  initPages, parseRoute, showPage, hidePage, pageOpen, refreshPage, pageVisible, gameHref, teamHref,
} from './pages.js';
import { initPullToRefresh } from './pull.js';
import { initSwipeNav } from './swipe.js';
import { inApp, setAlertTeams } from './native.js';

const MINE = { id: 'mine', label: 'My Teams', mine: true };
const LEAGUE_KEY = 'scores.league';
const storage = (() => { try { return window.localStorage; } catch { return null; } })();

let followed = loadFollowed(storage);

const view = {
  league: initialLeague(),
  mode: 'scores',  // 'scores' | 'standings' | 'rankings'
  dayOffset: 0,    // days from today, so "Today" survives midnight
  week: null,      // weekly leagues: null means the current week
  poll: 0,         // rankings: which poll is showing
  data: null,      // the board, standings or rankings for the current view
  error: null,
  updatedAt: null,
  loading: false,
  animate: true,   // play the entrance animation on the next data render
};

let timer = null;
let requestId = 0;

const els = {
  tabs: document.getElementById('tabs'),
  refresh: document.getElementById('refresh'),
  modes: document.getElementById('modes'),
  nav: document.getElementById('date-nav'),
  status: document.getElementById('status'),
  content: document.getElementById('content'),
  sheet: document.getElementById('sheet-root'),
  back: document.getElementById('back'),
  pageTitle: document.getElementById('page-title'),
};

// ---- Loading ----

async function load() {
  clearTimeout(timer);
  const id = ++requestId;
  view.loading = true;
  renderStatus();
  try {
    const data = await fetchView();
    if (id !== requestId) return; // the view changed while this was in flight
    view.data = data;
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

async function fetchView() {
  const { league, mode } = view;
  const date = addDays(new Date(), view.dayOffset);
  if (league.mine) return fetchMyTeams(date);
  if (mode === 'standings') return parseStandings(await getJson(standingsUrl(league)), league);
  if (mode === 'rankings') return parseRankings(await getJson(rankingsUrl(league)));
  return parseScoreboard(await getJson(scoreboardUrl(league, { date, week: view.week })), league);
}

// One scoreboard per league that has a followed team, filtered to their games.
async function fetchMyTeams(date) {
  const leagues = followedLeagues(followed).map(leagueById);
  const results = await Promise.allSettled(leagues.map(async (league) => {
    const board = parseScoreboard(await getJson(scoreboardUrl(league, { date, byDate: true })), league);
    return gamesForTeams(board.games, followed, league.id).map((game) => ({ ...game, league }));
  }));
  const failed = leagues.filter((_, i) => results[i].status === 'rejected');
  if (leagues.length && failed.length === leagues.length) throw results[0].reason;
  return {
    games: results.flatMap((r) => (r.status === 'fulfilled' ? r.value : [])),
    failed: failed.map((l) => l.label),
  };
}

function schedule() {
  clearTimeout(timer);
  if (document.hidden || pageOpen()) return;
  let delay = null;
  if (view.error) delay = 30_000;
  else if (view.mode === 'scores') delay = refreshDelay(view.data?.games ?? []);
  if (view.data?.failed?.length) delay = Math.min(delay ?? 30_000, 30_000);
  if (delay) timer = setTimeout(load, delay);
}

function changeView(changes) {
  Object.assign(view, changes, { data: null, error: null, updatedAt: null, animate: true });
  render();
  load();
}

// ---- Rendering ----

function render() {
  renderTabs();
  renderModes();
  renderNav();
  renderStatus();
  renderContent();
}

// Chrome is only rebuilt when what it shows changes, so a refresh every 15s
// doesn't steal focus or reset scroll positions.
const rendered = { tabs: '', modes: '', nav: '' };

function renderTabs() {
  if (rendered.tabs === view.league.id) return;
  rendered.tabs = view.league.id;
  els.tabs.innerHTML = [MINE, ...LEAGUES].map((l) => `
    <button class="tab" role="tab" data-league="${l.id}" aria-selected="${l.id === view.league.id}">${l.mine ? ICONS.star : ''}${esc(l.label)}</button>
  `).join('');
}

function renderModes() {
  const { league, mode } = view;
  const key = `${league.id}|${mode}|${followed.map((t) => `${t.league}:${t.id}`).join(',')}`;
  if (rendered.modes === key) return;
  rendered.modes = key;
  if (league.mine) {
    els.modes.innerHTML = followed.length ? `
      <div class="toolbar">
        <span class="eyebrow">Following ${followed.length} team${followed.length === 1 ? '' : 's'}</span>
        <button class="pill-btn" data-action="edit-teams">Edit teams</button>
      </div>
      <nav class="chips" aria-label="Your teams">
        ${followed.map((t) => `<a class="chip" href="${teamHref(t.league, t.id)}">${logoHtml(t, 20)}${esc(t.abbr || t.name)}</a>`).join('')}
      </nav>` : '';
    return;
  }
  const modes = [['scores', 'Scores'], ['standings', 'Standings'], ...(league.rankings ? [['rankings', 'Rankings']] : [])];
  els.modes.innerHTML = `
    <div class="segmented" role="tablist" aria-label="View">
      ${modes.map(([id, label]) => `<button role="tab" data-mode="${id}" aria-selected="${mode === id}">${label}</button>`).join('')}
    </div>`;
}

const HALF = 3;               // days either side of the selected one
const BUFFER = 7;             // off-screen days each side, for the slide
const TRACK = 7 + 2 * BUFFER;
const trackOffset = (shift) => `translateX(${(-shift * 100) / TRACK}%)`;
let stripStart = null;

function renderNav() {
  const { league, mode } = view;
  const weekly = league.weekly && !league.mine;
  const board = weekly ? view.data : null;
  const key = mode !== 'scores' ? 'none'
    : weekly ? `week|${league.id}|${JSON.stringify(view.week)}|${JSON.stringify(board?.week ?? null)}`
    : `day|${view.dayOffset}|${new Date().toDateString()}`;
  if (rendered.nav === key) return;
  rendered.nav = key;
  if (mode !== 'scores') {
    els.nav.innerHTML = '';
    stripStart = null;
  } else if (weekly) {
    els.nav.innerHTML = weekBar(board);
    stripStart = null;
  } else {
    els.nav.innerHTML = dayStrip();
    slideStrip();
  }
}

// Phade's DayStrip: the selected day sits in the middle and the strip slides
// when it changes. Arrows move a week.
function dayStrip() {
  const now = new Date();
  const first = view.dayOffset - HALF - BUFFER;
  const days = Array.from({ length: TRACK }, (_, i) => first + i);
  const current = view.dayOffset === 0;
  return `
    <div class="nav-head">
      <span class="eyebrow">${esc(dayLabel(view.dayOffset, now))}</span>
      ${current ? `<span class="sub">${esc(fullDate(now))}</span>` : '<button class="pill-btn" data-action="today">Today</button>'}
    </div>
    <div class="strip">
      <button class="strip-arrow" data-shift="-7" aria-label="Back a week">${ICONS.left}</button>
      <div class="strip-window">
        <div class="strip-track" style="width:${(TRACK / 7) * 100}%;transform:${trackOffset(BUFFER)}">
          ${days.map((offset, i) => dayButton(offset, i >= BUFFER && i < BUFFER + 7, now)).join('')}
        </div>
      </div>
      <button class="strip-arrow" data-shift="7" aria-label="Forward a week">${ICONS.right}</button>
    </div>`;
}

function dayButton(offset, inView, now) {
  const date = addDays(now, offset);
  const selected = offset === view.dayOffset;
  return `
    <button class="day${selected ? ' selected' : ''}" data-offset="${offset}" style="width:${100 / TRACK}%"
      aria-pressed="${selected}" aria-label="${esc(fullDate(date))}${offset === 0 ? ', today' : ''}"${inView ? '' : ' tabindex="-1" aria-hidden="true"'}>
      ${offset === 0 ? '<span class="today-dot" aria-hidden="true"></span>' : ''}
      <span class="dow">${esc(date.toLocaleDateString(undefined, { weekday: 'short' }))}</span>
      <span class="date">${esc(date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }))}</span>
    </button>`;
}

// Start the new track where the old window was, then ease it to rest.
function slideStrip() {
  const start = view.dayOffset - HALF;
  const prev = stripStart;
  stripStart = start;
  const track = els.nav.querySelector('.strip-track');
  if (!track || prev === null || prev === start) return;
  const moved = Math.max(-BUFFER, Math.min(BUFFER, start - prev));
  track.style.transition = 'none';
  track.style.transform = trackOffset(BUFFER - moved);
  void track.offsetWidth;
  track.style.transition = '';
  track.style.transform = trackOffset(BUFFER);
}

function weekBar(board) {
  const label = board ? weekLabel(board) : view.week?.label ?? (view.week ? `Week ${view.week.week}` : 'This week');
  const info = board ? weekInfo(board) : { detail: view.week?.detail ?? '', season: view.week?.season ?? '' };
  const current = view.week === null;
  return `
    <div class="nav-head">
      <span class="eyebrow">${esc(info.season || (current ? 'This week' : view.league.label))}</span>
      ${current ? '' : '<button class="pill-btn" data-action="today">This week</button>'}
    </div>
    <div class="strip">
      <button class="strip-arrow" data-week="-1" aria-label="Previous week"${adjacentWeek(board, -1) ? '' : ' disabled'}>${ICONS.left}</button>
      <div class="week-center">
        <span class="week-label">${esc(label)}</span>
        ${info.detail ? `<span class="week-detail">${esc(info.detail)}</span>` : ''}
      </div>
      <button class="strip-arrow" data-week="1" aria-label="Next week"${adjacentWeek(board, 1) ? '' : ' disabled'}>${ICONS.right}</button>
    </div>`;
}

function renderStatus() {
  els.refresh.classList.toggle('spinning', view.loading);
  const live = view.mode === 'scores' && view.data?.games?.some((g) => g.state === 'in');
  const failed = view.data?.failed ?? [];
  let html = '';
  if (view.error && view.updatedAt) {
    html = `Couldn't reach ESPN. Showing data from ${esc(formatClock(view.updatedAt))}. Retrying…`;
  } else if (!view.error && view.updatedAt) {
    html = `${live ? '<span class="pulse" aria-hidden="true"></span>' : ''}Updated ${esc(formatClock(view.updatedAt))}`
      + `${live ? ' · live, refreshing every 15s' : ''}`
      + `${failed.length ? ` · couldn't load ${esc(failed.join(', '))}` : ''}`;
  }
  els.status.innerHTML = html;
  els.status.classList.toggle('error', Boolean(view.error) || failed.length > 0);
}

function renderContent() {
  const { data, error, mode } = view;
  const animate = view.animate && Boolean(data);
  if (data) view.animate = false;
  els.content.classList.toggle('stagger-in', animate);
  if (!data) {
    els.content.innerHTML = error ? errorState() : skeleton(mode);
  } else if (mode === 'standings') {
    els.content.innerHTML = standingsHtml(data);
  } else if (mode === 'rankings') {
    els.content.innerHTML = rankingsHtml(data);
  } else {
    els.content.innerHTML = gamesHtml(data.games);
  }
}

// ---- Scores ----

function gamesHtml(games) {
  const { league } = view;
  if (league.mine && !followed.length) {
    return emptyState({
      icon: ICONS.starLarge,
      title: 'Pick your teams',
      text: 'Follow teams from any league and all their games land here, live.',
      action: '<button class="btn-primary" data-action="edit-teams">Choose teams</button>',
    });
  }
  const groups = groupGames(games);
  if (!groups.length) {
    if (league.mine) {
      return emptyState({
        icon: ICONS.calendar,
        title: 'No games for your teams',
        text: `None of the teams you follow play ${dayPhrase(view.dayOffset)}.`,
        action: '<button class="link-btn" data-action="edit-teams">Edit teams</button>',
      });
    }
    return emptyState({
      icon: ICONS.calendar,
      title: `No ${league.label} games`,
      text: league.weekly ? 'Nothing scheduled this week. Try another week.' : `Nothing scheduled ${dayPhrase(view.dayOffset)}. Try another day.`,
    });
  }
  const now = new Date();
  return groups.map((group) => `
    <section class="group">
      <h2 class="group-title ${group.key}">${group.key === 'in' ? '<span class="live-dot" aria-hidden="true"></span>' : ''}${group.label}<span class="count">${group.games.length}</span></h2>
      <div class="grid">${group.games.map((game) => gameCard(game, now)).join('')}</div>
    </section>
  `).join('');
}

function gameCard(game, now) {
  const league = game.league ?? view.league;
  const live = game.state === 'in';
  const done = game.state === 'post';
  const decided = done && game.teams.some((t) => t.winner);
  let status;
  if (TROUBLE.test(game.statusName)) status = `<span class="badge badge-warn">${esc(game.statusText || 'Postponed')}</span>`;
  else if (live) status = `<span class="badge badge-live"><span class="live-dot" aria-hidden="true"></span>Live</span><span class="clock">${esc(game.statusText)}</span>`;
  else if (done) status = `<span class="badge">${esc(game.statusText || 'Final')}</span>`;
  else status = `<span class="clock">${esc(statusLabel(game, now))}</span>`;
  // No line on a game that won't be played as scheduled.
  const odds = TROUBLE.test(game.statusName) ? null : game.odds;
  const rows = game.teams.map((team) => teamRow(team, league, done, decided, odds?.moneyline[team.id]));
  const foot = [game.detail, game.note].filter(Boolean).join(' · ');
  return `
    <a class="card game${live ? ' live' : ''}" href="${gameHref(league.id, game.id)}">
      <div class="game-head">
        ${game.league ? `<span class="league-chip">${esc(league.label)}</span>` : ''}
        ${status}
        <span class="tv">${esc(game.broadcast)}</span>
      </div>
      <div class="teams">
        ${rows.length === 2 ? `${rows[0]}<div class="divider">${league.homeFirst ? 'vs' : '@'}</div>${rows[1]}` : rows.join('')}
      </div>
      ${odds ? oddsHtml(odds, league) : ''}
      ${foot ? `<div class="game-foot">${esc(foot)}</div>` : ''}
    </a>`;
}

function teamRow(team, league, done, decided, moneyline) {
  const mine = isFollowed(followed, league.id, team.id);
  return `
    <div class="team${decided && !team.winner ? ' lost' : ''}">
      ${logoHtml(team)}
      <span class="name">${team.rank ? `<span class="rank">${team.rank}</span>` : ''}${esc(team.name)}${mine ? `<span class="star" title="Following">${ICONS.starSmall}</span>` : ''}</span>
      ${team.possession ? '<span class="poss" title="Possession" aria-label="Possession"></span>' : ''}
      <span class="record">${esc(team.record)}</span>
      <span class="score">${moneyline ? `<span class="ml" title="Moneyline">${esc(moneyline)}</span>` : esc(team.score)}</span>
      <span class="win-mark">${done && team.winner ? ICONS.winner : ''}</span>
    </div>`;
}

// ---- Standings ----

function standingsHtml(data) {
  if (!data.groups.length) {
    return emptyState({ icon: ICONS.trophy, title: 'No standings yet', text: `ESPN hasn't published ${view.league.label} standings for this season yet.` });
  }
  return data.groups.map((group) => `
    <section class="group">
      <h2 class="group-title">${esc(group.name)}</h2>
      <div class="card">
        <div class="table-wrap">
          <table class="standings">
            <thead><tr>
              <th class="col-team" scope="col">Team</th>
              ${group.columns.map((c) => `<th scope="col"${c.title ? ` title="${esc(c.title)}"` : ''}>${esc(c.label)}</th>`).join('')}
            </tr></thead>
            <tbody>${group.rows.map((row, i) => standingsRow(row, i, group.columns)).join('')}</tbody>
          </table>
        </div>
      </div>
      ${legendHtml(group.rows)}
    </section>
  `).join('');
}

function standingsRow(row, i, columns) {
  const mine = isFollowed(followed, view.league.id, row.team.id);
  const note = row.note?.color ? ` style="--note:${row.note.color}"` : '';
  return `
    <tr${mine ? ' class="followed"' : ''}>
      <th scope="row" class="col-team">
        <a class="team-cell" href="${teamHref(view.league.id, row.team.id)}">
          <span class="pos"${note}>${i + 1}</span>
          ${logoHtml(row.team, 22)}
          <span class="team-name">${esc(row.team.shortName || row.team.name)}</span>
          ${row.clincher ? `<span class="clinch" title="Clinched or eliminated">${esc(row.clincher)}</span>` : ''}
        </a>
      </th>
      ${columns.map((c) => `<td${c.key ? ' class="key"' : ''}>${esc(row.stats[c.id] ?? '–')}</td>`).join('')}
    </tr>`;
}

function legendHtml(rows) {
  const notes = new Map();
  for (const { note } of rows) if (note?.color && note.description) notes.set(note.description, note.color);
  if (!notes.size) return '';
  return `<div class="legend">${[...notes].map(([text, color]) => `<span><i style="--note:${color}"></i>${esc(text)}</span>`).join('')}</div>`;
}

// ---- Rankings ----

function rankingsHtml(data) {
  if (!data.polls.length) {
    return emptyState({ icon: ICONS.trophy, title: 'No polls yet', text: "Rankings show up once the season's first poll is out." });
  }
  const poll = data.polls[Math.min(view.poll, data.polls.length - 1)];
  return `
    <div class="toolbar">
      <div class="pills" role="group" aria-label="Poll">
        ${data.polls.map((p) => `<button data-poll="${data.polls.indexOf(p)}" aria-pressed="${p === poll}">${esc(p.shortName)}</button>`).join('')}
      </div>
      ${poll.headline ? `<span class="sub">${esc(poll.headline)}</span>` : ''}
    </div>
    <div class="card">${poll.ranks.map(rankRow).join('')}</div>
    ${poll.others.length ? `<p class="others">Also receiving votes: ${esc(poll.others.map((o) => `${o.team.shortName || o.team.name} ${o.points}`).join(', '))}</p>` : ''}`;
}

function rankRow(r) {
  const mine = isFollowed(followed, view.league.id, r.team.id);
  let trend = '<span class="trend">–</span>';
  if (r.movement === null) trend = '<span class="trend up">New</span>';
  else if (r.movement > 0) trend = `<span class="trend up">▲${r.movement}</span>`;
  else if (r.movement < 0) trend = `<span class="trend down">▼${-r.movement}</span>`;
  return `
    <a class="poll-row${mine ? ' followed' : ''}" href="${teamHref(view.league.id, r.team.id)}">
      <span class="poll-rank">${r.rank}</span>
      ${trend}
      ${logoHtml(r.team)}
      <span class="poll-team"><span class="name">${esc(r.team.name)}</span><span class="record">${esc(r.record)}</span></span>
      <span class="poll-points">${r.points ? esc(r.points) : ''}${r.firstPlaceVotes ? `<small>(${esc(r.firstPlaceVotes)})</small>` : ''}</span>
    </a>`;
}

// ---- Shared pieces ----

function skeleton(mode) {
  const bar = (w, h, extra = '') => `<span class="skeleton" style="width:${w};height:${h}px${extra}"></span>`;
  if (mode === 'scores') {
    const row = `<div class="skeleton-row">${bar('28px', 28, ';border-radius:50%')}${bar('45%', 14)}${bar('26px', 20)}</div>`;
    return `<div class="grid" style="margin-top:22px">${`<div class="card skeleton-card">${bar('35%', 10)}${row}${row}</div>`.repeat(4)}</div>`;
  }
  const row = `<div class="skeleton-row">${bar('18px', 14)}${bar('22px', 22, ';border-radius:50%')}${bar('40%', 14)}${bar('22%', 14)}</div>`;
  return `<div class="card skeleton-card" style="margin-top:22px">${row.repeat(8)}</div>`;
}

function dayPhrase(offset) {
  if (offset === 0) return 'today';
  if (offset === -1) return 'yesterday';
  if (offset === 1) return 'tomorrow';
  return `on ${dayLabel(offset)}`;
}

function readStorage(key) {
  try { return storage?.getItem(key) ?? null; } catch { return null; }
}

function writeStorage(key, value) {
  try { storage?.setItem(key, value); } catch { /* private mode etc. */ }
}

function initialLeague() {
  const saved = readStorage(LEAGUE_KEY);
  if (saved === MINE.id) return MINE;
  return leagueById(saved) ?? (followed.length ? MINE : LEAGUES[0]);
}

// ---- Team picker ----

const picker = { open: false, league: null, teams: new Map(), failed: new Set(), query: '', changed: false, opener: null };

function openPicker() {
  if (picker.open) return;
  Object.assign(picker, { open: true, changed: false, query: '', opener: document.activeElement });
  picker.league = view.league.mine ? leagueById(followed[0]?.league) ?? picker.league ?? LEAGUES[0] : view.league;
  els.sheet.innerHTML = `
    <div class="sheet-backdrop" data-action="close-picker"></div>
    <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
      <div class="sheet-grabber" aria-hidden="true"></div>
      <div class="sheet-head">
        <h2 id="sheet-title">Your teams</h2>
        <button class="pill-btn" data-action="close-picker">Done</button>
      </div>
      <nav class="tabs" id="picker-tabs" role="tablist" aria-label="League"></nav>
      <input class="search" id="picker-search" type="search" autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="search">
      <ul class="team-list" id="picker-list"></ul>
    </div>`;
  document.body.style.overflow = 'hidden';
  els.sheet.querySelector('#picker-search').addEventListener('input', (event) => {
    picker.query = event.target.value;
    renderPickerList();
  });
  renderPickerTabs();
  renderPickerList();
  els.sheet.querySelector('[data-action="close-picker"].pill-btn').focus();
  loadTeams(picker.league);
}

function closePicker() {
  if (!picker.open) return;
  picker.open = false;
  els.sheet.innerHTML = '';
  document.body.style.overflow = '';
  picker.opener?.focus?.();
  if (!picker.changed) return;
  if (view.league.mine) changeView({});
  else renderContent();
}

function renderPickerTabs() {
  const tabs = els.sheet.querySelector('#picker-tabs');
  tabs.innerHTML = LEAGUES.map((l) => {
    const n = countFollowed(followed, l.id);
    return `<button class="tab" role="tab" data-picker-league="${l.id}" aria-selected="${l.id === picker.league.id}">${esc(l.label)}${n ? `<span class="count">${n}</span>` : ''}</button>`;
  }).join('');
  const selected = tabs.querySelector('[aria-selected="true"]');
  if (selected) tabs.scrollLeft = selected.offsetLeft - (tabs.clientWidth - selected.offsetWidth) / 2;
}

const fold = (text) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function renderPickerList() {
  const list = els.sheet.querySelector('#picker-list');
  els.sheet.querySelector('#picker-search').placeholder = `Search ${picker.league.label} teams`;
  const teams = picker.teams.get(picker.league.id);
  if (!teams) {
    list.innerHTML = picker.failed.has(picker.league.id)
      ? `<li class="list-note">Couldn't load ${esc(picker.league.label)} teams.<br><br><button class="pill-btn" data-action="retry-teams">Try again</button></li>`
      : '<li class="list-note">Loading teams…</li>';
    return;
  }
  const query = fold(picker.query.trim());
  const shown = query ? teams.filter((t) => fold(`${t.name} ${t.shortName} ${t.abbr}`).includes(query)) : teams;
  if (!shown.length) {
    list.innerHTML = `<li class="list-note">No ${esc(picker.league.label)} teams match “${esc(picker.query.trim())}”.</li>`;
    return;
  }
  list.innerHTML = shown.map((t) => {
    const on = isFollowed(followed, picker.league.id, t.id);
    return `
      <li><button class="team-option" data-team="${esc(t.id)}" aria-pressed="${on}">
        ${logoHtml(t)}
        <span class="name">${esc(t.name)}</span>
        <span class="follow-mark" aria-hidden="true">${on ? ICONS.check : ICONS.plus}</span>
      </button></li>`;
  }).join('');
}

async function loadTeams(league) {
  if (picker.teams.has(league.id)) return;
  picker.failed.delete(league.id);
  try {
    // ESPN's teams list blocks browsers (no CORS header); standings list every team.
    picker.teams.set(league.id, teamsFromStandings(parseStandings(await getJson(standingsUrl(league)), league)));
  } catch {
    picker.failed.add(league.id);
  }
  if (picker.open && picker.league.id === league.id) renderPickerList();
}

function toggleTeam(button) {
  const team = picker.teams.get(picker.league.id)?.find((t) => t.id === button.dataset.team);
  if (!team) return;
  followed = toggleFollowed(followed, picker.league.id, team);
  saveFollowed(storage, followed);
  syncAlerts();
  picker.changed = true;
  const on = isFollowed(followed, picker.league.id, team.id);
  button.setAttribute('aria-pressed', String(on));
  button.querySelector('.follow-mark').innerHTML = on ? ICONS.check : ICONS.plus;
  renderPickerTabs();
}

// ---- Events ----

function selectLeague(id) {
  const league = id === MINE.id ? MINE : leagueById(id);
  if (!league || league.id === view.league.id) return;
  writeStorage(LEAGUE_KEY, league.id);
  // Stay on Standings when switching leagues; Rankings only where polls exist.
  const mode = league.mine || (view.mode === 'rankings' && !league.rankings) ? 'scores' : view.mode;
  changeView({ league, mode, dayOffset: 0, week: null, poll: 0 });
  els.tabs.querySelector(`[data-league="${league.id}"]`)?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
}

document.addEventListener('click', (event) => {
  const target = event.target.closest('button, [data-action]');
  if (!target || target.disabled) return;
  const { dataset: d } = target;
  if (d.league) selectLeague(d.league);
  else if (d.mode && d.mode !== view.mode) changeView({ mode: d.mode });
  else if (d.offset !== undefined && Number(d.offset) !== view.dayOffset) changeView({ dayOffset: Number(d.offset) });
  else if (d.shift) changeView({ dayOffset: view.dayOffset + Number(d.shift) });
  else if (d.week) {
    const week = adjacentWeek(view.data, Number(d.week));
    if (week) changeView({ week });
  } else if (d.poll !== undefined) {
    view.poll = Number(d.poll);
    renderContent();
  } else if (d.pickerLeague) {
    picker.league = leagueById(d.pickerLeague);
    renderPickerTabs();
    renderPickerList();
    loadTeams(picker.league);
  } else if (d.team) toggleTeam(target);
  else if (d.action === 'today') changeView({ dayOffset: 0, week: null });
  else if (d.action === 'edit-teams') openPicker();
  else if (d.action === 'close-picker') closePicker();
  else if (d.action === 'retry') load();
  else if (d.action === 'retry-teams') loadTeams(picker.league);
});

const refreshNow = () => (pageOpen() ? refreshPage() : load());
els.refresh.addEventListener('click', refreshNow);
initPullToRefresh({ refresh: refreshNow, enabled: () => !picker.open });
initSwipeNav({
  enabled: () => inApp() && !picker.open,
  content: () => document.getElementById(pageOpen() ? 'page' : 'main'),
  canBack: () => pageOpen(),
  canForward: () => furthest > depth,
  back: () => goBack(),
  forward: () => history.forward(),
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closePicker();
});

// Don't poll in the background; catch up as soon as the app is looked at again.
document.addEventListener('visibilitychange', () => {
  if (pageOpen()) pageVisible(!document.hidden);
  else if (document.hidden) clearTimeout(timer);
  else if (!view.updatedAt || Date.now() - view.updatedAt > 10_000) load();
  else schedule();
});

// A logo that fails to load becomes the team-color badge, and stays one.
document.addEventListener('error', (event) => {
  const img = event.target;
  if (!(img instanceof HTMLImageElement) || !img.classList.contains('logo')) return;
  failedLogos.add(img.getAttribute('src'));
  img.outerHTML = fallbackLogo(img.dataset.abbr, img.dataset.color);
}, true);

// ---- Game and team pages ----

// Links push history entries numbered from where the app was opened, so the
// header's back button goes back within the app, and a page opened straight
// from a shared link goes back to the scoreboard instead of leaving. Each
// entry keeps its scroll when a link leaves it, for coming back (the iPhone
// app's edge swipes walk these same entries).
let mainScroll = 0;
let followsChanged = false;

function applyRoute() {
  const route = parseRoute(location.hash);
  const wasOpen = pageOpen();
  if (route) {
    if (!wasOpen) {
      mainScroll = window.scrollY;
      clearTimeout(timer);
    }
    document.body.classList.add('page-mode');
    els.back.hidden = false;
    // A page we've seen renders at once, so going back lands where it was.
    const ready = showPage(route);
    window.scrollTo(0, ready ? history.state?.scroll ?? 0 : 0);
    return;
  }
  if (!wasOpen) return;
  hidePage();
  document.body.classList.remove('page-mode');
  els.back.hidden = true;
  els.pageTitle.textContent = '';
  if (followsChanged) {
    followsChanged = false;
    if (view.league.mine) changeView({});
    else render();
  }
  window.scrollTo(0, mainScroll);
  if (!view.updatedAt || Date.now() - view.updatedAt > 10_000) load();
  else schedule();
}

// Where in the app's own history we are, and how far forward it goes, so a
// forward swipe only moves when there's somewhere to go.
let depth = history.state?.depth ?? 0;
let furthest = depth;
let traversing = false;

function navigate(href) {
  history.replaceState({ ...history.state, scroll: window.scrollY }, '');
  history.pushState({ depth: (history.state?.depth ?? 0) + 1 }, '', href);
  depth = history.state.depth;
  furthest = depth;
  applyRoute();
}

function goBack() {
  if (history.state?.depth > 0) history.back();
  else {
    depth = 0;
    furthest = 0;
    history.replaceState(null, '', location.pathname + location.search);
    applyRoute();
  }
}

document.addEventListener('click', (event) => {
  const link = event.target.closest('a[href^="#/"]');
  if (!link || event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
  event.preventDefault();
  if (link.getAttribute('href') !== location.hash) navigate(link.getAttribute('href'));
});
window.addEventListener('popstate', () => {
  depth = history.state?.depth ?? 0;
  traversing = true;
  applyRoute();
});
window.addEventListener('hashchange', () => {
  // A hash set directly (an alert or card opening a game) starts a new
  // branch of history; a back or forward lands here after its popstate.
  if (!traversing) {
    depth = history.state?.depth ?? 0;
    furthest = depth;
  }
  traversing = false;
  applyRoute();
});
els.back.addEventListener('click', goBack);

initPages({
  isFollowed: (leagueId, teamId) => isFollowed(followed, leagueId, teamId),
  toggleFollow(leagueId, team) {
    followed = toggleFollowed(followed, leagueId, team);
    saveFollowed(storage, followed);
    syncAlerts();
    followsChanged = true;
  },
  alertsFor: (leagueId, teamId) => alertsFor(followed, leagueId, teamId),
  setAlerts(leagueId, teamId, kinds) {
    followed = setAlerts(followed, leagueId, teamId, kinds);
    saveFollowed(storage, followed);
    syncAlerts();
  },
  setTitle: (text) => { els.pageTitle.textContent = text; },
  setLoading: (on) => els.refresh.classList.toggle('spinning', on),
});

// iPhone app: hand the teams that want alerts to the app, which registers
// them with the push server. Also at every launch, since the device's push
// token can change.
function syncAlerts() {
  if (inApp()) setAlertTeams(alertTeams(followed));
}

syncAlerts();
render();
els.tabs.querySelector('[aria-selected="true"]')?.scrollIntoView({ inline: 'center', block: 'nearest' });
load();
applyRoute();
