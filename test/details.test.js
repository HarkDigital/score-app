import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { leagueById } from '../espn.js';
import { summaryUrl, scheduleUrls, parseSummary, parseSchedule, periodLabels } from '../details.js';

// Trimmed from real ESPN game summaries and team schedules (2024-26).
const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url)));
const summary = (name, league) => parseSummary(fixture(name), leagueById(league));

test('feed URLs: one summary per game, schedules by season type or fixture list', () => {
  assert.equal(summaryUrl(leagueById('nba'), '401585'), 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=401585');
  assert.deepEqual(scheduleUrls(leagueById('nfl'), '12').map((u) => new URL(u).search), ['?seasontype=2', '?seasontype=3']);
  assert.deepEqual(scheduleUrls(leagueById('epl'), '359').map((u) => new URL(u).search), ['', '?fixture=true']);
});

test('football box score: line score, scoring plays, team stats, player groups', () => {
  const game = summary('nfl-summary', 'nfl');
  assert.deepEqual(game.teams.map((t) => [t.abbr, t.score, t.record, t.winner]), [['KC', '22', '15-2', false], ['PHI', '40', '14-3', true]]);
  assert.deepEqual(game.lineScore, { labels: ['1', '2', '3', '4', 'T'], rows: [['0', '0', '6', '16', '22'], ['7', '17', '10', '6', '40']] });
  assert.deepEqual(game.scoring[0], { period: 'Q1', clock: '6:15', team: 'PHI', kind: 'score', text: 'Jalen Hurts 1 Yd Rush (Jake Elliott Kick)', score: '0 - 7' });
  assert.deepEqual(game.teamStats[0], { label: '1st Downs', values: ['12', '21'] });
  const kc = game.players[0];
  assert.equal(kc.teamId, '12');
  assert.deepEqual(kc.groups.map((g) => g.title), ['Passing', 'Rushing']);
  assert.deepEqual(kc.groups[0].rows[0], { name: 'Patrick Mahomes', position: '', starter: false, stats: ['21/32', '257', '8.0', '3', '2', '6-31', '10.0', '95.4'] });
  assert.equal(game.venue, 'Caesars Superdome · New Orleans, LA');
  assert.equal(game.attendance, '65,719');
});

test('basketball box score: starters, totals and who did not play', () => {
  const game = summary('nba-summary', 'nba');
  const raptors = game.players[0].groups[0];
  assert.equal(raptors.title, '');
  // Offensive and defensive rebounds are folded into REB.
  assert.deepEqual(raptors.labels, ['MIN', 'PTS', 'FG', '3PT', 'FT', 'REB', 'AST', 'TO', 'STL', 'BLK', 'PF', '+/-']);
  assert.deepEqual(raptors.rows[0], { name: 'K. Olynyk', position: 'F', starter: true, stats: ['26', '11', '5-8', '1-1', '0-0', '4', '3', '3', '1', '0', '5', '-11'] });
  assert.equal(raptors.totals[1], '96');
  assert.deepEqual(raptors.didNotPlay, ['G. Temple']);
  assert.deepEqual(game.scoring, []);
});

test('baseball line score ends R H E, and box score is batting and pitching', () => {
  const game = summary('mlb-summary', 'mlb');
  assert.deepEqual(game.lineScore.labels, ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'R', 'H', 'E']);
  assert.deepEqual(game.lineScore.rows[1], ['3', '1', '1', '0', '0', '1', '0', '0', '0', '6', '8', '3']);
  assert.deepEqual(game.players[0].groups.map((g) => [g.title, g.labels.join(' ')]), [
    ['Batting', 'AB R H RBI HR BB K AVG'],
    ['Pitching', 'IP H R ER BB K HR ERA PC'],
  ]);
  assert.deepEqual(game.teamStats, []);
});

test('hockey: goals as the scoring summary, goals and assists first', () => {
  const game = summary('nhl-summary', 'nhl');
  assert.deepEqual(game.scoring.map((p) => [p.period, p.clock, p.team, p.score]), [['1st', '4:27', 'FLA', '0 - 1'], ['1st', '6:44', 'EDM', '1 - 1']]);
  const groups = game.players[0].groups;
  assert.deepEqual(groups.map((g) => g.title), ['Forwards', 'Defense', 'Goalies']);
  assert.deepEqual(groups[0].labels, ['G', 'A', '+/-', 'SOG', 'S', 'HT', 'BS', 'PIM', 'FO%', 'TOI']);
  assert.deepEqual(groups[2].labels, ['GA', 'SA', 'SV', 'SV%', 'PIM', 'TOI']);
});

