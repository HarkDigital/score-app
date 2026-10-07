// A team's season stats, from ESPN's core API (sports.core.api.espn.com,
// CORS ok). The site API's /teams/{id}/statistics serves whatever phase is
// current (an MLB team's postseason only, a basketball team's last season
// during the preseason) and ignores season parameters; the core API takes
// the season and type in the path and ranks every stat across the league.
// As in espn.js, every assumption about the feed's shape lives here.

const CORE_BASE = 'https://sports.core.api.espn.com/v2/sports';

const sportOf = (league) => league.path.split('/')[0];

export function teamStatsUrl(league, teamId, { year, type }) {
  const [sport, name] = league.path.split('/');
  return `${CORE_BASE}/${sport}/leagues/${name}/seasons/${year}/types/${type}/teams/${teamId}/statistics`;
}

// The seasons to try, best first: the regular season the team schedule is
// for (its requestedSeason), then the one before, for a season with no games
// yet (the core API answers 404). Soccer's season is type 1. Labels read
// "2026 regular season", "2025-26 regular season", "2026-27 season".
export function statsSeasons(league, { seasonYear, season }) {
  const year = Number(seasonYear);
  if (seasonYear == null || !Number.isInteger(year) || year < 1900) return [];
  const soccer = sportOf(league) === 'soccer';
  const type = soccer ? 1 : 2;
  const name = /\d{4}(-\d{2})?/.exec(season ?? '')?.[0] ?? String(year);
  const label = (n) => (soccer ? `${n} season` : `${n} regular season`);
  return [
    { year, type, label: label(name) },
    { year: year - 1, type, label: label(previousSeason(name)) },
  ];
}

// "2026" → "2025", "2026-27" → "2025-26".
function previousSeason(name) {
  const [, start, end] = /^(\d{4})(?:-(\d{2}))?$/.exec(name) ?? [];
  if (!start) return name;
  return end ? `${start - 1}-${String((Number(end) + 99) % 100).padStart(2, '0')}` : String(start - 1);
}

// The stats that matter most, per sport: [category, stat, label, options].
// rankFrom: a per-game average has no rank of its own, its total has.
// pct: the feed gives a percentage as a bare number ("44.00").
const KEY_STATS = {
  football: [
    ['scoring', 'totalPointsPerGame', 'Points per game'],
    ['passing', 'yardsPerGame', 'Yards per game'],
    ['passing', 'passingYardsPerGame', 'Passing yards per game'],
    ['rushing', 'rushingYardsPerGame', 'Rushing yards per game'],
    ['miscellaneous', 'thirdDownConvPct', '3rd down', { pct: true }],
    ['miscellaneous', 'redzoneTouchdownPct', 'Red zone TD', { pct: true }],
    ['miscellaneous', 'turnOverDifferential', 'Turnover margin', { signed: true }],
    ['miscellaneous', 'totalTakeaways', 'Takeaways'],
    ['defensive', 'sacks', 'Sacks'],
  ],
  // College football: ESPN has no red zone numbers (every team 0.00) and
  // doesn't rank 3rd-down rate (every team Tied-1st).
  collegeFootball: [
    ['scoring', 'totalPointsPerGame', 'Points per game'],
    ['passing', 'yardsPerGame', 'Yards per game'],
    ['passing', 'passingYardsPerGame', 'Passing yards per game'],
    ['rushing', 'rushingYardsPerGame', 'Rushing yards per game'],
    ['miscellaneous', 'thirdDownConvPct', '3rd down', { pct: true, unranked: true }],
    ['scoring', 'totalTouchdowns', 'Touchdowns'],
    ['miscellaneous', 'turnOverDifferential', 'Turnover margin', { signed: true }],
    ['miscellaneous', 'totalTakeaways', 'Takeaways'],
    ['defensive', 'sacks', 'Sacks'],
  ],
  basketball: [
    ['offensive', 'avgPoints', 'Points per game', { rankFrom: 'points' }],
    ['general', 'avgRebounds', 'Rebounds per game'],
    ['offensive', 'avgAssists', 'Assists per game', { rankFrom: 'assists' }],
    ['offensive', 'fieldGoalPct', 'Field goal', { pct: true }],
    ['offensive', 'threePointPct', '3-point', { pct: true }],
    ['offensive', 'freeThrowPct', 'Free throw', { pct: true }],
    ['defensive', 'avgSteals', 'Steals per game', { rankFrom: 'steals' }],
    ['defensive', 'avgBlocks', 'Blocks per game', { rankFrom: 'blocks' }],
    ['offensive', 'avgTurnovers', 'Turnovers per game', { rankFrom: 'turnovers' }],
  ],
  baseball: [
    ['batting', 'avg', 'Batting average'],
    ['batting', 'runs', 'Runs'],
    ['batting', 'homeRuns', 'Home runs'],
    ['batting', 'OPS', 'OPS'],
    ['batting', 'stolenBases', 'Stolen bases'],
    ['pitching', 'ERA', 'ERA'],
    ['pitching', 'WHIP', 'WHIP'],
    ['pitching', 'strikeouts', 'Strikeouts (pitching)'],
    ['pitching', 'saves', 'Saves'],
  ],
  hockey: [
    ['offensive', 'avgGoals', 'Goals per game', { rankFrom: 'goals' }],
    ['defensive', 'avgGoalsAgainst', 'Goals against per game'],
    ['offensive', 'avgShots', 'Shots per game', { rankFrom: 'shotsTotal' }],
    ['offensive', 'powerPlayPct', 'Power play', { pct: true }],
    ['defensive', 'penaltyKillPct', 'Penalty kill', { pct: true }],
    ['defensive', 'savePct', 'Save percentage'],
    ['offensive', 'shootingPct', 'Shooting', { pct: true }],
    ['offensive', 'faceoffPercent', 'Faceoffs won', { pct: true }],
    ['penalties', 'penaltyMinutes', 'Penalty minutes'],
  ],
  soccer: [
    ['offensive', 'totalGoals', 'Goals'],
    ['offensive', 'avgGoals', 'Goals per game'],
    ['goalKeeping', 'goalsConceded', 'Goals conceded'],
    ['goalKeeping', 'cleanSheet', 'Clean sheets'],
    ['offensive', 'possessionPct', 'Possession', { pct: true }],
    ['offensive', 'totalShots', 'Shots'],
    ['offensive', 'shotsOnTarget', 'Shots on target'],
    ['general', 'yellowCards', 'Yellow cards'],
    ['general', 'redCards', 'Red cards'],
  ],
};

