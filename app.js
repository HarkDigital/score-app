import {
  LEAGUES, leagueById, leagueFilter, scoreboardUrl, dayUrls, mergeGames, parseScoreboard, groupGames, refreshDelay,
  statusLabel, dayLabel, addDays, weekLabel, weekInfo, adjacentWeek,
  weekDays, weekPhrase, weekRange, groupWeek, boardStale, fieldView,
} from './espn.js';
import {
  standingsUrl, filterStandingsGroup, teamListUrls, parseStandings, rankingsUrl, parseRankings, teamsFromStandings,
  searchTeams, fold, standingsViews, standingsView, clinchLegend,
} from './standings.js';
import {
  loadFollowed, saveFollowed, isFollowed, toggleFollowed, followedLeagues, countFollowed, gamesForTeams,
  alertsFor, setAlerts, alertTeams, widgetTeams, loadAlertDelay, saveAlertDelay, clampDelay,
  moveTeam, sortByTeams, orderLeagues, loadLeagueOrder, saveLeagueOrder,
  sportOf, gameCardsFor, setGameCards, loadGameCards, saveGameCards, loadScoreView, saveScoreView, cleanScoreView,
} from './myteams.js';
import {
  ICONS, getJson, TROUBLE, oddsHtml, failedLogos, failedImages, logoHtml, fallbackLogo, headshotHtml, emptyState, errorState, fullDate,
  formatClock, esc, patchHtml, newsHtml,
} from './ui.js';
import { newsUrl, parseNews, mergeNews } from './news.js';
import { playerSearchUrl, parseSearchPlayers } from './players.js';
import {
  initPages, parseRoute, showPage, hidePage, pageOpen, refreshPage, redrawPage, pageVisible, gameHref, teamHref, playerHref,
} from './pages.js';
import { initAutoUpdate } from './update.js';
import { initPullToRefresh } from './pull.js';
import { initSwipeNav } from './swipe.js';
import { inApp, setAlertTeams, setFollowedTeams, haptic } from './native.js';
import {
  accountsOn, initAccount, loadClerk, accountState, showSignIn, hideSignIn, accountChanged, signOut, deleteAccount, sync,
} from './signin.js';

const MINE = { id: 'mine', label: 'My Teams', mine: true };
const LEAGUE_KEY = 'scores.league';
const FILTER_KEY = 'scores.filters';
const SPAN_KEY = 'scores.span';
const storage = (() => { try { return window.localStorage; } catch { return null; } })();

let followed = loadFollowed(storage);
// Seconds the push server holds game alerts (a streaming delay; 0 is off).
let alertDelay = loadAlertDelay(storage);
// The league tabs' order (empty: the app's own). leagues() is LEAGUES in it.
let leagueOrder = loadLeagueOrder(storage);
const leagues = () => orderLeagues(leagueOrder);
// The game page's cards per sport: {football: {order, hidden}} (empty: the
// app's layout).
let gameCards = loadGameCards(storage);
// The score lists' cards: 'detailed' or 'compact' ('' is the app's own,
// detailed). One setting for every league and My Teams.
let scoreView = loadScoreView(storage);
const compact = () => scoreView === 'compact';
const startLeague = initialLeague();

const view = {
  league: startLeague,
  filter: savedFilter(startLeague),  // college football's conference or division, else null
  mode: 'scores',  // 'scores' | 'standings' | 'rankings' | 'news'
  dayOffset: 0,    // days from today, so "Today" survives midnight
  span: readStorage(SPAN_KEY) === 'week' ? 'week' : 'day', // daily leagues and My Teams: one day or its whole week
  week: null,      // weekly leagues: null means the current week
  poll: 0,         // rankings: which poll is showing
  standings: 'division', // NFL standings: 'division' | 'conference' | 'playoffs'
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
  lineSteam: document.getElementById('linesteam'),
  menu: document.getElementById('menu'),
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
  if (league.mine) return mode === 'news' ? fetchMyNews() : fetchMyTeams(date);
  if (mode === 'scores' && byWeek()) {
    return { games: mergeGames(await Promise.all(weekDays(date).map((day) => fetchBoard(scoreboardUrl(league, { date: day, groups: view.filter?.groups }), day, league)))) };
  }
  if (mode === 'standings') return parseStandings(await getJson(standingsUrl(league, filterStandingsGroup(view.filter))), league);
  if (mode === 'rankings') return parseRankings(await getJson(rankingsUrl(league)));
  if (mode === 'news') return parseNews(await getJson(newsUrl(league)));
  return parseScoreboard(await getJson(scoreboardUrl(league, { date, week: view.week, groups: view.filter?.groups })), league);
}

// One scoreboard per league that has a followed team, filtered to their games.
async function fetchMyTeams(date) {
  const leagues = followedLeagues(followed).map(leagueById);
  const results = await Promise.allSettled(leagues.map(async (league) => {
    const days = byWeek() ? weekDays(date) : [date];
    const boards = await Promise.all(days.flatMap((day) => dayUrls(league, day).map((url) => fetchBoard(url, day, league))));
    return gamesForTeams(mergeGames(boards), followed, league.id).map((game) => ({ ...game, league }));
  }));
  const failed = leagues.filter((_, i) => results[i].status === 'rejected');
  if (leagues.length && failed.length === leagues.length) throw results[0].reason;
  return {
    games: results.flatMap((r) => (r.status === 'fulfilled' ? r.value : [])),
    failed: failed.map((l) => l.label),
  };
}

// One day's board. A week view keeps the boards that can't change any more
// (boardStale), so a live game's 5s refresh re-reads a day or two, not seven.
const boardCache = new Map(); // url -> { board, at }
async function fetchBoard(url, day, league) {
  const cached = boardCache.get(url);
  if (byWeek() && cached && !boardStale(cached.board, day, cached.at)) return cached.board;
  const board = parseScoreboard(await getJson(url), league);
  boardCache.set(url, { board, at: Date.now() });
  if (boardCache.size > 200) boardCache.delete(boardCache.keys().next().value);
  return board;
}

// Daily leagues and My Teams can show a whole week; football is always by week.
function byWeek(league = view.league) {
  return view.span === 'week' && !(league.weekly && !league.mine);
}

