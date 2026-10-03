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
export const ALERT_KINDS = ['start', 'score', 'end'];
const NO_ALERTS = { start: false, score: false, end: false };

export function alertsFor(list, leagueId, teamId) {
  const team = list.find((t) => t.league === leagueId && t.id === String(teamId));
  const a = team?.alerts;
  // Early builds stored a plain true for "starts and finals".
  if (a === true) return { start: true, score: false, end: true };
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
