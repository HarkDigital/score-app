// The teams someone follows, kept on this device. Storage is passed in so the
// logic can be tested without a browser; it may be null (private mode etc.).

import { LEAGUES } from './espn.js';

const KEY = 'scores.myTeams';

export function loadFollowed(storage) {
  try {
    const list = JSON.parse(storage?.getItem(KEY) ?? '[]');
    return Array.isArray(list) ? list.filter((t) => t && t.league && t.id) : [];
  } catch {
    return [];
  }
}

export function saveFollowed(storage, list) {
  try { storage?.setItem(KEY, JSON.stringify(list)); } catch { /* full or blocked */ }
}

export function isFollowed(list, leagueId, teamId) {
  return list.some((t) => t.league === leagueId && t.id === String(teamId));
}

// Only what's needed to draw the team again without refetching it.
export function toggleFollowed(list, leagueId, team) {
  const id = String(team.id);
  if (isFollowed(list, leagueId, id)) return list.filter((t) => !(t.league === leagueId && t.id === id));
  const { name = '', abbr = '', logo = '', color = null } = team;
  return [...list, { league: leagueId, id, name, abbr, logo, color }];
}

// Team alerts are per followed team, sent by the iPhone app's push server:
// when a game starts, when either side scores (basketball: the score at
// each break) and the final. Unfollowing a team drops its alerts with it.
// start, score, end: notifications. lock: every game on the Lock Screen,
// put up by the push server 15 minutes before it starts.
export const ALERT_KINDS = ['start', 'score', 'end', 'lock', 'news'];
const NO_ALERTS = { start: false, score: false, end: false, lock: false, news: false };

export function alertsFor(list, leagueId, teamId) {
  const team = list.find((t) => t.league === leagueId && t.id === String(teamId));
  const a = team?.alerts;
  // Early builds stored a plain true for "starts and finals".
  if (a === true) return { ...NO_ALERTS, start: true, end: true };
  return { ...NO_ALERTS, ...(a && typeof a === 'object' ? a : {}) };
}

export function hasAlerts(list, leagueId, teamId) {
  return Object.values(alertsFor(list, leagueId, teamId)).some(Boolean);
}

export function setAlerts(list, leagueId, teamId, kinds) {
  const id = String(teamId);
  const next = { ...alertsFor(list, leagueId, id), ...kinds };
  const alerts = Object.values(next).some(Boolean) ? next : undefined;
  return list.map((t) => {
    if (t.league !== leagueId || t.id !== id) return t;
    const { alerts: _old, ...rest } = t;
    return alerts ? { ...rest, alerts } : rest;
  });
}

// What the push server needs: the league, the team and which alerts.
export function alertTeams(list) {
  return list
    .map((t) => ({ league: t.league, id: t.id, ...alertsFor(list, t.league, t.id) }))
    .filter((t) => ALERT_KINDS.some((k) => t[k]));
}

// The followed teams as the iPhone app's widgets need them: who they are and
// how to draw them, in the person's order.
export function widgetTeams(list) {
  return list.map(({ league, id, name = '', abbr = '', logo = '', color = null }) => ({ league, id, name, abbr, logo, color }));
}

// A spoiler delay for game alerts, so a game streamed behind live (YouTube
// TV runs 15 to 60 seconds back) isn't given away: the push server holds
// starts, scores and finals this many seconds. One setting for every
// followed team, kept on this device. Whole seconds, 0 (off) to 5 minutes
// (the server's MAX_ALERT_DELAY).
const DELAY_KEY = 'scores.alertDelay';
export const ALERT_DELAY_MAX = 300;
export const ALERT_DELAY_CHOICES = [0, 15, 30, 60];

export function clampDelay(value) {
  const seconds = Math.round(Number(value));
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, ALERT_DELAY_MAX) : 0;
}

export function loadAlertDelay(storage) {
  try {
    return clampDelay(storage?.getItem(DELAY_KEY));
  } catch {
    return 0;
  }
}

export function saveAlertDelay(storage, seconds) {
  try { storage?.setItem(DELAY_KEY, String(clampDelay(seconds))); } catch { /* full or blocked */ }
}

// The followed list's order is the person's order (new follows go last):
// My Teams shows its games in it. Moving a team is a plain move in the list.
export function moveTeam(list, from, to) {
  if (from === to || !list[from] || to < 0 || to >= list.length) return list;
  const next = [...list];
  next.splice(to, 0, ...next.splice(from, 1));
  return next;
}

// My Teams' groups (Live, Upcoming, Final; or a week's days) with each
// group's games in the order of their teams: a game goes where its highest
// followed team is, and games of the same team keep their time order.
export function sortByTeams(groups, list) {
  const rank = new Map(list.map((t, i) => [`${t.league}:${t.id}`, i]));
  const of = (game) => Math.min(...game.teams.map((t) => rank.get(`${game.league?.id}:${t.id}`) ?? Infinity));
  return groups.map((group) => ({ ...group, games: [...group.games].sort((a, b) => of(a) - of(b)) }));
}

// The league tabs' order: the person's (scores.leagueOrder, synced with the
// account), or the app's own (LEAGUES) when they never changed it. A league
// the order doesn't name (one added since) goes after the league before it
// in LEAGUES.
const ORDER_KEY = 'scores.leagueOrder';

