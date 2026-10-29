import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http2 from 'node:http2';
import { readFileSync } from 'node:fs';
import { leagueById, parseScoreboard } from '../../espn.js';
import {
  contentState, activityPlan, activityPayload, gameAlerts, gameMemo, wantsAlert, parseActivity, parseDevice,
  parseScheduled, startDue, startPayload, newsPlan, newsPayload, newsTeams, alertDelay,
} from '../live.js';
import { parseNews } from '../../news.js';
import { createApns, providerToken, tokenIsDead } from '../apns.js';
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
  assert.deepEqual(activityPlan({ ...live, bases: '1', outs: 1 }, { ...live, bases: '12', outs: 1 }), { priority: 5, end: false });
  assert.equal(activityPlan({ ...live, bases: '13', outs: 2, balls: 1, strikes: 2 }, { ...live, bases: '13', outs: 2, balls: 1, strikes: 2 }), null);
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
    { platform: 'ios', env: 'sandbox', teams: [{ league: 'nfl', id: '21', start: true, score: true, end: false, lock: false, news: false }] });
  // An early build sends bare teams: starts and finals.
  assert.deepEqual(parseDevice({ env: 'sandbox', teams: [{ league: 'nfl', id: '21' }] }).teams[0], { league: 'nfl', id: '21', start: true, score: false, end: true, lock: false, news: false });
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

// A real HTTP/2 server on localhost in Apple's place. answer(stream, n): n is
// which connection the request came on (1 = the first); reset(n) drops that
// connection the way a stale one fails (the client reads ECONNRESET).
async function fakeApple(t, answer) {
  const server = http2.createServer();
  const sockets = [];
  const connections = [];
  server.on('connection', (socket) => sockets.push(socket));
  server.on('session', (s) => connections.push(s));
  const reset = (n) => sockets[n - 1].resetAndDestroy();
  server.on('stream', (stream) => answer(stream, connections.indexOf(stream.session) + 1, reset));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => {
    for (const s of connections) s.destroy();
    server.close(resolve);
  }));
  return {
    connections,
    apns: (options = {}) => createApns({
      keyPem: crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ type: 'pkcs8', format: 'pem' }),
      keyId: 'KEY', teamId: 'TEAM', bundleId: 'digital.hark.scores', log: () => {},
      hosts: { production: `http://127.0.0.1:${server.address().port}` },
      ...options,
    }),
  };
}
const ok = (stream) => { stream.respond({ ':status': 200 }); stream.end(); };
const banner = { aps: { alert: { title: 'Bills', body: 'Kickoff' } } };

test('apns: a push on a connection that died goes again on a fresh one', async (t) => {
  // Oct 2026: after hours idle, the first push failed with read ECONNRESET.
  const apple = await fakeApple(t, (stream, n, reset) => (n === 1 ? reset(n) : ok(stream)));
  const result = await apple.apns().alert(TOKEN, 'production', banner);
  assert.equal(result.status, 200);
  assert.equal(apple.connections.length, 2);
});

test('apns: an idle connection is closed, so the next push starts on a fresh one', async (t) => {
  const apple = await fakeApple(t, ok);
  const apns = apple.apns({ idleClose: 100 });
  assert.equal((await apns.alert(TOKEN, 'production', banner)).status, 200);
  assert.equal((await apns.alert(TOKEN, 'production', banner)).status, 200);
  assert.equal(apple.connections.length, 1, 'busy: the same connection');
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal((await apns.alert(TOKEN, 'production', banner)).status, 200);
  assert.equal(apple.connections.length, 2);
});

test('apns: Apple\'s answer is final, and no answer at all is status 0 after two tries', async (t) => {
  const gone = await fakeApple(t, (stream) => {
    stream.respond({ ':status': 410, 'content-type': 'application/json' });
    stream.end(JSON.stringify({ reason: 'Unregistered' }));
  });
  assert.deepEqual(await gone.apns().alert(TOKEN, 'production', banner), { status: 410, reason: 'Unregistered', dead: true });
  assert.equal(gone.connections.length, 1, 'not sent twice');

  const down = await fakeApple(t, (stream, n, reset) => reset(n));
  const result = await down.apns().alert(TOKEN, 'production', banner);
  assert.equal(result.status, 0);
  assert.equal(result.dead, false);
  assert.equal(down.connections.length, 2);
});

test('a live game polls every 5s, one about to start every 15s, a quiet day every 15 minutes', () => {
  const now = Date.parse('2026-10-04T16:00:00Z');
  assert.equal(pollDelay([{ state: 'in' }], now), 5_000);
  assert.equal(pollDelay([{ state: 'pre', start: now + 10 * 60_000 }], now), 15_000);
  assert.equal(pollDelay([{ state: 'pre', start: now + 3 * 3_600_000 }], now), 120_000);
  assert.equal(pollDelay([], now), 900_000);
});

