// Home Screen and Lock Screen widgets (the iPhone app's WidgetKit
// extension): for each team asked for, the game on now, its last result and
// its next game, in a few hundred bytes. Built here with the app's own
// parsers (details.js parseSchedule, espn.js parseScoreboard), so the widget
// never downloads or reads ESPN's big feeds itself.
//
//   GET /v1/widget?teams=nhl:4,nfl:21

import { leagueById, dayUrls, parseScoreboard } from '../espn.js';
import { scheduleUrls, parseSchedule } from '../details.js';
import { scoreDays } from './watcher.js';

const MIN = 60_000;
const HOUR = 60 * MIN;

export const WIDGET_TEAMS_MAX = 12;
// The schedule lags and carries no live scores; today's scoreboard fills in
// the game on now, and is fresh to the second at ESPN.
const SCHEDULE_TTL = 10 * MIN;
const BOARD_TTL = 20_000;
// A final shows until the morning after an evening game, or until two hours
// before the next game, whichever comes first.
const FINAL_SHOWN = 15 * 3600;
const NEXT_LEAD = 2 * 3600;
// A game still "pre" this long after its start time is stale, not next.
const STALE_PRE = 12 * 3600;

const TEAM = /^[\w-]{1,20}$/;
const NOT_PLAYED = /POSTPONED|CANCELED|CANCELLED/;

// "nhl:4,nfl:21" → [{league, id}]: known leagues, no repeats, at most 12.
export function parseWidgetTeams(param) {
  const seen = new Set();
  const teams = [];
  for (const part of String(param ?? '').split(',')) {
    const [league, id, extra] = part.trim().split(':');
    const key = `${league}:${id}`;
    if (extra !== undefined || !leagueById(league) || !TEAM.test(id ?? '') || seen.has(key)) continue;
    seen.add(key);
    teams.push({ league, id });
  }
  return teams.slice(0, WIDGET_TEAMS_MAX);
}

// One game from the team's side: the schedule's entry, brought up to date
// from the scoreboard's when there is one (state, clock, scores).
function widgetGame(game, board, teamId) {
  const self = board?.teams.find((t) => String(t.id) === teamId);
  const opponent = board?.teams.find((t) => t !== self);
  const current = self && opponent ? board : null;
  const state = current?.state ?? game.state;
  const final = state === 'post' && !NOT_PLAYED.test(current?.statusName ?? game.statusName);
  const score = current ? self.score : game.teamScore ?? '';
  const oppScore = current ? opponent.score : game.opponent.score ?? '';
  let result = '';
  if (final && score !== '' && oppScore !== '') {
    if (current) result = self.winner ? 'W' : opponent.winner ? 'L' : 'T';
    else result = game.result;
  }
  return {
    id: game.id,
    start: Math.round((current?.start ?? game.start).getTime() / 1000),
    timeTbd: Boolean(game.timeTbd),
    state,
    final,
    status: current?.statusText ?? game.statusText,
    home: game.home,
    score: state === 'pre' ? '' : score,
    oppScore: state === 'pre' ? '' : oppScore,
    result,
    opponent: {
      id: String(game.opponent.id ?? ''),
      abbr: game.opponent.abbr ?? '',
      name: game.opponent.name ?? '',
      logo: game.opponent.logo ?? '',
      color: game.opponent.color ?? null,
      record: game.opponent.record ?? '',
    },
    broadcast: game.broadcast ?? '',
  };
}

// Which game the widget shows now, and until when (seconds since 1970; null
// for as long as nothing changes): the game on, else the last result for a
// while, else the next game.
export function pickShow(live, last, next, nowSec) {
  if (live) return { show: 'live', showUntil: null };
  if (last) {
    const until = Math.min(last.start + FINAL_SHOWN, next ? next.start - NEXT_LEAD : Infinity);
    if (nowSec < until) return { show: 'last', showUntil: until };
  }
  if (next) return { show: 'next', showUntil: null };
  // The season's over: its last result.
  return { show: last ? 'last' : null, showUntil: null };
}

// A team's widget data from its parsed schedule (details.js parseSchedule)
// and the scoreboard games around now, by id.
export function widgetTeam(schedule, board, league, nowMs) {
  const nowSec = Math.floor(nowMs / 1000);
  const teamId = schedule.team.id;
  const games = schedule.games.map((g) => widgetGame(g, board.get(g.id), teamId));
  const live = games.find((g) => g.state === 'in') ?? null;
  const last = games.filter((g) => g.final).at(-1) ?? null;
  const next = games.find((g) => g.state === 'pre' && g.start > nowSec - STALE_PRE) ?? null;
  const { team } = schedule;
  return {
    league: league.id,
    id: teamId,
    name: team.name,
    shortName: team.shortName,
    abbr: team.abbr,
    logo: team.logo,
    color: team.color,
    record: team.record,
    standing: team.standing,
    // Soccer lists the home side first.
    homeFirst: Boolean(league.homeFirst),
    ...pickShow(live, last, next, nowSec),
    live,
    last,
    next,
  };
}

// Fetches through a small cache, so many widgets asking about the same teams
// cost ESPN one schedule download per team every 10 minutes and one
// scoreboard per league every 20 seconds.
export function createWidgetSource({ fetchJson, now = () => Date.now(), log = () => {} }) {
  const cache = new Map();

  function cached(url, ttl) {
    const hit = cache.get(url);
    if (hit && now() - hit.at < ttl) return hit.value;
    const value = fetchJson(url);
    cache.set(url, { at: now(), value });
    // A failure isn't kept: the next widget asks again.
    value.catch(() => { if (cache.get(url)?.value === value) cache.delete(url); });
    if (cache.size > 500) for (const [key, entry] of cache) if (now() - entry.at > HOUR) cache.delete(key);
    return value;
  }

  async function board(league) {
    const games = new Map();
    for (const day of scoreDays(now(), [])) {
      for (const url of dayUrls(league, day)) {
        try {
          for (const g of parseScoreboard(await cached(url, BOARD_TTL), league).games) if (!games.has(g.id)) games.set(g.id, g);
        } catch (err) {
          log(`widget board ${league.id}: ${err.message}`);
        }
      }
    }
    return games;
  }

  async function team({ league: leagueId, id }, boards) {
    const league = leagueById(leagueId);
    const results = await Promise.allSettled(scheduleUrls(league, id).map((url) => cached(url, SCHEDULE_TTL)));
    const responses = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
    if (!responses.length) return { league: leagueId, id, error: 'unavailable' };
    if (!boards.has(leagueId)) boards.set(leagueId, board(league));
    return widgetTeam(parseSchedule(responses, league, id), await boards.get(leagueId), league, now());
  }

  return {
    async teams(list) {
      // One scoreboard read per league for the whole request.
      const boards = new Map();
      return { updatedAt: Math.floor(now() / 1000), teams: await Promise.all(list.map((t) => team(t, boards))) };
    },
  };
}
