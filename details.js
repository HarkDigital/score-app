// Box scores and team schedules from ESPN's game summary and team schedule
// feeds. As with espn.js, every assumption about their shape lives here and
// is covered by tests (test/details.test.js, fixtures trimmed from real
// responses).

import { parseGame, parseOdds, teamColor, fallbackUrl, cardSituation, seriesOf } from './espn.js';

const BASE = 'https://site.api.espn.com/apis/site/v2/sports';

export function summaryUrl(league, eventId) {
  return `${BASE}/${league.path}/summary?event=${encodeURIComponent(eventId)}`;
}

// The schedule feed returns one season type per request, and only the
// current one by default (an empty list between seasons), so ask for the
// regular season and the postseason. Soccer instead splits results (the
// default) from fixtures still to play.
export function scheduleUrls(league, teamId) {
  const url = `${BASE}/${league.path}/teams/${encodeURIComponent(teamId)}/schedule`;
  return league.homeFirst ? [url, `${url}?fixture=true`] : [`${url}?seasontype=2`, `${url}?seasontype=3`];
}

export { fallbackUrl };

const sportOf = (league) => league.path.split('/')[0];

// ---- Box score ----

export function parseSummary(data, league) {
  const comp = data?.header?.competitions?.[0];
  if (!comp) return null;
  const type = comp.status?.type ?? {};
  const state = type.state ?? 'pre';
  const competitors = comp.competitors ?? [];
  const home = competitors.find((c) => c.homeAway === 'home') ?? competitors[0];
  const away = competitors.find((c) => c.homeAway === 'away') ?? competitors[1];
  const order = (league.homeFirst ? [home, away] : [away, home]).filter(Boolean);
  const baseball = sportOf(league) === 'baseball';
  // The header counts timeouts used this half (3 each); overtime has its own
  // count, so only regulation's are read here.
  const timeoutsLeft = (c) =>
    sportOf(league) === 'football' && state === 'in' && comp.status?.period <= 4 && Number.isInteger(c.timeoutsUsed)
      ? Math.max(0, 3 - c.timeoutsUsed)
      : null;
  const teams = order.map((c) => {
    const team = c.team ?? {};
    return {
      id: String(team.id ?? c.id ?? ''),
      name: team.displayName ?? team.name ?? '',
      shortName: team.shortDisplayName ?? team.name ?? team.displayName ?? '',
      abbr: team.abbreviation ?? '',
      logo: team.logos?.[0]?.href ?? team.logo ?? '',
      color: teamColor(team.color),
      homeAway: c.homeAway ?? '',
      score: state === 'pre' ? '' : String(c.score?.displayValue ?? c.score ?? ''),
      winner: c.winner === true,
      record: recordOf(c.record),
      linescores: (c.linescores ?? []).map((l) => String(l.displayValue ?? l.value ?? '')),
      // Baseball's line score ends R H E.
      extras: baseball ? [String(c.hits ?? ''), String(c.errors ?? '')] : [],
      possession: state === 'in' && c.possession === true,
      timeouts: timeoutsLeft(c),
    };
  });
  let periods = Math.max(0, ...teams.map((t) => t.linescores.length));
  // Soccer's period list goes wrong past full time (extra time and shootouts
  // come through as -1 and as goals that don't add up), so only regulation
  // halves are shown.
  if (sportOf(league) === 'soccer' && periods !== 2) periods = 0;
  const venue = data.gameInfo?.venue;
  const place = [venue?.address?.city, venue?.address?.state ?? venue?.address?.country].filter(Boolean).join(', ');
  return {
    id: String(comp.id ?? ''),
    state,
    statusName: type.name ?? '',
    statusText: type.shortDetail ?? type.detail ?? '',
    start: new Date(comp.date),
    teams,
    lineScore: periods && state !== 'pre' ? {
      labels: [...periodLabels(league, periods, type.shortDetail ?? ''), ...(baseball ? ['R', 'H', 'E'] : ['T'])],
      rows: teams.map((t) => [...t.linescores, ...Array(periods - t.linescores.length).fill(''), t.score, ...t.extras]),
    } : null,
    scoring: scoringPlays(data, league, teams),
    teamStats: teamStats(data.boxscore?.teams, teams),
    players: playerStats(data.boxscore?.players, teams, league),
    venue: [venue?.fullName, place].filter(Boolean).join(' · '),
    attendance: Number(data.gameInfo?.attendance) > 0 ? Number(data.gameInfo.attendance).toLocaleString('en-US') : '',
    broadcast: [...new Set((comp.broadcasts ?? []).map((b) => b.media?.shortName ?? b.names?.[0]).filter(Boolean))].join(', '),
    odds: state === 'pre' ? parseOdds(data.pickcenter, home, away) : null,
    // The playoffs: "NLDS - Game 3" and the series (espn.js seriesOf).
    note: data.header?.gameNote ?? '',
    series: seriesOf(comp.series),
  };
}

