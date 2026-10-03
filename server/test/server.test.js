import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { leagueById, parseScoreboard } from '../../espn.js';
import {
  contentState, activityPlan, activityPayload, alertKind, alertPayload, parseActivity, parseDevice,
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
    away: '17', home: '21', state: 'in', status: '4:32 - 3rd', detail: game(nflBoard, '402').detail,
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

test('alerts fire on a change the server saw, never on first sight', () => {
  const live = game(nflBoard, '402');
  const final = game(nflBoard, '401');
  assert.equal(alertKind(undefined, live), null);
  assert.equal(alertKind('in', live), null);
  assert.equal(alertKind('pre', live), 'start');
  assert.equal(alertKind('in', final), 'final');
  assert.equal(alertKind('pre', { ...final, statusName: 'STATUS_POSTPONED', statusText: 'Postponed' }), 'off');
});

test('alert text reads like the scoreboard, with a link to the game', () => {
  const final = alertPayload('final', game(nflBoard, '403'), nfl);
  assert.equal(final.aps.alert.title, 'Jets @ Vikings');
  assert.equal(final.aps.alert.body, 'Final/OT: Jets 26, Vikings 23');
  assert.equal(final.route, '#/game/nfl/403');
  const soccer = alertPayload('final', game(eplBoard, '701'), epl);
  assert.equal(soccer.aps.alert.title, 'Man City vs Liverpool');
  assert.equal(soccer.aps.alert.body, 'FT: Man City 2, Liverpool 2');
  assert.ok(!/—/.test(final.aps.alert.body + soccer.aps.alert.body));
});

test('requests are validated', () => {
  const ok = parseActivity({ token: TOKEN.toUpperCase(), env: 'production', league: 'nfl', eventId: '401547417', start: 1_800_000_000 });
  assert.equal(ok.token, TOKEN);
  assert.equal(parseActivity({ token: TOKEN, env: 'production', league: 'xfl', eventId: '1' }), null);
  assert.equal(parseActivity({ token: 'nope', env: 'production', league: 'nfl', eventId: '1' }), null);
  assert.equal(parseActivity({ token: TOKEN, env: 'staging', league: 'nfl', eventId: '1' }), null);
  assert.equal(parseActivity({ token: TOKEN, env: 'sandbox', league: 'nfl', eventId: '1; drop' }), null);
  assert.deepEqual(parseDevice({ env: 'sandbox', teams: [{ league: 'nfl', id: 21 }] }), { env: 'sandbox', teams: [{ league: 'nfl', id: '21' }] });
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

test('a live game polls every 15s, a quiet day every 15 minutes', () => {
  const now = Date.parse('2026-10-04T16:00:00Z');
  assert.equal(pollDelay([{ state: 'in' }], now), 15_000);
  assert.equal(pollDelay([{ state: 'pre', start: now + 10 * 60_000 }], now), 15_000);
  assert.equal(pollDelay([{ state: 'pre', start: now + 3 * 3_600_000 }], now), 120_000);
  assert.equal(pollDelay([], now), 900_000);
});

// The whole loop against the real NFL scoreboard, with ESPN and Apple faked.
function harness(data) {
  const sent = [];
  const store = { data: { activities: {}, devices: {}, games: {}, sent: {}, ...data }, save() {} };
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

test('followers get one start and one final alert', async () => {
  // Following Buffalo (id 2), whose game against KC is 402.
  const h = harness({ devices: { [TOKEN]: { env: 'production', teams: [{ league: 'nfl', id: '2' }] } } });
  h.setBoard((b) => { b.events.find((e) => e.id === '402').competitions[0].status.type.state = 'pre'; });
  await h.watcher.tick();
  assert.equal(h.sent.length, 0, 'first sight is not a change');

  h.setBoard((b) => { b.events.find((e) => e.id === '402').competitions[0].status.type.state = 'in'; });
  h.later(20_000);
  await h.watcher.tick();
  h.later(20_000);
  await h.watcher.tick();
  assert.deepEqual(h.sent.map((s) => s.payload.aps.alert.body), ['Starting now.']);

  h.setBoard((b) => {
    const t = b.events.find((e) => e.id === '402').competitions[0].status.type;
    Object.assign(t, { state: 'post', name: 'STATUS_FINAL', shortDetail: 'Final' });
  });
  h.later(20_000);
  await h.watcher.tick();
  assert.equal(h.sent.length, 2);
  assert.equal(h.sent[1].payload.aps.alert.body, 'Final: Chiefs 17, Bills 21');
  assert.equal(h.sent[1].payload.route, '#/game/nfl/402');
});
