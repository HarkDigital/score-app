// What the push server decides, kept pure so it can be tested: the lock-screen
// card's content for a game, whether a change is worth a push, the alerts a
// game's change of state sends, and request validation. index.js and
// watcher.js do the I/O.

import { leagueById } from '../espn.js';

// Statuses that mean the game won't go ahead as scheduled (ui.js's TROUBLE).
export const TROUBLE = /POSTPONED|CANCELED|CANCELLED|SUSPENDED|DELAYED|FORFEIT|ABANDONED/;

// parseGame lists away then home (soccer: home then away).
export function sides(game, league) {
  const [first, second] = game.teams;
  return league.homeFirst ? { home: first, away: second } : { away: first, home: second };
}

// The card's ContentState (GameAttributes.ContentState in the iPhone app; the
// keys must match). A normal pre-game status is left empty: the card shows the
// start time in the phone's own time zone instead.
export function contentState(game, league) {
  const { away, home } = sides(game, league);
  const scheduled = game.state === 'pre' && game.statusName === 'STATUS_SCHEDULED';
  return {
    away: away?.score ?? '',
    home: home?.score ?? '',
    state: game.state,
    status: scheduled ? '' : game.statusText,
    detail: game.detail ?? '',
  };
}

// null when nothing changed. Score and state changes go out at priority 10;
// a clock or down-and-distance change only at 5, which Apple doesn't budget.
export function activityPlan(last, next) {
  const end = next.state === 'post';
  if (!last) return { priority: 10, end };
  const same = (k) => last[k] === next[k];
  if (['away', 'home', 'state', 'status', 'detail'].every(same)) return null;
  const big = !same('away') || !same('home') || !same('state');
  return { priority: big ? 10 : 5, end };
}

const HOUR = 3600;

export function activityPayload(state, plan, nowSec) {
  const aps = {
    timestamp: nowSec,
    event: plan.end ? 'end' : 'update',
    'content-state': state,
  };
  if (plan.end) aps['dismissal-date'] = nowSec + 2 * HOUR;
  // Greyed out if the server goes quiet mid-game.
  else if (state.state === 'in') aps['stale-date'] = nowSec + 15 * 60;
  return { aps };
}

// The alert a game's change of state sends to people following either team,
// or null. Only a change the server saw happen counts, so a restart or a new
// follower never gets a late "starting now".
export function alertKind(prev, game) {
  if (!prev || prev === game.state) return null;
  if (game.state === 'in' && prev === 'pre') return 'start';
  if (game.state === 'post') return TROUBLE.test(game.statusName) ? 'off' : 'final';
  return null;
}

export function alertPayload(kind, game, league) {
  const { away, home } = sides(game, league);
  const title = league.homeFirst ? `${home.name} vs ${away.name}` : `${away.name} @ ${home.name}`;
  // Soccer reads home first, everything else away first.
  const [a, b] = league.homeFirst ? [home, away] : [away, home];
  let body;
  if (kind === 'start') body = 'Starting now.';
  else if (kind === 'off') body = game.statusText || 'Postponed.';
  else body = `${game.statusText || 'Final'}: ${a.name} ${a.score}, ${b.name} ${b.score}`;
  return {
    aps: { alert: { title, body }, sound: 'default', 'thread-id': `${league.id}-${game.id}` },
    route: `#/game/${league.id}/${game.id}`,
  };
}

// Followed teams in a league whose game this is.
export function followsGame(device, leagueId, game) {
  const ids = new Set(game.teams.map((t) => String(t.id)));
  return device.teams.some((t) => t.league === leagueId && ids.has(t.id));
}

// ---- Requests ----

const TOKEN = /^[0-9a-f]{32,512}$/i;
const EVENT = /^\d{1,14}$/;
const TEAM = /^[\w-]{1,20}$/;
const ENVS = new Set(['production', 'sandbox']);

export const validToken = (token) => typeof token === 'string' && TOKEN.test(token);

export function parseActivity(body) {
  const { token, env, league, eventId, start } = body ?? {};
  if (!validToken(token) || !ENVS.has(env) || !leagueById(league) || !EVENT.test(String(eventId ?? ''))) return null;
  const startSec = Number(start);
  return {
    token: token.toLowerCase(),
    env,
    league,
    eventId: String(eventId),
    start: Number.isFinite(startSec) && startSec > 0 ? startSec : null,
  };
}

export function parseDevice(body) {
  const { env, teams } = body ?? {};
  if (!ENVS.has(env) || !Array.isArray(teams) || teams.length > 200) return null;
  const list = [];
  for (const t of teams) {
    if (!leagueById(t?.league) || !TEAM.test(String(t?.id ?? ''))) return null;
    list.push({ league: t.league, id: String(t.id) });
  }
  return { env, teams: list };
}
