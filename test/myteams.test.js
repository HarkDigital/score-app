import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LEAGUES, parseScoreboard } from '../espn.js';
import {
  loadFollowed, saveFollowed, isFollowed, toggleFollowed, followedLeagues, countFollowed, gamesForTeams,
  hasAlerts, setAlerts, alertTeams, alertsFor, widgetTeams, loadAlertDelay, saveAlertDelay, clampDelay, ALERT_DELAY_MAX,
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
  assert.deepEqual(alertsFor(list, 'nfl', '21'), { start: false, score: false, end: false, lock: false, news: false }, 'off until asked for');
  assert.equal(hasAlerts(list, 'nfl', '21'), false);
  list = setAlerts(list, 'nfl', 21, { start: true });
  list = setAlerts(list, 'nfl', 21, { end: true });
  assert.deepEqual(alertsFor(list, 'nfl', '21'), { start: true, score: false, end: true, lock: false, news: false });
  assert.equal(hasAlerts(list, 'mlb', '22'), false);
  assert.deepEqual(alertTeams(list), [{ league: 'nfl', id: '21', start: true, score: false, end: true, lock: false, news: false }]);
  // Turning the last one off drops the setting entirely.
  list = setAlerts(list, 'nfl', '21', { start: false, end: false });
  assert.equal(list.find((t) => t.id === '21').alerts, undefined);
  assert.deepEqual(alertTeams(list), []);
  list = setAlerts(list, 'nfl', '21', { score: true });
  list = toggleFollowed(list, 'nfl', eagles);
  assert.deepEqual(alertTeams(list), [], 'unfollowing drops them');
  // Early builds stored true for starts and finals.
  assert.deepEqual(alertsFor([{ league: 'nfl', id: '1', alerts: true }], 'nfl', '1'), { start: true, score: false, end: true, lock: false, news: false });
  // Lock Screen alone is enough to keep a team with the server.
  // News alone is a reason to send the team.
  const newsOnly = setAlerts([{ league: 'nfl', id: '3', name: 'Dolphins' }], 'nfl', '3', { news: true });
  assert.deepEqual(alertTeams(newsOnly), [{ league: 'nfl', id: '3', start: false, score: false, end: false, lock: false, news: true }]);
  const lockOnly = setAlerts([{ league: 'nfl', id: '2', name: 'Bills' }], 'nfl', '2', { lock: true, news: false });
  assert.deepEqual(alertTeams(lockOnly), [{ league: 'nfl', id: '2', start: false, score: false, end: false, lock: true, news: false }]);
});

test('the widgets get every followed team, alerts or not, without the alert settings', () => {
  let list = toggleFollowed([], 'nhl', { id: '15', name: 'Philadelphia Flyers', abbr: 'PHI', logo: 'https://a.espncdn.com/i/teamlogos/nhl/500/phi.png', color: '#f74902' });
  list = toggleFollowed(list, 'nfl', { id: '21', name: 'Philadelphia Eagles', abbr: 'PHI' });
  list = setAlerts(list, 'nfl', '21', { start: true });
  assert.deepEqual(widgetTeams(list), [
    { league: 'nhl', id: '15', name: 'Philadelphia Flyers', abbr: 'PHI', logo: 'https://a.espncdn.com/i/teamlogos/nhl/500/phi.png', color: '#f74902' },
    { league: 'nfl', id: '21', name: 'Philadelphia Eagles', abbr: 'PHI', logo: '', color: null },
  ]);
  assert.deepEqual(widgetTeams([]), []);
});

test('the alert delay: whole seconds, off by default, at most 5 minutes, kept on the device', () => {
  const storage = memoryStorage();
  assert.equal(loadAlertDelay(storage), 0, 'off until set');
  saveAlertDelay(storage, 15);
  assert.equal(loadAlertDelay(storage), 15);
  saveAlertDelay(storage, '42.4');
  assert.equal(loadAlertDelay(storage), 42, 'typed into the custom field');
  saveAlertDelay(storage, 9999);
  assert.equal(loadAlertDelay(storage), ALERT_DELAY_MAX);
  assert.deepEqual([clampDelay(-3), clampDelay(''), clampDelay('abc'), clampDelay(null)], [0, 0, 0, 0]);
  assert.equal(loadAlertDelay(memoryStorage({ 'scores.alertDelay': 'junk' })), 0);
  assert.equal(loadAlertDelay(null), 0, 'no storage (private mode)');
});