// Games the stats cover, wherever the sport keeps the count.
const GAMES = ['gamesPlayed', 'teamGamesPlayed', 'games', 'appearances'];

// Placeholders the feed fills with zeros (ratings, WAR, per-48 averages,
// qualification flags): left out of All stats.
const JUNK = /Rating$|^ESPN|WARBR|^avg48|^isQualified|^rpi$|^sos$|^powerRank$|^gameDayOfYear$/i;
// And college football's empty red zone numbers.
const COLLEGE_FOOTBALL_JUNK = /^redzone/i;

// "Tied-23rd" reads "T-23rd".
const rankText = (stat) => (stat?.rankDisplayValue ? String(stat.rankDisplayValue).replace(/^Tied-/, 'T-') : '');

// { games, key: [{label, value, rank}], categories: [{name, stats: [{label,
// value, rank}]}] } or null when the feed has no stats.
export function parseTeamStats(data, league) {
  const categories = (data?.splits?.categories ?? []).filter((c) => Array.isArray(c?.stats) && c.stats.length);
  if (!categories.length) return null;
  const find = (category, name) => categories.find((c) => c.name === category)?.stats.find((s) => s?.name === name);
  const all = categories.flatMap((c) => c.stats);
  const games = GAMES.map((name) => all.find((s) => s?.name === name)).find((s) => Number.isFinite(s?.value))?.value ?? null;
  const collegeFootball = league.college && sportOf(league) === 'football';
  const junk = (name) => JUNK.test(name) || (collegeFootball && COLLEGE_FOOTBALL_JUNK.test(name));
  const key = (KEY_STATS[collegeFootball ? 'collegeFootball' : sportOf(league)] ?? []).map(([category, name, label, opts = {}]) => {
    const stat = find(category, name);
    if (!stat || stat.displayValue === undefined) return null;
    let value = String(stat.displayValue);
    // "44.00" reads "44.0%".
    if (opts.pct && !value.endsWith('%')) value = `${Number.isFinite(Number(value)) ? Number(value).toFixed(1) : value}%`;
    if (opts.signed && Number(stat.value) > 0 && !value.startsWith('+')) value = `+${value}`;
    return { label, value, rank: opts.unranked ? '' : rankText(opts.rankFrom ? find(category, opts.rankFrom) : stat) };
  }).filter(Boolean);
  return {
    games,
    key,
    categories: categories.map((c) => {
      const seen = new Set();
      return {
        name: c.displayName || c.name,
        stats: c.stats
          .filter((s) => s?.name && !junk(s.name) && s.displayValue !== undefined && !seen.has(s.name) && seen.add(s.name))
          .map((s) => ({ label: s.displayName || s.name, value: String(s.displayValue), rank: rankText(s) })),
      };
    }).filter((c) => c.stats.length),
  };
}