// My Teams' news: each followed team's own news (news.js), merged. Fewer
// articles per team when there are several, to keep the download small.
async function fetchMyNews() {
  const teams = followed.filter((t) => leagueById(t.league));
  const limit = teams.length <= 3 ? 50 : 25;
  const results = await Promise.allSettled(teams.map(async (team) => ({
    team,
    articles: parseNews(await getJson(newsUrl(leagueById(team.league), team.id, limit)), { teamId: team.id }).articles,
  })));
  const failed = teams.filter((_, i) => results[i].status === 'rejected');
  if (teams.length && failed.length === teams.length) throw results[0].reason;
  return {
    articles: mergeNews(results.filter((r) => r.status === 'fulfilled').map((r) => r.value)),
    failed: failed.map((t) => t.abbr || t.name),
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

// Chrome is only rebuilt when what it shows changes, so a refresh every 5s
// doesn't steal focus or reset scroll positions.
const rendered = { tabs: '', modes: '', nav: '' };

function renderTabs() {
  const key = `${view.league.id}|${leagueOrder.join(',')}`;
  if (rendered.tabs === key) return;
  rendered.tabs = key;
  els.tabs.innerHTML = [MINE, ...leagues()].map((l) => `
    <button class="tab" role="tab" data-league="${l.id}" aria-selected="${l.id === view.league.id}">${l.mine ? ICONS.star : ''}${esc(l.label)}</button>
  `).join('');
}

function renderModes() {
  const { league, mode } = view;
  const key = `${league.id}|${mode}|${view.filter?.id}|${followed.map((t) => `${t.league}:${t.id}`).join(',')}`;
  if (rendered.modes === key) return;
  rendered.modes = key;
  if (league.mine) {
    els.modes.innerHTML = `
      <div class="segmented" role="tablist" aria-label="View">
        ${[['scores', 'Scores'], ['news', 'News']].map(([id, label]) => `<button role="tab" data-mode="${id}" aria-selected="${mode === id}">${label}</button>`).join('')}
      </div>` + (followed.length ? `
      <div class="toolbar">
        <span class="eyebrow">Following ${followed.length} team${followed.length === 1 ? '' : 's'}</span>
        <span class="toolbar-actions">
          ${followed.length > 1 ? '<button class="pill-btn" data-action="order-teams">Reorder</button>' : ''}
          <button class="pill-btn" data-action="edit-teams">Edit teams</button>
        </span>
      </div>
      <nav class="chips" aria-label="Your teams">
        ${followed.map((t) => `<a class="chip" href="${teamHref(t.league, t.id)}">${logoHtml(t, 20)}${esc(t.abbr || t.name)}</a>`).join('')}
      </nav>` : '');
    return;
  }
  const modes = [['scores', 'Scores'], ['standings', 'Standings'], ...(league.rankings ? [['rankings', 'Rankings']] : []), ['news', 'News']];
  els.modes.innerHTML = `
    <div class="segmented" role="tablist" aria-label="View">
      ${modes.map(([id, label]) => `<button role="tab" data-mode="${id}" aria-selected="${mode === id}">${label}</button>`).join('')}
    </div>
    ${view.filter && (mode === 'scores' || mode === 'standings') ? filterHtml(league, view.filter) : ''}`;
}

// College football's conference picker: a native select, so the phone shows
// its own wheel. Sections are FBS and FCS.
function filterHtml(league, current) {
  const option = (o) => `<option value="${esc(o.id)}"${o.id === current.id ? ' selected' : ''}>${esc(o.label)}</option>`;
  return `
    <label class="filter">
      <span class="filter-label">Showing</span>
      <select data-filter aria-label="Conference">
        ${league.filters.map((s) => (s.label
          ? `<optgroup label="${esc(s.label)}">${s.options.map(option).join('')}</optgroup>`
          : s.options.map(option).join(''))).join('')}
      </select>
      <span class="filter-chevron" aria-hidden="true">${ICONS.down}</span>
    </label>`;
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
    : `${compact()}|` + (weekly ? `week|${league.id}|${JSON.stringify(view.week)}|${JSON.stringify(board?.week ?? null)}`
    : `${view.span}|${view.dayOffset}|${new Date().toDateString()}`);
  if (rendered.nav === key) return;
  rendered.nav = key;
  if (mode !== 'scores') {
    els.nav.innerHTML = '';
    stripStart = null;
  } else if (weekly) {
    els.nav.innerHTML = weekBar(board);
    stripStart = null;
  } else if (view.span === 'week') {
    els.nav.innerHTML = calendarWeekBar();
    stripStart = null;
  } else {
    els.nav.innerHTML = dayStrip();
    slideStrip();
  }
}

// Day or Week, for the leagues browsed by day and My Teams.
function spanToggle() {
  return `
    <div class="pills" role="group" aria-label="Show">
      ${[['day', 'Day'], ['week', 'Week']].map(([id, label]) => `<button data-span="${id}" aria-pressed="${view.span === id}">${label}</button>`).join('')}
    </div>`;
}

// Detailed or Compact cards, on every score list.
const VIEW_ICONS = {
  detailed: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><rect x="4" y="4" width="16" height="7" rx="1.5"/><rect x="4" y="13" width="16" height="7" rx="1.5"/></g></svg>',
  compact: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/></g></svg>',
};

function viewToggle() {
  const shown = compact() ? 'compact' : 'detailed';
  return `
    <div class="pills view-pills" role="group" aria-label="Cards">
      ${[['detailed', 'Detailed'], ['compact', 'Compact']].map(([id, label]) => `<button data-score-view="${id}" aria-pressed="${shown === id}" aria-label="${label}" title="${label}">${VIEW_ICONS[id]}</button>`).join('')}
    </div>`;
}

// The week holding the selected day, Monday to Sunday. Arrows move a week.
function calendarWeekBar() {
  const now = new Date();
  const date = addDays(now, view.dayOffset);
  const phrase = weekPhrase(date, now);
  return `
    <div class="nav-head">
      <span class="eyebrow">${esc(phrase)}</span>
      <span class="nav-actions">
        ${phrase === 'This week' ? '' : '<button class="pill-btn" data-action="today">This week</button>'}
        ${spanToggle()}
        ${viewToggle()}
      </span>
    </div>
    <div class="strip">
      <button class="strip-arrow" data-shift="-7" aria-label="Previous week">${ICONS.left}</button>
      <div class="week-center">
        <span class="week-label">${esc(weekRange(date))}</span>
        <span class="week-detail">Mon to Sun</span>
      </div>
      <button class="strip-arrow" data-shift="7" aria-label="Next week">${ICONS.right}</button>
    </div>`;
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
      <span class="nav-actions">
        ${current ? `<span class="sub">${esc(fullDate(now))}</span>` : '<button class="pill-btn" data-action="today">Today</button>'}
        ${spanToggle()}
        ${viewToggle()}
      </span>
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
      <span class="nav-actions">
        ${current ? '' : '<button class="pill-btn" data-action="today">This week</button>'}
        ${viewToggle()}
      </span>
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
  // Patched, not replaced, so a refresh doesn't make the logos flash.
  if (!data) {
    patchHtml(els.content, error ? errorState() : skeleton(mode));
  } else if (mode === 'standings') {
    patchHtml(els.content, standingsHtml(data));
  } else if (mode === 'rankings') {
    patchHtml(els.content, rankingsHtml(data));
  } else if (mode === 'news') {
    const { league } = view;
    if (league.mine && !followed.length) patchHtml(els.content, pickTeamsHtml());
    else patchHtml(els.content, newsHtml(data.articles, { empty: league.mine ? 'ESPN has no recent news about your teams.' : `ESPN has no ${league.label} news right now.` }));
  } else {
    patchHtml(els.content, gamesHtml(data.games));
  }
}

// ---- Scores ----

function pickTeamsHtml() {
  return emptyState({
    icon: ICONS.starLarge,
    title: 'Pick your teams',
    text: 'Follow teams from any league and their games, live, and their news land here.',
    action: '<button class="btn-primary" data-action="edit-teams">Choose teams</button>',
  });
}

function gamesHtml(games) {
  const { league } = view;
  if (league.mine && !followed.length) return pickTeamsHtml();
  const week = byWeek();
  const now = new Date();
  const grouped = week ? groupWeek(games, addDays(now, view.dayOffset), now) : groupGames(games);
  // My Teams: each group's games in the order of your teams.
  const groups = league.mine ? sortByTeams(grouped, followed) : grouped;
  if (!groups.length) {
    if (league.mine) {
      return emptyState({
        icon: ICONS.calendar,
        title: 'No games for your teams',
        text: `None of the teams you follow play ${week ? weekWords(addDays(now, view.dayOffset), now) : dayPhrase(view.dayOffset)}.`,
        action: '<button class="link-btn" data-action="edit-teams">Edit teams</button>',
      });
    }
    return emptyState({
      icon: ICONS.calendar,
      // "No SEC games", "No FCS games", "No Top 25 games".
      title: `No ${view.filter ? view.filter.label.replace(/^All /, '') : league.label} games`,
      text: league.weekly ? 'Nothing scheduled this week. Try another week.'
        : week ? `Nothing scheduled ${weekWords(addDays(now, view.dayOffset), now)}. Try another week.`
        : `Nothing scheduled ${dayPhrase(view.dayOffset)}. Try another day.`,
    });
  }
  return groups.map((group) => `
    <section class="group">
      <h2 class="group-title ${group.key}">${group.key === 'in' ? '<span class="live-dot" aria-hidden="true"></span>' : ''}${esc(group.label)}<span class="count">${group.games.length}</span></h2>
      <div class="grid${compact() ? ' compact' : ''}">${group.games.map((game) => (compact() ? compactCard : gameCard)(game, group.key === 'day' ? game.start : now)).join('')}</div>
    </section>
  `).join('');
}

// `now` decides how a start time reads; under a day's heading the game's own
// start is passed, so it reads as just the time.
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
  // The down and distance, or the outs and runners, are in the live block.
  const foot = [game.note, game.series?.summary].filter(Boolean).join(' · ');
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
      ${live ? liveHtml(game, league) : ''}
      ${momentsHtml(game)}
      ${odds ? oddsHtml(odds, league) : ''}
      ${foot ? `<div class="game-foot">${esc(foot)}</div>` : ''}
    </a>`;
}

// Compact: the teams, the score and the time, inning or period.
function compactCard(game, now) {
  const league = game.league ?? view.league;
  const live = game.state === 'in';
  const done = game.state === 'post';
  const decided = done && game.teams.some((t) => t.winner);
  let status;
  if (TROUBLE.test(game.statusName)) status = `<span class="warn">${esc(game.statusText || 'Postponed')}</span>`;
  else if (live) status = `<span class="live-dot" aria-hidden="true"></span>${esc(game.statusText)}`;
  else if (done) status = esc(game.statusText || 'Final');
  else status = esc(statusLabel(game, now));
  const row = (team) => `
    <div class="compact-team${decided && !team.winner ? ' lost' : ''}">
      ${logoHtml(team, 20)}
      <span class="name">${team.rank ? `<span class="rank">${team.rank}</span>` : ''}${esc(team.name)}</span>
      <span class="score">${esc(team.score)}</span>
    </div>`;
  return `
    <a class="card game compact${live ? ' live' : ''}" href="${gameHref(league.id, game.id)}">
      <div class="compact-status${live ? ' on' : ''}">${status}</div>
      ${game.teams.map(row).join('')}
    </a>`;
}

// A live game's situation on a detailed card: baseball's runners, count,
// outs, batter and pitcher; football's field with the ball and the first-down
// line; and, in every sport that sends one, ESPN's last play.
function liveHtml(game, league) {
  let html = '';
  if (game.diamond && league.path.startsWith('baseball/')) html += cardDiamond(game.diamond);
  else if (league.path.startsWith('football/')) html += cardField(game, league);
  if (game.lastPlay) html += `<p class="live-last"><span>Last play</span> ${esc(game.lastPlay)}</p>`;
  return html ? `<div class="game-live">${html}</div>` : '';
}

function cardDiamond(d) {
  const base = (n, x, y) => `<rect class="base${d.bases.includes(n) ? ' on' : ''}" x="${x - 5}" y="${y - 5}" width="10" height="10" rx="1.5" transform="rotate(45 ${x} ${y})"/>`;
  const ordinal = { 1: 'first', 2: 'second', 3: 'third' };
  const runners = d.bases.length ? `Runners on ${d.bases.map((b) => ordinal[b]).join(' and ')}` : 'Bases empty';
  const outs = [0, 1, 2].map((i) => `<i${i < d.outs ? ' class="on"' : ''}></i>`).join('');
  const who = (role, name, line) => (name ? `<p><span>${role}</span> <b>${esc(name)}</b>${line ? ` ${esc(line)}` : ''}</p>` : '');
  return `
    <div class="card-diamond">
      <div class="card-bases" role="img" aria-label="${esc(`${runners}, ${d.outs} out${d.outs === 1 ? '' : 's'}, count ${d.balls}-${d.strikes}`)}">
        <svg viewBox="0 0 48 34" aria-hidden="true">${base(2, 24, 8)}${base(3, 11, 21)}${base(1, 37, 21)}</svg>
        <span class="card-count" aria-hidden="true"><b>${d.balls}-${d.strikes}</b><span class="card-outs">${outs}</span></span>
      </div>
      <div class="card-who">${who('P', d.pitcher, d.pitcherLine)}${who('AB', d.batter, d.batterLine)}</div>
    </div>`;
}

// The field as on the game page, smaller: each end zone in its team's color
// on that team's side, the ball and the first-down line; under it who has
// the ball and the down and distance. Between plays there's no ball.
function cardField(game, league) {
  const spot = fieldView(game, league);
  const holder = game.teams.find((t) => t.possession);
  if (!spot && !game.detail && !holder) return '';
  const zone = (team) => `<span class="end-zone" style="background:${esc(team?.color ?? '#374151')}"></span>`;
  const at = (yards) => `left:${yards}%`;
  let play = '<i class="yard mid" style="left:50%"></i>';
  if (spot) {
    if (spot.firstDown !== null) {
      play += `<i class="to-go" style="${at(Math.min(spot.ball, spot.firstDown))};width:${Math.abs(spot.firstDown - spot.ball)}%"></i>`
        + `<i class="first-down" style="${at(spot.firstDown)}"></i>`;
    }
    play += `<i class="scrimmage" style="${at(spot.ball)}"></i><span class="ball" style="${at(spot.ball)}">${ICONS.football}</span>`;
  }
  const caption = [holder && `<span class="field-ball">${ICONS.football}${esc(holder.abbr)}</span>`, game.detail && esc(game.detail)].filter(Boolean).join(' · ');
  const [a, b] = game.teams;
  return `
    <div class="field card-field" role="img" aria-label="${esc(game.detail ? `${holder ? `${holder.abbr} ball, ` : ''}${game.detail}` : 'The field')}">
      ${zone(a)}<div class="turf">${play}</div>${zone(b)}
    </div>
    ${caption ? `<p class="card-field-detail">${caption}</p>` : ''}`;
}

// Soccer's goals and red cards on a detailed card, each side's on its own
// line: "Saka 23', Haaland 45'+2' (pen)".
function momentsHtml(game) {
  if (!game.moments?.length) return '';
  const lines = game.teams.map((team) => {
    const mine = game.moments.filter((m) => m.teamId === String(team.id));
    if (!mine.length) return '';
    const items = mine.map((m) => `<span class="moment">${m.kind === 'red' ? `<span class="play-icon red">${ICONS.redCard}</span>` : `<span class="play-icon">${ICONS.ball}</span>`}${esc(m.name)} ${esc(m.minute)}${m.penalty ? ' (pen)' : m.ownGoal ? ' (OG)' : ''}</span>`);
    return `<p><b>${esc(team.abbr || team.name)}</b>${items.join('')}</p>`;
  }).join('');
  return lines ? `<div class="game-moments">${lines}</div>` : '';
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
  // The NFL's Division, Conference and Playoff Picture, all from one download.
  if (view.league.standingsViews) {
    const shown = standingsView(data, view.standings, view.league.standingsViews);
    return `
      <div class="toolbar toolbar-center">
        <div class="pills" role="group" aria-label="Standings view">
          ${standingsViews(view.league).map((v) => `<button data-standings="${v.id}" aria-pressed="${v.id === view.standings}">${esc(v.label)}</button>`).join('')}
        </div>
      </div>
      ${standingsTables(shown.groups)}
      ${view.standings === 'playoffs' ? clinchHtml(shown.groups) : ''}`;
  }
  return standingsTables(data.groups);
}

function standingsTables(groups) {
  return groups.map((group) => `
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
          <span class="pos"${note}>${row.pos ?? i + 1}</span>
          ${logoHtml(row.team, 22)}
          <span class="team-name">${esc(row.team.shortName || row.team.name)}</span>
          ${row.clincher ? `<span class="clinch" title="Clinched or eliminated">${esc(row.clincher)}</span>` : ''}
        </a>
      </th>
      ${columns.map((c) => `<td${c.key ? ' class="key"' : ''}>${esc(row.stats[c.id] ?? '–')}</td>`).join('')}
    </tr>`;
}

// What the letters by a team mean (the playoff picture's clinch marks).
function clinchHtml(groups) {
  const marks = clinchLegend(groups.flatMap((g) => g.rows), view.league);
  if (!marks.length) return '';
  return `<p class="others">${marks.map(([mark, text]) => `<b>${esc(mark)}</b> ${esc(text)}`).join(' · ')}</p>`;
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
    <div class="toolbar toolbar-center">
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

// "this week", "last week", "the week of Oct 6".
function weekWords(date, now) {
  const phrase = weekPhrase(date, now);
  return phrase.startsWith('Week of') ? `the w${phrase.slice(1)}` : phrase.toLowerCase();
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
  return leagueById(saved) ?? (followed.length ? MINE : leagues()[0]);
}

// The filter last picked for each league that has them: { ncaaf: '8' }.
function savedFilters() {
  try { return JSON.parse(readStorage(FILTER_KEY)) ?? {}; } catch { return {}; }
}

function savedFilter(league) {
  return leagueFilter(league, savedFilters()[league.id]);
}

function selectFilter(id) {
  const filter = leagueFilter(view.league, id);
  if (!filter || filter.id === view.filter?.id) return;
  writeStorage(FILTER_KEY, JSON.stringify({ ...savedFilters(), [view.league.id]: filter.id }));
  // Same week, other games.
  changeView({ filter });
}

// ---- Team lists ----

// Every league's teams, for the team picker and the team search. ESPN's teams
// list blocks browsers (no CORS header); standings list every team (college
// football's in two: FBS and FCS). Kept for the session once loaded.
const teamLists = new Map();   // league id → teams
const teamLoads = new Map();   // league id → the load in flight

function teamsFor(league) {
  if (teamLists.has(league.id)) return Promise.resolve(teamLists.get(league.id));
  if (!teamLoads.has(league.id)) {
    const load = Promise.all(teamListUrls(league).map(async (url) => parseStandings(await getJson(url), league)))
      .then((tables) => {
        const teams = teamsFromStandings({ groups: tables.flatMap((t) => t.groups) });
        teamLists.set(league.id, teams);
        return teams;
      })
      .finally(() => teamLoads.delete(league.id));
    teamLoads.set(league.id, load);
  }
  return teamLoads.get(league.id);
}

// ---- Team picker ----

const picker = { open: false, league: null, failed: new Set(), query: '', changed: false, opener: null };

function openPicker() {
  if (picker.open) return;
  closeSearch(false);
  closeAccount(false);
  closeMenu(false);
  closeOrder(false);
  Object.assign(picker, { open: true, changed: false, query: '', opener: document.activeElement });
  picker.league = view.league.mine ? leagueById(followed[0]?.league) ?? picker.league ?? leagues()[0] : view.league;
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
  tabs.innerHTML = leagues().map((l) => {
    const n = countFollowed(followed, l.id);
    return `<button class="tab" role="tab" data-picker-league="${l.id}" aria-selected="${l.id === picker.league.id}">${esc(l.label)}${n ? `<span class="count">${n}</span>` : ''}</button>`;
  }).join('');
  const selected = tabs.querySelector('[aria-selected="true"]');
  if (selected) tabs.scrollLeft = selected.offsetLeft - (tabs.clientWidth - selected.offsetWidth) / 2;
}

function renderPickerList() {
  const list = els.sheet.querySelector('#picker-list');
  els.sheet.querySelector('#picker-search').placeholder = `Search ${picker.league.label} teams`;
  const teams = teamLists.get(picker.league.id);
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
  if (teamLists.has(league.id)) return;
  picker.failed.delete(league.id);
  try {
    await teamsFor(league);
  } catch {
    picker.failed.add(league.id);
  }
  if (picker.open && picker.league.id === league.id) renderPickerList();
}

function toggleTeam(button) {
  const team = teamLists.get(picker.league.id)?.find((t) => t.id === button.dataset.team);
  if (!team) return;
  followed = toggleFollowed(followed, picker.league.id, team);
  saveFollowed(storage, followed);
  followsEdited();
  picker.changed = true;
  const on = isFollowed(followed, picker.league.id, team.id);
  button.setAttribute('aria-pressed', String(on));
  button.querySelector('.follow-mark').innerHTML = on ? ICONS.check : ICONS.plus;
  renderPickerTabs();
}

// ---- Team and player search ----

// The magnifier in the header: every league's teams at once, and players
// from ESPN's search; a tap opens the team's or the player's page. Before
// anything is typed it lists your teams.
const search = { open: false, query: '', pending: new Set(), failed: new Set(), opener: null, timer: null, failedPlayers: new Set() };

// Players come from ESPN's search (players.js) a moment after typing stops,
// from 3 letters on. Each query's answer is kept for the session, so typing
// back over a name doesn't ask again.
const PLAYER_MIN = 3;
const PLAYER_WAIT = 300;
const playerResults = new Map(); // folded query → players
const playerKey = (query) => fold(query.trim()).replace(/\s+/g, ' ');

function openSearch() {
  if (search.open) return;
  closePicker();
  closeAccount(false);
  closeMenu(false);
  closeOrder(false);
  Object.assign(search, { open: true, query: '', opener: document.activeElement });
  els.sheet.innerHTML = `
    <div class="sheet-backdrop" data-action="close-search"></div>
    <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
      <div class="sheet-grabber" aria-hidden="true"></div>
      <div class="sheet-head">
        <h2 id="sheet-title">Search</h2>
        <button class="pill-btn" data-action="close-search">Done</button>
      </div>
      <input class="search" id="team-search" type="search" placeholder="Team, city or player" aria-label="Search teams and players"
        autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" enterkeyhint="go">
      <ul class="team-list" id="search-list"></ul>
    </div>`;
  document.body.style.overflow = 'hidden';
  const input = els.sheet.querySelector('#team-search');
  input.addEventListener('input', () => {
    search.query = input.value;
    searchPlayersSoon();
    renderSearch();
  });
  // Go on the keyboard opens the top result.
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    els.sheet.querySelector('[data-search-team], [data-search-player]')?.click();
  });
  // Scrolling the results puts the keyboard away, as in iOS's own lists.
  els.sheet.querySelector('#search-list').addEventListener('touchmove', () => input.blur(), { passive: true });
  // Within the tap itself, or iOS won't bring up the keyboard.
  input.focus();
  renderSearch();
  for (const league of leagues()) loadSearchTeams(league);
}

function closeSearch(restoreFocus = true) {
  if (!search.open) return;
  search.open = false;
  clearTimeout(search.timer);
  els.sheet.innerHTML = '';
  document.body.style.overflow = '';
  if (restoreFocus) search.opener?.focus?.();
}

function searchPlayersSoon() {
  clearTimeout(search.timer);
  const key = playerKey(search.query);
  if (key.length < PLAYER_MIN || playerResults.has(key)) return;
  search.failedPlayers.delete(key);
  const query = search.query.trim();
  search.timer = setTimeout(() => loadSearchPlayers(query, key), PLAYER_WAIT);
}

async function loadSearchPlayers(query, key) {
  try {
    playerResults.set(key, parseSearchPlayers(await getJson(playerSearchUrl(query))));
  } catch {
    search.failedPlayers.add(key);
  }
  // Only if it's still what's typed: an older answer can arrive late.
  if (search.open && playerKey(search.query) === key) renderSearch();
}

async function loadSearchTeams(league) {
  if (teamLists.has(league.id)) return;
  search.pending.add(league.id);
  search.failed.delete(league.id);
  try {
    await teamsFor(league);
  } catch {
    search.failed.add(league.id);
  }
  search.pending.delete(league.id);
  if (search.open) renderSearch();
}

function renderSearch() {
  const list = els.sheet.querySelector('#search-list');
  if (!list) return;
  const query = search.query.trim();
  if (!query) {
    const mine = followed.map((t) => ({ league: leagueById(t.league), team: t })).filter((r) => r.league);
    list.innerHTML = mine.length
      ? `<li class="list-label">Your teams</li>${mine.map(searchRow).join('')}`
      : '<li class="list-note">Search every league by team name, city or abbreviation, or by a player\'s name.</li>';
    return;
  }
  const loaded = leagues().filter((l) => teamLists.has(l.id)).map((league) => ({ league, teams: teamLists.get(league.id) }));
  const results = searchTeams(loaded, query);
  const loading = leagues().filter((l) => search.pending.has(l.id)).map((l) => l.label);
  const failed = leagues().filter((l) => search.failed.has(l.id)).map((l) => l.label);
  const key = playerKey(query);
  const searchesPlayers = key.length >= PLAYER_MIN;
  const players = (searchesPlayers && playerResults.get(key)) || [];
  const playersFailed = searchesPlayers && search.failedPlayers.has(key);
  const playersPending = searchesPlayers && !playerResults.has(key) && !playersFailed;
  const notes = [
    !results.length && !loading.length && !players.length && !playersPending
      ? `No teams${searchesPlayers && !playersFailed ? ' or players' : ''} match “${query}”.`
      : '',
    loading.length ? `Still loading ${loading.join(', ')}…` : '',
    failed.length ? `Couldn't load ${failed.join(', ')}.` : '',
    playersPending ? 'Searching players…' : '',
    playersFailed ? "Couldn't search players." : '',
  ].filter(Boolean);
  // Labelled once both kinds can show.
  const both = results.length && (players.length || playersPending);
  list.innerHTML = (both ? '<li class="list-label">Teams</li>' : '') + results.map(searchRow).join('')
    + (players.length ? `<li class="list-label">Players</li>${players.map(playerRow).join('')}` : '')
    + notes.map((n) => `<li class="list-note">${esc(n)}</li>`).join('');
}

