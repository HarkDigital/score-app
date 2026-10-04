import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LEAGUES, parseScoreboard } from '../espn.js';
import {
  loadFollowed, saveFollowed, isFollowed, toggleFollowed, followedLeagues, countFollowed, gamesForTeams,
  hasAlerts, setAlerts, alertTeams, alertsFor,
} from '../myteams.js';

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => { data[key] = String(value); },
    data,
  };
}

const chiefs = { id: 12, name: 'Kansas City Chiefs', abbr: 'KC', logo: 'kc.png', color: '#e31837', extra: 'dropped' };
const arsenal = { id: '359', name: 'Arsenal', abbr: 'ARS', logo: '', color: null };

test('follows survive a reload and tolerate bad or missing storage', () => {
  const storage = memoryStorage();
  let list = toggleFollowed([], 'nfl', chiefs);
  list = toggleFollowed(list, 'epl', arsenal);
  saveFollowed(storage, list);
  assert.deepEqual(loadFollowed(storage), [
    { league: 'nfl', id: '12', name: 'Kansas City Chiefs', abbr: 'KC', logo: 'kc.png', color: '#e31837' },
    { league: 'epl', id: '359', name: 'Arsenal', abbr: 'ARS', logo: '', color: null },
  ]);
  assert.deepEqual(loadFollowed(memoryStorage({ 'scores.myTeams': 'not json' })), []);
  assert.deepEqual(loadFollowed(memoryStorage({ 'scores.myTeams': '{"a":1}' })), []);
  assert.deepEqual(loadFollowed(null), []);
  saveFollowed(null, list); // no throw
  saveFollowed({ setItem() { throw new Error('quota'); } }, list); // no throw
});

test('toggling follows and unfollows by league and id', () => {
  let list = toggleFollowed([], 'nfl', chiefs);
  assert.ok(isFollowed(list, 'nfl', '12'));
  assert.ok(isFollowed(list, 'nfl', 12));
  assert.ok(!isFollowed(list, 'ncaaf', '12')); // same id, different league
  list = toggleFollowed(list, 'nfl', { id: '12' });
  assert.deepEqual(list, []);
});

test('leagues with follows come back in app order, with counts', () => {
  let list = toggleFollowed([], 'epl', arsenal);
  list = toggleFollowed(list, 'nfl', chiefs);
  list = toggleFollowed(list, 'nfl', { id: '2', name: 'Buffalo Bills' });
  assert.deepEqual(followedLeagues(list), ['nfl', 'epl']);
  assert.equal(countFollowed(list, 'nfl'), 2);
  assert.equal(countFollowed(list, 'nba'), 0);
});

test('a scoreboard is filtered to games with a followed team', () => {
  const nfl = LEAGUES.find((l) => l.id === 'nfl');
  const board = parseScoreboard(JSON.parse(readFileSync(new URL('./fixtures/nfl-scoreboard.json', import.meta.url))), nfl);
  const kc = board.games.find((g) => g.id === '402').teams.find((t) => t.abbr === 'KC');
  const list = toggleFollowed([], 'nfl', kc);
  assert.deepEqual(gamesForTeams(board.games, list, 'nfl').map((g) => g.id), ['402']);
  assert.deepEqual(gamesForTeams(board.games, list, 'nba'), []);
  assert.deepEqual(gamesForTeams(board.games, [], 'nfl'), []);
});

test('alerts are per followed team, per kind, and go when the team does', () => {
  const eagles = { id: '21', name: 'Eagles', abbr: 'PHI' };
  const phillies = { id: '22', name: 'Phillies', abbr: 'PHI' };
  let list = toggleFollowed(toggleFollowed([], 'nfl', eagles), 'mlb', phillies);
  assert.deepEqual(alertsFor(list, 'nfl', '21'), { start: false, score: false, end: false, lock: false }, 'off until asked for');
  assert.equal(hasAlerts(list, 'nfl', '21'), false);
  list = setAlerts(list, 'nfl', 21, { start: true });
  list = setAlerts(list, 'nfl', 21, { end: true });
  assert.deepEqual(alertsFor(list, 'nfl', '21'), { start: true, score: false, end: true, lock: false });
  assert.equal(hasAlerts(list, 'mlb', '22'), false);
  assert.deepEqual(alertTeams(list), [{ league: 'nfl', id: '21', start: true, score: false, end: true, lock: false }]);
  // Turning the last one off drops the setting entirely.
  list = setAlerts(list, 'nfl', '21', { start: false, end: false });
  assert.equal(list.find((t) => t.id === '21').alerts, undefined);
  assert.deepEqual(alertTeams(list), []);
  list = setAlerts(list, 'nfl', '21', { score: true });
  list = toggleFollowed(list, 'nfl', eagles);
  assert.deepEqual(alertTeams(list), [], 'unfollowing drops them');
  // Early builds stored true for starts and finals.
  assert.deepEqual(alertsFor([{ league: 'nfl', id: '1', alerts: true }], 'nfl', '1'), { start: true, score: false, end: true, lock: false });
  // Lock Screen alone is enough to keep a team with the server.
  const lockOnly = setAlerts([{ league: 'nfl', id: '2', name: 'Bills' }], 'nfl', '2', { lock: true });
  assert.deepEqual(alertTeams(lockOnly), [{ league: 'nfl', id: '2', start: false, score: false, end: false, lock: true }]);
});
