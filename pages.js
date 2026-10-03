// The game page (box score) and the team page (schedule). They open over the
// scoreboard from links like #/game/nfl/401547417 and #/team/nfl/12, so the
// back button, swipe-back and shared links all work.

import { leagueById, statusLabel, lineSteamUrl, dayUrls, parseScoreboard } from './espn.js';
import { summaryUrl, scheduleUrls, parseSummary, parseSchedule, lockScreenCard, canShowOnLockScreen } from './details.js';
import { ICONS, getJson, TROUBLE, oddsHtml, logoHtml, emptyState, errorState, formatClock, esc } from './ui.js';
import { inApp, nativeInfo, showOnLockScreen, scheduleOnLockScreen, removeFromLockScreen, enableAlerts } from './native.js';

export const gameHref = (leagueId, id) => `#/game/${leagueId}/${encodeURIComponent(id)}`;
export const teamHref = (leagueId, id) => `#/team/${leagueId}/${encodeURIComponent(id)}`;

export function parseRoute(hash) {
  const match = /^#\/(game|team)\/([a-z0-9]+)\/([\w-]+)$/.exec(hash ?? '');
  const league = match && leagueById(match[2]);
  return league ? { kind: match[1], league, id: match[3], key: match[0] } : null;
}

// What the page needs from the app: follows, the header title and spinner.
let app = null;
export function initPages(context) { app = context; }

const page = {
  route: null,
  data: null,
  error: null,
  updatedAt: null,
  loading: false,
  side: 0,       // game page: whose box score is showing
  timer: null,
  quick: null,   // live game: the 5s score and clock check
  board: null,   // live game: the scoreboard URL that has it
  requestId: 0,
};
const root = () => document.getElementById('page');

// iPhone app only: what the app says about Live Activities and alerts, and
// the state of the game page's Lock Screen card and the team page's bell.
const native = { info: null, busy: false, lockError: '', alertNote: '', alertsOpen: false };

function refreshNative() {
  if (!inApp()) return;
  nativeInfo().then((info) => {
    native.info = info;
    if (page.route) render();
  });
}

// The last few pages, so going back (button or swipe) shows the page as it
// was straight away, then refreshes it if it's stale.
const recent = new Map();
const RECENT = 8;
const stale = () => !page.updatedAt || Date.now() - page.updatedAt > 10_000;

function remember() {
  const { route, data, updatedAt, side } = page;
  if (!route || !data) return;
  recent.delete(route.key);
  recent.set(route.key, { data, updatedAt, side });
  if (recent.size > RECENT) recent.delete(recent.keys().next().value);
}

// Drop the timer and any request in flight for the page that's going away.
function leave() {
  clearTimeout(page.timer);
  clearTimeout(page.quick);
  page.board = null;
  page.requestId++;
  remember();
  if (page.loading) {
    page.loading = false;
    app.setLoading(false);
  }
}

export const pageOpen = () => Boolean(page.route);

// True when the page rendered with content, so its scroll can be restored.
export function showPage(route) {
  if (page.route?.key === route.key) return Boolean(page.data);
  leave();
  const seen = recent.get(route.key);
  Object.assign(page, { route, data: null, error: null, updatedAt: null, side: 0 }, seen);
  Object.assign(native, { lockError: '', alertNote: '', alertsOpen: false });
  refreshNative();
  render();
  if (stale()) load();
  else schedule();
  return Boolean(page.data);
}

export function hidePage() {
  leave();
  page.route = null;
  root().innerHTML = '';
}

export function refreshPage() {
  return page.route ? load() : Promise.resolve();
}

export function pageVisible(visible) {
  if (!page.route) return;
  if (!visible) {
    clearTimeout(page.timer);
    clearTimeout(page.quick);
  } else if (stale()) load();
  else schedule();
  // The card may have been swiped off the Lock Screen meanwhile.
  if (visible) refreshNative();
}

async function load() {
  clearTimeout(page.timer);
  clearTimeout(page.quick);
  const id = ++page.requestId;
  const { route } = page;
  page.loading = true;
  app.setLoading(true);
  try {
    let data;
    if (route.kind === 'game') {
      data = parseSummary(await getJson(summaryUrl(route.league, route.id)), route.league);
    } else {
      const results = await Promise.allSettled(scheduleUrls(route.league, route.id).map(getJson));
      const ok = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
      if (!ok.length) throw results[0].reason;
      data = parseSchedule(ok, route.league, route.id);
    }
    if (!data) throw new Error('No data');
    if (id !== page.requestId) return;
    Object.assign(page, { data, error: null, updatedAt: new Date() });
  } catch (err) {
    if (id !== page.requestId) return;
    page.error = err;
  }
  page.loading = false;
  app.setLoading(false);
  render();
  schedule();
}