function searchRow({ league, team }) {
  const mine = isFollowed(followed, league.id, team.id);
  return `
    <li><button class="team-option" data-search-team="${esc(league.id)}|${esc(team.id)}">
      ${logoHtml(team)}
      <span class="name">${esc(team.name)}${mine ? `<span class="star" title="Following">${ICONS.starSmall}</span>` : ''}</span>
      <span class="league-chip">${esc(league.label)}</span>
    </button></li>`;
}

function playerRow(player) {
  const league = leagueById(player.league);
  const meta = [player.team?.abbr, player.position].filter(Boolean).join(' · ');
  return `
    <li><button class="team-option" data-search-player="${esc(player.league)}|${esc(player.id)}">
      ${headshotHtml(player, 28, player.team?.color)}
      <span class="name">${esc(player.name)}${meta ? `<small class="option-meta">${esc(meta)}</small>` : ''}</span>
      <span class="league-chip">${esc(league.label)}</span>
    </button></li>`;
}

function openSearchResult(value, hrefFor = teamHref) {
  const [leagueId, id] = value.split('|');
  closeSearch(false);
  const href = hrefFor(leagueId, id);
  if (href !== location.hash) navigate(href);
}

// ---- Events ----

function selectLeague(id) {
  const league = id === MINE.id ? MINE : leagueById(id);
  if (!league || league.id === view.league.id) return;
  writeStorage(LEAGUE_KEY, league.id);
  // Stay on Standings or News when switching leagues; Rankings only where
  // polls exist; My Teams has Scores and News.
  const mode = league.mine ? (view.mode === 'news' ? 'news' : 'scores')
    : view.mode === 'rankings' && !league.rankings ? 'scores' : view.mode;
  changeView({ league, filter: league.mine ? null : savedFilter(league), mode, dayOffset: 0, week: null, poll: 0 });
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
  else if (d.span && d.span !== view.span) {
    writeStorage(SPAN_KEY, d.span);
    changeView({ span: d.span });
  }
  else if (d.scoreView && d.scoreView !== (scoreView || 'detailed')) {
    scoreView = cleanScoreView(d.scoreView);
    saveScoreView(storage, scoreView);
    accountChanged();
    renderNav();
    renderContent();
  }
  else if (d.week) {
    const week = adjacentWeek(view.data, Number(d.week));
    if (week) changeView({ week });
  } else if (d.poll !== undefined) {
    view.poll = Number(d.poll);
    renderContent();
  } else if (d.standings) {
    view.standings = d.standings;
    renderContent();
  } else if (d.pickerLeague) {
    picker.league = leagueById(d.pickerLeague);
    renderPickerTabs();
    renderPickerList();
    loadTeams(picker.league);
  } else if (d.team) toggleTeam(target);
  else if (d.action === 'today') changeView({ dayOffset: 0, week: null });
  else if (d.action === 'edit-teams') openPicker();
  else if (d.action === 'order-teams') openOrder('teams');
  else if (d.action === 'open-order') openOrder('leagues');
  else if (d.action === 'close-order') closeOrder();
  else if (d.action === 'reset-order') resetLeagueOrder();
  else if (d.action === 'reset-cards') resetCards();
  else if (d.cardToggle !== undefined) toggleCard(Number(d.cardToggle));
  else if (d.orderTab && d.orderTab !== order.tab) {
    order.tab = d.orderTab;
    renderOrder();
  }
  else if (d.action === 'close-picker') closePicker();
  else if (d.action === 'open-search') openSearch();
  else if (d.action === 'close-search') closeSearch();
  else if (d.action === 'open-menu') openMenu();
  else if (d.action === 'close-menu') closeMenu();
  else if (d.action === 'open-account') openAccount();
  else if (d.action === 'close-account') closeAccount();
  else if (d.action === 'sign-out') signOut();
  else if (d.action === 'delete-account') confirmDelete();
  else if (d.action === 'retry-account') retryAccount();
  else if (d.searchTeam) openSearchResult(d.searchTeam);
  else if (d.searchPlayer) openSearchResult(d.searchPlayer, playerHref);
  else if (d.action === 'retry') load();
  else if (d.action === 'retry-teams') loadTeams(picker.league);
});

