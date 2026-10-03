import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { leagueById } from '../espn.js';
import {
  standingsUrl, filterStandingsGroup, teamListUrls, rankingsUrl, parseStandings, parseRankings, teamsFromStandings,
  searchTeams, fold,
} from '../standings.js';
import { leagueFilter } from '../espn.js';

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

test('college football standings follow the scoreboard filter', () => {
  const ncaafLeague = leagueById('ncaaf');
  const group = (id) => new URL(standingsUrl(ncaafLeague, filterStandingsGroup(leagueFilter(ncaafLeague, id)))).searchParams.get('group');
  assert.equal(group('top25'), '80');
  assert.equal(group('80'), '80');
  assert.equal(group('81'), '81');
  // A conference reads its own table (group=8 is the SEC alone).
  assert.equal(group('8'), '8');
  assert.equal(group('29'), '29');
  assert.equal(filterStandingsGroup(null), undefined);
  // The team picker reads FBS and FCS; other leagues their one table.
  assert.deepEqual(teamListUrls(ncaafLeague).map((u) => new URL(u).searchParams.get('group')), ['80', '81']);
  assert.deepEqual(teamListUrls(leagueById('nfl')), ['https://site.api.espn.com/apis/v2/sports/football/nfl/standings']);
});

test('a single conference\'s standings are one table at the top level', () => {
  const entry = (id, name) => ({ team: { id, displayName: name, abbreviation: id }, stats: [{ name: 'leagueWinPercent', type: 'leaguewinpercent', value: 1 }] });
  const { groups } = parseStandings({ id: '8', name: 'Southeastern Conference', shortName: 'SEC', standings: { entries: [entry('1', 'A'), entry('2', 'B')] } }, leagueById('ncaaf'));
  assert.deepEqual(groups.map((g) => [g.name, g.rows.length]), [['SEC', 2]]);
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

test('polls keep AP, Coaches and FCS, and drop Division II and III', () => {
  assert.deepEqual(polls.polls.map((p) => p.shortName), ['AP Poll', 'AFCA Coaches Poll', 'FCS Coaches Poll']);
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
    { type: 'afca', name: 'AFCA Division III Coaches Poll', shortName: 'AFCA Div III', ranks },
  ] });
  assert.deepEqual(list.map((p) => p.shortName), ['CFP Rankings', 'AP Poll', 'AFCA Coaches Poll', 'FCS Coaches Poll']);
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

test('team search: abbreviations, then word starts, then anywhere, across leagues', () => {
  const team = (id, name, shortName, abbr) => ({ id, name, shortName, abbr });
  const lists = [
    { league: { id: 'nfl' }, teams: [team('21', 'Philadelphia Eagles', 'Eagles', 'PHI'), team('8', 'Detroit Lions', 'Lions', 'DET')] },
    { league: { id: 'nba' }, teams: [team('20', 'Philadelphia 76ers', '76ers', 'PHI')] },
    { league: { id: 'ncaaf' }, teams: [team('2', 'Auburn Tigers', 'Auburn', 'AUB'), team('245', 'Texas A&M Aggies', 'Texas A&M', 'TA&M'),
      team('2006', 'Akron Zips', 'Akron', 'AKR'), team('99', 'LSU Tigers', 'LSU', 'LSU')] },
    { league: { id: 'nhl' }, teams: [team('10', 'Montréal Canadiens', 'Canadiens', 'MTL'), team('19', 'St. Louis Blues', 'Blues', 'STL')] },
  ];
  const ids = (q) => searchTeams(lists, q).map((r) => `${r.league.id}:${r.team.id}`);
  // Same abbreviation in two leagues: both, in the leagues' order.
  assert.deepEqual(ids('phi'), ['nfl:21', 'nba:20']);
  // A word start beats the middle of a word ("tigers" vs "Detroit").
  assert.deepEqual(ids('tigers'), ['ncaaf:2', 'ncaaf:99']);
  assert.deepEqual(ids('troit'), ['nfl:8']);
  // Accents, punctuation and an ampersand abbreviation.
  assert.deepEqual(ids('montreal'), ['nhl:10']);
  assert.deepEqual(ids('st louis'), ['nhl:19']);
  assert.deepEqual(ids('ta&m'), ['ncaaf:245']);
  assert.deepEqual(ids('philadelphia e'), ['nfl:21']);
  assert.deepEqual(ids('  '), []);
  assert.deepEqual(ids('zzz'), []);
  assert.equal(searchTeams(lists, 'a', 2).length, 2);
  assert.equal(fold('Québec'), 'quebec');
  assert.equal(fold(undefined), '');
});