// A summary can be over a megabyte, so a live game's box score refreshes
// every 30s, while its score and clock come every 5s from the day's
// scoreboard (a few KB). A score or the game's state changing there brings
// the box score at once.
const QUICK = 5_000;
const FULL = 30_000;

function schedule() {
  clearTimeout(page.timer);
  clearTimeout(page.quick);
  if (document.hidden || !page.route) return;
  const { data, route } = page;
  let delay = null;
  if (page.error) delay = FULL;
  else if (route.kind === 'game' && data?.state === 'in') {
    delay = FULL;
    page.quick = setTimeout(quick, QUICK);
  } else if (route.kind === 'team' && data?.games.some((g) => g.state === 'in')) delay = 60_000;
  if (delay) page.timer = setTimeout(load, delay);
}

async function quick() {
  const { route, data } = page;
  const id = page.requestId;
  if (route?.kind !== 'game' || data?.state !== 'in' || document.hidden) return;
  try {
    // College football's game may be on the FBS or the FCS board.
    let game = null;
    for (const url of page.board ? [page.board] : dayUrls(route.league, data.start)) {
      game = parseScoreboard(await getJson(url), route.league).games.find((g) => g.id === String(route.id));
      if (game) {
        page.board = url;
        break;
      }
    }
    if (id !== page.requestId) return; // left the page, or a full refresh started
    const scores = (g) => g.teams.map((t) => `${t.id}:${t.score}`).sort().join();
    if (game && (game.state !== data.state || scores(game) !== scores(data))) {
      load();
      return;
    }
    if (game && game.statusText !== data.statusText) {
      Object.assign(data, { statusText: game.statusText, statusName: game.statusName });
      const status = root().querySelector('.matchup-status');
      if (status) status.innerHTML = statusHtml(data);
    }
  } catch {
    // The 30s refresh reports trouble.
  }
  if (id === page.requestId && !document.hidden) page.quick = setTimeout(quick, QUICK);
}

function render() {
  const { route, data, error } = page;
  if (!route) return;
  app.setTitle(data ? title(route, data) : '');
  let html;
  if (!data) html = error ? errorState() : loadingHtml(route.kind);
  else html = route.kind === 'game' ? gameHtml(data, route.league, route.id) : teamHtml(data, route.league);
  const updated = data && page.updatedAt
    ? `<p class="status${error ? ' error' : ''}">${error ? `Couldn't reach ESPN. Showing data from ${esc(formatClock(page.updatedAt))}.` : `Updated ${esc(formatClock(page.updatedAt))}${route.kind === 'game' && data.state === 'in' ? ' · live, score every 5s' : ''}`}</p>`
    : '';
  root().innerHTML = html + updated;
}

function title(route, data) {
  if (route.kind === 'team') return data.team.name;
  return data.teams.map((t) => t.abbr).join(route.league.homeFirst ? ' vs ' : ' @ ');
}

function loadingHtml(kind) {
  const bar = (w, h, extra = '') => `<span class="skeleton" style="width:${w};height:${h}px${extra}"></span>`;
  const head = `<div class="card skeleton-card page-head-skeleton">${bar('64px', 64, ';border-radius:50%;margin:0 auto')}${bar('50%', 18, ';margin:0 auto')}${bar('30%', 12, ';margin:0 auto')}</div>`;
  const row = `<div class="skeleton-row">${bar('40px', 14)}${bar('24px', 24, ';border-radius:50%')}${bar('45%', 14)}${bar('15%', 14)}</div>`;
  return `${head}<div class="card skeleton-card" style="margin-top:16px">${row.repeat(kind === 'team' ? 6 : 4)}</div>`;
}

// ---- Game page ----

