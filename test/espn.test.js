import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  LEAGUES, scoreboardUrl, parseScoreboard, groupGames, refreshDelay,
  statusLabel, formatStart, dayLabel, weekLabel, adjacentWeek,
} from '../espn.js';

const league = (id) => LEAGUES.find((l) => l.id === id);
const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url)));
const nfl = parseScoreboard(fixture('nfl-scoreboard'), league('nfl'));
const epl = parseScoreboard(fixture('epl-scoreboard'), league('epl'));
const game = (board, id) => board.games.find((g) => g.id === id);

test('daily leagues request a single local date', () => {
  const url = new URL(scoreboardUrl(league('nba'), { date: new Date(2026, 0, 9, 23, 30) }));
  assert.equal(url.pathname, '/apis/site/v2/sports/basketball/nba/scoreboard');
  assert.equal(url.searchParams.get('dates'), '20260109');
});

test('weekly leagues ask for the current week unless one is picked', () => {
  const current = new URL(scoreboardUrl(league('ncaaf'), { date: new Date() }));
  assert.equal(current.searchParams.get('dates'), null);
  assert.equal(current.searchParams.get('week'), null);
  assert.equal(current.searchParams.get('groups'), '80');

  const picked = new URL(scoreboardUrl(league('nfl'), { week: { seasonType: 3, week: 1 } }));
  assert.equal(picked.searchParams.get('seasontype'), '3');
  assert.equal(picked.searchParams.get('week'), '1');
});

test('US sports list the away team first', () => {
  const live = game(nfl, '402');
  assert.deepEqual(live.teams.map((t) => t.abbr), ['KC', 'BUF']);
  assert.equal(live.state, 'in');
  assert.equal(live.statusText, '4:32 - 3rd');
  assert.equal(live.teams[0].score, '17');
  assert.equal(live.teams[0].record, '4-0');
  assert.equal(live.teams[0].name, 'Chiefs');
});

test('soccer lists the home side first', () => {
  assert.deepEqual(game(epl, '702').teams.map((t) => t.abbr), ['ARS', 'CHE']);
});

test('live football shows possession and down & distance', () => {
  const live = game(nfl, '402');
  assert.equal(live.detail, '2nd & 7 at BUF 34');
  assert.deepEqual(live.teams.map((t) => t.possession), [true, false]);
  // Situation is ignored once a game is over.
  assert.equal(game(nfl, '401').detail, '');
});

test('baseball situation shows outs and runners', () => {
  const board = parseScoreboard({ events: [{
    id: '1',
    date: '2026-07-04T23:05Z',
    competitions: [{
      status: { type: { state: 'in', shortDetail: 'Top 7th' } },
      situation: { outs: 1, onFirst: true, onSecond: false, onThird: true },
      competitors: [],
    }],
  }] }, league('mlb'));
  assert.equal(board.games[0].detail, '1 out · On 1st, 3rd');
});

test('pre-game scores are hidden and broadcasts de-duplicated', () => {
  const upcoming = game(nfl, '404');
  assert.deepEqual(upcoming.teams.map((t) => t.score), ['', '']);
  assert.equal(upcoming.broadcast, 'FOX');
  assert.equal(game(nfl, '405').broadcast, 'NBC, Peacock');
});

test('winners are flagged and notes carried through', () => {
  const ot = game(nfl, '403');
  assert.deepEqual(ot.teams.map((t) => [t.abbr, t.winner]), [['NYJ', true], ['MIN', false]]);
  assert.equal(ot.statusText, 'Final/OT');
  assert.equal(ot.note, 'NFL London Game');
});

test('college rankings only show for the top 25', () => {
  const board = parseScoreboard({ events: [{
    id: '1',
    date: '2026-10-03T16:00Z',
    competitions: [{
      status: { type: { state: 'pre', name: 'STATUS_SCHEDULED' } },
      competitors: [
        { homeAway: 'home', team: { shortDisplayName: 'Georgia' }, curatedRank: { current: 3 } },
        { homeAway: 'away', team: { shortDisplayName: 'Kentucky' }, curatedRank: { current: 99 } },
      ],
    }],
  }] }, league('ncaaf'));
  assert.deepEqual(board.games[0].teams.map((t) => t.rank), [null, 3]);
});

