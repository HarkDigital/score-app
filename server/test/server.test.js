import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { leagueById, parseScoreboard } from '../../espn.js';
import {
  contentState, activityPlan, activityPayload, gameAlerts, gameMemo, wantsAlert, parseActivity, parseDevice,
  parseScheduled, startDue, startPayload,
} from '../live.js';
import { providerToken, tokenIsDead } from '../apns.js';
import { createWatcher, pollDelay } from '../watcher.js';

const fixture = (name) => JSON.parse(readFileSync(new URL(`../../test/fixtures/${name}.json`, import.meta.url)));
const nfl = leagueById('nfl');
const epl = leagueById('epl');
const nflBoard = parseScoreboard(fixture('nfl-scoreboard'), nfl);
const eplBoard = parseScoreboard(fixture('epl-scoreboard'), epl);
const game = (board, id) => board.games.find((g) => g.id === id);
const TOKEN = 'ab'.repeat(32);

test('card state names away and home, whatever order the league lists them', () => {
  // KC @ BUF, live.
  assert.deepEqual(contentState(game(nflBoard, '402'), nfl), {
    away: '17', home: '21', state: 'in', status: '4:32 - 3rd', detail: game(nflBoard, '402').detail, possession: 'away',
  });
  // Football's timeouts, from a real live board (Oct 4 2026, NE @ BUF).
  const live = parseScoreboard(fixture('nfl-scoreboard-live'), nfl);
  assert.deepEqual(contentState(game(live, '401872971'), nfl), {
    away: '7', home: '7', state: 'in', status: '8:21 - 2nd', detail: '1st & 10 at NE 37', awayTimeouts: 2, homeTimeouts: 3, possession: 'away',
    yardLine: 63, toGo: 10,
  });
  // Soccer lists home first: Arsenal 1, Chelsea 0.
  const ars = contentState(game(eplBoard, '702'), epl);
  assert.equal(ars.home, '1');
  assert.equal(ars.away, '0');
});

test('a scheduled game leaves the status to the phone (local start time)', () => {
  const sf = contentState(game(nflBoard, '404'), nfl);
  assert.equal(sf.state, 'pre');
  assert.equal(sf.status, '');
  assert.equal(sf.away, '');
});

test('pushes go out only on change, scores at high priority', () => {
  const live = { away: '17', home: '21', state: 'in', status: '4:32 - 3rd', detail: '' };
  assert.deepEqual(activityPlan(null, live), { priority: 10, end: false });
  assert.equal(activityPlan(live, { ...live }), null);
  assert.deepEqual(activityPlan(live, { ...live, status: '4:01 - 3rd' }), { priority: 5, end: false });
  assert.deepEqual(activityPlan({ ...live, awayTimeouts: 3, homeTimeouts: 3 }, { ...live, awayTimeouts: 2, homeTimeouts: 3 }), { priority: 5, end: false });
  assert.deepEqual(activityPlan({ ...live, possession: 'away' }, { ...live, possession: 'home' }), { priority: 5, end: false });
  assert.deepEqual(activityPlan({ ...live, yardLine: 63, toGo: 10 }, { ...live, yardLine: 58, toGo: 5 }), { priority: 5, end: false });
  assert.deepEqual(activityPlan(live, { ...live, home: '24' }), { priority: 10, end: false });
  assert.deepEqual(activityPlan(live, { ...live, state: 'post', status: 'Final' }), { priority: 10, end: true });
});

test('the final push ends the card and leaves it up for two hours', () => {
  const payload = activityPayload({ state: 'post' }, { priority: 10, end: true }, 1_000);
  assert.equal(payload.aps.event, 'end');
  assert.equal(payload.aps['dismissal-date'], 1_000 + 7_200);
  const live = activityPayload({ state: 'in' }, { priority: 10, end: false }, 1_000);
  assert.equal(live.aps.event, 'update');
  assert.equal(live.aps['stale-date'], 1_000 + 900);
});

const nba = leagueById('nba');
const memo = (game, league, changes = {}) => ({ ...gameMemo(game, league, 0), ...changes });
const bodies = (alerts) => alerts.map((a) => `${a.kind}: ${a.payload.aps.alert.body}`);