function gameHtml(game, league, id) {
  const odds = game.odds && !TROUBLE.test(game.statusName) ? `<div class="card page-odds">${oddsHtml(game.odds, league)}${moneylinesHtml(game)}</div>` : '';
  const sections = [
    matchupHtml(game, league, id),
    odds,
    lineScoreHtml(game),
    scoringHtml(game, league),
    playersHtml(game),
    teamStatsHtml(game),
  ].filter(Boolean);
  if (game.state === 'pre' && sections.length <= 2) {
    sections.push(emptyState({ icon: ICONS.clipboard, title: 'Box score at kickoff', text: 'Player and team stats show up here once the game starts.' }));
  }
  sections.splice(1, 0, lockHtml(game, league, id));
  return sections.join('');
}

// iPhone app only: a toggle on every game page that hasn't finished. A game
// that's on or starts within six hours goes on the Lock Screen and in the
// Dynamic Island now; a later one is scheduled, and the push server puts it
// up 30 minutes before the start (iOS ends a card after eight hours).
// Several games can be up at once.
function lockState(league, id) {
  const match = (g) => g.league === league.id && g.eventId === String(id);
  return {
    showing: Boolean(native.info?.active?.some(match)),
    scheduled: Boolean(native.info?.scheduled?.some(match)),
  };
}

function lockHtml(game, league, id) {
  const info = native.info;
  if (!info?.liveActivities) return '';
  const { showing, scheduled } = lockState(league, id);
  const now = canShowOnLockScreen(game);
  if (!showing && !scheduled && (game.state === 'post' || TROUBLE.test(game.statusName) || (!now && !info.canSchedule))) return '';
  const on = showing || scheduled;
  let sub;
  if (native.lockError) sub = native.lockError;
  else if (showing) sub = 'Live score on your Lock Screen and in the Dynamic Island.';
  else if (scheduled) sub = 'Appears on your Lock Screen 30 minutes before the start.';
  else if (now) sub = 'Live score on your Lock Screen and in the Dynamic Island.';
  else sub = 'Turn on and it appears 30 minutes before the start.';
  return `
    <button class="card ext-link lock-card${on ? ' on' : ''}" role="switch" aria-checked="${on}" data-lock${native.busy ? ' disabled' : ''}>
      <span class="ext-icon">${on ? ICONS.lockCheck : ICONS.lock}</span>
      <span class="ext-text"><span class="ext-title">Show on Lock Screen</span><span class="ext-sub${native.lockError ? ' error' : ''}">${esc(sub)}</span></span>
      <span class="switch" aria-hidden="true"></span>
    </button>`;
}

async function toggleLock() {
  const { data, route } = page;
  if (!data || native.busy) return;
  const { showing, scheduled } = lockState(route.league, route.id);
  native.busy = true;
  native.lockError = '';
  render();
  let result;
  if (showing || scheduled) result = await removeFromLockScreen(route.league.id, route.id);
  else if (canShowOnLockScreen(data)) result = await showOnLockScreen(lockScreenCard(data, route.league, route.id));
  else result = await scheduleOnLockScreen(lockScreenCard(data, route.league, route.id));
  native.busy = false;
  if (!result?.ok) {
    native.lockError = showing || scheduled ? "Couldn't turn it off. Try again." : "Couldn't add it. Check that Live Activities are on for Phade Scores in Settings.";
  }
  native.info = await nativeInfo();
  render();
}

// LineSteam (linesteam.com) charts every FanDuel line move for its five
// leagues: its mark in a circle, top right of the matchup card. Opens
// outside the app.
function lineSteamHtml(league, id) {
  const url = lineSteamUrl(league, id);
  if (!url) return '';
  return `
    <a class="ls-badge" href="${esc(url)}" target="_blank" rel="noopener" aria-label="Line movement on LineSteam" title="Line movement on LineSteam">
      <span class="ls-circle"><img src="icons/linesteam-mark.png" alt="" width="24" height="21"></span>
    </a>`;
}

// The badge and clock above the score; the 5s check swaps just this in.
function statusHtml(game) {
  if (TROUBLE.test(game.statusName)) return `<span class="badge badge-warn">${esc(game.statusText)}</span>`;
  if (game.state === 'in') return `<span class="badge badge-live"><span class="live-dot" aria-hidden="true"></span>Live</span><span class="clock">${esc(game.statusText)}</span>`;
  if (game.state === 'post') return `<span class="badge">${esc(game.statusText || 'Final')}</span>`;
  return `<span class="clock">${esc(statusLabel({ ...game, timeTbd: false }, new Date()))}</span>`;
}