test('games are grouped live, upcoming, final and sorted by start', () => {
  const groups = groupGames(nfl.games);
  assert.deepEqual(groups.map((g) => g.label), ['Live', 'Upcoming', 'Final']);
  assert.deepEqual(groups.map((g) => g.games.map((x) => x.id)), [['402'], ['404', '405'], ['401', '403']]);
  assert.deepEqual(groupGames([]), []);
});

test('weeks step across season types using the calendar', () => {
  assert.equal(weekLabel(nfl), 'Week 5');
  assert.deepEqual(adjacentWeek(nfl, -1), { seasonType: 2, week: 4, label: 'Week 4' });
  assert.deepEqual(adjacentWeek(nfl, 1), { seasonType: 2, week: 6, label: 'Week 6' });

  const lastRegular = { ...nfl, week: { seasonType: 2, week: 18 } };
  assert.deepEqual(adjacentWeek(lastRegular, 1), { seasonType: 3, week: 1, label: 'Wild Card' });
  const firstRegular = { ...nfl, week: { seasonType: 2, week: 1 } };
  assert.deepEqual(adjacentWeek(firstRegular, -1), { seasonType: 1, week: 4, label: 'Preseason Week 3' });
  // The off-season isn't browsable.
  const superBowl = { ...nfl, week: { seasonType: 3, week: 5 } };
  assert.equal(adjacentWeek(superBowl, 1), null);
});

test('weeks fall back to simple counting without a calendar', () => {
  const board = { week: { seasonType: 2, week: 1 }, weeks: [] };
  assert.equal(weekLabel(board), 'Week 1');
  assert.deepEqual(adjacentWeek(board, 1), { seasonType: 2, week: 2 });
  assert.equal(adjacentWeek(board, -1), null);
  assert.equal(adjacentWeek(null, 1), null);
});

test('refresh is fast while live, slower before kickoff, off otherwise', () => {
  const now = Date.parse('2026-10-04T16:00Z');
  const pre = (iso, extra) => ({ state: 'pre', start: new Date(iso), ...extra });

  assert.equal(refreshDelay(nfl.games, now), 15_000);
  assert.equal(refreshDelay([pre('2026-10-04T16:20Z')], now), 30_000);
  // Past its start time but not live yet (e.g. a delay): keep checking.
  assert.equal(refreshDelay([pre('2026-10-04T14:00Z')], now), 30_000);
  assert.equal(refreshDelay([pre('2026-10-04T23:00Z')], now), 300_000);
  assert.equal(refreshDelay([pre('2026-10-07T23:00Z')], now), null);
  assert.equal(refreshDelay([pre('2026-10-04T16:10Z', { timeTbd: true })], now), null);
  assert.equal(refreshDelay([{ state: 'post', start: new Date('2026-10-04T13:00Z') }], now), null);
  assert.equal(refreshDelay([], now), null);
});

test('status labels use local start times for scheduled games', () => {
  const now = new Date(2026, 9, 4, 9, 0);
  const at = (h, m, day = 4) => new Date(2026, 9, day, h, m);
  const time = (d) => d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

  assert.equal(statusLabel({ state: 'pre', statusName: 'STATUS_SCHEDULED', start: at(13, 0) }, now), time(at(13, 0)));
  assert.equal(statusLabel({ state: 'pre', statusName: 'STATUS_SCHEDULED', start: at(13, 0), timeTbd: true }, now), 'TBD');
  assert.equal(statusLabel({ state: 'pre', statusName: 'STATUS_DELAYED', statusText: 'Delayed' }, now), 'Delayed');
  assert.equal(statusLabel({ state: 'in', statusText: 'Top 5th' }, now), 'Top 5th');

  const tomorrow = formatStart(at(20, 15, 5), now);
  assert.ok(tomorrow.endsWith(time(at(20, 15, 5))) && tomorrow !== time(at(20, 15, 5)));
});

test('day labels', () => {
  assert.equal(dayLabel(0), 'Today');
  assert.equal(dayLabel(-1), 'Yesterday');
  assert.equal(dayLabel(1), 'Tomorrow');
  assert.match(dayLabel(5, new Date(2026, 9, 3)), /8/);
});
