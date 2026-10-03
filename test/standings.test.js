import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { leagueById } from '../espn.js';
import { standingsUrl, rankingsUrl, parseStandings, parseRankings, teamsFromStandings } from '../standings.js';

// Trimmed from real ESPN responses (2024-25 seasons and the 2026 week 4 polls).
const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url)));
const nfl = parseStandings(fixture('nfl-standings'), leagueById('nfl'));
const epl = parseStandings(fixture('epl-standings'), leagueById('epl'));
const ncaaf = parseStandings(fixture('ncaaf-standings'), leagueById('ncaaf'));
const polls = parseRankings(fixture('ncaaf-rankings'));

test('standings come from /apis/v2, college limited to its division', () => {
  assert.equal(standingsUrl(leagueById('nfl')), 'https://site.api.espn.com/apis/v2/sports/football/nfl/standings');
  assert.equal(new URL(standingsUrl(leagueById('ncaaf'))).searchParams.get('group'), '80');
  assert.equal(new URL(standingsUrl(leagueById('ncaam'))).searchParams.get('group'), '50');
  assert.equal(rankingsUrl(leagueById('ncaam')), 'https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/rankings');
});

test('pro standings are ordered by playoff seed, not feed order', () => {
  assert.deepEqual(nfl.groups.map((g) => g.name), ['American Football Conference', 'National Football Conference']);
  const afc = nfl.groups[0];
  // The feed lists the 1 seed last.
  assert.deepEqual(afc.rows.map((r) => r.team.abbr), ['KC', 'BUF', 'BAL', 'HOU', 'LAC', 'PIT']);
  assert.deepEqual(afc.columns.map((c) => c.label), ['W', 'L', 'T', 'Pct', 'Diff', 'Strk']);
  assert.deepEqual(afc.rows[1].stats, { w: '13', l: '4', t: '0', pct: '.765', diff: '+157', strk: 'L1' });
  assert.equal(afc.rows[1].clincher, 'z');
  assert.equal(afc.rows[1].team.logo, 'https://a.espncdn.com/i/teamlogos/nfl/500/buf.png');
  assert.equal(afc.rows[1].note, null);
});

test('soccer tables use league position, goal difference and zone notes', () => {
  const table = epl.groups[0];
  assert.deepEqual(table.columns.map((c) => c.label), ['GP', 'W', 'D', 'L', 'GD', 'Pts']);
  assert.deepEqual(table.rows.map((r) => r.team.abbr), ['ARS', 'MNC', 'MAN', 'WHU', 'BUR', 'WOL']);
  assert.deepEqual(table.rows[0].stats, { gp: '38', w: '26', d: '7', l: '5', gd: '+44', pts: '85' });
  assert.deepEqual(table.rows[0].note, { color: '#81d6ac', description: 'Champions League' });
  assert.deepEqual(table.rows.at(-1).note, { color: '#ff7f84', description: 'Relegation' });
});

test('college standings are by conference and ignore per-split copies of stats', () => {
  // Sun Belt nests its divisions one level deeper.
  assert.deepEqual(ncaaf.groups.map((g) => g.name), ['Big Ten', 'Sun Belt - East', 'Sun Belt - West']);
  const bigTen = ncaaf.groups[0];
  assert.deepEqual(bigTen.columns.map((c) => c.label), ['Conf', 'Overall', 'Strk']);
  assert.deepEqual(bigTen.rows.map((r) => r.team.abbr), ['ORE', 'IU', 'PSU', 'OSU']);
  // The fixture puts a road-games streak ahead of the overall one under the same name.
  assert.deepEqual(bigTen.rows[0].stats, { conf: '9-0', overall: '13-1', strk: 'L1' });
});

test('every team in the standings is offered in the picker, alphabetically', () => {
  const teams = teamsFromStandings(nfl);
  assert.equal(teams.length, 12);
  assert.equal(teams[0].name, 'Baltimore Ravens');
  assert.equal(new Set(teams.map((t) => t.id)).size, 12);
  assert.deepEqual(teamsFromStandings({ groups: [] }), []);
});

test('polls keep AP and Coaches, and drop FCS and lower divisions', () => {
  assert.deepEqual(polls.polls.map((p) => p.shortName), ['AP Poll', 'AFCA Coaches Poll']);
  const ap = polls.polls[0];
  assert.equal(ap.headline, 'Week 4');
  assert.deepEqual(ap.ranks.map((r) => r.team.abbr), ['TEX', 'UGA', 'ND', 'MISS', 'IU']);
  assert.deepEqual(ap.ranks[0], {
    rank: 1,
    movement: 0,
    record: '3-0',
    points: '1,706',
    firstPlaceVotes: 58,
    team: { id: '251', name: 'Texas', shortName: 'Texas', abbr: 'TEX', logo: 'https://a.espncdn.com/i/teamlogos/ncaa/500/251.png', color: null },
  });
  assert.equal(ap.ranks[3].movement, 4);
  assert.equal(ap.ranks[4].movement, -1);
  assert.deepEqual(ap.others.map((o) => `${o.team.name} ${o.points}`), ['Washington 107', 'Kentucky 98', 'West Virginia 93']);
});

test('the CFP rankings lead once they exist, whatever the feed calls them', () => {
  const ranks = [{ current: 1, previous: 1, team: { id: '1', location: 'Somewhere' } }];
  const { polls: list } = parseRankings({ rankings: [
    { type: 'ap', shortName: 'AP Poll', ranks },
    { type: 'usa', shortName: 'AFCA Coaches Poll', ranks },
    { type: 'playoff', name: 'College Football Playoff Rankings', shortName: 'CFP Rankings', ranks },
    { type: 'fcs', shortName: 'FCS Coaches Poll', ranks },
    { type: 'other', name: 'AFCA Division II Coaches Poll', shortName: 'AFCA Div II', ranks },
  ] });
  assert.deepEqual(list.map((p) => p.shortName), ['CFP Rankings', 'AP Poll', 'AFCA Coaches Poll']);
});

test('poll movement: new entries and the first poll of a season', () => {
  const poll = (ranks) => parseRankings({ rankings: [{ type: 'ap', shortName: 'AP Poll', ranks }] }).polls[0].ranks;
  const team = { id: '1', location: 'Somewhere' };
  assert.deepEqual(poll([
    { current: 1, previous: 2, team },
    { current: 2, previous: 0, team },
  ]).map((r) => r.movement), [1, null]);
  assert.deepEqual(poll([
    { current: 1, previous: 0, team },
    { current: 2, previous: 0, team },
  ]).map((r) => r.movement), [0, 0]);
  assert.deepEqual(parseRankings({}).polls, []);
});

test('feeds without tables parse to nothing rather than failing', () => {
  assert.deepEqual(parseStandings({ fullViewLink: { href: 'x' } }, leagueById('mlb')), { groups: [] });
  assert.deepEqual(parseStandings(null, leagueById('nhl')), { groups: [] });
});
