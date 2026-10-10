import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { leagueById } from '../espn.js';
import {
  summaryUrl, scheduleUrls, parseSummary, parseSchedule, periodLabels, lockScreenCard, canShowOnLockScreen, LOCK_LEAD_MINUTES,
} from '../details.js';

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
    id: '150', name: 'Duke Blue Devils', shortName: 'Duke', abbr: 'DUKE', logo: 'https://a.espncdn.com/i/teamlogos/ncaa/500/150.png',
    color: '#00539b', record: '35-3', standing: '1st in ACC',
  });
  // The header has only the full name; the short one comes from the team's
  // own entry in its games.
  assert.equal(parseSchedule([fixture('nfl-schedule')], leagueById('nfl'), '12').team.shortName, 'Chiefs');
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

test('lock-screen card: away and home by side, scores, and a status only when it says something', () => {
  const nfl = leagueById('nfl');
  const game = parseSummary(JSON.parse(readFileSync(new URL('./fixtures/nfl-summary.json', import.meta.url))), nfl);
  const card = lockScreenCard(game, nfl, '401547417');
  const away = game.teams.find((t) => t.homeAway === 'away');
  const home = game.teams.find((t) => t.homeAway === 'home');
  assert.equal(card.eventId, '401547417');
  assert.equal(card.league, 'nfl');
  assert.equal(card.homeFirst, false);
  assert.deepEqual(card.away, { abbr: away.abbr, name: away.shortName, color: away.color, logo: away.logo });
  assert.match(card.home.logo, /^https:\/\/a\.espncdn\.com\//);
  assert.equal(card.home.abbr, home.abbr);
  assert.equal(card.state.away, away.score);
  assert.equal(card.state.home, home.score);
  assert.equal(card.start, Math.floor(game.start.getTime() / 1000));
  // A scheduled game's status is left to the phone, which shows the local start time.
  const pre = lockScreenCard({ ...game, state: 'pre', statusName: 'STATUS_SCHEDULED', statusText: '10/4 - 1:00 PM EDT' }, nfl);
  assert.equal(pre.state.status, '');
  const late = lockScreenCard({ ...game, state: 'pre', statusName: 'STATUS_DELAYED', statusText: 'Delayed' }, nfl);
  assert.equal(late.state.status, 'Delayed');
});

test('a live football card starts with timeouts left and who has the ball', () => {
  // Captured Oct 4 2026, NE @ BUF in the 2nd: the header counts timeouts used.
  const nfl = leagueById('nfl');
  const game = summary('nfl-summary-live', 'nfl');
  assert.deepEqual(game.teams.map((t) => [t.abbr, t.timeouts, t.possession]), [['NE', 2, true], ['BUF', 3, false]]);
  const card = lockScreenCard(game, nfl, game.id);
  assert.deepEqual(card.state, { away: '7', home: '7', state: 'in', status: '8:16 - 2nd', detail: '', awayTimeouts: 2, homeTimeouts: 3, possession: 'away' });
  // Overtime has its own count, so it's left to the push server's scoreboard.
  const data = fixture('nfl-summary-live');
  data.header.competitions[0].status.period = 5;
  assert.deepEqual(parseSummary(data, nfl).teams.map((t) => t.timeouts), [null, null]);
  // Other sports and finished games carry neither.
  assert.equal('possession' in lockScreenCard(summary('nba-summary', 'nba'), leagueById('nba'), '1').state, false);
  assert.equal('awayTimeouts' in lockScreenCard(summary('nfl-summary', 'nfl'), nfl, '1').state, false);
});

test('a playoff game knows its round and its series', () => {
  // Captured Oct 7 2026: NLDS Game 3, LAD @ ATL.
  const game = summary('mlb-summary-playoffs', 'mlb');
  assert.equal(game.note, 'NLDS - Game 3');
  // The summary lists the current series, the regular season's (ATL 5-1)
  // and the playoff one; the playoff one counts.
  assert.equal(game.series.summary, 'LAD lead series 2-1');
  assert.equal(game.series.bestOf, 5);
  assert.deepEqual(game.series.wins, { 15: 1, 19: 2 });
  assert.equal(game.series.games.length, 5);
  assert.ok(game.series.games.includes(game.id));
  // A regular-season game has none.
  assert.equal(summary('nfl-summary', 'nfl').series, null);
});

test('the lock-screen card goes up now for live games and ones within 15 minutes; later ones are scheduled', () => {
  const now = new Date('2026-10-04T16:00:00Z');
  const pre = (minutes) => ({ state: 'pre', statusName: 'STATUS_SCHEDULED', start: new Date(now.getTime() + minutes * 60_000) });
  assert.equal(LOCK_LEAD_MINUTES, 15);
  assert.ok(canShowOnLockScreen({ state: 'in' }, now));
  assert.ok(canShowOnLockScreen(pre(10), now));
  assert.ok(canShowOnLockScreen(pre(15), now));
  assert.ok(!canShowOnLockScreen(pre(16), now));
  assert.ok(!canShowOnLockScreen(pre(120), now));
  assert.ok(!canShowOnLockScreen({ state: 'post' }, now));
  assert.ok(!canShowOnLockScreen({ ...pre(5), statusName: 'STATUS_POSTPONED' }, now));
  // Before iOS 17.2 the server can't start a card: within six hours, now.
  const old = { canSchedule: false };
  assert.ok(canShowOnLockScreen(pre(120), now, old));
  assert.ok(!canShowOnLockScreen(pre(9 * 60), now, old));
});

test('a live game on a team schedule has no score in the feed, so none is made up', () => {
  const event = (state, scores) => ({
    id: '9',
    date: '2026-10-03T16:00Z',
    competitions: [{
      date: '2026-10-03T16:00Z',
      status: { type: { state, name: state === 'in' ? 'STATUS_IN_PROGRESS' : 'STATUS_FINAL', shortDetail: '' } },
      competitors: [
        { homeAway: 'home', team: { id: '153', displayName: 'North Carolina' }, ...(scores ? { score: { displayValue: scores[0] } } : {}) },
        { homeAway: 'away', team: { id: '87', displayName: 'Notre Dame' }, ...(scores ? { score: { displayValue: scores[1] } } : {}), winner: false },
      ],
    }],
  });
  const ncaaf = leagueById('ncaaf');
  const live = parseSchedule([{ team: { id: '87', displayName: 'Notre Dame' }, events: [event('in')] }], ncaaf, '87');
  assert.equal(live.games[0].score, '');
  const scored = parseSchedule([{ team: { id: '87', displayName: 'Notre Dame' }, events: [event('in', ['20', '21'])] }], ncaaf, '87');
  assert.equal(scored.games[0].score, '21-20');
});
