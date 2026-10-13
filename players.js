// Players: a team's roster, and a player's page (profile, this season's key
// stats, recent games, career by season) from ESPN's site API. As with
// espn.js, every assumption about the feeds' shape lives here and is covered
// by tests (test/players.test.js, fixtures trimmed from real responses).
// Every feed here sends Access-Control-Allow-Origin: * and is served by both
// site hosts, so getJson's site.web.api fallback applies.

import { LEAGUES, teamColor } from './espn.js';
import { rankText } from './stats.js';

const SITE = 'https://site.api.espn.com/apis/site/v2/sports';
const COMMON = 'https://site.api.espn.com/apis/common/v3/sports';

const sportOf = (league) => league.path.split('/')[0];

export function rosterUrl(league, teamId) {
  return `${SITE}/${league.path}/teams/${encodeURIComponent(teamId)}/roster`;
}

// The player page's feeds: the profile (with ESPN's four key stats for the
// position), the overview (the last five games; soccer: this season by
// competition) and the career by season, which soccer players don't have
// (404).
export function athleteUrls(league, athleteId) {
  const base = `${COMMON}/${league.path}/athletes/${encodeURIComponent(athleteId)}`;
  return { bio: base, overview: `${base}/overview`, career: sportOf(league) === 'soccer' ? null : `${base}/stats` };
}

// Summaries and rosters give a headshot as {href}; some feeds as a plain URL.
export const headshotOf = (athlete) =>
  (typeof athlete?.headshot === 'string' ? athlete.headshot : athlete?.headshot?.href) || '';

// A headshot at the size it's shown (height in CSS pixels, doubled for
// retina): ESPN's are 350x254 PNGs, and its resizer (combiner, as for news
// photos) shrinks one keeping that shape. The page crops it round.
export function headshotUrl(url, height) {
  const match = /^https:\/\/a\.espncdn\.com(\/i\/headshots\/[^?#]+)$/.exec(url ?? '');
  if (!match) return url || '';
  const h = height * 2;
  return `https://a.espncdn.com/combiner/i?img=${match[1]}&w=${Math.round((h * 350) / 254)}&h=${h}&scale=crop&cquality=80`;
}

// "Patrick Mahomes" → PM, "Kenneth Walker III" → KW: the badge when there's
// no headshot.
export function initials(name) {
  const words = String(name ?? '').split(/\s+/).filter((w) => w && !/^(jr|sr|ii|iii|iv|v)\.?$/i.test(w));
  if (!words.length) return '?';
  return (words[0][0] + (words.length > 1 ? words[words.length - 1][0] : '')).toUpperCase();
}

// "Points Per Game" reads "Points per game"; abbreviations stay as they are.
const sentence = (text) => String(text ?? '').trim().split(/\s+/).map((w, i) => (i && /^[A-Z][a-z]/.test(w) ? w.toLowerCase() : w)).join(' ');
const capitalize = (text) => (text ? text[0].toUpperCase() + text.slice(1) : '');

// The slug in a game link's leagueAbbrev ("eng.1") as one of our leagues.
const leagueBySlug = (slug) => (slug ? LEAGUES.find((l) => l.path.split('/')[1] === slug) ?? null : null);

// ---- Roster ----

// Football and hockey rosters come in groups (offense, Centers...), baseball
// by Pitchers, Catchers and so on; the rest come flat and are grouped by
// position here, in this order.
const GROUP_TITLES = {
  offense: 'Offense',
  defense: 'Defense',
  specialTeam: 'Special teams',
  injuredReserveOrOut: 'Injured reserve or out',
  suspended: 'Suspended',
  practiceSquad: 'Practice squad',
};
const POSITION_GROUPS = {
  basketball: [['G', 'Guards'], ['F', 'Forwards'], ['C', 'Centers']],
  soccer: [['G', 'Goalkeepers'], ['D', 'Defenders'], ['M', 'Midfielders'], ['F', 'Forwards']],
};

// { groups: [{ title, players: [{ id, name, jersey, position, headshot, size,
// year, injury }] }] } or null.
export function parseRoster(data, league) {
  const list = data?.athletes;
  if (!Array.isArray(list)) return null;
  const player = (a) => rosterPlayer(a, league);
  let groups;
  if (list.some((g) => Array.isArray(g?.items))) {
    groups = list.map((g) => ({ title: GROUP_TITLES[g.position] ?? g.position ?? '', players: (g.items ?? []).map(player) }));
  } else {
    const players = list.map(player);
    const order = POSITION_GROUPS[sportOf(league)] ?? [];
    groups = order.map(([abbr, title]) => ({ title, players: players.filter((p) => p.position === abbr) }));
    const rest = players.filter((p) => !order.some(([abbr]) => abbr === p.position));
    if (rest.length) groups.push({ title: order.length ? 'Others' : 'Players', players: rest });
  }
  return { groups: groups.filter((g) => g.players.length) };
}

function rosterPlayer(a, league) {
  return {
    id: String(a.id ?? ''),
    name: a.displayName ?? a.fullName ?? '',
    jersey: a.jersey ?? '',
    position: a.position?.abbreviation ?? '',
    headshot: headshotOf(a),
    size: [a.displayHeight, a.displayWeight].filter(Boolean).join(', '),
    // A college player's class ("SO").
    year: league.college ? a.experience?.abbreviation ?? '' : '',
    // The injury's status, not the player's: a player on injured reserve
    // can be "Day-To-Day" in status.
    injury: a.injuries?.[0]?.status ?? '',
  };
}

// ---- Profile ----

// Key stats whose names don't shorten well.
const STAT_LABELS = {
  'wins-losses': 'W-L',
  'wins-losses-overtimeLosses': 'W-L-OTL',
  'starts-subIns': 'Starts (sub)',
  OPS: 'OPS',
};

// The shortest of ESPN's names that still reads: "Points per game", but "FG%"
// for "Field Goal Percentage" and "GAA" for "Goals Against Average".
function statLabel(stat) {
  if (STAT_LABELS[stat.name]) return STAT_LABELS[stat.name];
  const name = [stat.displayName, stat.shortDisplayName].find((n) => n && n.length <= 20) ?? stat.abbreviation ?? stat.name ?? '';
  return sentence(name);
}

// displayDOB is day/month/year ("17/9/1995"): "Sep 17, 1995".
export function birthDate(text) {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text ?? '');
  if (!match) return '';
  const date = new Date(Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1])));
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