const refreshNow = () => (pageOpen() ? refreshPage() : load());
els.refresh.addEventListener('click', refreshNow);
initPullToRefresh({ refresh: refreshNow, enabled: () => !sheetOpen() });
initSwipeNav({
  enabled: () => inApp() && !sheetOpen(),
  content: () => document.getElementById(pageOpen() ? 'page' : 'main'),
  canBack: () => pageOpen(),
  canForward: () => furthest > depth,
  back: () => goBack(),
  forward: () => history.forward(),
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  closePicker();
  closeSearch();
  closeAccount();
  closeMenu();
  closeOrder();
});

document.addEventListener('change', (event) => {
  if (!event.target.matches('select[data-filter]')) return;
  haptic('selection');
  selectFilter(event.target.value);
});

// In the iPhone app every button press taps the haptic engine: a selection
// tick for tabs, view switches, days and polls, a light tap for the rest.
// Captured first, so it buzzes even for buttons whose handlers stop the click.
const SELECTION = '[role="tab"], .day, [data-order-tab], [data-span], [data-score-view], [data-poll], [data-standings], [data-team-tab], [data-alert-delay]';
document.addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (button && !button.disabled) haptic(button.matches(SELECTION) ? 'selection' : 'light');
}, true);

// Don't poll in the background; catch up as soon as the app is looked at again.
document.addEventListener('visibilitychange', () => {
  if (pageOpen()) pageVisible(!document.hidden);
  else if (document.hidden) clearTimeout(timer);
  else if (!view.updatedAt || Date.now() - view.updatedAt > 10_000) load();
  else schedule();
});