// What the iPhone app needs to put a game on the Lock Screen (a Live
// Activity): GameAttributes and its ContentState in the app, so the keys must
// match. The push server takes over the state from there (server/live.js
// builds the same ContentState from the scoreboard).
export function lockScreenCard(game, league, eventId) {
  const home = game.teams.find((t) => t.homeAway === 'home') ?? game.teams[league.homeFirst ? 0 : 1];
  const away = game.teams.find((t) => t.homeAway === 'away') ?? game.teams[league.homeFirst ? 1 : 0];
  if (!home || !away) return null;
  // logo: the app saves it for the card (a Live Activity can't load images).
  const team = (t) => ({ abbr: t.abbr || t.shortName, name: t.shortName || t.name, color: t.color ?? null, logo: t.logo || null });
  const scheduled = game.state === 'pre' && game.statusName === 'STATUS_SCHEDULED';
  return {
    league: league.id,
    leagueLabel: league.label,
    eventId: String(eventId ?? game.id),
    start: Math.floor(game.start.getTime() / 1000),
    homeFirst: Boolean(league.homeFirst),
    away: team(away),
    home: team(home),
    state: {
      away: away.score ?? '',
      home: home.score ?? '',
      state: game.state,
      status: scheduled ? '' : game.statusText,
      detail: '',
      // No ball spot here: the summary has none. The push server's first
      // update (seconds later) brings it.
      ...cardSituation(away, home),
    },
  };
}

// A future game's card goes up this long before the start: the push server
// starts it then (server/live.js SCHEDULE_LEAD).
export const LOCK_LEAD_MINUTES = 15;

// Whether the switch puts the card up now (rather than scheduling it): the
// game is on, or starts within LOCK_LEAD_MINUTES. Phones that can't have a
// card started by the server (canSchedule false, before iOS 17.2) show it
// now for a game within six hours instead, as iOS ends a card after eight.
export function canShowOnLockScreen(game, now = new Date(), { canSchedule = true } = {}) {
  if (game.state === 'in') return true;
  if (game.state !== 'pre' || game.statusName !== 'STATUS_SCHEDULED') return false;
  return game.start - now <= (canSchedule ? LOCK_LEAD_MINUTES * 60_000 : 6 * 3_600_000);
}

function recordOf(record) {
  if (typeof record === 'string') return record;
  if (!Array.isArray(record)) return '';
  const overall = record.find((r) => r.type === 'total') ?? record[0];
  return overall?.summary ?? overall?.displayValue ?? '';
}

// Quarters, halves, periods or innings, then OT (2OT...) or a shootout.
export function periodLabels(league, count, statusText = '') {
  const sport = sportOf(league);
  const regulation = { baseball: Infinity, hockey: 3, soccer: 2 }[sport] ?? (league.id === 'ncaam' ? 2 : 4);
  return Array.from({ length: count }, (_, i) => {
    if (i < regulation) return String(i + 1);
    if (sport === 'hockey' && i === count - 1 && /SO/.test(statusText)) return 'SO';
    if (sport === 'soccer') return i - regulation < 2 ? 'ET' : 'PK';
    const overtime = i - regulation + 1;
    return overtime === 1 ? 'OT' : `${overtime}OT`;
  });
}