// The whole loop against the real NFL scoreboard, with ESPN and Apple faked.
// answers: what Apple says to each push in turn (then 200s).
function harness(data, answers = []) {
  const sent = [];
  const store = { data: { activities: {}, scheduled: {}, devices: {}, games: {}, sent: {}, ...data }, save() {} };
  let board = structuredClone(fixture('nfl-scoreboard'));
  const answer = () => answers.shift() ?? { status: 200, reason: '', dead: false };
  const apns = {
    activity: async (token, env, payload, priority) => { sent.push({ kind: 'activity', token, payload, priority }); return answer(); },
    alert: async (token, env, payload) => { sent.push({ kind: 'alert', token, payload }); return answer(); },
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

test('a follower\'s delay holds their game alerts back that many seconds', async () => {
  // Following Buffalo with scores on and a 15-second delay (a streamed game).
  const h = harness({ devices: { [TOKEN]: { env: 'production', delay: 15, teams: [{ league: 'nfl', id: '2', start: false, score: true, end: false }] } } });
  await h.watcher.tick();
  h.setBoard((b) => {
    b.events.find((e) => e.id === '402').competitions[0].competitors.find((c) => c.homeAway === 'home').score = '28';
  });
  h.later(20_000);
  await h.watcher.tick();
  assert.equal(h.sent.length, 0, 'held back');
  assert.equal(h.store.data.pending.length, 1);
  h.later(10_000);
  await h.watcher.tick();
  assert.equal(h.sent.length, 0, 'not yet');
  h.later(5_000);
  await h.watcher.tick();
  assert.deepEqual(h.sent.map((s) => [s.token, s.payload.aps.alert.body]), [[TOKEN, 'Bills score: Chiefs 17, Bills 28']]);
  assert.deepEqual(h.store.data.pending, []);

  // One far past due (the server was down) is dropped, not sent late.
  h.store.data.pending.push({ token: TOKEN, dueAt: Date.parse('2026-10-04T17:00:00Z'), payload: h.sent[0].payload });
  h.later(1_000);
  await h.watcher.tick();
  assert.equal(h.sent.length, 1);
  assert.deepEqual(h.store.data.pending, []);
});

test('the delay is whole seconds, 0 to 5 minutes, and kept with the device only when set', () => {
  assert.deepEqual([alertDelay(15), alertDelay('30'), alertDelay(14.6), alertDelay(900), alertDelay(-5), alertDelay('x'), alertDelay(null)], [15, 30, 15, 300, 0, 0, 0]);
  const teams = [{ league: 'nfl', id: '2', score: true }];
  assert.equal(parseDevice({ env: 'production', teams, delay: 45 }).delay, 45);
  assert.equal('delay' in parseDevice({ env: 'production', teams }), false);
  assert.equal('delay' in parseDevice({ env: 'production', teams, delay: 0 }), false);
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
  assert.deepEqual(device.teams, [{ league: 'nfl', id: '14', start: false, score: false, end: false, lock: true, news: false }], 'Lock Screen alone keeps the team');
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

test('every game on the Lock Screen: a start Apple never answered goes again on the next poll', async () => {
  // Oct 2026: a stale connection's ECONNRESET (status 0) lost the card for good.
  const START = 'cd'.repeat(32);
  const device = parseDevice({ env: 'production', startToken: START, teams: [{ league: 'nfl', id: '14', lock: true }] });
  const h = harness({ devices: { [TOKEN]: device } }, [{ status: 0, reason: 'read ECONNRESET', dead: false }]);
  h.later(2 * 3600_000 + 10 * 60_000 + 1_000);
  await h.watcher.tick();
  const starts = () => h.sent.filter((s) => s.payload.aps.event === 'start').length;
  assert.equal(starts(), 1);
  assert.equal(h.store.data.sent[`${TOKEN}|nfl:404|lock`], undefined, 'not marked: Apple never had it');
  h.later(15_000);
  await h.watcher.tick();
  assert.equal(starts(), 2, 'sent again');
  assert.ok(h.store.data.sent[`${TOKEN}|nfl:404|lock`], 'marked once Apple took it');
  h.later(15_000);
  await h.watcher.tick();
  assert.equal(starts(), 2, 'and only then left alone');
});

test('every game on the Lock Screen: an answer from Apple is final, and a dead start token is dropped', async () => {
  const START = 'cd'.repeat(32);
  const lockDevice = () => parseDevice({ env: 'production', startToken: START, teams: [{ league: 'nfl', id: '14', lock: true }] });
  const h = harness({ devices: { [TOKEN]: lockDevice() } }, [{ status: 429, reason: 'TooManyRequests', dead: false }]);
  h.later(2 * 3600_000 + 10 * 60_000 + 1_000);
  await h.watcher.tick();
  h.later(15_000);
  await h.watcher.tick();
  assert.equal(h.sent.length, 1, 'not hammered after Apple said no');

  const h2 = harness({ devices: { [TOKEN]: lockDevice() } }, [{ status: 410, reason: 'Unregistered', dead: true }]);
  h2.later(2 * 3600_000 + 10 * 60_000 + 1_000);
  await h2.watcher.tick();
  assert.equal(h2.store.data.devices[TOKEN].startToken, undefined, 'the phone sends a new one when it has it');
  assert.ok(h2.store.data.devices[TOKEN], 'the device and its alerts stay');
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

// ---- Team news alerts ----

test('news alerts: the first look only notes what\'s there; then new stories, once', () => {
  const now = Date.parse('2026-10-06T12:00:00Z');
  const at = (hours) => new Date(now - hours * 3600_000);
  const story = (id, hours, kind = '') => ({ id, headline: `Story ${id}`, kind, published: at(hours), teamName: 'Kansas City Chiefs' });
  const first = newsPlan(null, [story('a', 1), story('b', 2)], now);
  assert.deepEqual(first.fresh, []);
  assert.deepEqual(first.memo.seen, ['a', 'b']);
  // A new story, a video (left to game alerts' kind of thing), an old one
  // ESPN lists late: only the story goes.
  const next = newsPlan(first.memo, [story('c', 0.2), story('v', 0.1, 'Video'), story('old', 30), story('a', 1)], now);
  assert.deepEqual(next.fresh.map((a) => a.id), ['c']);
  assert.ok(next.memo.seen.includes('c') && next.memo.seen.includes('a'));
  assert.deepEqual(newsPlan(next.memo, [story('c', 0.2)], now).fresh, []);
  // At most two per look.
  assert.equal(newsPlan(first.memo, [story('x', 0.1), story('y', 0.2), story('z', 0.3)], now).fresh.length, 2);
});

test('a news alert is the team over the headline, and opens the team\'s News tab', () => {
  const [article] = parseNews(fixture('nfl-news-team12'), { teamId: '12' }).articles;
  const payload = newsPayload(article, nfl, '12');
  assert.equal(payload.aps.alert.title, 'Kansas City Chiefs');
  assert.equal(payload.aps.alert.body, article.headline);
  assert.equal(payload.route, '#/team/nfl/12/news');
  assert.equal(payload.aps['thread-id'], 'news-nfl-12');
  const devices = { a: parseDevice({ env: 'production', teams: [{ league: 'nfl', id: '12', news: true }] }), b: parseDevice({ env: 'production', teams: [{ league: 'nfl', id: '12', start: true }] }) };
  assert.deepEqual([...newsTeams(devices).keys()], ['nfl:12']);
  assert.equal(devices.a.teams[0].news, true, 'news alone keeps the team');
});

test('the watcher sends a followed team\'s new story to phones that want it, once', async () => {
  const sent = [];
  const apns = { alert: async (token, env, payload) => { sent.push({ token, payload }); return { status: 200, reason: '', dead: false }; } };
  const feed = structuredClone(fixture('nfl-news-team12'));
  const store = { data: { activities: {}, scheduled: {}, games: {}, sent: {}, devices: {
    [TOKEN]: parseDevice({ env: 'production', teams: [{ league: 'nfl', id: '12', news: true }] }),
    ['cd'.repeat(32)]: parseDevice({ env: 'production', teams: [{ league: 'nfl', id: '12', start: true }] }),
  } }, save() {} };
  let clock = Date.parse('2026-10-06T00:00:00Z');
  const fetchJson = async (url) => (url.includes('/news') ? feed : fixture('nfl-scoreboard'));
  const watcher = createWatcher({ store, apns, fetchJson, log: () => {}, now: () => clock });
  await watcher.tick();
  assert.equal(sent.length, 0, 'the first look sends nothing');
  // ESPN posts a Chiefs story.
  const [first] = feed.articles;
  feed.articles.unshift({ ...structuredClone(first), id: 999, headline: 'Chiefs sign a kicker', type: 'HeadlineNews', published: new Date(clock).toISOString(),
    links: { web: { href: 'https://www.espn.com/nfl/story/_/id/999' } }, categories: [{ type: 'team', teamId: 12, description: 'Kansas City Chiefs' }] });
  clock += 5 * 60_000;
  await watcher.tick();
  assert.equal(sent.length, 0, 'not before the next look');
  clock += 6 * 60_000;
  await watcher.tick();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].token, TOKEN);
  assert.equal(sent[0].payload.aps.alert.body, 'Chiefs sign a kicker');
  clock += 11 * 60_000;
  await watcher.tick();
  assert.equal(sent.length, 1, 'once');
});