function matchupHtml(game, league, id) {
  const live = game.state === 'in';
  const done = game.state === 'post';
  const decided = done && game.teams.some((t) => t.winner);
  const side = (team) => `
    <a class="matchup-team${decided && !team.winner ? ' lost' : ''}" href="${teamHref(league.id, team.id)}">
      ${logoHtml(team, 56)}
      <span class="matchup-name">${esc(team.shortName || team.name)}${app.isFollowed(league.id, team.id) ? `<span class="star" title="Following">${ICONS.starSmall}</span>` : ''}</span>
      <span class="record">${esc(team.record)}</span>
    </a>`;
  const [a, b] = game.teams;
  const middle = game.state === 'pre'
    ? `<span class="matchup-vs">${league.homeFirst ? 'vs' : '@'}</span>`
    : `<span class="matchup-score"><span class="${decided && !a?.winner ? 'lost' : ''}">${esc(a?.score)}</span><span class="dash">-</span><span class="${decided && !b?.winner ? 'lost' : ''}">${esc(b?.score)}</span></span>`;
  const meta = [game.venue, game.broadcast, game.attendance && `Attendance ${game.attendance}`].filter(Boolean);
  return `
    <div class="card matchup${live ? ' live' : ''}">
      ${lineSteamHtml(league, id)}
      <div class="matchup-status">${statusHtml(game)}</div>
      <div class="matchup-teams">${a ? side(a) : ''}${middle}${b ? side(b) : ''}</div>
      ${meta.length ? `<div class="matchup-meta">${meta.map(esc).join(' · ')}</div>` : ''}
    </div>`;
}

function moneylinesHtml(game) {
  const prices = game.teams.map((t) => [t.abbr, game.odds.moneyline[t.id]]).filter(([, p]) => p);
  if (!prices.length) return '';
  return `<div class="game-odds"><span class="odd"><span class="odd-label">Moneyline</span>${prices.map(([abbr, p]) => `${esc(abbr)} ${esc(p)}`).join(' · ')}</span></div>`;
}

function lineScoreHtml(game) {
  const line = game.lineScore;
  if (!line) return '';
  const firstTotal = line.labels.findIndex((l) => l === 'T' || l === 'R');
  return section('Line score', `
    <div class="card"><div class="table-wrap">
      <table class="box-table line-score">
        <thead><tr><th class="col-name" scope="col"><span class="sr-only">Team</span></th>${line.labels.map((l, i) => `<th scope="col"${i >= firstTotal ? ' class="total"' : ''}>${esc(l)}</th>`).join('')}</tr></thead>
        <tbody>${game.teams.map((team, r) => `
          <tr${game.state === 'post' && game.teams.some((t) => t.winner) && !team.winner ? ' class="lost"' : ''}>
            <th scope="row" class="col-name"><span class="team-cell">${logoHtml(team, 20)}<span>${esc(team.abbr)}</span></span></th>
            ${line.rows[r].map((v, i) => `<td${i >= firstTotal ? ' class="total"' : ''}>${esc(v)}</td>`).join('')}
          </tr>`).join('')}
        </tbody>
      </table>
    </div></div>`);
}

function scoringHtml(game, league) {
  if (!game.scoring.length) return '';
  const soccer = league.homeFirst;
  return section(soccer ? 'Goals and red cards' : 'Scoring', `
    <div class="card list-card">${game.scoring.map((p) => `
      <div class="play">
        <span class="play-when">${p.period ? `<span>${esc(p.period)}</span>` : ''}<span>${esc(p.clock)}</span></span>
        <span class="play-team">${esc(p.team)}</span>
        <span class="play-text">${p.kind === 'goal' ? `<span class="play-icon">${ICONS.ball}</span>` : p.kind === 'red' ? `<span class="play-icon red">${ICONS.redCard}</span>` : ''}${esc(p.text)}</span>
        ${p.score ? `<span class="play-score">${esc(p.score)}</span>` : ''}
      </div>`).join('')}
    </div>`);
}

function playersHtml(game) {
  if (!game.players.length) return '';
  const teams = game.players.map((p) => game.teams.find((t) => t.id === p.teamId)).filter(Boolean);
  const side = Math.min(page.side, game.players.length - 1);
  const switcher = teams.length > 1 ? `
    <div class="segmented box-switch" role="tablist" aria-label="Team">
      ${teams.map((t, i) => `<button role="tab" data-side="${i}" aria-selected="${i === side}">${logoHtml(t, 20)}${esc(t.shortName || t.abbr)}</button>`).join('')}
    </div>` : '';
  // Football has up to ten groups; the first three (passing, rushing,
  // receiving) are what most people look for, so the rest start folded.
  return section('Box score', switcher + game.players[side].groups.map((g, i) => groupHtml(g, i < 3)).join(''));
}

