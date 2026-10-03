// Standings and poll rankings from ESPN's public feeds. Like espn.js, every
// assumption about the feeds' shape lives here and is covered by tests.

import { teamColor } from './espn.js';

// Standings live under /apis/v2; the /apis/site/v2 path only returns a link.
const STANDINGS_BASE = 'https://site.api.espn.com/apis/v2/sports';
const SITE_BASE = 'https://site.api.espn.com/apis/site/v2/sports';

// group: a college division or one conference in place of the league's own
// (`group=8` is the SEC's table alone, a fraction of the whole division's).
export function standingsUrl(league, group) {
  const url = new URL(`${STANDINGS_BASE}/${league.path}/standings`);
  for (const [key, value] of Object.entries(league.standingsParams ?? {})) url.searchParams.set(key, value);
  if (group) url.searchParams.set('group', group);
  return url.toString();
}

// The standings a scoreboard filter goes with: a conference's own table, else
// its division's (Top 25 reads FBS).
export const filterStandingsGroup = (filter) => (filter ? filter.groups ?? filter.division : undefined);

// Every division's standings, for the team picker: college football's FCS
// teams aren't in the FBS tables.
export function teamListUrls(league) {
  return (league.divisions ?? [undefined]).map((group) => standingsUrl(league, group));
}

export function rankingsUrl(league) {
  return `${SITE_BASE}/${league.path}/rankings`;
}

// A column shows a stat found by `names` (numeric stats) or `types`
// (records such as "vs. Conf.", whose names vary). `key` bolds the column
// that matters most. Columns a feed doesn't carry are dropped.
const W = { id: 'w', label: 'W', title: 'Wins', names: ['wins'] };
const L = { id: 'l', label: 'L', title: 'Losses', names: ['losses'] };
const PCT = { id: 'pct', label: 'Pct', title: 'Win percentage', names: ['winPercent'], key: true };
const GB = { id: 'gb', label: 'GB', title: 'Games behind', names: ['gamesBehind'] };
const STRK = { id: 'strk', label: 'Strk', title: 'Streak', names: ['streak'] };
const GP = { id: 'gp', label: 'GP', title: 'Games played', names: ['gamesPlayed'] };
const PTS = { id: 'pts', label: 'Pts', title: 'Points', names: ['points'], key: true };

// sortBy: the stat to order by when the feed gives no seed or position.
export const TABLES = {
  football: {
    columns: [W, L, { id: 't', label: 'T', title: 'Ties', names: ['ties'] }, PCT,
      { id: 'diff', label: 'Diff', title: 'Point differential', names: ['pointDifferential', 'differential'] }, STRK],
    sortBy: 'winPercent',
  },
  basketball: { columns: [W, L, PCT, GB, STRK], sortBy: 'winPercent' },
  baseball: { columns: [W, L, PCT, GB, STRK], sortBy: 'winPercent' },
  hockey: {
    columns: [GP, W, L, { id: 'otl', label: 'OTL', title: 'Overtime losses', names: ['otLosses', 'overtimeLosses'] }, PTS],
    sortBy: 'points',
  },
  soccer: {
    columns: [GP, W, { id: 'd', label: 'D', title: 'Draws', names: ['ties'] }, L,
      { id: 'gd', label: 'GD', title: 'Goal difference', names: ['pointDifferential'] }, PTS],
    sortBy: 'points',
  },
  // College tables are by conference: conference record first, then overall.
  // leagueWinPercent is the conference winning percentage.
  college: {
    columns: [
      { id: 'conf', label: 'Conf', title: 'Conference record', types: ['vsconf'], key: true },
      { id: 'overall', label: 'Overall', title: 'Overall record', types: ['total'] },
      STRK,
    ],
    sortBy: 'leagueWinPercent',
  },
};

function tableFor(league) {
  if (league.college) return TABLES.college;
  return TABLES[league.path.split('/')[0]] ?? TABLES.basketball;
}

