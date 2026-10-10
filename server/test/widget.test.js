import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { leagueById } from '../../espn.js';
import { parseSchedule } from '../../details.js';
import { parseWidgetTeams, pickShow, widgetTeam, createWidgetSource, WIDGET_TEAMS_MAX } from '../widget.js';

// Real team schedules: the Chiefs before the 2026 season (two games to come),
// Duke at the end of 2025-26 (three finals, nothing next).
const fixture = (name) => JSON.parse(readFileSync(new URL(`../../test/fixtures/${name}.json`, import.meta.url)));
const nfl = leagueById('nfl');
const ncaam = leagueById('ncaam');
const kc = parseSchedule([fixture('nfl-schedule')], nfl, '12');
const duke = parseSchedule([fixture('ncaam-schedule')], ncaam, '150');
const sec = (iso) => Date.parse(iso) / 1000;
const KC_DEN = '401872931'; // 2026-09-15T00:15Z, at home to Denver
const KC_IND = '401872945'; // 2026-09-21T00:20Z

// A scoreboard entry for a Chiefs game (built here: only the fields the
// widget reads from espn.js parseScoreboard's games).
const boardGame = (id, state, statusName, statusText, kcScore, denScore, kcWins = false) => ({
  id,
  start: new Date('2026-09-15T00:15Z'),
  state,
  statusName,
  statusText,
  teams: [{ id: '7', score: denScore, winner: !kcWins && state === 'post' }, { id: '12', score: kcScore, winner: kcWins }],
});

test('widget teams: known leagues, no repeats, at most 12', () => {
  assert.deepEqual(parseWidgetTeams('nhl:4,nfl:21'), [{ league: 'nhl', id: '4' }, { league: 'nfl', id: '21' }]);
  assert.deepEqual(parseWidgetTeams('nhl:4,nhl:4,xfl:1,nfl:,nfl:a b,nba:1:2, mlb:22 '), [{ league: 'nhl', id: '4' }, { league: 'mlb', id: '22' }]);
  assert.deepEqual(parseWidgetTeams(null), []);
  const many = Array.from({ length: 20 }, (_, i) => `nba:${i + 1}`).join(',');
  assert.equal(parseWidgetTeams(many).length, WIDGET_TEAMS_MAX);
});

test('before the season: the next game, from the team side', () => {
  const team = widgetTeam(kc, new Map(), nfl, Date.parse('2026-09-10T12:00Z'));
  assert.equal(team.shortName, 'Chiefs');
  assert.equal(team.record, '6-11');
  assert.equal(team.homeFirst, false);
  assert.equal(widgetTeam({ team: { id: '359' }, games: [] }, new Map(), leagueById('epl'), 0).homeFirst, true, 'soccer: home first');
  assert.equal(team.show, 'next');
  assert.equal(team.showUntil, null);
  assert.equal(team.live, null);
  assert.equal(team.last, null);
  assert.deepEqual(
    { id: team.next.id, start: team.next.start, home: team.next.home, opp: team.next.opponent.abbr, score: team.next.score, state: team.next.state },
    { id: KC_DEN, start: sec('2026-09-15T00:15Z'), home: true, opp: 'DEN', score: '', state: 'pre' },
  );
});

test('the game on now comes from the scoreboard: state, clock and both scores', () => {
  const board = new Map([[KC_DEN, boardGame(KC_DEN, 'in', 'STATUS_IN_PROGRESS', '8:21 - 2nd', '14', '7')]]);
  const team = widgetTeam(kc, board, nfl, Date.parse('2026-09-15T01:00Z'));
  assert.equal(team.show, 'live');
  assert.deepEqual([team.live.id, team.live.status, team.live.score, team.live.oppScore], [KC_DEN, '8:21 - 2nd', '14', '7']);
  assert.equal(team.next.id, KC_IND, 'the next game is the one after');
});