function groupHtml(group, open = true) {
  const starters = group.rows.some((r) => r.starter) && group.rows.some((r) => !r.starter);
  let benchShown = false;
  const rows = group.rows.map((row) => {
    let divider = '';
    if (starters && !row.starter && !benchShown) {
      benchShown = true;
      const rest = { Pitching: 'Bullpen', Batting: 'Substitutes' }[group.title] ?? 'Bench';
      divider = `<tr class="divider-row"><th scope="rowgroup" colspan="${group.labels.length + 1}">${rest}</th></tr>`;
    }
    return `${divider}<tr>
      <th scope="row" class="col-name"><span class="player">${esc(row.name)}</span>${row.position ? `<span class="pos-tag">${esc(row.position)}</span>` : ''}</th>
      ${row.stats.map((v) => `<td>${esc(v)}</td>`).join('')}
    </tr>`;
  }).join('');
  const table = `
    <div class="card"><div class="table-wrap">
      <table class="box-table">
        <thead><tr><th class="col-name" scope="col">${starters ? 'Starters' : 'Player'}</th>${group.labels.map((l) => `<th scope="col">${esc(l)}</th>`).join('')}</tr></thead>
        <tbody>${rows}</tbody>
        ${group.totals ? `<tfoot><tr><th scope="row" class="col-name">Team</th>${group.totals.map((v) => `<td>${esc(v)}</td>`).join('')}</tr></tfoot>` : ''}
      </table>
    </div></div>
    ${group.didNotPlay.length ? `<p class="dnp">Did not play: ${esc(group.didNotPlay.join(', '))}</p>` : ''}`;
  if (!group.title) return table;
  return `<details class="box-group"${open ? ' open' : ''}><summary class="box-title">${esc(group.title)}</summary>${table}</details>`;
}

function teamStatsHtml(game) {
  if (!game.teamStats.length) return '';
  const [a, b] = game.teams;
  return section('Team stats', `
    <div class="card list-card team-stats">
      <div class="stat-row stat-head">
        <span>${logoHtml(a, 20)}${esc(a.abbr)}</span><span></span><span>${esc(b.abbr)}${logoHtml(b, 20)}</span>
      </div>
      ${game.teamStats.map((s) => `
        <div class="stat-row">
          <span>${esc(s.values[0])}</span>
          <span class="stat-label">${esc(s.label)}</span>
          <span>${esc(s.values[1])}</span>
        </div>`).join('')}
    </div>`);
}

const section = (heading, body, cls = '') => `<section class="group"><h2 class="group-title ${cls}">${esc(heading)}</h2>${body}</section>`;

// ---- Team page ----

function teamHtml(data, league) {
  const { team, games } = data;
  const following = app.isFollowed(league.id, team.id);
  const subtitle = [team.record, team.standing].filter(Boolean).join(' · ');
  const head = `
    <div class="card team-head">
      ${logoHtml(team, 72)}
      <h2>${esc(team.name)}</h2>
      ${subtitle ? `<p class="sub">${esc(subtitle)}</p>` : ''}
      <p class="sub">${esc(league.label)}${data.season ? ` · ${esc(data.season)}` : ''}</p>
      <div class="team-actions">
        <button class="pill-btn follow-btn${following ? ' on' : ''}" data-follow aria-pressed="${following}">
          ${following ? `${ICONS.check} Following` : `${ICONS.plus} Follow`}
        </button>
        ${alertsButton(league, team, following)}
      </div>
      ${following && native.alertsOpen ? alertsPanel(league, team) : ''}
      ${native.alertNote ? `<p class="sub alert-note">${esc(native.alertNote)}</p>` : ''}
    </div>`;
  if (!games.length) {
    return head + emptyState({ icon: ICONS.calendar, title: 'No games listed', text: `ESPN has no ${league.label} schedule for this team right now.` });
  }
  const live = games.filter((g) => g.state === 'in');
  const upcoming = games.filter((g) => g.state === 'pre');
  const results = games.filter((g) => g.state === 'post').reverse();
  const list = (heading, items, cls = '') => (items.length ? section(heading, `<div class="card list-card">${items.map((g) => scheduleRow(g, league)).join('')}</div>`, cls) : '');
  return head + list('Live', live, 'in') + list('Upcoming', upcoming, 'pre') + list('Results', results);
}