test('start and end alerts fire on a change the server saw, never on first sight', () => {
  const live = game(nflBoard, '402');
  assert.deepEqual(gameAlerts(null, live, nfl), []);
  assert.deepEqual(gameAlerts(memo(live, nfl), live, nfl), [], 'no change, no alert');
  assert.deepEqual(bodies(gameAlerts(memo(live, nfl, { state: 'pre', away: '', home: '' }), live, nfl)), ['start: Starting now.']);
  const final = game(nflBoard, '403');
  assert.deepEqual(bodies(gameAlerts(memo(final, nfl, { state: 'in' }), final, nfl)), ['end: Final/OT: Jets 26, Vikings 23']);
  const off = { ...final, statusName: 'STATUS_POSTPONED', statusText: 'Postponed' };
  assert.deepEqual(bodies(gameAlerts(memo(off, nfl, { state: 'pre' }), off, nfl)), ['end: Postponed']);
  // Soccer reads home first.
  const soccer = gameAlerts(memo(game(eplBoard, '701'), epl, { state: 'in' }), game(eplBoard, '701'), epl);
  assert.equal(soccer[0].payload.aps.alert.title, 'Man City vs Liverpool');
  assert.equal(soccer[0].payload.aps.alert.body, 'FT: Man City 2, Liverpool 2');
  assert.equal(soccer[0].payload.route, '#/game/epl/701');
});

test('a score alert names who scored, and only fires on a score going up', () => {
  const live = game(nflBoard, '402'); // KC 17 @ BUF 21
  assert.deepEqual(bodies(gameAlerts(memo(live, nfl, { home: '14' }), live, nfl)), ['score: Bills score: Chiefs 17, Bills 21']);
  assert.deepEqual(bodies(gameAlerts(memo(live, nfl, { away: '10', home: '14' }), live, nfl)), ['score: Score update: Chiefs 17, Bills 21']);
  assert.deepEqual(gameAlerts(memo(live, nfl, { home: '24' }), live, nfl), [], 'a score taken off is not news');
  const ars = game(eplBoard, '702'); // Arsenal 1, Chelsea 0
  assert.deepEqual(bodies(gameAlerts(memo(ars, epl, { home: '0' }), ars, epl)), ['score: Arsenal goal: Arsenal 1, Chelsea 0']);
  assert.ok(!bodies(gameAlerts(memo(live, nfl, { home: '14' }), live, nfl)).some((b) => b.includes('—')));
});

test('basketball sends the score at each break, not every basket', () => {
  const live = game(nflBoard, '402');
  const hoops = { ...live, statusName: 'STATUS_IN_PROGRESS', statusText: '6:12 - 2nd' };
  assert.deepEqual(gameAlerts(memo(hoops, nba, { home: '10' }), hoops, nba), [], 'baskets are not alerts');
  const half = { ...live, statusName: 'STATUS_HALFTIME', statusText: 'Halftime' };
  assert.deepEqual(bodies(gameAlerts(memo(hoops, nba), half, nba)), ['score: Halftime: Chiefs 17, Bills 21']);
  assert.deepEqual(gameAlerts(memo(half, nba), half, nba), [], 'once per break');
});

test('alerts go only to followers with that switch on', () => {
  const live = game(nflBoard, '402'); // KC (12) @ BUF (2)
  const device = { teams: [{ league: 'nfl', id: '2', start: true, score: false, end: true }] };
  assert.ok(wantsAlert(device, 'nfl', live, 'start'));
  assert.ok(!wantsAlert(device, 'nfl', live, 'score'));
  assert.ok(!wantsAlert(device, 'nba', live, 'start'), 'same id in another league');
  assert.ok(wantsAlert({ teams: [{ league: 'nfl', id: '12' }] }, 'nfl', live, 'end'), 'stored before the switches: starts and finals');
  assert.ok(!wantsAlert({ teams: [{ league: 'nfl', id: '12' }] }, 'nfl', live, 'score'));
});