// A logo that fails to load becomes the team-color badge, and stays one. A
// news photo that fails is left out.
document.addEventListener('error', (event) => {
  const img = event.target;
  if (!(img instanceof HTMLImageElement)) return;
  if (img.classList.contains('news-photo')) {
    failedImages.add(img.getAttribute('src'));
    img.remove();
    return;
  }
  if (!img.classList.contains('logo')) return;
  failedLogos.add(img.getAttribute('src'));
  img.outerHTML = fallbackLogo(img.dataset.abbr, img.dataset.color);
}, true);

// ---- Menu ----

// The header's menu button: the account (where sign-in works, account.js;
// it's optional and only syncs teams and alerts), the privacy policy and
// support pages (Apple wants the policy reachable in the app; they're the
// push server's, so they open in the browser).

const menu = { open: false, opener: null };
const sheetOpen = () => picker.open || search.open || account.open || menu.open || order.open;

const CHEVRON = '<svg class="menu-chevron" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function openMenu() {
  if (menu.open) return;
  closePicker();
  closeSearch(false);
  closeAccount(false);
  closeOrder(false);
  Object.assign(menu, { open: true, opener: document.activeElement });
  els.sheet.innerHTML = `
    <div class="sheet-backdrop" data-action="close-menu"></div>
    <div class="sheet sheet-short" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
      <div class="sheet-grabber" aria-hidden="true"></div>
      <div class="sheet-head">
        <h2 id="sheet-title">Menu</h2>
        <button class="pill-btn" data-action="close-menu">Done</button>
      </div>
      <ul class="menu-list" id="menu-list"></ul>
    </div>`;
  document.body.style.overflow = 'hidden';
  renderMenu();
  els.sheet.querySelector('[data-action="close-menu"].pill-btn').focus();
}

