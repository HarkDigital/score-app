// The game page (box score) and the team page (schedule). They open over the
// scoreboard from links like #/game/nfl/401547417 and #/team/nfl/12, so the
// back button, swipe-back and shared links all work.

import { leagueById, statusLabel, lineSteamUrl } from './espn.js';
import { summaryUrl, scheduleUrls, parseSummary, parseSchedule, lockScreenCard, canShowOnLockScreen } from './details.js';
import { ICONS, getJson, TROUBLE, oddsHtml, logoHtml, emptyState, errorState, formatClock, esc } from './ui.js';
import { inApp, nativeInfo, showOnLockScreen, removeFromLockScreen, enableAlerts } from './native.js';

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
  requestId: 0,
};
const root = () => document.getElementById('page');

// iPhone app only: what the app says about Live Activities and alerts, and
// the state of the game page's Lock Screen card and the team page's bell.
const native = { info: null, busy: false, lockError: '', alertNote: '' };

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
  Object.assign(native, { lockError: '', alertNote: '' });
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
  if (!visible) clearTimeout(page.timer);
  else if (stale()) load();
  else schedule();
  // The card may have been swiped off the Lock Screen meanwhile.
  if (visible) refreshNative();
}

async function load() {
  clearTimeout(page.timer);
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

// A summary can be over a megabyte, so a live box score refreshes every 30s
// rather than the scoreboard's 15s.
function schedule() {
  clearTimeout(page.timer);
  if (document.hidden || !page.route) return;
  const { data, route } = page;
  let delay = null;
  if (page.error) delay = 30_000;
  else if (route.kind === 'game' && data?.state === 'in') delay = 30_000;
  else if (route.kind === 'team' && data?.games.some((g) => g.state === 'in')) delay = 60_000;
  if (delay) page.timer = setTimeout(load, delay);
}

function render() {
  const { route, data, error } = page;
  if (!route) return;
  app.setTitle(data ? title(route, data) : '');
  let html;
  if (!data) html = error ? errorState() : loadingHtml(route.kind);
  else html = route.kind === 'game' ? gameHtml(data, route.league, route.id) : teamHtml(data, route.league);
  const updated = data && page.updatedAt
    ? `<p class="status${error ? ' error' : ''}">${error ? `Couldn't reach ESPN. Showing data from ${esc(formatClock(page.updatedAt))}.` : `Updated ${esc(formatClock(page.updatedAt))}${route.kind === 'game' && data.state === 'in' ? ' · refreshing every 30s' : ''}`}</p>`
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
    matchupHtml(game, league),
    odds,
    lineScoreHtml(game),
    scoringHtml(game, league),
    playersHtml(game),
    teamStatsHtml(game),
  ].filter(Boolean);
  if (game.state === 'pre' && sections.length <= 2) {
    sections.push(emptyState({ icon: ICONS.clipboard, title: 'Box score at kickoff', text: 'Player and team stats show up here once the game starts.' }));
  }
  // The line history sits under the lines (or the matchup once they're gone).
  sections.splice(odds ? 2 : 1, 0, lineSteamHtml(league, id));
  sections.splice(1, 0, lockHtml(game, league, id));
  return sections.join('');
}

// iPhone app only: put this game's live score on the Lock Screen and in the
// Dynamic Island (one game at a time; the push server keeps it current).
function onLockScreen(league, id) {
  const current = native.info?.current;
  return current?.league === league.id && current?.eventId === String(id);
}

function lockHtml(game, league, id) {
  if (!native.info?.liveActivities) return '';
  const on = onLockScreen(league, id);
  if (!on && !canShowOnLockScreen(game)) return '';
  const sub = native.lockError
    || (on ? 'Live score on your Lock Screen and in the Dynamic Island. Tap to remove.' : 'Keep the live score on your Lock Screen and in the Dynamic Island.');
  return `
    <button class="card ext-link lock-card${on ? ' on' : ''}" data-lock aria-pressed="${on}"${native.busy ? ' disabled' : ''}>
      <span class="ext-icon">${on ? ICONS.lockCheck : ICONS.lock}</span>
      <span class="ext-text"><span class="ext-title">${on ? 'On your Lock Screen' : 'Show on Lock Screen'}</span><span class="ext-sub${native.lockError ? ' error' : ''}">${esc(sub)}</span></span>
    </button>`;
}

