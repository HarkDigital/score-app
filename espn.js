// Data layer: ESPN's public scoreboard feed, the same one espn.com's own
// scoreboard reads. It's unofficial (no API key, no SLA), so everything that
// touches its shape lives here and is covered by test/espn.test.js.

const BASE = 'https://site.api.espn.com/apis/site/v2/sports';

// weekly: football is browsed by week rather than by day.
// homeFirst: soccer lists the home side first; US sports list away first.
export const LEAGUES = [
  { id: 'nfl', label: 'NFL', path: 'football/nfl', weekly: true },
  { id: 'nba', label: 'NBA', path: 'basketball/nba' },
  { id: 'mlb', label: 'MLB', path: 'baseball/mlb' },
  { id: 'nhl', label: 'NHL', path: 'hockey/nhl' },
  { id: 'ncaaf', label: 'NCAAF', path: 'football/college-football', weekly: true, params: { groups: '80', limit: '300' } },
  { id: 'ncaam', label: 'NCAAM', path: 'basketball/mens-college-basketball', params: { groups: '50', limit: '400' } },
  { id: 'wnba', label: 'WNBA', path: 'basketball/wnba' },
  { id: 'mls', label: 'MLS', path: 'soccer/usa.1', homeFirst: true },
  { id: 'epl', label: 'Premier League', path: 'soccer/eng.1', homeFirst: true },
  { id: 'ucl', label: 'Champions League', path: 'soccer/uefa.champions', homeFirst: true },
];

export function scoreboardUrl(league, { date, week } = {}) {
  const url = new URL(`${BASE}/${league.path}/scoreboard`);
  for (const [key, value] of Object.entries(league.params ?? {})) url.searchParams.set(key, value);
  if (league.weekly) {
    // No week means "the current week", which ESPN works out for us.
    if (week) {
      url.searchParams.set('seasontype', String(week.seasonType));
      url.searchParams.set('week', String(week.week));
    }
  } else if (date) {
    url.searchParams.set('dates', ymd(date));
  }
  return url.toString();
}

export function parseScoreboard(data, league) {
  return {
    games: (data?.events ?? []).map((event) => parseGame(event, league)).filter(Boolean),
    week: data?.season?.type && data?.week?.number
      ? { seasonType: Number(data.season.type), week: Number(data.week.number) }
      : null,
    weeks: parseCalendar(data?.leagues?.[0]?.calendar),
  };
}

function parseGame(event, league) {
  const comp = event.competitions?.[0];
  if (!comp) return null;
  const type = (comp.status ?? event.status)?.type ?? {};
  const state = type.state ?? 'pre'; // 'pre' | 'in' | 'post'
  const competitors = comp.competitors ?? [];
  const home = competitors.find((c) => c.homeAway === 'home') ?? competitors[0];
  const away = competitors.find((c) => c.homeAway === 'away') ?? competitors[1];
  const situation = state === 'in' ? comp.situation : null;
  return {
    id: event.id,
    start: new Date(comp.date ?? event.date),
    timeTbd: comp.timeValid === false,
    state,
    statusName: type.name ?? '',
    statusText: type.shortDetail ?? type.detail ?? '',
    teams: (league.homeFirst ? [home, away] : [away, home])
      .filter(Boolean)
      .map((c) => parseTeam(c, state, situation)),
    broadcast: [...new Set((comp.broadcasts ?? []).flatMap((b) => b.names ?? []))].join(', '),
    detail: situationText(situation),
    note: comp.notes?.[0]?.headline ?? '',
  };
}

function parseTeam(c, state, situation) {
  const team = c.team ?? {};
  const rank = c.curatedRank?.current;
  return {
    id: team.id,
    name: team.shortDisplayName ?? team.displayName ?? team.name ?? 'TBD',
    abbr: team.abbreviation ?? '',
    logo: team.logo ?? '',
    record: c.records?.[0]?.summary ?? '',
    // ESPN uses 99 for "unranked".
    rank: rank >= 1 && rank <= 25 ? rank : null,
    // Pre-game scores come through as "0"; hide them.
    score: state === 'pre' ? '' : String(c.score?.displayValue ?? c.score ?? ''),
    winner: c.winner === true,
    possession: situation?.possession != null && situation.possession === team.id,
  };
}