test('requests are validated', () => {
  const ok = parseActivity({ token: TOKEN.toUpperCase(), env: 'production', league: 'nfl', eventId: '401547417', start: 1_800_000_000 });
  assert.equal(ok.token, TOKEN);
  assert.equal(parseActivity({ token: TOKEN, env: 'production', league: 'xfl', eventId: '1' }), null);
  assert.equal(parseActivity({ token: 'nope', env: 'production', league: 'nfl', eventId: '1' }), null);
  assert.equal(parseActivity({ token: TOKEN, env: 'staging', league: 'nfl', eventId: '1' }), null);
  assert.equal(parseActivity({ token: TOKEN, env: 'sandbox', league: 'nfl', eventId: '1; drop' }), null);
  assert.deepEqual(parseDevice({ env: 'sandbox', teams: [{ league: 'nfl', id: 21, start: true, score: true }] }),
    { platform: 'ios', env: 'sandbox', teams: [{ league: 'nfl', id: '21', start: true, score: true, end: false, lock: false }] });
  // An early build sends bare teams: starts and finals.
  assert.deepEqual(parseDevice({ env: 'sandbox', teams: [{ league: 'nfl', id: '21' }] }).teams[0], { league: 'nfl', id: '21', start: true, score: false, end: true, lock: false });
  assert.deepEqual(parseDevice({ env: 'sandbox', teams: [{ league: 'nfl', id: '21', start: false }] }).teams, [], 'all switches off is no team');
  assert.equal(parseDevice({ env: 'sandbox', teams: [{ league: 'nfl', id: '<x>' }] }), null);
});