// { id, name, jersey, position, positionName, headshot, team, injury, bio:
// [{label, value}], season: { label, stats: [{label, value, rank}] } } or null.
export function parseAthlete(data, league) {
  const a = data?.athlete;
  if (!a?.id) return null;
  const sport = sportOf(league);
  const t = a.team;
  const born = birthDate(a.displayDOB);
  const injury = a.injuries?.[0];
  const bio = [
    ['Height', a.displayHeight],
    ['Weight', a.displayWeight],
    born ? ['Born', a.age ? `${born} (${a.age})` : born] : ['Age', a.age],
    ['Birthplace', a.displayBirthPlace],
    // A college player's college is the team.
    ['College', league.college ? '' : a.college?.name],
    league.college ? ['Class', a.displayExperience] : ['Experience', sentence(a.displayExperience)],
    ['Draft', a.displayDraft],
    ['Bats/Throws', a.displayBatsThrows],
    ...(sport === 'hockey' ? [[a.position?.abbreviation === 'G' ? 'Catches' : 'Shoots', a.hand?.displayValue]] : []),
    ...(sport === 'soccer' ? [['Nationality', a.citizenship]] : []),
  ].filter(([, value]) => value != null && value !== '').map(([label, value]) => ({ label, value: String(value) }));
  const summary = a.statsSummary;
  return {
    id: String(a.id),
    name: a.displayName ?? a.fullName ?? '',
    jersey: a.jersey ?? '',
    position: a.position?.abbreviation ?? '',
    positionName: a.position?.displayName ?? '',
    headshot: headshotOf(a),
    team: t?.id ? {
      id: String(t.id),
      name: t.displayName ?? t.name ?? '',
      abbr: t.abbreviation ?? '',
      logo: t.logos?.[0]?.href ?? t.logo ?? '',
      color: teamColor(t.color),
    } : null,
    injury: injury?.status ? { status: injury.status, text: injury.shortComment ?? '' } : null,
    bio,
    // "2026 regular season stats" reads "2026 regular season".
    season: summary?.statistics?.length ? {
      label: String(summary.displayName ?? '').replace(/\s+stats$/i, ''),
      stats: summary.statistics.map((s) => ({ label: statLabel(s), value: String(s.displayValue ?? ''), rank: rankText(s) })),
    } : null,
  };
}

// ---- Overview: recent games, and soccer's season by competition ----

// A stat with nothing in it: "", "-", "0", "0.0", ".000".
const EMPTY = /^(-|[0.]*)$/;

