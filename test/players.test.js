import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { leagueById } from '../espn.js';
import {
  rosterUrl, athleteUrls, headshotOf, headshotUrl, initials, birthDate,
  parseRoster, parseAthlete, parseOverview, parseCareer, playerSearchUrl, parseSearchPlayers,
} from '../players.js';

// Trimmed from ESPN's site API on Oct 13 2026 (npm run capture:players): the
// Chiefs', Magic's, Iowa's, Dodgers', Oilers' and Manchester United's rosters,
// and the bios, overviews and careers of some of their players.
const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url)));
const nfl = leagueById('nfl');
const names = (group) => group.players.map((p) => p.name);

test('roster and player URLs (common/v3 on site.api, so the host fallback applies)', () => {
  assert.equal(rosterUrl(nfl, '12'), 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/12/roster');
  assert.deepEqual(athleteUrls(nfl, '3139477'), {
    bio: 'https://site.api.espn.com/apis/common/v3/sports/football/nfl/athletes/3139477',
    overview: 'https://site.api.espn.com/apis/common/v3/sports/football/nfl/athletes/3139477/overview',
    career: 'https://site.api.espn.com/apis/common/v3/sports/football/nfl/athletes/3139477/stats',
  });
  // Soccer players have no career feed (404).
  assert.equal(athleteUrls(leagueById('epl'), '124091').career, null);
});

test('football rosters keep ESPN\'s groups, named, and the empty ones go', () => {
  const roster = parseRoster(fixture('nfl-roster'), nfl);
  assert.deepEqual(roster.groups.map((g) => g.title), ['Offense', 'Defense', 'Special teams', 'Injured reserve or out', 'Practice squad']);
  assert.deepEqual(roster.groups[0].players[1], {
    id: '3139477',
    name: 'Patrick Mahomes',
    jersey: '15',
    position: 'QB',
    headshot: 'https://a.espncdn.com/i/headshots/nfl/players/full/3139477.png',
    size: '6\' 2", 225 lbs',
    year: '',
    injury: '',
  });
  const find = (name) => roster.groups.flatMap((g) => g.players).find((p) => p.name === name);
  assert.equal(find('Rashee Rice').injury, 'Questionable');
  // Out, though his status says Day-To-Day: the injury is what counts.
  assert.equal(find('Omarr Norman-Lott').injury, 'Out');
  // Practice squad players can have no number.
  assert.equal(find('Nathan Carter').jersey, '');
});

test('flat rosters are grouped by position', () => {
  const nba = parseRoster(fixture('nba-roster'), leagueById('nba'));
  assert.deepEqual(nba.groups.map((g) => [g.title, names(g)]), [
    ['Guards', ['Desmond Bane', 'Mike Sharavjamts']],
    ['Forwards', ['Paolo Banchero', 'Jamal Cain', 'Izaiyah Nelson']],
    ['Centers', ['Goga Bitadze']],
  ]);
  const sharavjamts = nba.groups[0].players[1];
  assert.equal(sharavjamts.headshot, '');
  assert.equal(sharavjamts.jersey, '');
  const epl = parseRoster(fixture('epl-roster'), leagueById('epl'));
  assert.deepEqual(epl.groups.map((g) => g.title), ['Goalkeepers', 'Defenders', 'Midfielders', 'Forwards']);
  // Soccer rosters mostly have no headshots.
  assert.equal(epl.groups[0].players[0].headshot, '');
});

test('college rosters carry the class; baseball and hockey keep their groups', () => {
  const iowa = parseRoster(fixture('ncaaf-roster'), leagueById('ncaaf'));
  assert.deepEqual(iowa.groups.map((g) => g.title), ['Offense', 'Defense', 'Special teams']);
  assert.equal(iowa.groups[0].players[0].year, 'SO');
  assert.deepEqual(parseRoster(fixture('mlb-roster'), leagueById('mlb')).groups.map((g) => g.title),
    ['Pitchers', 'Catchers', 'Infielders', 'Outfielders', 'Designated Hitter']);
  assert.deepEqual(parseRoster(fixture('nhl-roster'), leagueById('nhl')).groups.map((g) => g.title),
    ['Centers', 'Left Wings', 'Right Wings', 'Defense', 'Goalies']);
  assert.equal(parseRoster({}, nfl), null);
});

test('a player\'s profile: bio facts and ESPN\'s key stats for the position, ranked', () => {
  const mahomes = parseAthlete(fixture('nfl-athlete-qb'), nfl);
  assert.equal(mahomes.name, 'Patrick Mahomes');
  assert.equal(mahomes.jersey, '15');
  assert.equal(mahomes.positionName, 'Quarterback');
  assert.deepEqual(mahomes.team, { id: '12', name: 'Kansas City Chiefs', abbr: 'KC', logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/kc.png', color: '#e31837' });
  assert.deepEqual(mahomes.bio, [
    { label: 'Height', value: '6\' 2"' },
    { label: 'Weight', value: '225 lbs' },
    { label: 'Born', value: 'Sep 17, 1995 (31)' },
    { label: 'Birthplace', value: 'Whitehouse, TX' },
    { label: 'College', value: 'Texas Tech' },
    { label: 'Experience', value: '10th season' },
    { label: 'Draft', value: '2017: Rd 1, Pk 10 (KC)' },
  ]);
  assert.equal(mahomes.season.label, '2026 regular season');
  assert.deepEqual(mahomes.season.stats, [
    { label: 'Passing yards', value: '1,037', rank: '17th' },
    { label: 'Passing touchdowns', value: '9', rank: 'T-8th' },
    { label: 'Interceptions', value: '2', rank: 'T-7th' },
    { label: 'Adjusted QBR', value: '68.5', rank: '9th' },
  ]);
  assert.equal(mahomes.injury, null);
  assert.equal(parseAthlete({}, nfl), null);
});

test('injuries, and labels too long for a tile', () => {
  const thornton = parseAthlete(fixture('nfl-athlete-wr'), nfl);
  assert.equal(thornton.injury.status, 'Injured Reserve');
  assert.match(thornton.injury.text, /injured reserve/);
  // NHL's names are long: the abbreviation, or our own.
  const jarry = parseAthlete(fixture('nhl-athlete-goalie'), leagueById('nhl'));
  assert.deepEqual(jarry.season.stats.map((s) => s.label), ['W-L-OTL', 'GAA', 'Save percentage', 'Shutouts']);
  // A goalie catches; a skater shoots.
  assert.deepEqual(jarry.bio.at(-1), { label: 'Catches', value: 'Left' });
  // Basketball's per-game stats carry no rank.
  const cain = parseAthlete(fixture('nba-athlete'), leagueById('nba'));
  assert.deepEqual(cain.season.stats.map((s) => [s.label, s.value, s.rank]), [
    ['Points per game', '5.4', ''], ['Rebounds per game', '2.0', ''], ['Assists per game', '0.7', ''], ['FG%', '48.7', ''],
  ]);
});

test('baseball\'s bats and throws; college class; soccer nationality and no headshot', () => {
  const betts = parseAthlete(fixture('mlb-athlete-batter'), leagueById('mlb'));
  // displayDOB is day/month/year: 7/10/1992 is October 7.
  assert.deepEqual(betts.bio.find((b) => b.label === 'Born'), { label: 'Born', value: 'Oct 7, 1992 (34)' });
  assert.deepEqual(betts.bio.at(-1), { label: 'Bats/Throws', value: 'Right/Right' });
  const vanderZee = parseAthlete(fixture('ncaaf-athlete-wr'), leagueById('ncaaf'));
  assert.deepEqual(vanderZee.bio.map((b) => b.label), ['Height', 'Weight', 'Birthplace', 'Class']);
  assert.equal(vanderZee.bio.at(-1).value, 'Junior');
  const bruno = parseAthlete(fixture('epl-athlete'), leagueById('epl'));
  assert.equal(bruno.headshot, '');
  assert.deepEqual(bruno.bio.at(-1), { label: 'Nationality', value: 'Portugal' });
  assert.equal(bruno.season.label, '2026-27 Premier League');
  assert.deepEqual(bruno.season.stats[0], { label: 'Starts (sub)', value: '6 (0)', rank: '' });
});

test('recent games: newest first, the player\'s team\'s score first, the league each was in', () => {
  const { games, competitions } = parseOverview(fixture('nfl-recent-qb'), nfl);
  assert.deepEqual(games.map((g) => g.title), ['Passing', 'Rushing']);
  assert.equal(competitions, null);
  const [passing] = games;
  assert.deepEqual(passing.labels, ['CMP', 'ATT', 'YDS', 'CMP%', 'AVG', 'TD', 'INT', 'LNG', 'SACK', 'RTG', 'QBR']);
  assert.deepEqual(passing.rows.map((r) => [r.id, r.home, r.opponent.abbr, r.result, r.score, r.league]), [
    ['401872976', false, 'LV', 'W', '30-27', 'nfl'],
    ['401872952', false, 'MIA', 'W', '24-10', 'nfl'],
    ['401872945', true, 'IND', 'W', '33-30 OT', 'nfl'],
    ['401872931', true, 'DEN', 'W', '31-10', 'nfl'],
  ]);
  assert.deepEqual(passing.rows[0].stats, ['15', '30', '225', '50.0', '7.5', '2', '0', '55', '2', '97.2', '58.7']);
  // The feed puts the winner first: a 6-5 overtime loss is 5-6 OT.
  const goalie = parseOverview(fixture('nhl-recent-goalie'), leagueById('nhl')).games;
  assert.equal(goalie.length, 1);
  assert.equal(goalie[0].title, '');
  assert.deepEqual(goalie[0].rows.map((r) => [r.result, r.score]), [['W', '3-1'], ['L', '5-6 OT']]);
});

test('recent games: a pitcher\'s empty batting goes, playoff notes stay', () => {
  const { games } = parseOverview(fixture('mlb-recent-pitcher'), leagueById('mlb'));
  assert.equal(games.length, 1);
  assert.equal(games[0].labels[3], 'IP');
  assert.equal(games[0].rows[0].note, 'NLCS - Game 2');
});

test('soccer\'s recent matches: doubled labels and a doubled match once, other competitions, season by competition', () => {
  const epl = leagueById('epl');
  const { games, competitions } = parseOverview(fixture('epl-recent'), epl);
  const [log] = games;
  assert.deepEqual(log.labels, ['APP', 'G', 'A', 'SHOT', 'SOG', 'FC', 'FA', 'OF', 'YC', 'RC']);
  assert.deepEqual(log.rows.map((r) => [r.opponent.abbr, r.result, r.score, r.league, r.competition]), [
    ['TOT', 'D', '1-1', 'epl', 'Premier League'],
    ['NOR', 'W', '2-1', null, 'UEFA Nations League'],
    ['DEN', 'W', '4-2', null, 'UEFA Nations League'],
    ['WAL', 'W', '1-0', null, 'UEFA Nations League'],
  ]);
  assert.equal(log.rows[3].stats.length, 10);
  assert.equal(competitions.labels[0], 'STRT');
  assert.deepEqual(competitions.rows.map((r) => [r.name, r.league]).slice(0, 3), [
    ['UEFA Nations League', null],
    ['Champions League', 'ucl'],
    ['English Premier League', 'epl'],
  ]);
  assert.equal(competitions.rows.at(-1).name, '2026 FIFA World Cup');
});

test('career: newest season first, a team per row, the career total', () => {
  const [passing, rushing] = parseCareer(fixture('nfl-career-qb'));
  assert.equal(passing.title, 'Passing');
  assert.equal(rushing.title, 'Rushing');
  assert.deepEqual(passing.labels.slice(0, 5), ['GP', 'CMP', 'ATT', 'CMP%', 'YDS']);
  assert.deepEqual(passing.rows.map((r) => r.season).slice(0, 3), ['2026', '2025', '2024']);
  assert.equal(passing.rows.at(-1).season, '2017');
  assert.equal(passing.rows[0].team, 'KC');
  assert.equal(passing.total[4], '36,976');
  // A season split between teams: each team, then the total, together.
  const [skater] = parseCareer(fixture('nhl-career-skater'));
  assert.equal(skater.title, 'Regular season');
  assert.deepEqual(skater.rows.slice(0, 4).map((r) => `${r.season} ${r.team}`), ['26-27 EDM', '25-26 CHI', '25-26 EDM', '25-26 Total']);
  // Baseball's teams map is keyed by slug and by id.
  const batting = parseCareer(fixture('mlb-career-batter'));
  assert.deepEqual(batting.map((c) => c.title), ['Career batting', 'Postseason batting', 'Expanded batting', 'Advanced batting']);
  assert.equal(batting[0].rows.at(-1).team, 'BOS');
  assert.deepEqual(parseCareer(fixture('nba-career')).map((c) => c.rows[0].team), ['ORL', 'ORL', 'ORL']);
  assert.deepEqual(parseCareer({}), []);
});

test('headshots: either shape, resized through the combiner; initials otherwise', () => {
  assert.equal(headshotOf({ headshot: { href: 'https://a.espncdn.com/i/headshots/nfl/players/full/1.png' } }), 'https://a.espncdn.com/i/headshots/nfl/players/full/1.png');
  assert.equal(headshotOf({ headshot: 'https://a.espncdn.com/i/headshots/mlb/players/full/2.png' }), 'https://a.espncdn.com/i/headshots/mlb/players/full/2.png');
  assert.equal(headshotOf({}), '');
  assert.equal(headshotUrl('https://a.espncdn.com/i/headshots/nfl/players/full/3139477.png', 40),
    'https://a.espncdn.com/combiner/i?img=/i/headshots/nfl/players/full/3139477.png&w=110&h=80&scale=crop&cquality=80');
  assert.equal(headshotUrl('https://example.com/x.png', 40), 'https://example.com/x.png');
  assert.equal(headshotUrl('', 40), '');
  assert.equal(initials('Patrick Mahomes'), 'PM');
  assert.equal(initials('Kenneth Walker III'), 'KW');
  assert.equal(initials('Raphinha'), 'R');
  assert.equal(initials(''), '?');
  assert.equal(birthDate('29/4/1995'), 'Apr 29, 1995');
  assert.equal(birthDate(''), '');
});

// Trimmed from ESPN's search on Oct 13 2026 (npm run capture:players -- search).
test('player search: players only, on site.api so the host fallback applies', () => {
  assert.equal(playerSearchUrl('patrick mah'), 'https://site.api.espn.com/apis/common/v3/search?query=patrick+mah&limit=20&type=player');
});

test('player search: our leagues only, in ESPN\'s order, with team and position', () => {
  const smith = parseSearchPlayers(fixture('search-players-smith'));
  assert.deepEqual(smith.slice(0, 4).map((p) => [p.name, p.league, p.team.abbr, p.position]), [
    ['Jeremiah Smith', 'ncaaf', 'OSU', 'WR'],
    ['Jaxon Smith-Njigba', 'nfl', 'SEA', 'WR'],
    ['DeVonta Smith', 'nfl', 'PHI', 'WR'],
    ['Cade Smith', 'mlb', 'CLE', 'RP'],
  ]);
  assert.deepEqual(smith[1], {
    id: '4430878',
    league: 'nfl',
    name: 'Jaxon Smith-Njigba',
    team: { id: '26', name: 'Seattle Seahawks', abbr: 'SEA', logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/sea.png', color: '#002a5c' },
    position: 'WR',
    jersey: '11',
    headshot: 'https://a.espncdn.com/i/headshots/nfl/players/full/4430878.png',
  });
  // Soccer players come under their domestic league: Taca de Portugal,
  // League One and the like are left out.
  assert.deepEqual(parseSearchPlayers(fixture('search-players-bruno-fernandes')).map((p) => [p.name, p.league, p.team.abbr]), [['Bruno Fernandes', 'epl', 'MAN']]);
  // A rugby player has no league at all.
  assert.deepEqual(parseSearchPlayers(fixture('search-players-ohtani')).map((p) => p.name), ['Shohei Ohtani']);
  // A name half typed matches the start of the last name; a player can have
  // no team.
  const mah = parseSearchPlayers(fixture('search-players-patrick-mah'));
  assert.deepEqual(mah.map((p) => [p.name, p.league]), [['Patrick Mahomes', 'nfl'], ['Patrick Maher', 'ncaam'], ['Patrick Mahoney III', 'ncaaf']]);
  assert.equal(mah[1].team, null);
  assert.deepEqual(parseSearchPlayers({}), []);
  assert.deepEqual(parseSearchPlayers({ items: [{ type: 'team', id: '1', league: 'nfl' }, { type: 'player', id: '2', league: 'nfl', isRetired: true }] }), []);
});
