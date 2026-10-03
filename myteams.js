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

// Team alerts (game starting, final score) are per followed team, sent by
// the iPhone app's push server. Unfollowing a team drops its alerts with it.
export function hasAlerts(list, leagueId, teamId) {
  return list.some((t) => t.league === leagueId && t.id === String(teamId) && t.alerts === true);
}

export function setAlerts(list, leagueId, teamId, on) {
  const id = String(teamId);
  return list.map((t) => (t.league === leagueId && t.id === id ? { ...t, alerts: on } : t));
}

// What the push server needs: just the league and team ids.
export function alertTeams(list) {
  return list.filter((t) => t.alerts === true).map(({ league, id }) => ({ league, id }));
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