// { games: [{ title, labels, rows: [game + stats] }], competitions } where a
// game is { id, date, home, opponent, result, score, note, league,
// competition }, newest first. competitions (soccer only): { labels, rows:
// [{ name, league, stats }] }.
export function parseOverview(data, league) {
  const log = data?.gameLog;
  const events = log?.events ?? {};
  let games = (log?.statistics ?? []).map((group) => {
    // Soccer can list its labels twice over, and a match twice with its stats
    // doubled: one copy of each.
    let labels = group.labels ?? [];
    const half = labels.length / 2;
    if (half && Number.isInteger(half) && labels.slice(0, half).join() === labels.slice(half).join()) labels = labels.slice(0, half);
    const seen = new Set();
    const rows = (group.events ?? [])
      .filter((e) => events[e.eventId] && !seen.has(e.eventId) && seen.add(e.eventId))
      .map((e) => ({ ...recentGame(events[e.eventId]), stats: (e.stats ?? []).slice(0, labels.length).map(String) }))
      .sort((x, y) => y.date - x.date);
    return { title: capitalize(group.displayName ?? ''), labels, rows };
  });
  // Groups with nothing in them: a pitcher's batting (dashes, or a 0 for 0),
  // a receiver's fumbles.
  games = games.filter((g) => g.rows.some((r) => r.stats.some((v) => !EMPTY.test(v))));
  // One group needs no title ("totals", "goaltender").
  if (games.length === 1) games[0].title = '';
  const stats = data?.statistics;
  const competitions = sportOf(league) === 'soccer' && Array.isArray(stats?.splits) && stats.splits.length
    ? {
      labels: stats.labels ?? [],
      // "2026-27 Champions League" reads "Champions League"; "2026 FIFA World
      // Cup" keeps its year.
      rows: stats.splits.map((s) => ({ name: String(s.displayName ?? '').replace(/^\d{4}-\d{2}\s+/, ''), league: leagueBySlug(s.leagueSlug)?.id ?? null, stats: (s.stats ?? []).map(String) })),
    }
    : null;
  return { games, competitions };
}

function recentGame(e) {
  const home = String(e.homeTeamId) === String(e.team?.id);
  const own = home ? e.homeTeamScore : e.awayTeamScore;
  const other = home ? e.awayTeamScore : e.homeTeamScore;
  // The feed's score has the winner first, then OT or SO ("6-5 OT"); the
  // page shows the player's team first, like the team schedule.
  const extra = /\d\s+([A-Z/0-9]+)$/.exec(e.score ?? '')?.[1] ?? '';
  const slug = (e.links ?? []).map((l) => /[?&]leagueAbbrev=([^&]+)/.exec(l.href ?? '')?.[1]).find(Boolean);
  return {
    id: String(e.id ?? ''),
    date: new Date(e.gameDate),
    home: e.atVs !== '@',
    opponent: {
      id: String(e.opponent?.id ?? ''),
      name: e.opponent?.displayName ?? '',
      abbr: e.opponent?.abbreviation ?? '',
      logo: e.opponent?.logo ?? '',
    },
    // W, L, D (soccer) or T.
    result: e.gameResult ?? '',
    score: own != null && other != null ? `${own}-${other}${extra ? ` ${extra}` : ''}` : e.score ?? '',
    // "NLCS - Game 2".
    note: e.eventNote ?? '',
    // The league it was played in, when it's one of ours (a Premier League
    // player's Champions League match opens there); null for the rest.
    league: leagueBySlug(slug)?.id ?? null,
    competition: e.leagueShortName ?? e.leagueName ?? '',
  };
}

// ---- Career ----

// [{ title, labels, rows: [{ season, team, stats }], total }], newest season
// first. A season split between teams has a row per team, then the "Total".
export function parseCareer(data) {
  const teams = data?.teams ?? {};
  const teamOf = (s) => {
    const team = teams[s.teamSlug] ?? Object.values(teams).find((t) => s.teamId && String(t.id) === String(s.teamId));
    if (team) return team.abbreviation ?? '';
    return /totals/i.test(s.teamSlug ?? s.displayName ?? '') ? 'Total' : '';
  };
  return (data?.categories ?? []).map((c) => ({
    title: capitalize(sentence(c.displayName ?? c.name ?? '')),
    labels: c.labels ?? [],
    rows: (c.statistics ?? [])
      .map((s) => ({ season: s.season?.displayName ?? '', year: Number(s.season?.year) || 0, team: teamOf(s), stats: (s.stats ?? []).map(String) }))
      // Stable, so a split season keeps its teams, then its total.
      .sort((x, y) => y.year - x.year),
    total: Array.isArray(c.totals) && c.totals.length ? c.totals.map(String) : null,
  })).filter((c) => c.rows.length);
}