export function parseStandings(data, league) {
  const table = tableFor(league);
  const groups = collectGroups(data).map((node) => {
    const rows = node.standings.entries.map((entry) => parseEntry(entry, table)).filter(Boolean);
    return {
      // College conferences read best short ("Big Ten"); pro ones in full.
      name: (league.college && node.shortName) || node.name || node.abbreviation || '',
      columns: table.columns.filter((c) => rows.some((r) => r.stats[c.id] !== undefined)),
      rows: sortRows(rows),
    };
  }).filter((group) => group.rows.length);
  return { groups };
}

// Conferences and divisions nest in `children` to varying depths; a table is
// any node with entries of its own.
function collectGroups(node) {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node.standings?.entries) && node.standings.entries.length) return [node];
  return (node.children ?? []).flatMap(collectGroups);
}

function parseEntry(entry, table) {
  const team = entry?.team;
  if (!team?.id) return null;
  // College feeds repeat every stat once per split (home, road, vs. conf)
  // under the same name; the split ones have an underscore in their type.
  const stats = (entry.stats ?? []).filter((s) => !String(s.type ?? '').includes('_'));
  const values = {};
  for (const column of table.columns) {
    const stat = stats.find((s) => column.names?.includes(s.name) || column.types?.includes(s.type));
    const value = stat && (stat.displayValue ?? stat.summary);
    if (value !== undefined && value !== null && value !== '') values[column.id] = String(value);
  }
  const number = (name) => {
    const value = Number(stats.find((s) => s.name === name)?.value);
    return Number.isFinite(value) ? value : null;
  };
  return {
    team: {
      id: String(team.id),
      name: team.displayName ?? team.name ?? '',
      shortName: team.shortDisplayName ?? team.name ?? team.displayName ?? '',
      abbr: team.abbreviation ?? '',
      logo: team.logos?.[0]?.href ?? team.logo ?? '',
      color: teamColor(team.color),
    },
    stats: values,
    // x, y, z... once a team has clinched or been eliminated.
    clincher: stats.find((s) => s.name === 'clincher')?.displayValue ?? '',
    note: parseNote(entry.note),
    order: {
      rank: number('rank') > 0 ? number('rank') : null,
      seed: number('playoffSeed') > 0 ? number('playoffSeed') : null,
      key: number(table.sortBy),
      wins: number('wins'),
    },
  };
}

// The feed's entries come in no useful order. Use league position (soccer),
// then playoff seed (pro leagues), then the table's sort stat.
function sortRows(rows) {
  const all = (field) => rows.every((r) => r.order[field] !== null);
  let compare;
  if (all('rank')) compare = (a, b) => a.order.rank - b.order.rank;
  else if (all('seed')) compare = (a, b) => a.order.seed - b.order.seed;
  else compare = (a, b) => (b.order.key ?? -1) - (a.order.key ?? -1) || (b.order.wins ?? 0) - (a.order.wins ?? 0);
  return [...rows].sort(compare).map(({ order, ...row }) => row);
}

function parseNote(note) {
  if (!note?.description) return null;
  const hex = String(note.color ?? '').replace('#', '');
  return /^[0-9a-f]{6}$/i.test(hex) ? { color: `#${hex.toLowerCase()}`, description: note.description } : null;
}

