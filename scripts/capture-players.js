// Saves real ESPN responses for the player pages: team rosters, athlete bios,
// stats and game logs, and a recent box score whose athletes keep their ids.
// It also records which of those feeds send the CORS header a browser needs.
// Cloud sessions can't reach ESPN, so this runs on a Mac:
//
//   node scripts/capture-players.js            every league
//   node scripts/capture-players.js nfl mlb    just these
//
// The responses go to test/fixtures/captures/ (raw, to be trimmed into
// fixtures) with report.json: every URL tried, its status, its
// Access-Control-Allow-Origin header, size and time.

import { mkdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { LEAGUES, scoreboardUrl } from '../espn.js';
import { parseSchedule, scheduleUrls, summaryUrl } from '../details.js';
import { parseStandings, teamListUrls, teamsFromStandings } from '../standings.js';
import { statsSeasons } from '../stats.js';

const OUT = fileURLToPath(new URL('../test/fixtures/captures/', import.meta.url));
const ORIGIN = 'https://harkdigital.github.io';
const SITE = 'https://site.api.espn.com';
const WEB = 'https://site.web.api.espn.com';
const CORE = 'https://sports.core.api.espn.com';

// The teams our other fixtures use, so the captures line up with them; the
// rest take the first team in their standings.
const TEAMS = { nfl: '12', nba: '19', mlb: '19', nhl: '6', ncaaf: '2294', ncaam: '150', epl: '360', ucl: '359' };

// Which athletes to capture per sport: each role's stats differ (a pitcher's
// from a batter's), and its positions, for picking one off the roster.
const ROLES = {
  football: [
    { role: 'qb', group: 'passing', pos: /^QB$/ },
    { role: 'wr', group: 'receiving', pos: /^WR$/ },
    { role: 'defense', group: 'defensive', pos: /^(LB|OLB|ILB|MLB|DE|DT|DL|NT|CB|S|FS|SS|DB|EDGE)$/ },
  ],
  basketball: [{ role: 'player', group: null, pos: /./ }],
  baseball: [
    { role: 'batter', group: 'batting', pos: /^(C|1B|2B|3B|SS|LF|CF|RF|OF|IF|DH|UT)$/ },
    { role: 'pitcher', group: 'pitching', pos: /^(SP|RP|P)$/ },
  ],
  hockey: [
    { role: 'skater', group: 'forwards', pos: /^(C|LW|RW|W|F|D)$/ },
    { role: 'goalie', group: 'goalies', pos: /^G$/ },
  ],
  soccer: [
    { role: 'outfield', group: null, pos: /^(F|FW|ST|CF|M|AM|D)$/ },
    { role: 'keeper', group: null, pos: /^(G|GK)$/ },
  ],
};

const report = [];
let saved = 0;

// One request, as a browser on the site would send it (the Origin header is
// what makes ESPN answer with its CORS header, or not). Saves the body as
// `file` when it's JSON; keep() trims it first.
async function grab(label, url, file, keep) {
  const started = Date.now();
  const row = { label, url };
  let json = null;
  try {
    const res = await fetch(url, { headers: { Origin: ORIGIN }, signal: AbortSignal.timeout(30_000) });
    const text = await res.text();
    Object.assign(row, {
      status: res.status,
      cors: res.headers.get('access-control-allow-origin'),
      bytes: Buffer.byteLength(text),
      ms: Date.now() - started,
    });
    if (res.ok) {
      try {
        json = JSON.parse(text);
      } catch {
        row.note = 'not JSON';
      }
    }
    if (json && file) {
      const body = keep ? JSON.stringify(keep(json)) : text;
      await writeFile(OUT + file, body);
      saved += Buffer.byteLength(body);
      row.file = file;
    }
  } catch (err) {
    row.error = err?.message ?? String(err);
  }
  report.push(row);
  const status = row.error ? `ERR ${row.error}` : `${row.status} cors=${row.cors ?? '-'} ${Math.round(row.bytes / 1024)}KB`;
  console.log(`  ${label.padEnd(34)} ${status}${row.file ? ` -> ${row.file}` : ''}`);
  return json;
}

// The same feed on several hosts: every one is tried (for the report), the
// first answer is saved.
async function probe(label, urls, file, keep) {
  let first = null;
  for (const url of urls) {
    const host = urls.length > 1 ? ` [${new URL(url).hostname.replace('.espn.com', '')}]` : '';
    const json = await grab(`${label}${host}`, url, first ? null : file, keep);
    first = first ?? json;
  }
  return first;
}

const withParam = (url, key, value) => {
  const u = new URL(url);
  u.searchParams.set(key, value);
  return u.toString();
};

// Every object that looks like an athlete (an id, a name and a position),
// wherever the feed nests it.
function athletesIn(data, found = new Map()) {
  if (Array.isArray(data)) data.forEach((item) => athletesIn(item, found));
  else if (data && typeof data === 'object') {
    const pos = data.position?.abbreviation ?? (typeof data.position === 'string' ? data.position : null);
    if (data.id && (data.displayName || data.fullName) && pos && !found.has(String(data.id))) found.set(String(data.id), pos);
    for (const value of Object.values(data)) if (value && typeof value === 'object') athletesIn(value, found);
  }
  return found;
}

// The athletes to capture: ones who played in the box score and are still on
// the roster (so their stats aren't empty), else off the roster by position.
function pickAthletes(league, teamId, summary, roster) {
  const sport = league.path.split('/')[0];
  const roles = ROLES[sport] ?? ROLES.basketball;
  const onRoster = athletesIn(roster);
  const box = summary?.boxscore?.players?.find((p) => String(p.team?.id) === teamId);
  const lineup = summary?.rosters?.find((r) => String(r.team?.id) === teamId)?.roster ?? [];
  const picked = [];
  const taken = new Set();
  for (const { role, group, pos } of roles) {
    let candidates = [];
    if (box) {
      const groups = box.statistics ?? [];
      const g = group ? groups.find((s) => (s.name ?? s.type) === group) : groups[0];
      candidates = (g?.athletes ?? []).filter((a) => a.stats?.length && !a.didNotPlay).map((a) => String(a.athlete?.id ?? ''));
    } else if (lineup.length) {
      candidates = lineup
        .filter((r) => pos.test(r.position?.abbreviation ?? r.position ?? ''))
        .map((r) => String(r.athlete?.id ?? ''));
    }
    let id = candidates.find((c) => c && !taken.has(c) && (!onRoster.size || onRoster.has(c)));
    if (!id) id = [...onRoster].find(([c, p]) => !taken.has(c) && pos.test(p))?.[0];
    if (id) {
      taken.add(id);
      picked.push({ role, id });
    } else console.log(`  (no ${role} found)`);
  }
  return picked;
}

async function firstTeam(league) {
  const data = await grab(`${league.id} standings`, teamListUrls(league)[0]);
  return data ? teamsFromStandings(parseStandings(data, league))[0]?.id : null;
}

const finals = (schedule) => schedule.games.filter((g) => g.state === 'post' && g.result);

async function captureLeague(league) {
  console.log(`\n${league.label}`);
  const [sport, name] = league.path.split('/');
  const teamId = TEAMS[league.id] ?? (await firstTeam(league));
  if (!teamId) return console.log('  no team found');

  // The team's last final, from this season or else the last one (a season
  // that hasn't started has none).
  const scheduleFor = async (season) => {
    const urls = scheduleUrls(league, teamId).map((u) => (season ? withParam(u, 'season', season) : u));
    return parseSchedule(await Promise.all(urls.map((u, i) => grab(`${league.id} schedule ${season ?? 'current'} ${i + 1}`, u))), league, teamId);
  };
  const schedule = await scheduleFor();
  const year = schedule.seasonYear;
  let last = finals(schedule).at(-1);
  if (!last && year) last = finals(await scheduleFor(year - 1)).at(-1);

  const summary = last
    ? await grab(`${league.id} summary ${last.id}`, summaryUrl(league, last.id), `${league.id}-summary-${last.id}.json`,
      ({ header, boxscore, rosters, leaders }) => ({ header, boxscore, rosters, leaders }))
    : null;

  const teamPath = `${league.path}/teams/${teamId}`;
  const roster = await probe(`${league.id} roster ${teamId}`, [
    `${SITE}/apis/site/v2/sports/${teamPath}/roster`,
    `${WEB}/apis/site/v2/sports/${teamPath}/roster`,
  ], `${league.id}-roster-${teamId}.json`);
  if (!roster) await grab(`${league.id} team ?enable=roster`, `${SITE}/apis/site/v2/sports/${teamPath}?enable=roster`, `${league.id}-team-roster-${teamId}.json`);
  if (year) await grab(`${league.id} core roster`, `${CORE}/v2/sports/${sport}/leagues/${name}/seasons/${year}/teams/${teamId}/athletes?limit=200`, `${league.id}-core-roster-${teamId}.json`);

  for (const { role, id } of pickAthletes(league, teamId, summary, roster)) {
    const base = `${league.path}/athletes/${id}`;
    const file = (kind) => `${league.id}-${role}-${id}-${kind}.json`;
    const both = (suffix) => [`${WEB}/apis/common/v3/sports/${base}${suffix}`, `${SITE}/apis/common/v3/sports/${base}${suffix}`];
    await probe(`${role} ${id} bio`, both(''), file('bio'));
    await probe(`${role} ${id} overview`, both('/overview'), file('overview'));
    await probe(`${role} ${id} stats`, both('/stats'), file('stats'));
    await probe(`${role} ${id} gamelog`, both('/gamelog'), file('gamelog'));
    if (year) await grab(`${role} ${id} gamelog ${year - 1}`, `${WEB}/apis/common/v3/sports/${base}/gamelog?season=${year - 1}`, file(`gamelog-${year - 1}`));
    await grab(`${role} ${id} site v2 athlete`, `${SITE}/apis/site/v2/sports/${base}`, file('site'));
    await grab(`${role} ${id} core athlete`, `${CORE}/v2/sports/${sport}/leagues/${name}/athletes/${id}`, file('core'));
    for (const season of statsSeasons(league, schedule)) {
      const url = `${CORE}/v2/sports/${sport}/leagues/${name}/seasons/${season.year}/types/${season.type}/athletes/${id}/statistics`;
      if (await grab(`${role} ${id} core stats ${season.year}`, url, file(`core-stats-${season.year}`))) break;
    }
  }
}

const wanted = process.argv.slice(2);
const leagues = wanted.length ? LEAGUES.filter((l) => wanted.includes(l.id)) : LEAGUES;
if (!leagues.length) {
  console.error(`Unknown league. Pick from: ${LEAGUES.map((l) => l.id).join(' ')}`);
  process.exit(1);
}
await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
// The control: the scoreboard is known to send Access-Control-Allow-Origin: *.
console.log('Control');
await grab('nfl scoreboard', scoreboardUrl(LEAGUES[0]));
for (const league of leagues) {
  try {
    await captureLeague(league);
  } catch (err) {
    console.log(`  failed: ${err?.stack ?? err}`);
    report.push({ label: `${league.id} failed`, error: String(err?.message ?? err) });
  }
}
await writeFile(OUT + 'report.json', JSON.stringify(report, null, 1));
const noCors = report.filter((r) => r.status === 200 && !r.cors).map((r) => r.label);
console.log(`\nSaved ${(saved / 1048576).toFixed(1)} MB in test/fixtures/captures/.`);
console.log(noCors.length ? `Answered without a CORS header: ${noCors.join(', ')}` : 'Every answer carried a CORS header.');