function closeMenu(restoreFocus = true) {
  if (!menu.open) return;
  menu.open = false;
  els.sheet.innerHTML = '';
  document.body.style.overflow = '';
  if (restoreFocus) menu.opener?.focus?.();
}

function renderMenu() {
  if (!menu.open) return;
  const s = accountState();
  const signedIn = s.status === 'signedIn';
  const accountRow = accountsOn() ? `
    <li><button class="menu-row" data-action="open-account">
      <span class="menu-text">
        <span class="menu-title">${signedIn ? 'Account' : 'Sign in'}</span>
        <span class="option-meta">${signedIn ? esc(s.email) : 'Optional. Keeps your teams and alerts on all your devices.'}</span>
      </span>${CHEVRON}
    </button></li>` : '';
  els.sheet.querySelector('#menu-list').innerHTML = `${accountRow}
    <li><button class="menu-row" data-action="open-order">
      <span class="menu-text"><span class="menu-title">Change League Order</span><span class="option-meta">The leagues across the top, and your teams</span></span>${CHEVRON}
    </button></li>
    <li><a class="menu-row" href="https://scores.phade.app/privacy" target="_blank" rel="noopener">
      <span class="menu-text"><span class="menu-title">Privacy policy</span></span>${CHEVRON}
    </a></li>
    <li><a class="menu-row" href="https://scores.phade.app/support" target="_blank" rel="noopener">
      <span class="menu-text"><span class="menu-title">Support</span><span class="option-meta">Help, and where the scores come from</span></span>${CHEVRON}
    </a></li>`;
}

// ---- Order ----

// The menu's Change League Order row (and My Teams' Reorder): the league tabs, or the
// followed teams, dragged into the person's order by the grip on each row
// (arrow keys on it work too). The teams' order is the followed list's own,
// so the chips, the games in My Teams and the widgets follow it. The game
// page's gear opens the same sheet on that sport's cards (tab 'cards'), each
// with a switch to hide it. All of them sync with the account like the
// teams do.

const order = { open: false, tab: 'leagues', league: null, opener: null, drag: null };
const GRIP = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M5 8h14M5 12h14M5 16h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

function openOrder(tab, league = null) {
  if (order.open) return;
  const opener = menu.open ? menu.opener : document.activeElement;
  closePicker();
  closeSearch(false);
  closeAccount(false);
  closeMenu(false);
  Object.assign(order, { open: true, tab, league, opener, drag: null });
  const cards = tab === 'cards';
  els.sheet.innerHTML = `
    <div class="sheet-backdrop" data-action="close-order"></div>
    <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
      <div class="sheet-grabber" aria-hidden="true"></div>
      <div class="sheet-head">
        <h2 id="sheet-title">${cards ? 'Game page' : 'Order'}</h2>
        <button class="pill-btn" data-action="close-order">Done</button>
      </div>
      ${cards ? '' : '<div class="segmented order-tabs" role="tablist" aria-label="What to order"></div>'}
      <ul class="order-list" id="order-list"></ul>
    </div>`;
  document.body.style.overflow = 'hidden';
  const list = els.sheet.querySelector('#order-list');
  list.addEventListener('pointerdown', dragStart);
  list.addEventListener('keydown', orderKey);
  renderOrder();
  els.sheet.querySelector('[data-action="close-order"].pill-btn').focus();
}

function closeOrder(restoreFocus = true) {
  if (!order.open) return;
  order.open = false;
  order.drag = null;
  els.sheet.innerHTML = '';
  document.body.style.overflow = '';
  if (restoreFocus) order.opener?.focus?.();
}

