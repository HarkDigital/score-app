// The Android app's side of the push server: FCM tokens, its requests, the
// data messages it gets, and the watcher sending them through Firebase.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { leagueById, parseScoreboard } from '../../espn.js';
import {
  contentState, parseActivity, parseDevice, parseScheduled, normalizeToken, validToken, activityKey,
  androidCardMessage, androidStartMessage, androidAlertMessage, gameAlerts, gameMemo,
} from '../live.js';
import { assertion, fcmMessage, fcmTokenIsDead, createFcm, readAccount } from '../fcm.js';
import { createWatcher } from '../watcher.js';

const fixture = (name) => JSON.parse(readFileSync(new URL(`../../test/fixtures/${name}.json`, import.meta.url)));
const nfl = leagueById('nfl');
const nflBoard = parseScoreboard(fixture('nfl-scoreboard'), nfl);
const game = (board, id) => board.games.find((g) => g.id === id);
// The shape of an FCM registration token (made up).
const FCM = `cW7xQ2h-TfS_3kd9aBcDeF:APA91b${'Hx-Q_9zK'.repeat(17)}`;
const APNS = 'ab'.repeat(32);

const card = (eventId) => ({
  league: 'nfl', leagueLabel: 'NFL', eventId, start: 1_791_200_000, homeFirst: false,
  away: { abbr: 'SF', name: '49ers', color: '#aa0000', logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/sf.png' },
  home: { abbr: 'LAR', name: 'Rams', color: '#003594', logo: null },
});

test('FCM tokens are accepted as they are; iPhone tokens are hex, in any case', () => {
  assert.ok(validToken(FCM));
  assert.equal(normalizeToken(FCM), FCM, 'case kept: FCM tokens are case-sensitive');
  assert.equal(normalizeToken(APNS.toUpperCase()), APNS);
  assert.equal(normalizeToken('no:t a token'), null);
  assert.equal(normalizeToken(undefined), null);
});

test('Android requests: an FCM token and no APNs environment', () => {
  const activity = parseActivity({ platform: 'android', token: FCM, league: 'nfl', eventId: '404', start: 1_791_200_000 });
  assert.deepEqual(activity, { platform: 'android', token: FCM, env: 'production', league: 'nfl', eventId: '404', start: 1_791_200_000 });
  assert.equal(activityKey(activity), `${FCM}|nfl:404`, 'one phone token, one key per game');
  assert.equal(activityKey({ ...activity, platform: 'ios', token: APNS }), APNS);
  // Each app's own kind of token only.
  assert.equal(parseActivity({ platform: 'android', token: APNS, league: 'nfl', eventId: '404' }), null);
  assert.equal(parseActivity({ token: FCM, env: 'production', league: 'nfl', eventId: '404' }), null);

  const scheduled = parseScheduled({ platform: 'android', token: FCM, card: card('404') });
  assert.equal(scheduled.platform, 'android');
  assert.equal(scheduled.token, FCM);
  assert.equal(scheduled.card.away.name, '49ers');

  const device = parseDevice({ platform: 'android', teams: [{ league: 'nfl', id: '25', start: true, score: true, end: true }] });
  assert.equal(device.platform, 'android');
  assert.equal(device.env, 'production');
  assert.equal(device.teams.length, 1);
});

test('Android messages: string data, priority by what changed, one collapse key per game', () => {
  const entry = { league: 'nfl', eventId: '402' };
  const state = contentState(game(nflBoard, '402'), nfl);
  const big = androidCardMessage(entry, state, { priority: 10, end: false });
  assert.equal(big.data.type, 'update');
  assert.equal(big.priority, 'HIGH');
  assert.equal(big.collapseKey, 'nfl:402');
  assert.deepEqual(JSON.parse(big.data.state), state);
  assert.ok(Object.values(big.data).every((v) => typeof v === 'string'));
  assert.equal(androidCardMessage(entry, state, { priority: 5, end: false }).priority, 'NORMAL');
  assert.equal(androidCardMessage(entry, state, { priority: 10, end: true }).data.type, 'end');

  const pre = game(nflBoard, '404');
  const start = androidStartMessage(card('404'), pre, nfl);
  assert.equal(start.data.type, 'start');
  assert.equal(JSON.parse(start.data.card).start, Math.round(pre.start.getTime() / 1000), 'the scoreboard start, in Unix seconds');
  assert.deepEqual(JSON.parse(start.data.state), contentState(pre, nfl));

  const live = game(nflBoard, '402');
  const [alert] = gameAlerts(gameMemo({ ...live, state: 'pre' }, nfl, 0), live, nfl);
  const message = androidAlertMessage(alert.payload);
  assert.deepEqual(message.data, { type: 'alert', title: alert.payload.aps.alert.title, body: 'Starting now.', route: '#/game/nfl/402', thread: 'nfl-402' });
});

test('the FCM assertion is an RS256 JWT Google can verify, and messages carry Android options', () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const account = { project_id: 'phade-f0a20', client_email: 'scores@phade-f0a20.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
  const jwt = assertion(account, 1_800_000_000);
  const [head, claims, sig] = jwt.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(head, 'base64url')), { alg: 'RS256', typ: 'JWT' });
  const c = JSON.parse(Buffer.from(claims, 'base64url'));
  assert.equal(c.iss, account.client_email);
  assert.equal(c.scope, 'https://www.googleapis.com/auth/firebase.messaging');
  assert.equal(c.exp - c.iat, 3600);
  assert.ok(crypto.verify('RSA-SHA256', Buffer.from(`${head}.${claims}`), publicKey, Buffer.from(sig, 'base64url')));

  assert.deepEqual(fcmMessage(FCM, { data: { a: '1' }, priority: 'NORMAL', collapseKey: 'nfl:1', ttl: '60s' }), {
    message: { token: FCM, data: { a: '1' }, android: { priority: 'NORMAL', collapse_key: 'nfl:1', ttl: '60s' } },
  });
  assert.equal(readAccount(JSON.stringify(account)).project_id, 'phade-f0a20');
  assert.equal(readAccount('{"project_id": "x"}'), null);
  assert.equal(readAccount('not json'), null);
});

