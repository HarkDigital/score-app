import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { leagueById } from '../espn.js';
import { parseSchedule, scheduleUrls } from '../details.js';
import { teamStatsUrl, statsSeasons, parseTeamStats } from '../stats.js';

// Trimmed from ESPN's core API on Oct 6 2026: the Chiefs and Yankees' 2026
// regular seasons, the Celtics' 2025-26, the Bruins' 2026-27 so far, Arsenal's
// 2026-27 so far, Iowa's 2026.
const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url)));
const stats = (name, league) => parseTeamStats(fixture(name), leagueById(league));
const byLabel = (s, label) => s.key.find((k) => k.label === label);

test('team stats come from the core API, by season and type', () => {
  assert.equal(teamStatsUrl(leagueById('nfl'), '12', { year: 2026, type: 2 }),
    'https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/2026/types/2/teams/12/statistics');
  assert.equal(teamStatsUrl(leagueById('epl'), '359', { year: 2026, type: 1 }),
    'https://sports.core.api.espn.com/v2/sports/soccer/leagues/eng.1/seasons/2026/types/1/teams/359/statistics');
});

test('the season comes from the team schedule: its requested season, then the one before', () => {
  // Captured in the off season: the current season says 2025, the requested one 2026.
  const nflSchedule = parseSchedule([fixture('nfl-schedule')], leagueById('nfl'), '12');
  assert.equal(nflSchedule.seasonYear, 2026);
  assert.deepEqual(statsSeasons(leagueById('nfl'), nflSchedule), [
    { year: 2026, type: 2, label: '2026 regular season' },
    { year: 2025, type: 2, label: '2025 regular season' },
  ]);
  assert.deepEqual(statsSeasons(leagueById('nba'), { seasonYear: 2027, season: '2026-27' }).map((s) => s.label),
    ['2026-27 regular season', '2025-26 regular season']);
  // Soccer's season is type 1, named from "2026-27 English Premier League".
  assert.deepEqual(statsSeasons(leagueById('epl'), { seasonYear: 2026, season: '2026-27 English Premier League' }), [
    { year: 2026, type: 1, label: '2026-27 season' },
    { year: 2025, type: 1, label: '2025-26 season' },
  ]);
  assert.deepEqual(statsSeasons(leagueById('nfl'), { seasonYear: null }), []);
  assert.ok(scheduleUrls(leagueById('nfl'), '12')[0].endsWith('seasontype=2'));
});

test('football key stats, with league ranks', () => {
  const kc = stats('nfl-team-stats', 'nfl');
  assert.equal(kc.games, 4);
  assert.deepEqual(byLabel(kc, 'Points per game'), { label: 'Points per game', value: '29.5', rank: '6th' });
  assert.deepEqual(byLabel(kc, '3rd down'), { label: '3rd down', value: '44.0%', rank: '8th' });
  assert.equal(byLabel(kc, 'Turnover margin').value, '+5');
  assert.equal(byLabel(kc, 'Turnover margin').rank, 'T-2nd');
  assert.equal(kc.key.length, 9);
});

test('per-game averages take their totals\' ranks; percentages get a %', () => {
  const bos = stats('nba-team-stats', 'nba');
  assert.equal(bos.games, 82);
  assert.deepEqual(byLabel(bos, 'Points per game'), { label: 'Points per game', value: '114.9', rank: '3rd' });
  assert.equal(byLabel(bos, '3-point').value, '36.7%');
  const nyy = stats('mlb-team-stats', 'mlb');
  assert.equal(nyy.games, 161);
  assert.deepEqual(byLabel(nyy, 'ERA'), { label: 'ERA', value: '3.24', rank: '1st' });
  const bruins = stats('nhl-team-stats', 'nhl');
  assert.equal(bruins.games, 4);
  assert.equal(byLabel(bruins, 'Save percentage').value, '.909');
  assert.equal(byLabel(bruins, 'Penalty kill').value, '72.7%');
});

test('soccer has no ranks; all stats skip the feed\'s zero placeholders', () => {
  const ars = stats('epl-team-stats', 'epl');
  assert.equal(ars.games, 5);
  assert.deepEqual(byLabel(ars, 'Goals'), { label: 'Goals', value: '8', rank: '' });
  assert.equal(byLabel(ars, 'Possession').value, '59.5%');
  const bos = stats('nba-team-stats', 'nba');
  const labels = bos.categories.flatMap((c) => c.stats.map((s) => s.label));
  assert.ok(!labels.some((l) => /Rating|48/.test(l)));
  assert.equal(parseTeamStats({ splits: { categories: [] } }, leagueById('nfl')), null);
  assert.equal(parseTeamStats(null, leagueById('nfl')), null);
});

test('college football: no red zone (ESPN has none) and no rank on 3rd-down rate', () => {
  const iowa = stats('ncaaf-team-stats', 'ncaaf');
  assert.equal(byLabel(iowa, 'Red zone TD'), undefined);
  assert.equal(byLabel(iowa, '3rd down').rank, '');
  assert.ok(byLabel(iowa, 'Touchdowns'));
  assert.ok(byLabel(iowa, 'Points per game').rank);
  assert.ok(!iowa.categories.flatMap((c) => c.stats).some((s) => /red ?zone/i.test(s.label)));
  // The NFL keeps both.
  assert.ok(byLabel(stats('nfl-team-stats', 'nfl'), 'Red zone TD'));
});