// Every team in a league's standings, for the team picker. (ESPN's own teams
// list can't be fetched from a browser: it sends no CORS header.)
export function teamsFromStandings(standings) {
  const teams = new Map();
  for (const group of standings.groups) for (const row of group.rows) teams.set(row.team.id, row.team);
  return [...teams.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// Case and accents don't count when searching: "quebec" finds "Québec".
export const fold = (text) => String(text ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

// The header's team search across leagues. lists: [{league, teams}] in the
// leagues' order. An abbreviation typed in full comes first, then names with
// a word starting with what was typed, then names containing it anywhere;
// ties keep the leagues' order, then go by name.
export function searchTeams(lists, query, limit = 50) {
  // Punctuation is a space on both sides ("St. Louis" finds "St Louis");
  // abbreviations are matched as typed ("TA&M").
  const raw = fold(query).trim();
  const words = raw.replace(/[^a-z0-9]+/g, ' ').trim();
  if (!words) return [];
  const hits = [];
  lists.forEach(({ league, teams }, order) => {
    for (const team of teams ?? []) {
      const score = matchScore(team, raw, words);
      if (score !== null) hits.push({ league, team, score, order });
    }
  });
  return hits
    .sort((a, b) => a.score - b.score || a.order - b.order || a.team.name.localeCompare(b.team.name))
    .slice(0, limit)
    .map(({ league, team }) => ({ league, team }));
}

function matchScore(team, raw, words) {
  const abbr = fold(team.abbr);
  if (abbr === raw) return 0;
  const text = ` ${fold(`${team.name} ${team.shortName}`).replace(/[^a-z0-9]+/g, ' ')}`;
  if (text.includes(` ${words}`)) return 1;
  if (text.includes(words) || abbr.startsWith(raw)) return 2;
  return null;
}

// AP, Coaches and (late in the season) the CFP lead, then the FCS poll; the
// feed also carries Division II and III polls, which are left out.
const POLL_ORDER = ['cfp', 'ap', 'usa', 'fcs'];
const LOWER_DIVISION = /\bDiv(ision)?\.? ?I{2,3}\b|\bNAIA\b/i;
const isFcs = (poll) => poll.type === 'fcs' || /\bFCS\b/.test(`${poll.name} ${poll.shortName}`);
function pollRank(poll) {
  if (/playoff|\bCFP\b/i.test(`${poll.name} ${poll.shortName}`)) return 0;
  if (isFcs(poll)) return POLL_ORDER.indexOf('fcs');
  return POLL_ORDER.includes(poll.type) ? POLL_ORDER.indexOf(poll.type) : POLL_ORDER.length;
}

export function parseRankings(data) {
  const polls = (data?.rankings ?? [])
    .filter((poll) => Array.isArray(poll?.ranks) && poll.ranks.length)
    .filter((poll) => poll.type !== 'afca' && !LOWER_DIVISION.test(`${poll.name} ${poll.shortName}`))
    .sort((a, b) => pollRank(a) - pollRank(b))
    .map((poll) => {
      // A season's first poll has nothing to move from.
      const first = poll.ranks.every((r) => !(Number(r.previous) > 0));
      return {
        name: poll.name ?? '',
        shortName: poll.shortName ?? poll.name ?? '',
        headline: poll.occurrence?.displayValue ?? '',
        ranks: poll.ranks.map((r) => ({
          rank: Number(r.current),
          // null: the team wasn't ranked in the previous poll.
          movement: first ? 0 : Number(r.previous) > 0 ? Number(r.previous) - Number(r.current) : null,
          record: r.recordSummary ?? '',
          points: Number(r.points) > 0 ? Math.round(Number(r.points)).toLocaleString('en-US') : '',
          firstPlaceVotes: Number(r.firstPlaceVotes) > 0 ? Number(r.firstPlaceVotes) : 0,
          team: pollTeam(r.team),
        })).sort((a, b) => a.rank - b.rank),
        others: (poll.others ?? [])
          .filter((o) => Number(o.points) > 0)
          .map((o) => ({ team: pollTeam(o.team), points: Math.round(Number(o.points)) })),
      };
    });
  return { polls };
}

// Poll teams are college teams: "Texas", not "Texas Longhorns". ESPN serves
// college logos by team id, so one can be had even when the poll omits it.
function pollTeam(team = {}) {
  const id = String(team.id ?? '');
  return {
    id,
    name: team.location ?? team.nickname ?? team.displayName ?? team.name ?? '',
    shortName: team.nickname ?? team.location ?? team.abbreviation ?? '',
    abbr: team.abbreviation ?? '',
    logo: team.logos?.[0]?.href ?? team.logo ?? (id ? `https://a.espncdn.com/i/teamlogos/ncaa/500/${id}.png` : ''),
    color: teamColor(team.color),
  };
}