test('dead FCM tokens are recognized', () => {
  assert.ok(fcmTokenIsDead(404, { error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } }));
  assert.ok(fcmTokenIsDead(403, { error: { status: 'PERMISSION_DENIED', details: [{ errorCode: 'SENDER_ID_MISMATCH' }] } }));
  assert.ok(fcmTokenIsDead(400, { error: { status: 'INVALID_ARGUMENT', message: 'The registration token is not a valid FCM registration token' } }));
  assert.ok(!fcmTokenIsDead(429, { error: { status: 'RESOURCE_EXHAUSTED' } }));
  assert.ok(!fcmTokenIsDead(503, {}));
});

test('the FCM client gets an access token once and sends with it', async () => {
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const account = { project_id: 'phade-f0a20', client_email: 'x@y', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
  const calls = [];
  const fake = async (url, init) => {
    calls.push({ url, init });
    if (url.includes('oauth2')) return new Response(JSON.stringify({ access_token: 'ya29.x', expires_in: 3599 }));
    if (init.body.includes('dead-token')) return new Response(JSON.stringify({ error: { details: [{ errorCode: 'UNREGISTERED' }] } }), { status: 404 });
    return new Response('{}');
  };
  const fcm = createFcm({ account, fetch: fake, log: () => {} });
  assert.deepEqual(await fcm.send(FCM, { data: { type: 'alert' } }), { ok: true, dead: false, status: 200 });
  assert.deepEqual(await fcm.send('dead-token', { data: { type: 'alert' } }), { ok: false, dead: true, status: 404 });
  assert.equal(calls.filter((c) => c.url.includes('oauth2')).length, 1, 'the access token is reused');
  const send = calls.find((c) => c.url.includes('messages:send'));
  assert.equal(send.url, 'https://fcm.googleapis.com/v1/projects/phade-f0a20/messages:send');
  assert.equal(send.init.headers.authorization, 'Bearer ya29.x');
});

// The watcher against the real NFL scoreboard, with ESPN and Firebase faked.
function harness(data) {
  const sent = [];
  const store = { data: { activities: {}, scheduled: {}, devices: {}, games: {}, sent: {}, ...data }, save() {} };
  let board = structuredClone(fixture('nfl-scoreboard'));
  const apns = {
    activity: async () => { throw new Error('no iPhone pushes here'); },
    alert: async () => { throw new Error('no iPhone pushes here'); },
  };
  const fcm = { send: async (token, message) => { sent.push({ token, ...message }); return { ok: true, dead: false, status: 200 }; } };
  let clock = Date.parse('2026-10-04T18:00:00Z');
  const watcher = createWatcher({ store, apns, fcm, fetchJson: async () => board, log: () => {}, now: () => clock });
  return {
    store, sent, watcher,
    setBoard: (fn) => { board = structuredClone(board); fn(board); },
    later: (ms) => { clock += ms; },
  };
}

test('an Android card gets its state through Firebase, then only changes, then the final', async () => {
  const key = `${FCM}|nfl:402`;
  const h = harness({ activities: { [key]: { platform: 'android', token: FCM, env: 'production', league: 'nfl', eventId: '402', start: null, createdAt: Date.parse('2026-10-04T17:00:00Z'), last: null } } });
  await h.watcher.tick();
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].token, FCM);
  assert.equal(h.sent[0].data.type, 'update');
  assert.equal(JSON.parse(h.sent[0].data.state).home, '21');

  h.later(20_000);
  await h.watcher.tick();
  assert.equal(h.sent.length, 1, 'nothing changed, nothing sent');

  h.setBoard((b) => {
    const comp = b.events.find((e) => e.id === '402').competitions[0];
    comp.status.type = { ...comp.status.type, state: 'post', name: 'STATUS_FINAL', shortDetail: 'Final' };
  });
  h.later(20_000);
  await h.watcher.tick();
  assert.equal(h.sent[1].data.type, 'end');
  assert.deepEqual(h.store.data.activities, {}, 'done once the final is sent');
});