const sportCards = () => gameCardsFor(sportOf(order.league), gameCards);

function orderItems() {
  if (order.tab === 'cards') return sportCards();
  return order.tab === 'teams' ? followed : leagues();
}

// Saves this sport's cards as listed (moved or switched).
function saveCards(listed) {
  gameCards = setGameCards(gameCards, sportOf(order.league), listed);
  saveGameCards(storage, gameCards);
  accountChanged();
  redrawPage();
}

function toggleCard(index) {
  const items = orderItems();
  if (!items[index]) return;
  items[index] = { ...items[index], hidden: !items[index].hidden };
  saveCards(items);
  renderOrder();
  els.sheet.querySelector(`[data-card-toggle="${index}"]`)?.focus();
}

function resetCards() {
  // Saved in full, like the league order, so it reaches other devices.
  gameCards = setGameCards(gameCards, sportOf(order.league), gameCardsFor(sportOf(order.league), {}));
  saveGameCards(storage, gameCards);
  accountChanged();
  redrawPage();
  renderOrder();
}

function renderCards() {
  const list = els.sheet.querySelector('#order-list');
  const items = orderItems();
  const sport = sportOf(order.league);
  const standard = JSON.stringify(gameCardsFor(sport, {})) === JSON.stringify(items);
  list.innerHTML = `<li class="list-note order-hint">Drag the cards into the order you want and switch off the ones you don't. Every ${esc(sport)} game shows them this way.</li>` + items.map((card, i) => `
      <li class="order-row${card.hidden ? ' off' : ''}" data-order-index="${i}">
        <span class="name">${esc(card.label)}</span>
        <button class="card-switch" role="switch" aria-checked="${!card.hidden}" data-card-toggle="${i}" aria-label="Show ${esc(card.label)}"><span class="switch" aria-hidden="true"></span></button>
        <button class="order-grip" data-order-grip="${i}" aria-label="Move ${esc(card.label)}, ${i + 1} of ${items.length}. Use the arrow keys.">${GRIP}</button>
      </li>`).join('') + (standard ? '' : '<li class="list-note"><button class="link-btn" data-action="reset-cards">Back to the standard layout</button></li>');
}

function renderOrder() {
  if (!order.open) return;
  if (order.tab === 'cards') {
    renderCards();
    return;
  }
  els.sheet.querySelector('.order-tabs').innerHTML = [['leagues', 'Leagues'], ['teams', 'My Teams']]
    .map(([id, label]) => `<button role="tab" data-order-tab="${id}" aria-selected="${order.tab === id}">${label}</button>`).join('');
  const list = els.sheet.querySelector('#order-list');
  const teams = order.tab === 'teams';
  if (teams && !followed.length) {
    list.innerHTML = '<li class="list-note">Follow teams and you can put them in order here.<br><br><button class="pill-btn" data-action="edit-teams">Choose teams</button></li>';
    return;
  }
  const items = orderItems();
  const hint = teams
    ? 'Drag your teams into order. My Teams shows their games in it.'
    : 'Drag the leagues into the order you want across the top.';
  const custom = leagueOrder.length && leagues().some((l, i) => l.id !== LEAGUES[i].id);
  list.innerHTML = `<li class="list-note order-hint">${hint}</li>` + items.map((item, i) => {
    const name = teams ? item.name || item.abbr : item.label;
    return `
      <li class="order-row" data-order-index="${i}">
        ${teams ? logoHtml(item) : ''}
        <span class="name">${esc(name)}</span>
        ${teams ? `<span class="league-chip">${esc(leagueById(item.league)?.label ?? '')}</span>` : ''}
        <button class="order-grip" data-order-grip="${i}" aria-label="Move ${esc(name)}, ${i + 1} of ${items.length}. Use the arrow keys.">${GRIP}</button>
      </li>`;
  }).join('') + (!teams && custom ? '<li class="list-note"><button class="link-btn" data-action="reset-order">Back to the standard order</button></li>' : '');
}

function moveOrder(from, to) {
  if (from === to) return;
  if (order.tab === 'cards') saveCards(moveTeam(orderItems(), from, to));
  else if (order.tab === 'teams') {
    followed = moveTeam(followed, from, to);
    saveFollowed(storage, followed);
    followsEdited();
  } else {
    leagueOrder = moveTeam(leagues(), from, to).map((l) => l.id);
    saveLeagueOrder(storage, leagueOrder);
    accountChanged();
  }
  render();
}

function resetLeagueOrder() {
  // Saved in full, so the reset reaches the account's other devices too.
  leagueOrder = LEAGUES.map((l) => l.id);
  saveLeagueOrder(storage, leagueOrder);
  accountChanged();
  render();
  renderOrder();
}

function orderKey(event) {
  const grip = event.target.closest('[data-order-grip]');
  const step = { ArrowUp: -1, ArrowDown: 1 }[event.key];
  if (!grip || !step) return;
  event.preventDefault();
  const from = Number(grip.dataset.orderGrip);
  const to = from + step;
  if (to < 0 || to >= orderItems().length) return;
  moveOrder(from, to);
  renderOrder();
  els.sheet.querySelector(`[data-order-grip="${to}"]`)?.focus();
}

// The row follows the finger; the rows it passes slide out of its way.
// Nothing is saved until it's let go.
function dragStart(event) {
  const grip = event.target.closest('[data-order-grip]');
  if (!grip || order.drag || event.button > 0) return;
  event.preventDefault();
  const list = els.sheet.querySelector('#order-list');
  const rows = [...list.querySelectorAll('.order-row')];
  const from = Number(grip.dataset.orderGrip);
  const row = rows[from];
  const step = rows.length > 1 ? rows[1].getBoundingClientRect().top - rows[0].getBoundingClientRect().top : row.offsetHeight;
  order.drag = { id: event.pointerId, list, rows, row, from, to: from, step, startY: event.clientY, startScroll: list.scrollTop };
  grip.setPointerCapture?.(event.pointerId);
  row.classList.add('dragging');
  list.classList.add('sorting');
  grip.addEventListener('pointermove', dragMove);
  grip.addEventListener('pointerup', dragEnd);
  grip.addEventListener('pointercancel', dragEnd);
}

function dragMove(event) {
  const d = order.drag;
  if (!d || event.pointerId !== d.id) return;
  // Near the list's top or bottom edge, scroll it.
  const box = d.list.getBoundingClientRect();
  if (event.clientY < box.top + 48) d.list.scrollTop -= 10;
  else if (event.clientY > box.bottom - 48) d.list.scrollTop += 10;
  const dy = event.clientY - d.startY + d.list.scrollTop - d.startScroll;
  d.row.style.transform = `translateY(${dy}px)`;
  const to = Math.max(0, Math.min(d.rows.length - 1, d.from + Math.round(dy / d.step)));
  if (to === d.to) return;
  d.to = to;
  haptic('selection');
  d.rows.forEach((r, i) => {
    if (r === d.row) return;
    const shift = d.from < i && i <= to ? -d.step : to <= i && i < d.from ? d.step : 0;
    r.style.transform = shift ? `translateY(${shift}px)` : '';
  });
}

