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

// What the server remembers of a game between polls, to see what changed.
export function gameMemo(game, league, now) {
  const { away, home } = sides(game, league);
  return { state: game.state, statusName: game.statusName, away: away?.score ?? '', home: home?.score ?? '', at: now };
}

// Basketball scores every few seconds, so its "score" alert is the score at
// each break (end of a quarter or half) instead of every basket.
const BREAKS = new Set(['STATUS_END_PERIOD', 'STATUS_HALFTIME']);
const isBasketball = (league) => league.path.startsWith('basketball/');

// The alerts a game's change sends, from what the server saw last time (null
// the first time: first sight is never a change, so a restart or a new
// follower never gets a late "starting now"). Each is { kind, payload }, and
// kind is the follower's switch it answers to: start, score or end.
export function gameAlerts(prev, game, league) {
  if (!prev) return [];
  const alerts = [];
  const say = (kind, body) => alerts.push({ kind, payload: alertPayload(game, league, body) });
  const { away, home } = sides(game, league);
  // Soccer reads home first, everything else away first.
  const [a, b] = league.homeFirst ? [home, away] : [away, home];
  const line = `${a.name} ${a.score}, ${b.name} ${b.score}`;

  if (game.state === 'in' && prev.state === 'pre') say('start', 'Starting now.');
  if (game.state === 'post' && prev.state !== 'post') {
    if (TROUBLE.test(game.statusName)) say('end', game.statusText || 'Postponed.');
    else say('end', `${game.statusText || 'Final'}: ${line}`);
  }
  if (game.state === 'in' && prev.state === 'in') {
    if (isBasketball(league)) {
      if (BREAKS.has(game.statusName) && prev.statusName !== game.statusName) say('score', `${game.statusText}: ${line}`);
    } else {
      const up = (side, was) => Number(side?.score) > Number(was);
      const awayUp = up(away, prev.away);
      const homeUp = up(home, prev.home);
      if (awayUp !== homeUp) {
        const scorer = awayUp ? away : home;
        const goal = league.path.startsWith('soccer/') || league.path.startsWith('hockey/');
        say('score', `${scorer.name} ${goal ? 'goal' : 'score'}: ${line}`);
      } else if (awayUp && homeUp) {
        say('score', `Score update: ${line}`);
      }
    }
  }
  return alerts;
}

function alertPayload(game, league, body) {
  const { away, home } = sides(game, league);
  const title = league.homeFirst ? `${home.name} vs ${away.name}` : `${away.name} @ ${home.name}`;
  return {
    aps: { alert: { title, body }, sound: 'default', 'thread-id': `${league.id}-${game.id}` },
    route: `#/game/${league.id}/${game.id}`,
  };
}

// Whether a device follows a team in this game with this alert switched on.
// Teams stored before the switches existed mean starts and finals.
export function wantsAlert(device, leagueId, game, kind) {
  const ids = new Set(game.teams.map((t) => String(t.id)));
  const on = (t) => (['start', 'score', 'end'].some((k) => k in t) ? t[kind] === true : kind !== 'score');
  return device.teams.some((t) => t.league === leagueId && ids.has(t.id) && on(t));
}

// Whether a device follows a team in this game at all (for polling).
export function followsGame(device, leagueId, game) {
  const ids = new Set(game.teams.map((t) => String(t.id)));
  return device.teams.some((t) => t.league === leagueId && ids.has(t.id));
}

// ---- Scheduled cards ----

// A card for a later game is started by the server with Apple's
// push-to-start, this long before the game (the web app's
// LOCK_LEAD_MINUTES; iOS ends a card after 8 hours anyway).
export const SCHEDULE_LEAD = 15 * 60;

// ActivityKit decodes a Date from JSON as seconds since 2001-01-01.
const APPLE_EPOCH = 978_307_200;

export function startDue(game, nowSec) {
  if (game.state === 'in') return true;
  if (game.state !== 'pre' || game.statusName !== 'STATUS_SCHEDULED') return false;
  return game.start.getTime() / 1000 - nowSec <= SCHEDULE_LEAD;
}

// The push-to-start payload: the card's attributes (GameAttributes; the
// start comes from the scoreboard, in case the time moved) and its first
// state, with a quiet banner saying it's there.
export function startPayload(card, game, league, nowSec) {
  const { away, home } = card;
  const title = card.homeFirst ? `${home.name} vs ${away.name}` : `${away.name} @ ${home.name}`;
  const aps = {
    timestamp: nowSec,
    event: 'start',
    'content-state': contentState(game, league),
    'attributes-type': 'GameAttributes',
    attributes: { ...card, start: Math.round(game.start.getTime() / 1000) - APPLE_EPOCH },
    alert: { title, body: game.state === 'in' ? 'Live now on your Lock Screen.' : 'Starting soon. The score is on your Lock Screen.' },
  };
  if (game.state === 'in') aps['stale-date'] = nowSec + 15 * 60;
  return { aps };
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

const HEX = /^#[0-9a-f]{6}$/i;
const text = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max;

// ESPN's logo CDN only; anything else is dropped (the card shows the badge).
const LOGO = /^https:\/\/a\.espncdn\.com\/[\w./-]{1,240}$/;

function parseCardTeam(t) {
  if (!t || !text(t.abbr, 12) || !text(t.name, 60) || (t.color != null && !HEX.test(t.color))) return null;
  return { abbr: t.abbr, name: t.name, color: t.color ?? null, logo: LOGO.test(t.logo ?? '') ? t.logo : null };
}

// POST /v1/scheduled: {token (push-to-start), env, card (details.js lockScreenCard)}.
export function parseScheduled(body) {
  const { token, env, card } = body ?? {};
  if (!validToken(token) || !ENVS.has(env) || !card || typeof card !== 'object') return null;
  const league = leagueById(card.league);
  const start = Number(card.start);
  const away = parseCardTeam(card.away);
  const home = parseCardTeam(card.home);
  if (!league || !EVENT.test(String(card.eventId ?? '')) || !Number.isFinite(start) || start <= 0
    || !text(card.leagueLabel, 40) || !away || !home) return null;
  const eventId = String(card.eventId);
  return {
    token: token.toLowerCase(),
    env,
    league: league.id,
    eventId,
    start,
    card: { league: league.id, leagueLabel: card.leagueLabel, eventId, start, homeFirst: card.homeFirst === true, away, home },
  };
}

export function parseDevice(body) {
  const { env, teams } = body ?? {};
  if (!ENVS.has(env) || !Array.isArray(teams) || teams.length > 200) return null;
  const list = [];
  for (const t of teams) {
    if (!leagueById(t?.league) || !TEAM.test(String(t?.id ?? ''))) return null;
    // A team without switches comes from an early build: starts and finals.
    const legacy = !['start', 'score', 'end'].some((k) => k in t);
    list.push({
      league: t.league,
      id: String(t.id),
      start: legacy || t.start === true,
      score: !legacy && t.score === true,
      end: legacy || t.end === true,
    });
  }
  return { env, teams: list.filter((t) => t.start || t.score || t.end) };
}