// iPhone app only: per followed team, alerts when its games start, when
// either side scores and when they end. The bell opens the three switches.
function alertsButton(league, team, following) {
  if (!inApp() || !following) return '';
  const on = Object.values(app.alertsFor(league.id, team.id)).some(Boolean);
  return `
    <button class="pill-btn alert-btn${on ? ' on' : ''}" data-alerts aria-expanded="${native.alertsOpen}">
      ${on ? ICONS.bell : ICONS.bellOff} ${on ? 'Alerts on' : 'Alerts'}
    </button>`;
}

function alertsPanel(league, team) {
  const on = app.alertsFor(league.id, team.id);
  const basketball = league.path.startsWith('basketball/');
  const rows = [
    ['start', 'Game starts', 'When a game gets underway'],
    ['score', 'Scores', basketball ? 'The score at the end of each quarter or half' : 'Every time either team scores'],
    ['end', 'Final score', 'When a game ends'],
  ];
  return `
    <div class="alert-panel" role="group" aria-label="${esc(team.name)} alerts">
      ${rows.map(([kind, title, sub]) => `
        <button class="alert-row" role="switch" aria-checked="${on[kind]}" data-alert-kind="${kind}">
          <span class="alert-text"><span class="alert-title">${title}</span><span class="alert-sub">${sub}</span></span>
          <span class="switch" aria-hidden="true"></span>
        </button>`).join('')}
    </div>`;
}

async function toggleAlertKind(kind) {
  const { data, route } = page;
  if (!data?.team) return;
  const on = !app.alertsFor(route.league.id, data.team.id)[kind];
  if (on) {
    const status = await enableAlerts();
    if (!['authorized', 'provisional', 'ephemeral'].includes(status)) {
      native.alertNote = 'Notifications are off for Phade Scores. Turn them on in Settings, then try again.';
      render();
      return;
    }
  }
  native.alertNote = '';
  app.setAlerts(route.league.id, data.team.id, { [kind]: on });
  render();
}

function scheduleRow(game, league) {
  const date = game.start;
  const day = date.toLocaleDateString(undefined, { weekday: 'short' });
  const md = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  let right;
  if (TROUBLE.test(game.statusName)) right = `<span class="badge badge-warn">${esc(game.statusText)}</span>`;
  else if (game.state === 'in') right = `<span class="badge badge-live"><span class="live-dot" aria-hidden="true"></span>${esc(game.score || 'Live')}</span>`;
  else if (game.result) right = `<span class="result ${game.result.toLowerCase()}">${game.result}</span><span class="result-score">${esc(game.score)}</span>`;
  else if (game.state === 'post') right = `<span class="sub">${esc(game.statusText)}</span>`;
  else {
    const time = game.timeTbd ? 'TBD' : date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    right = `<span class="sched-time">${esc(time)}${game.broadcast ? `<small>${esc(game.broadcast.split(', ')[0])}</small>` : ''}</span>`;
  }
  return `
    <a class="sched-row" href="${gameHref(league.id, game.id)}">
      <span class="sched-date"><span>${esc(day)}</span><span>${esc(md)}</span></span>
      <span class="sched-vs">${game.home ? 'vs' : '@'}</span>
      ${logoHtml(game.opponent, 24)}
      <span class="name">${esc(game.opponent.name)}</span>
      ${league.weekly && game.label ? `<span class="sched-label">${esc(game.label)}</span>` : ''}
      <span class="sched-right">${right}</span>
    </a>`;
}

// ---- Events ----

document.addEventListener('click', (event) => {
  if (!page.route) return;
  const target = event.target.closest('[data-side], [data-follow], [data-lock], [data-alerts], [data-alert-kind]');
  if (!target || !root().contains(target) || target.disabled) return;
  if (target.hasAttribute('data-lock')) toggleLock();
  else if (target.dataset.alertKind) toggleAlertKind(target.dataset.alertKind);
  else if (target.hasAttribute('data-alerts')) {
    native.alertsOpen = !native.alertsOpen;
    render();
  }
  else if (target.dataset.side !== undefined) {
    page.side = Number(target.dataset.side);
    render();
  } else if (target.hasAttribute('data-follow') && page.data?.team) {
    const { team } = page.data;
    app.toggleFollow(page.route.league.id, team);
    render();
  }
});