test('soccer: home side first, halves, goals and red cards', () => {
  const game = summary('epl-summary', 'epl');
  assert.deepEqual(game.teams.map((t) => t.abbr), ['BHA', 'MAN']);
  assert.deepEqual(game.lineScore, { labels: ['1', '2', 'T'], rows: [['0', '0', '0'], ['2', '1', '3']] });
  assert.deepEqual(game.scoring.map((e) => [e.clock, e.team, e.kind, e.text]), [
    ["33'", 'MAN', 'goal', 'Patrick Dorgu Goal - Header'],
    ["44'", 'MAN', 'goal', 'Bryan Mbeumo Goal'],
  ]);
  assert.deepEqual(game.players, []);
  const withRed = parseSummary({ ...fixture('epl-summary'), keyEvents: [{ type: { text: 'Red Card' }, clock: { displayValue: "88'" }, team: { id: '360' }, shortText: 'X Red Card' }] }, leagueById('epl'));
  assert.deepEqual(withRed.scoring.map((e) => e.kind), ['red']);
  // A shootout's period list is garbled in the feed, so no line score.
  assert.equal(summary('ucl-summary', 'ucl').lineScore, null);
});

test('period labels: overtime, shootouts, college halves, innings', () => {
  assert.deepEqual(periodLabels(leagueById('wnba'), 6), ['1', '2', '3', '4', 'OT', '2OT']);
  assert.deepEqual(periodLabels(leagueById('ncaam'), 3), ['1', '2', 'OT']);
  assert.deepEqual(periodLabels(leagueById('nhl'), 5, 'Final/SO'), ['1', '2', '3', 'OT', 'SO']);
  assert.deepEqual(periodLabels(leagueById('nhl'), 5, 'Final/2OT'), ['1', '2', '3', 'OT', '2OT']);
  assert.deepEqual(periodLabels(leagueById('mlb'), 11).slice(8), ['9', '10', '11']);
});

test('a game that has not started has no box score yet, but has its line', () => {
  const data = fixture('nfl-summary');
  const comp = data.header.competitions[0];
  comp.status = { type: { state: 'pre', name: 'STATUS_SCHEDULED', shortDetail: '9/14 - 8:15 PM EDT' } };
  const game = parseSummary({
    header: data.header,
    pickcenter: [{ provider: { name: 'DraftKings' }, details: 'PHI -1.5', overUnder: 49.5 }],
  }, leagueById('nfl'));
  assert.equal(game.lineScore, null);
  assert.deepEqual(game.teams.map((t) => t.score), ['', '']);
  assert.equal(game.odds.spread, 'PHI -1.5');
  assert.deepEqual([game.players, game.teamStats, game.scoring], [[], [], []]);
  assert.equal(parseSummary({}, leagueById('nfl')), null);
});

test('team schedule: header, results from the team side, upcoming games', () => {
  const duke = parseSchedule([fixture('ncaam-schedule')], leagueById('ncaam'), '150');
  assert.deepEqual(duke.team, {
    id: '150', name: 'Duke Blue Devils', abbr: 'DUKE', logo: 'https://a.espncdn.com/i/teamlogos/ncaa/500/150.png',
    color: '#00539b', record: '35-3', standing: '1st in ACC',
  });
  assert.deepEqual(duke.games.map((g) => [g.opponent.abbr, g.home, g.result, g.score]), [
    ['FSU', true, 'W', '80-79'], ['CLEM', true, 'W', '73-61'], ['UVA', true, 'W', '74-70'],
  ]);
  const kc = parseSchedule([fixture('nfl-schedule')], leagueById('nfl'), '12');
  assert.deepEqual(kc.games.map((g) => [g.opponent.abbr, g.state, g.result, g.label, g.broadcast]), [
    ['DEN', 'pre', '', 'Week 1', 'ESPN, ABC'], ['IND', 'pre', '', 'Week 2', 'NBC'],
  ]);
});

test('schedules from several requests are merged, deduplicated and in date order', () => {
  const regular = fixture('ncaam-schedule');
  const later = { ...regular, events: regular.events.slice(0, 1).map((e) => ({ ...e, id: 'x1', date: '2026-04-01T00:00Z', competitions: [{ ...e.competitions[0], date: '2026-04-01T00:00Z' }] })) };
  const merged = parseSchedule([regular, later, { events: [] }, null], leagueById('ncaam'), '150');
  assert.deepEqual(merged.games.map((g) => g.id), ['401851179', '401851182', '401851183', 'x1']);
  const loss = parseSchedule([{ ...regular, events: regular.events.slice(0, 1).map((e) => ({ ...e, competitions: [{ ...e.competitions[0], competitors: e.competitions[0].competitors.map((c) => ({ ...c, winner: !c.winner })) }] })) }], leagueById('ncaam'), '150');
  assert.equal(loss.games[0].result, 'L');
  assert.deepEqual(parseSchedule([], leagueById('nhl'), '23').games, []);
});