test('a scheduled Android card starts on time and then updates like any other', async () => {
  const entry = parseScheduled({ platform: 'android', token: FCM, card: card('404') });
  const h = harness({ scheduled: { [`${FCM}|nfl:404`]: { ...entry, createdAt: 0 } } });
  await h.watcher.tick(); // 18:00Z, 2h25 before
  assert.equal(h.sent.length, 0);
  h.later(2 * 3600_000 + 10 * 60_000 + 1_000); // 20:10:01Z, just under 15 minutes before
  await h.watcher.tick();
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].data.type, 'start');
  assert.equal(JSON.parse(h.sent[0].data.card).away.name, '49ers');
  assert.deepEqual(h.store.data.scheduled, {});
  const active = h.store.data.activities[`${FCM}|nfl:404`];
  assert.equal(active.platform, 'android');
  assert.deepEqual(active.last, JSON.parse(h.sent[0].data.state), 'the first state counts as sent');
});

test('an Android phone gets its team alerts through Firebase', async () => {
  const h = harness({ devices: { [FCM]: { platform: 'android', env: 'production', teams: [{ league: 'nfl', id: '2', start: true, score: true, end: true }] } } });
  // KC @ BUF (402) is live in the fixture; first sight of it is never an alert.
  h.store.data.games['nfl:402'] = { state: 'pre', statusName: 'STATUS_SCHEDULED', away: '', home: '', at: Date.parse('2026-10-04T17:59:00Z') };
  await h.watcher.tick();
  const alerts = h.sent.filter((m) => m.data.type === 'alert');
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].data.body, 'Starting now.');
  assert.equal(alerts[0].data.route, '#/game/nfl/402');
});