test('a final shows for 15 hours, or until 2 hours before the next game', () => {
  const board = new Map([[KC_DEN, boardGame(KC_DEN, 'post', 'STATUS_FINAL', 'Final', '24', '17', true)]]);
  const team = widgetTeam(kc, board, nfl, Date.parse('2026-09-15T04:00Z'));
  assert.equal(team.show, 'last');
  assert.deepEqual([team.last.result, team.last.score, team.last.oppScore, team.last.final], ['W', '24', '17', true]);
  assert.equal(team.showUntil, sec('2026-09-15T00:15Z') + 15 * 3600);
  // The next morning, the next game.
  assert.equal(widgetTeam(kc, board, nfl, Date.parse('2026-09-15T16:00Z')).show, 'next');
  // A quick turnaround: the final gives way 2 hours before the next start.
  assert.deepEqual(pickShow(null, { start: 0 }, { start: 10 * 3600 }, 7 * 3600), { show: 'last', showUntil: 8 * 3600 });
  assert.deepEqual(pickShow(null, { start: 0 }, { start: 10 * 3600 }, 9 * 3600), { show: 'next', showUntil: null });
});

test('a postponed game is neither a result nor next', () => {
  const board = new Map([[KC_DEN, boardGame(KC_DEN, 'post', 'STATUS_POSTPONED', 'Postponed', '', '')]]);
  const team = widgetTeam(kc, board, nfl, Date.parse('2026-09-15T04:00Z'));
  assert.equal(team.last, null);
  assert.equal(team.next.id, KC_IND);
  assert.equal(team.show, 'next');
});

test('finals from the schedule alone; after the season, its last result', () => {
  const lastStart = sec('2026-03-15T00:40Z');
  const team = widgetTeam(duke, new Map(), ncaam, (lastStart + 3 * 3600) * 1000);
  assert.equal(team.show, 'last');
  assert.deepEqual([team.last.opponent.abbr, team.last.result, team.last.score, team.last.oppScore], ['UVA', 'W', '74', '70']);
  assert.equal(team.showUntil, lastStart + 15 * 3600);
  const later = widgetTeam(duke, new Map(), ncaam, (lastStart + 3 * 86400) * 1000);
  assert.deepEqual([later.show, later.showUntil, later.next], ['last', null, null]);
});

test('the source caches schedules and boards, retries failures, and reports a team it can\'t get', async () => {
  const calls = new Map();
  const fetchJson = async (url) => {
    calls.set(url, (calls.get(url) ?? 0) + 1);
    if (url.includes('/scoreboard')) return { events: [] };
    if (url.includes('/teams/12/schedule?seasontype=2')) return fixture('nfl-schedule');
    throw new Error('HTTP 404');
  };
  let clock = Date.parse('2026-09-10T12:00Z');
  const source = createWidgetSource({ fetchJson, now: () => clock });
  const first = await source.teams([{ league: 'nfl', id: '12' }, { league: 'nfl', id: '99' }]);
  assert.equal(first.updatedAt, clock / 1000);
  assert.equal(first.teams[0].next.id, KC_DEN, 'one of the two schedule pages is enough');
  assert.deepEqual(first.teams[1], { league: 'nfl', id: '99', error: 'unavailable' });

  clock += 60_000;
  await source.teams([{ league: 'nfl', id: '12' }]);
  const count = (part) => [...calls].filter(([url]) => url.includes(part)).reduce((n, [, c]) => n + c, 0);
  assert.equal(count('/teams/12/schedule?seasontype=2'), 1, 'a schedule is kept for 10 minutes');
  assert.equal(count('/teams/12/schedule?seasontype=3'), 2, 'a failure is asked again');
  const boardsBefore = count('/scoreboard');
  clock += 30_000;
  await source.teams([{ league: 'nfl', id: '12' }]);
  assert.ok(count('/scoreboard') > boardsBefore, 'the scoreboard only for 20 seconds');
});