async function toggleLock() {
  const { data, route } = page;
  if (!data || native.busy) return;
  const on = onLockScreen(route.league, route.id);
  native.busy = true;
  native.lockError = '';
  render();
  const result = on ? await removeFromLockScreen() : await showOnLockScreen(lockScreenCard(data, route.league, route.id));
  native.busy = false;
  if (!result?.ok) {
    native.lockError = on ? "Couldn't remove it. Try again." : "Couldn't add it. Check that Live Activities are on for Phade Scores in Settings.";
  }
  native.info = await nativeInfo();
  render();
}

// LineSteam (linesteam.com) charts every FanDuel line move for its five
// leagues. Opens outside the app.
function lineSteamHtml(league, id) {
  const url = lineSteamUrl(league, id);
  if (!url) return '';
  return `
    <a class="card ext-link" href="${esc(url)}" target="_blank" rel="noopener">
      <span class="ext-icon">${ICONS.chart}</span>
      <span class="ext-text"><span class="ext-title">Line movement</span><span class="ext-sub">FanDuel's spread, total and moneyline history on LineSteam</span></span>
      <span class="ext-arrow">${ICONS.external}</span>
    </a>`;
}

function matchupHtml(game, league) {
  const live = game.state === 'in';
  const done = game.state === 'post';
  let status;
  if (TROUBLE.test(game.statusName)) status = `<span class="badge badge-warn">${esc(game.statusText)}</span>`;
  else if (live) status = `<span class="badge badge-live"><span class="live-dot" aria-hidden="true"></span>Live</span><span class="clock">${esc(game.statusText)}</span>`;
  else if (done) status = `<span class="badge">${esc(game.statusText || 'Final')}</span>`;
  else status = `<span class="clock">${esc(statusLabel({ ...game, timeTbd: false }, new Date()))}</span>`;
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
      <div class="matchup-status">${status}</div>
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
        ${alertsHtml(league, team, following)}
      </div>
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

// iPhone app only: alerts when this followed team's games start and end.
function alertsHtml(league, team, following) {
  if (!inApp() || !following) return '';
  const on = app.hasAlerts(league.id, team.id);
  return `
    <button class="pill-btn alert-btn${on ? ' on' : ''}" data-alerts aria-pressed="${on}" aria-label="Game alerts">
      ${on ? ICONS.bell : ICONS.bellOff} ${on ? 'Alerts on' : 'Alerts off'}
    </button>`;
}

async function toggleAlerts() {
  const { data, route } = page;
  if (!data?.team) return;
  const on = !app.hasAlerts(route.league.id, data.team.id);
  if (on) {
    const status = await enableAlerts();
    if (!['authorized', 'provisional', 'ephemeral'].includes(status)) {
      native.alertNote = 'Notifications are off for Phade Scores. Turn them on in Settings, then try again.';
      render();
      return;
    }
  }
  native.alertNote = '';
  app.setAlerts(route.league.id, data.team.id, on);
  render();
}

function scheduleRow(game, league) {
  const date = game.start;
  const day = date.toLocaleDateString(undefined, { weekday: 'short' });
  const md = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  let right;
  if (TROUBLE.test(game.statusName)) right = `<span class="badge badge-warn">${esc(game.statusText)}</span>`;
  else if (game.state === 'in') right = `<span class="badge badge-live"><span class="live-dot" aria-hidden="true"></span>${esc(game.score)}</span>`;
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
  const target = event.target.closest('[data-side], [data-follow], [data-lock], [data-alerts]');
  if (!target || !root().contains(target) || target.disabled) return;
  if (target.hasAttribute('data-lock')) toggleLock();
  else if (target.hasAttribute('data-alerts')) toggleAlerts();
  else if (target.dataset.side !== undefined) {
    page.side = Number(target.dataset.side);
    render();
  } else if (target.hasAttribute('data-follow') && page.data?.team) {
    const { team } = page.data;
    app.toggleFollow(page.route.league.id, team);
    render();
  }
});