test('the provider token is an ES256 JWT Apple can verify', () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwt = providerToken(privateKey, 'ABC123DEFG', '72U2ZL3GVM', 1_700_000_000);
  const [head, claims, sig] = jwt.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(head, 'base64url')), { alg: 'ES256', kid: 'ABC123DEFG' });
  assert.deepEqual(JSON.parse(Buffer.from(claims, 'base64url')), { iss: '72U2ZL3GVM', iat: 1_700_000_000 });
  assert.equal(Buffer.from(sig, 'base64url').length, 64);
  assert.ok(crypto.verify('sha256', Buffer.from(`${head}.${claims}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url')));
});

test('dead tokens are recognized', () => {
  assert.ok(tokenIsDead(410, 'Unregistered'));
  assert.ok(tokenIsDead(400, 'BadDeviceToken'));
  assert.ok(!tokenIsDead(429, 'TooManyRequests'));
});

test('a live game polls every 5s, one about to start every 15s, a quiet day every 15 minutes', () => {
  const now = Date.parse('2026-10-04T16:00:00Z');
  assert.equal(pollDelay([{ state: 'in' }], now), 5_000);
  assert.equal(pollDelay([{ state: 'pre', start: now + 10 * 60_000 }], now), 15_000);
  assert.equal(pollDelay([{ state: 'pre', start: now + 3 * 3_600_000 }], now), 120_000);
  assert.equal(pollDelay([], now), 900_000);
});

// The whole loop against the real NFL scoreboard, with ESPN and Apple faked.
function harness(data) {
  const sent = [];
  const store = { data: { activities: {}, scheduled: {}, devices: {}, games: {}, sent: {}, ...data }, save() {} };
  let board = structuredClone(fixture('nfl-scoreboard'));
  const apns = {
    activity: async (token, env, payload, priority) => { sent.push({ kind: 'activity', token, payload, priority }); return { status: 200, reason: '', dead: false }; },
    alert: async (token, env, payload) => { sent.push({ kind: 'alert', token, payload }); return { status: 200, reason: '', dead: false }; },
  };
  let clock = Date.parse('2026-10-04T18:00:00Z');
  const watcher = createWatcher({ store, apns, fetchJson: async () => board, log: () => {}, now: () => clock });
  return {
    store, sent, watcher,
    setBoard: (fn) => { board = structuredClone(board); fn(board); },
    later: (ms) => { clock += ms; },
  };
}

test('a card gets its first state, then only changes, then the final ends it', async () => {
  const h = harness({ activities: { [TOKEN]: { env: 'production', league: 'nfl', eventId: '402', start: null, createdAt: Date.parse('2026-10-04T17:00:00Z'), last: null } } });
  await h.watcher.tick();
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].payload.aps['content-state'].home, '21');

  h.later(20_000);
  await h.watcher.tick();
  assert.equal(h.sent.length, 1, 'nothing changed, nothing sent');

  h.setBoard((b) => {
    const comp = b.events.find((e) => e.id === '402').competitions[0];
    comp.status.type = { ...comp.status.type, state: 'post', name: 'STATUS_FINAL', shortDetail: 'Final' };
  });
  h.later(20_000);
  await h.watcher.tick();
  assert.equal(h.sent.length, 2);
  assert.equal(h.sent[1].payload.aps.event, 'end');
  assert.deepEqual(h.store.data.activities, {}, 'an ended card is forgotten');
});

test('followers get the alerts they switched on, once each', async () => {
  // Following Buffalo (id 2), whose game against KC is 402.
  const other = 'cd'.repeat(32);
  const h = harness({ devices: {
    [TOKEN]: { env: 'production', teams: [{ league: 'nfl', id: '2', start: true, score: false, end: true }] },
    [other]: { env: 'production', teams: [{ league: 'nfl', id: '2', start: false, score: true, end: false }] },
  } });
  h.setBoard((b) => { b.events.find((e) => e.id === '402').competitions[0].status.type.state = 'pre'; });
  await h.watcher.tick();
  assert.equal(h.sent.length, 0, 'first sight is not a change');

  h.setBoard((b) => { b.events.find((e) => e.id === '402').competitions[0].status.type.state = 'in'; });
  h.later(20_000);
  await h.watcher.tick();
  h.later(20_000);
  await h.watcher.tick();
  assert.deepEqual(h.sent.map((s) => s.payload.aps.alert.body), ['Starting now.']);
  assert.equal(h.sent[0].token, TOKEN, 'only the follower with starts on');

  // Buffalo scores: only the follower with scores on hears about it.
  h.setBoard((b) => {
    const buf = b.events.find((e) => e.id === '402').competitions[0].competitors.find((c) => c.homeAway === 'home');
    buf.score = '28';
  });
  h.later(20_000);
  await h.watcher.tick();
  assert.deepEqual(h.sent.slice(1).map((s) => [s.token === other, s.payload.aps.alert.body]), [[true, 'Bills score: Chiefs 17, Bills 28']]);
  h.sent.splice(1);

  h.setBoard((b) => {
    const t = b.events.find((e) => e.id === '402').competitions[0].status.type;
    Object.assign(t, { state: 'post', name: 'STATUS_FINAL', shortDetail: 'Final' });
  });
  h.later(20_000);
  await h.watcher.tick();
  assert.equal(h.sent.length, 2);
  assert.equal(h.sent[1].payload.aps.alert.body, 'Final: Chiefs 17, Bills 28');
  assert.equal(h.sent[1].token, TOKEN);
  assert.equal(h.sent[1].payload.route, '#/game/nfl/402');
});

const card = (eventId, overrides = {}) => ({
  league: 'nfl', leagueLabel: 'NFL', eventId, start: Date.parse('2026-10-04T20:25:00Z') / 1000, homeFirst: false,
  away: { abbr: 'SF', name: '49ers', color: '#aa0000', logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/sf.png' },
  home: { abbr: 'LAR', name: 'Rams', color: null, logo: 'https://evil.example/x.png' },
  state: { away: '', home: '', state: 'pre', status: '', detail: '' },
  ...overrides,
});

test('scheduled cards are validated and keep only the attributes', () => {
  const entry = parseScheduled({ token: TOKEN, env: 'production', card: card('404') });
  assert.equal(entry.league, 'nfl');
  assert.equal(entry.eventId, '404');
  assert.deepEqual(Object.keys(entry.card).sort(), ['away', 'eventId', 'home', 'homeFirst', 'league', 'leagueLabel', 'start']);
  assert.equal(entry.card.away.logo, 'https://a.espncdn.com/i/teamlogos/nfl/500/sf.png');
  assert.equal(entry.card.home.logo, null, 'only ESPN logos are passed on');
  assert.equal(parseScheduled({ token: TOKEN, env: 'production', card: card('404', { away: { abbr: 'SF', name: '49ers', color: 'red' } }) }), null);
  assert.equal(parseScheduled({ token: TOKEN, env: 'production', card: card('x') }), null);
  assert.equal(parseScheduled({ token: 'short', env: 'production', card: card('404') }), null);
});

test('a scheduled card goes up 15 minutes before the start, or as soon as the game is on', () => {
  const pre = game(nflBoard, '404'); // SF @ LAR, 4:25 PM EDT
  const kickoff = pre.start.getTime() / 1000;
  assert.equal(startDue(pre, kickoff - 16 * 60), false);
  assert.equal(startDue(pre, kickoff - 15 * 60), true);
  assert.equal(startDue(pre, kickoff - 14 * 60), true);
  assert.equal(startDue(game(nflBoard, '402'), 0), true, 'already live');
  assert.equal(startDue({ ...pre, statusName: 'STATUS_POSTPONED' }, kickoff), false);
});

test('the push-to-start payload carries the attributes, with the date as ActivityKit reads it', () => {
  const pre = game(nflBoard, '404');
  const entry = parseScheduled({ token: TOKEN, env: 'production', card: card('404') });
  const { aps } = startPayload(entry.card, pre, nfl, 1_000);
  assert.equal(aps.event, 'start');
  assert.equal(aps['attributes-type'], 'GameAttributes');
  // Seconds since 2001-01-01, ActivityKit's default Date decoding.
  assert.equal(aps.attributes.start, pre.start.getTime() / 1000 - 978_307_200);
  assert.equal(aps.attributes.away.name, '49ers');
  assert.deepEqual(aps['content-state'], contentState(pre, nfl));
  assert.equal(aps.alert.title, '49ers @ Rams');
});

test('the watcher starts a scheduled card once, at the right time', async () => {
  const entry = parseScheduled({ token: TOKEN, env: 'production', card: card('404') });
  const h = harness({ scheduled: { [`${TOKEN}|nfl:404`]: { ...entry, createdAt: 0 } } });
  await h.watcher.tick(); // 18:00Z, 2h25 before
  assert.equal(h.sent.length, 0);
  h.later(2 * 3600_000 + 9.5 * 60_000); // 20:09:30Z, 15.5 minutes before
  await h.watcher.tick();
  assert.equal(h.sent.length, 0, 'not yet');
  // The next regular poll would be 2 minutes on; the card is due at 20:10.
  h.later(31_000);
  await h.watcher.tick();
  assert.equal(h.sent.length, 1, 'on time');
  assert.equal(h.sent[0].payload.aps.event, 'start');
  assert.deepEqual(h.store.data.scheduled, {}, 'sent once, then forgotten');
});

test('every game on the Lock Screen: the iPhone gets a push-to-start, once, when the game is due', async () => {
  const START = 'cd'.repeat(32);
  const device = parseDevice({ env: 'production', startToken: START, teams: [{ league: 'nfl', id: '14', lock: true }] });
  assert.equal(device.startToken, START);
  assert.deepEqual(device.teams, [{ league: 'nfl', id: '14', start: false, score: false, end: false, lock: true }], 'Lock Screen alone keeps the team');
  const h = harness({ devices: { [TOKEN]: device } });
  await h.watcher.tick(); // 18:00Z, SF @ LAR (404) is 2h25 away
  assert.equal(h.sent.length, 0);
  h.later(2 * 3600_000 + 10 * 60_000 + 1_000); // just under 15 minutes before
  await h.watcher.tick();
  const starts = h.sent.filter((s) => s.payload.aps.event === 'start');
  assert.equal(starts.length, 1);
  assert.equal(starts[0].token, START, 'to the push-to-start token, not the device token');
  assert.equal(starts[0].payload.aps.attributes.home.name, 'Rams');
  assert.equal(starts[0].payload.aps.attributes.away.logo, game(nflBoard, '404').teams[0].logo || null);
  h.later(60_000);
  await h.watcher.tick();
  assert.equal(h.sent.filter((s) => s.payload.aps.event === 'start').length, 1, 'once: a card swiped away stays away');
});

test('every game on the Lock Screen: nothing for an iPhone without a push-to-start token, or one scheduled by hand', async () => {
  const h = harness({ devices: { [TOKEN]: parseDevice({ env: 'production', teams: [{ league: 'nfl', id: '14', lock: true }] }) } });
  h.later(2 * 3600_000 + 10 * 60_000 + 1_000);
  await h.watcher.tick();
  assert.equal(h.sent.length, 0, 'before iOS 17.2 the server cannot start a card');

  const START = 'cd'.repeat(32);
  const entry = parseScheduled({ token: START, env: 'production', card: card('404') });
  const h2 = harness({
    devices: { [TOKEN]: parseDevice({ env: 'production', startToken: START, teams: [{ league: 'nfl', id: '14', lock: true }] }) },
    scheduled: { [`${START}|nfl:404`]: { ...entry, createdAt: 0 } },
  });
  h2.later(2 * 3600_000 + 10 * 60_000 + 1_000);
  await h2.watcher.tick();
  assert.equal(h2.sent.filter((s) => s.payload.aps.event === 'start').length, 1, 'the scheduled card only, not a second one');
});