// Touchdowns and field goals, goals, or (soccer) goals and red cards. Baseball
// and basketball have no useful summary: every pitch or basket is a play.
function scoringPlays(data, league, teams) {
  const sport = sportOf(league);
  const abbrOf = (id) => teams.find((t) => t.id === String(id))?.abbr ?? '';
  const period = (p, fallback) => p?.displayValue ?? (p?.number ? `${fallback}${p.number}` : '');
  if (sport === 'soccer') {
    return (data.keyEvents ?? [])
      .filter((e) => e.scoringPlay || /red card/i.test(e.type?.text ?? ''))
      .map((e) => ({
        period: '',
        clock: e.clock?.displayValue ?? '',
        team: abbrOf(e.team?.id),
        kind: e.scoringPlay ? 'goal' : 'red',
        text: e.shortText ?? e.text ?? '',
        score: '',
      }));
  }
  const plays = sport === 'football' ? data.scoringPlays
    : sport === 'hockey' ? (data.plays ?? []).filter((p) => p.scoringPlay)
    : null;
  return (plays ?? []).map((p) => {
    const away = teams.find((t) => t.homeAway === 'away');
    const home = teams.find((t) => t.homeAway === 'home');
    const scores = { away: p.awayScore, home: p.homeScore };
    return {
      period: period(p.period, sport === 'football' ? 'Q' : 'P'),
      clock: p.clock?.displayValue ?? '',
      team: abbrOf(p.team?.id),
      kind: 'score',
      text: p.text ?? '',
      // In display order, e.g. "KC 7 - 3 BUF".
      score: scores.away != null && scores.home != null
        ? teams.map((t) => (t === away ? scores.away : t === home ? scores.home : '')).join(' - ')
        : '',
    };
  });
}

// Side-by-side team totals. Baseball's are grouped objects, not a list of
// figures, and its box score already says it all, so it has none here.
function teamStats(boxTeams, teams) {
  if (!Array.isArray(boxTeams) || boxTeams.length < 2) return [];
  const byTeam = teams.map((t) => boxTeams.find((b) => String(b.team?.id) === t.id || b.homeAway === t.homeAway));
  if (byTeam.some((b) => !b)) return [];
  const [first] = byTeam;
  return (first.statistics ?? [])
    .filter((s) => s.label && s.displayValue !== undefined)
    .map((s) => ({
      label: s.label,
      values: byTeam.map((b) => b.statistics?.find((x) => x.name === s.name)?.displayValue ?? ''),
    }));
}

// Columns that crowd a phone without telling a fan much.
const HIDDEN_COLUMNS = new Set([
  'OREB', 'DREB', // REB covers them
  'H-AB', '#P', 'OBP', 'SLG', 'PC-ST',
  'YTDG', 'PPTOI', 'SHTOI', 'ESTOI', 'SHFT', 'SM', 'FW', 'FL', 'GV', 'TK', 'SOS', 'SOSA', 'ESSV', 'PPSV', 'SHSV', 'PN',
]);
// Hockey lists blocked shots and hits first; fans read goals and assists
// (or a goalie's saves) first.
const HOCKEY_ORDER = ['G', 'A', '+/-', 'SOG', 'S', 'GA', 'SA', 'SV', 'SV%', 'HT', 'BS', 'PIM', 'FO%', 'TOI'];

const GROUP_TITLES = { defenses: 'Defense', kickReturns: 'Kick Returns', puntReturns: 'Punt Returns', defensive: 'Defense' };

