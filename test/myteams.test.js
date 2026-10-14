import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LEAGUES, parseScoreboard } from '../espn.js';
import {
  loadFollowed, saveFollowed, isFollowed, toggleFollowed, followedLeagues, countFollowed, gamesForTeams,
  hasAlerts, setAlerts, alertTeams, alertsFor, widgetTeams, loadAlertDelay, saveAlertDelay, clampDelay, ALERT_DELAY_MAX,
  moveTeam, sortByTeams, orderLeagues, cleanLeagueOrder, loadLeagueOrder, saveLeagueOrder,
  SPORTS, sportOf, gameCardsFor, setGameCards, cleanGameCards, loadGameCards, saveGameCards,
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

test('teams move within the list, which is the order My Teams uses', () => {
  const list = [{ league: 'nfl', id: '1' }, { league: 'nba', id: '2' }, { league: 'nhl', id: '3' }];
  assert.deepEqual(moveTeam(list, 2, 0).map((t) => t.id), ['3', '1', '2']);
  assert.deepEqual(moveTeam(list, 0, 2).map((t) => t.id), ['2', '3', '1']);
  assert.equal(moveTeam(list, 1, 1), list);
  assert.equal(moveTeam(list, 0, 5), list);
  assert.deepEqual(list.map((t) => t.id), ['1', '2', '3']); // not changed in place
});

test('My Teams lists each group\'s games in the order of the teams', () => {
  const nfl = LEAGUES.find((l) => l.id === 'nfl');
  const nba = LEAGUES.find((l) => l.id === 'nba');
  const game = (id, league, ...teams) => ({ id, league, teams: teams.map((t) => ({ id: t })) });
  const list = [{ league: 'nba', id: '2' }, { league: 'nfl', id: '12' }, { league: 'nfl', id: '2' }];
  const groups = [
    // Already in time order, as groupGames and groupWeek give them.
    { key: 'pre', games: [game('a', nfl, '2', '9'), game('b', nfl, '12', '7'), game('c', nba, '5', '2'), game('d', nfl, '30', '12')] },
    { key: 'post', games: [game('e', nfl, '1', '3')] },
  ];
  const sorted = sortByTeams(groups, list);
  // Celtics, then the Chiefs' two in time order, then the Bills. NFL id 2
  // is the Bills, not the Celtics: the league counts.
  assert.deepEqual(sorted[0].games.map((g) => g.id), ['c', 'b', 'd', 'a']);
  assert.deepEqual(sorted[1].games.map((g) => g.id), ['e']);
  assert.equal(sorted[0].key, 'pre');
  assert.deepEqual(groups[0].games.map((g) => g.id), ['a', 'b', 'c', 'd']); // not changed in place
});

test('the league order: the person\'s, new leagues after their neighbor, kept on the device', () => {
  const ids = (order) => orderLeagues(order).map((l) => l.id);
  const app = LEAGUES.map((l) => l.id);
  assert.deepEqual(ids([]), app);
  assert.deepEqual(ids(null), app);
  const mine = [...app].reverse();
  assert.deepEqual(ids(mine), mine);
  // An order saved before a league existed: it goes after the one before it.
  const [first, second, ...rest] = app;
  assert.deepEqual(ids([...rest, second]), [first, ...rest, second]);
  assert.deepEqual(ids([second, ...rest]), [first, second, ...rest]);
  assert.deepEqual(ids([...rest.slice().reverse(), first]), [...rest.slice().reverse(), first, second]);
  assert.deepEqual(cleanLeagueOrder(['nba', 'nope', 'nba', 'nfl']), ['nba', 'nfl']);

  const storage = memoryStorage();
  assert.deepEqual(loadLeagueOrder(storage), []);
  saveLeagueOrder(storage, ['nhl', 'nba', 'gone']);
  assert.deepEqual(loadLeagueOrder(storage), ['nhl', 'nba']);
  assert.deepEqual(loadLeagueOrder(memoryStorage({ 'scores.leagueOrder': '{bad' })), []);
  assert.deepEqual(loadLeagueOrder(null), []);
  saveLeagueOrder(null, ['nba']);
});

test('every league is one of the game page\'s sports', () => {
  for (const league of LEAGUES) assert.ok(SPORTS.includes(sportOf(league)), league.id);
  assert.equal(sportOf(LEAGUES.find((l) => l.id === 'ncaaf')), 'football');
});

test('the game page\'s cards per sport: the app\'s order, the person\'s, and hidden ones', () => {
  const ids = (sport, layouts) => gameCardsFor(sport, layouts).map((c) => c.id);
  // Each sport lists only the cards its feeds can fill.
  assert.deepEqual(ids('football', {}), ['lock', 'odds', 'lineScore', 'scoring', 'boxScore', 'teamStats']);
  assert.deepEqual(ids('baseball', {}), ['series', 'lock', 'odds', 'lineScore', 'boxScore']);
  assert.deepEqual(ids('soccer', {}), ['lock', 'odds', 'lineScore', 'scoring', 'lineups', 'teamStats']);
  assert.equal(gameCardsFor('soccer', {}).find((c) => c.id === 'scoring').label, 'Goals and red cards');

  let layouts = setGameCards({}, 'football', [
    { id: 'boxScore' }, { id: 'scoring' }, { id: 'odds', hidden: true }, { id: 'lock' }, { id: 'lineScore' }, { id: 'teamStats' },
  ]);
  assert.deepEqual(layouts, { football: { order: ['boxScore', 'scoring', 'odds', 'lock', 'lineScore', 'teamStats'], hidden: ['odds'] } });
  assert.deepEqual(gameCardsFor('football', layouts).filter((c) => c.hidden).map((c) => c.id), ['odds']);
  // Other sports keep the app's layout.
  assert.deepEqual(ids('hockey', layouts), ids('hockey', {}));
  // A card the saved order doesn't name goes after the card before it.
  layouts = { football: { order: ['boxScore', 'odds', 'lock'], hidden: [] } };
  assert.deepEqual(ids('football', layouts), ['boxScore', 'teamStats', 'odds', 'lineScore', 'scoring', 'lock']);
  // Unknown sports and cards, and cards a sport doesn't have, are dropped.
  assert.deepEqual(cleanGameCards({ baseball: { order: ['scoring', 'odds', 'odds'], hidden: ['nope'] }, curling: { order: ['odds'] } }),
    { baseball: { order: ['odds'], hidden: [] } });
  assert.deepEqual(cleanGameCards([]), {});
  assert.deepEqual(cleanGameCards({ hockey: { order: [] } }), {});

  const storage = memoryStorage();
  assert.deepEqual(loadGameCards(storage), {});
  saveGameCards(storage, { hockey: { order: ['teamStats', 'odds'], hidden: ['odds'] } });
  assert.deepEqual(loadGameCards(storage), { hockey: { order: ['teamStats', 'odds'], hidden: ['odds'] } });
  assert.deepEqual(loadGameCards(memoryStorage({ 'scores.gameCards': '{bad' })), {});
  assert.deepEqual(loadGameCards(null), {});
  saveGameCards(null, {});
});