function dragEnd(event) {
  const d = order.drag;
  if (!d || event.pointerId !== d.id) return;
  order.drag = null;
  event.currentTarget.removeEventListener('pointermove', dragMove);
  event.currentTarget.removeEventListener('pointerup', dragEnd);
  event.currentTarget.removeEventListener('pointercancel', dragEnd);
  const scroll = d.list.scrollTop;
  d.list.classList.remove('sorting');
  if (event.type !== 'pointercancel') moveOrder(d.from, d.to);
  renderOrder();
  d.list.scrollTop = scroll;
}

// ---- Account ----

// Opened from the menu (only where a Clerk key works, account.js): sign in
// to keep the followed teams and their alerts on every device. Clerk draws
// the sign-in form itself; signin.js does the syncing.

const account = { open: false, opener: null, shown: null };

function openAccount() {
  if (account.open) return;
  const opener = menu.open ? menu.opener : document.activeElement;
  closePicker();
  closeSearch(false);
  closeMenu(false);
  closeOrder(false);
  Object.assign(account, { open: true, opener, shown: null });
  els.sheet.innerHTML = `
    <div class="sheet-backdrop" data-action="close-account"></div>
    <div class="sheet sheet-short" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
      <div class="sheet-grabber" aria-hidden="true"></div>
      <div class="sheet-head">
        <h2 id="sheet-title">Account</h2>
        <button class="pill-btn" data-action="close-account">Done</button>
      </div>
      <div class="account-body" id="account-body"></div>
    </div>`;
  document.body.style.overflow = 'hidden';
  loadClerk().catch(() => {});
  renderAccount();
}

function closeAccount(restoreFocus = true) {
  if (!account.open) return;
  account.open = false;
  hideSignIn();
  els.sheet.innerHTML = '';
  document.body.style.overflow = '';
  if (restoreFocus) account.opener?.focus?.();
}

function syncLine(s) {
  if (s.error) return '<p class="account-note account-error">Couldn\'t reach your account. Your changes are kept here and saved when it\'s back.</p>';
  if (!s.syncedAt) return '<p class="account-note">Syncing your teams</p>';
  return '<p class="account-note">Your teams, alerts and alert delay are saved to your account.</p>';
}

function renderAccount() {
  const s = accountState();
  els.menu.classList.toggle('signed-in', s.status === 'signedIn');
  els.menu.setAttribute('aria-label', s.status === 'signedIn' ? 'Menu (signed in)' : 'Menu');
  renderMenu();
  if (!account.open) return;
  const body = els.sheet.querySelector('#account-body');
  // Clerk's form lives in #clerk-sign-in: leave it alone while signed out.
  if (s.status === 'signedOut' && account.shown === 'signedOut') return;
  account.shown = s.status;
  if (s.status === 'signedIn') {
    hideSignIn();
    body.innerHTML = `
      <div class="account-user">
        <span class="account-avatar" aria-hidden="true">${esc((s.email[0] ?? '?').toUpperCase())}</span>
        <div><p class="account-label">Signed in as</p><p class="account-email">${esc(s.email)}</p></div>
      </div>
      ${syncLine(s)}
      <div class="account-actions">
        ${s.error ? '<button class="pill-btn" data-action="retry-account">Try again</button>' : ''}
        <button class="pill-btn" data-action="sign-out">Sign out</button>
      </div>
      <p class="account-note">Signing out keeps your teams on this device.</p>
      <button class="link-btn account-delete" data-action="delete-account">Delete account</button>`;
    return;
  }
  if (s.status === 'signedOut') {
    body.innerHTML = `
      <p class="account-intro">Sign in to keep your teams, alerts and alert delay on all your devices. The teams on this device are added to your account.</p>
      <div id="clerk-sign-in" class="clerk-mount"></div>`;
    showSignIn(body.querySelector('#clerk-sign-in'));
    return;
  }
  body.innerHTML = s.status === 'failed'
    ? '<p class="account-intro">Couldn\'t load sign-in. Check your connection.</p><div class="account-actions"><button class="pill-btn" data-action="retry-account">Try again</button></div>'
    : '<p class="account-intro">Loading</p>';
}

function retryAccount() {
  if (accountState().status === 'signedIn') sync();
  else {
    loadClerk().catch(() => {});
    renderAccount();
  }
}

async function confirmDelete() {
  if (!window.confirm('Delete your account? Your teams stay on this device, but are removed from your account and your other devices stop syncing.')) return;
  try {
    await deleteAccount();
  } catch {
    window.alert('Couldn\'t delete your account. Try again.');
  }
}

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
  setLineSteam(null);
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
    followsEdited();
    followsChanged = true;
  },
  alertsFor: (leagueId, teamId) => alertsFor(followed, leagueId, teamId),
  setAlerts(leagueId, teamId, kinds) {
    followed = setAlerts(followed, leagueId, teamId, kinds);
    saveFollowed(storage, followed);
    followsEdited();
  },
  alertDelay: () => alertDelay,
  setAlertDelay(seconds) {
    alertDelay = clampDelay(seconds);
    saveAlertDelay(storage, alertDelay);
    followsEdited();
  },
  gameCards: (league) => gameCardsFor(sportOf(league), gameCards),
  arrangeCards: (league) => openOrder('cards', league),
  setTitle: (text) => { els.pageTitle.textContent = text; },
  setLineSteam,
  setLoading: (on) => els.refresh.classList.toggle('spinning', on),
});

// The header's LineSteam link (linesteam.com charts every FanDuel line move):
// a game's own chart on a game page in one of its leagues, else its home page.
// Opens outside the app.
function setLineSteam(url) {
  els.lineSteam.href = url || 'https://linesteam.com';
  els.lineSteam.setAttribute('aria-label', url ? "This game's line movement on LineSteam" : 'Line movement on LineSteam');
}

// iPhone app: hand the teams that want alerts to the app, which registers
// them with the push server. Also at every launch, since the device's push
// token can change. The widgets get every followed team.
function syncAlerts() {
  if (!inApp()) return;
  setAlertTeams(alertTeams(followed), alertDelay);
  setFollowedTeams(widgetTeams(followed));
}

// A change made here: the apps, and the account when signed in.
function followsEdited() {
  syncAlerts();
  accountChanged();
}

syncAlerts();
initAccount({
  storage,
  local: () => ({ teams: followed, alertDelay, leagueOrder, gameCards, scoreView }),
  // The account's teams replaced this device's (another device changed
  // them, or the first sign-in merged them).
  apply(saved) {
    followed = saved.teams;
    alertDelay = saved.alertDelay;
    if (saved.leagueOrder.length) leagueOrder = saved.leagueOrder;
    if (Object.keys(saved.gameCards).length) gameCards = saved.gameCards;
    if (saved.scoreView) scoreView = saved.scoreView;
    saveFollowed(storage, followed);
    saveAlertDelay(storage, alertDelay);
    saveLeagueOrder(storage, leagueOrder);
    saveGameCards(storage, gameCards);
    if (scoreView) saveScoreView(storage, scoreView);
    redrawPage();
    if (order.open) renderOrder();
    syncAlerts();
    if (pageOpen()) followsChanged = true;
    else if (view.league.mine) changeView({});
    else render();
  },
  changed: renderAccount,
});
render();
els.tabs.querySelector('[aria-selected="true"]')?.scrollIntoView({ inline: 'center', block: 'nearest' });
load();
applyRoute();
// Pick up a new deploy when the app comes back to the front (not while the
// team picker is open).
initAutoUpdate({ canReload: () => !picker.open && !account.open && !order.open });