function playerStats(boxPlayers, teams, league) {
  if (!Array.isArray(boxPlayers)) return [];
  const hockey = sportOf(league) === 'hockey';
  return teams.map((team) => {
    const entry = boxPlayers.find((p) => String(p.team?.id) === team.id);
    const groups = (entry?.statistics ?? []).map((group) => {
      const labels = group.labels ?? [];
      let columns = labels.map((label, i) => ({ label, i })).filter((c) => !HIDDEN_COLUMNS.has(c.label));
      if (hockey) {
        const rank = (label) => (HOCKEY_ORDER.includes(label) ? HOCKEY_ORDER.indexOf(label) : HOCKEY_ORDER.length);
        columns = [...columns].sort((a, b) => rank(a.label) - rank(b.label));
      }
      const pick = (stats) => columns.map((c) => String(stats?.[c.i] ?? ''));
      const athletes = group.athletes ?? [];
      const played = athletes.filter((a) => !a.didNotPlay && a.stats?.length);
      const name = group.name ?? group.type ?? '';
      return {
        title: GROUP_TITLES[name] ?? (name ? name[0].toUpperCase() + name.slice(1) : ''),
        labels: columns.map((c) => c.label),
        rows: played.map((a) => ({
          name: a.athlete?.shortName ?? a.athlete?.displayName ?? '',
          position: a.athlete?.position?.abbreviation ?? '',
          starter: a.starter === true,
          stats: pick(a.stats),
        })),
        totals: group.totals?.some((v) => v !== '' && v != null) ? pick(group.totals) : null,
        didNotPlay: athletes.filter((a) => a.didNotPlay).map((a) => a.athlete?.shortName ?? a.athlete?.displayName ?? '').filter(Boolean),
      };
    }).filter((g) => g.rows.length);
    return { teamId: team.id, groups };
  }).filter((t) => t.groups.length);
}

// ---- Team schedule ----

// One team's season: its header (record, standing) and every game, from its
// own side: opponent, home or away, and the result once it's final.
export function parseSchedule(responses, league, teamId) {
  const list = Array.isArray(responses) ? responses : [responses];
  const first = list.find((d) => d?.team) ?? list[0];
  const team = first?.team ?? {};
  const seen = new Set();
  const games = list
    .flatMap((d) => d?.events ?? [])
    .filter((e) => e?.id && !seen.has(e.id) && seen.add(e.id))
    .map((e) => scheduleGame(e, league, String(teamId)))
    .filter(Boolean)
    .sort((a, b) => a.start - b.start);
  // The short name ("Chiefs", "Duke") for tight spaces like the widgets: the
  // header carries only the full one, the games name the team themselves.
  const shortName = team.shortDisplayName ?? list
    .flatMap((d) => d?.events ?? [])
    .flatMap((e) => e?.competitions?.[0]?.competitors ?? [])
    .find((c) => String(c?.team?.id ?? c?.id) === String(teamId))?.team?.shortDisplayName;
  return {
    team: {
      id: String(team.id ?? teamId),
      name: team.displayName ?? team.name ?? '',
      shortName: shortName ?? team.displayName ?? team.name ?? '',
      abbr: team.abbreviation ?? '',
      logo: team.logo ?? team.logos?.[0]?.href ?? '',
      color: teamColor(team.color),
      record: team.recordSummary ?? '',
      standing: team.standingSummary ?? '',
    },
    season: first?.requestedSeason?.displayName ?? first?.season?.displayName ?? '',
    // The season's year, for its stats (stats.js statsSeasons). The requested
    // season, as the current one can be last year's during the off season.
    seasonYear: first?.requestedSeason?.year ?? first?.season?.year ?? null,
    games,
  };
}

function scheduleGame(event, league, teamId) {
  const game = parseGame(event, league);
  if (!game) return null;
  const competitors = event.competitions?.[0]?.competitors ?? [];
  const self = game.teams.find((t) => String(t.id) === teamId);
  const opponent = game.teams.find((t) => t !== self);
  if (!self || !opponent) return null;
  const home = competitors.find((c) => String(c.team?.id ?? c.id) === teamId)?.homeAway === 'home';
  const final = game.state === 'post' && !/POSTPONED|CANCELED|CANCELLED/.test(game.statusName);
  let result = '';
  if (final && self.score !== '' && opponent.score !== '') {
    result = self.winner ? 'W' : opponent.winner ? 'L' : 'T';
  }
  return {
    id: game.id,
    start: game.start,
    timeTbd: game.timeTbd,
    state: game.state,
    statusName: game.statusName,
    statusText: game.statusText,
    broadcast: game.broadcast,
    home,
    opponent,
    result,
    // The schedule feed carries no live score, only finals; a live game
    // without one shows as plain Live rather than "-".
    score: result || (game.state === 'in' && self.score !== '' && opponent.score !== '') ? `${self.score}-${opponent.score}` : '',
    // The team's own score on its own (the opponent's is opponent.score).
    teamScore: self.score,
    label: event.week?.text ?? '',
  };
}