export function cleanLeagueOrder(order) {
  if (!Array.isArray(order)) return [];
  const known = new Set(LEAGUES.map((l) => l.id));
  return [...new Set(order.filter((id) => known.has(id)))];
}

export function orderLeagues(order) {
  const ids = cleanLeagueOrder(order);
  if (!ids.length) return LEAGUES;
  LEAGUES.forEach((league, i) => {
    if (ids.includes(league.id)) return;
    const before = i ? ids.indexOf(LEAGUES[i - 1].id) : -1;
    ids.splice(before + 1, 0, league.id);
  });
  return ids.map((id) => LEAGUES.find((l) => l.id === id));
}

export function loadLeagueOrder(storage) {
  try {
    return cleanLeagueOrder(JSON.parse(storage?.getItem(ORDER_KEY) ?? '[]'));
  } catch {
    return [];
  }
}

export function saveLeagueOrder(storage, order) {
  try { storage?.setItem(ORDER_KEY, JSON.stringify(cleanLeagueOrder(order))); } catch { /* full or blocked */ }
}

// The game page's cards under the matchup (which stays on top: it has the
// gear that arranges them). The person picks their order and hides any of
// them per sport, so every football game (NFL and college) looks the same.
// scores.gameCards: {football: {order: ['boxScore', ...], hidden: ['odds']}},
// synced with the account. A sport it doesn't name is the app's layout.
const CARDS_KEY = 'scores.gameCards';

export const SPORTS = ['football', 'basketball', 'baseball', 'hockey', 'soccer'];

// sports: the only sports a card can have content in (the feeds give
// baseball and basketball no scoring list, baseball no team stats, soccer
// lineups instead of a box score).
export const GAME_CARDS = [
  { id: 'series', label: 'Playoff series', sports: ['basketball', 'baseball', 'hockey'] },
  { id: 'odds', label: 'Lines' },
  { id: 'lineScore', label: 'Line score' },
  { id: 'scoring', label: 'Scoring', soccer: 'Goals and red cards', sports: ['football', 'hockey', 'soccer'] },
  { id: 'boxScore', label: 'Box score', sports: ['football', 'basketball', 'baseball', 'hockey'] },
  { id: 'lineups', label: 'Lineups', sports: ['soccer'] },
  { id: 'teamStats', label: 'Team stats', sports: ['football', 'basketball', 'hockey', 'soccer'] },
];

// A league's sport: the first part of its ESPN path.
export const sportOf = (league) => String(league?.path ?? '').split('/')[0];

const cardsOf = (sport) => GAME_CARDS.filter((c) => !c.sports || c.sports.includes(sport));

export function cleanGameCards(layouts) {
  if (!layouts || typeof layouts !== 'object' || Array.isArray(layouts)) return {};
  const clean = {};
  for (const sport of SPORTS) {
    const saved = layouts[sport];
    if (!saved || typeof saved !== 'object') continue;
    const known = new Set(cardsOf(sport).map((c) => c.id));
    const ids = (list) => (Array.isArray(list) ? [...new Set(list.filter((id) => known.has(id)))] : []);
    const order = ids(saved.order);
    if (order.length) clean[sport] = { order, hidden: ids(saved.hidden) };
  }
  return clean;
}

// A sport's cards in the person's order, each {id, label, hidden}. A card
// the saved order doesn't name (one added since) goes after the card before
// it in GAME_CARDS, like the leagues.
export function gameCardsFor(sport, layouts) {
  const cards = cardsOf(sport);
  const saved = cleanGameCards(layouts)[sport];
  const ids = saved ? [...saved.order] : [];
  cards.forEach((card, i) => {
    if (ids.includes(card.id)) return;
    const before = i ? ids.indexOf(cards[i - 1].id) : -1;
    ids.splice(before + 1, 0, card.id);
  });
  const hidden = new Set(saved?.hidden ?? []);
  return ids.map((id) => {
    const card = cards.find((c) => c.id === id);
    return { id, label: (sport === 'soccer' && card.soccer) || card.label, hidden: hidden.has(id) };
  });
}

// The layouts with one sport's cards as given ([{id, hidden}], in order),
// saved in full so the change reaches the account's other devices.
export function setGameCards(layouts, sport, cards) {
  return cleanGameCards({
    ...cleanGameCards(layouts),
    [sport]: { order: cards.map((c) => c.id), hidden: cards.filter((c) => c.hidden).map((c) => c.id) },
  });
}

export function loadGameCards(storage) {
  try {
    return cleanGameCards(JSON.parse(storage?.getItem(CARDS_KEY) ?? '{}'));
  } catch {
    return {};
  }
}

export function saveGameCards(storage, layouts) {
  try { storage?.setItem(CARDS_KEY, JSON.stringify(cleanGameCards(layouts))); } catch { /* full or blocked */ }
}

// League ids with at least one followed team, in the app's league order.
export function followedLeagues(list) {
  return LEAGUES.map((l) => l.id).filter((id) => list.some((t) => t.league === id));
}

export function countFollowed(list, leagueId) {
  return list.filter((t) => t.league === leagueId).length;
}

// A league's games that involve a followed team.
export function gamesForTeams(games, list, leagueId) {
  const ids = new Set(list.filter((t) => t.league === leagueId).map((t) => t.id));
  return games.filter((g) => g.teams.some((t) => ids.has(String(t.id))));
}