function situationText(s) {
  if (!s) return '';
  if (s.downDistanceText) return s.downDistanceText;
  if (typeof s.outs === 'number' && s.outs < 3) {
    const bases = [s.onFirst && '1st', s.onSecond && '2nd', s.onThird && '3rd'].filter(Boolean);
    const outs = `${s.outs} out${s.outs === 1 ? '' : 's'}`;
    return bases.length ? `${outs} · On ${bases.join(', ')}` : outs;
  }
  return '';
}

// Football calendars are a list of season types (pre/regular/post), each with
// week entries. Flatten them so prev/next can cross season-type boundaries.
function parseCalendar(calendar) {
  if (!Array.isArray(calendar)) return [];
  return calendar
    .filter((seasonType) => Array.isArray(seasonType?.entries) && Number(seasonType.value) <= 3)
    .flatMap((seasonType) => seasonType.entries.map((entry) => ({
      seasonType: Number(seasonType.value),
      week: Number(entry.value),
      label: entry.label,
    })));
}

export function weekLabel(board) {
  const cur = board?.week;
  if (!cur) return 'This week';
  const entry = board.weeks.find((w) => w.seasonType === cur.seasonType && w.week === cur.week);
  return entry?.label ?? `Week ${cur.week}`;
}

export function adjacentWeek(board, dir) {
  const cur = board?.week;
  if (!cur) return null;
  const i = board.weeks.findIndex((w) => w.seasonType === cur.seasonType && w.week === cur.week);
  if (i === -1) {
    const week = cur.week + dir;
    return week >= 1 ? { seasonType: cur.seasonType, week } : null;
  }
  return board.weeks[i + dir] ?? null;
}

const STATE_ORDER = { in: 0, pre: 1, post: 2 };
const GROUP_LABELS = { in: 'Live', pre: 'Upcoming', post: 'Final' };

export function groupGames(games) {
  const sorted = [...games].sort(
    (a, b) => (STATE_ORDER[a.state] ?? 1) - (STATE_ORDER[b.state] ?? 1) || a.start - b.start,
  );
  return Object.keys(GROUP_LABELS)
    .map((key) => ({ key, label: GROUP_LABELS[key], games: sorted.filter((g) => g.state === key) }))
    .filter((group) => group.games.length);
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

// How long to wait before re-fetching, or null to stop auto-refreshing.
export function refreshDelay(games, now = Date.now()) {
  if (games.some((g) => g.state === 'in')) return 15_000;
  const upcoming = games.filter((g) => g.state === 'pre' && !g.timeTbd).map((g) => g.start - now);
  // About to start, or past its start time but not marked live yet.
  if (upcoming.some((ms) => ms < 30 * MINUTE && ms > -6 * HOUR)) return 30_000;
  if (upcoming.some((ms) => ms > 0 && ms < 24 * HOUR)) return 5 * MINUTE;
  return null;
}

export function statusLabel(game, now = new Date()) {
  if (game.state !== 'pre' || game.statusName !== 'STATUS_SCHEDULED') return game.statusText;
  return game.timeTbd ? 'TBD' : formatStart(game.start, now);
}

export function formatStart(start, now = new Date()) {
  const time = start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (sameDay(start, now)) return time;
  const nearby = Math.abs(start - now) < 6 * 24 * HOUR;
  const day = start.toLocaleDateString(undefined, nearby ? { weekday: 'short' } : { month: 'short', day: 'numeric' });
  return `${day} ${time}`;
}

export function dayLabel(offset, now = new Date()) {
  if (offset === 0) return 'Today';
  if (offset === -1) return 'Yesterday';
  if (offset === 1) return 'Tomorrow';
  return addDays(now, offset).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

export function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

export function ymd(d) {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
