import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createClerkAuth } from '../auth.js';
import { accountRoute, corsHeaders } from '../me.js';

const ISS = 'https://clerk.phade.app';
const NOW = 1_800_000_000_000;
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'ins_1', alg: 'RS256', use: 'sig' };
const pem = publicKey.export({ format: 'pem', type: 'spki' });

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function sign(claims, { key = privateKey, kid = 'ins_1', alg = 'RS256' } = {}) {
  const head = b64({ alg, kid, typ: 'JWT' });
  const body = b64({ iss: ISS, sub: 'user_2abc', azp: 'https://scores.phade.app', exp: NOW / 1000 + 60, nbf: NOW / 1000 - 10, ...claims });
  const sig = crypto.sign('RSA-SHA256', Buffer.from(`${head}.${body}`), key).toString('base64url');
  return `Bearer ${head}.${body}.${sig}`;
}

test('a Clerk session token checks out with the PEM key, no network', async () => {
  const verify = createClerkAuth({ issuer: ISS, jwtKey: pem, now: () => NOW, fetchJson: () => assert.fail('no fetch') });
  assert.equal(await verify(sign({})), 'user_2abc');
});

test('a token is refused when anything is off', async () => {
  const verify = createClerkAuth({ issuer: `${ISS}/`, jwtKey: pem, parties: ['https://scores.phade.app', 'https://harkdigital.github.io'], now: () => NOW });
  assert.equal(await verify(sign({ exp: NOW / 1000 - 30 })), null, 'expired');
  assert.equal(await verify(sign({ exp: NOW / 1000 - 3 })), 'user_2abc', 'within the clock skew');
  assert.equal(await verify(sign({ nbf: NOW / 1000 + 60 })), null, 'not yet valid');
  assert.equal(await verify(sign({ iss: 'https://evil.clerk.accounts.dev' })), null, 'another instance');
  assert.equal(await verify(sign({ azp: 'https://evil.example' })), null, 'made for another site');
  assert.equal(await verify(sign({}, { key: other.privateKey })), null, 'signed with another key');
  assert.equal(await verify(sign({}, { alg: 'HS256' })), null);
  assert.equal(await verify(sign({ sub: 'org_1' })), null);
  assert.equal(await verify(sign({ exp: undefined })), null);
  // Tampered claims fail the signature.
  const [head, , sig] = sign({}).slice(7).split('.');
  assert.equal(await verify(`Bearer ${head}.${b64({ iss: ISS, sub: 'user_evil', exp: NOW / 1000 + 60 })}.${sig}`), null);
  assert.equal(await verify(undefined), null);
  assert.equal(await verify('Basic abc'), null);
  assert.equal(await verify('Bearer not.a-token'), null);
  assert.throws(() => createClerkAuth({ issuer: 'http://clerk.phade.app' }));
});

test('without a PEM key the instance\'s JWKS is fetched once and cached', async () => {
  let now = NOW;
  const urls = [];
  const verify = createClerkAuth({
    issuer: ISS,
    now: () => now,
    fetchJson: async (url) => { urls.push(url); return { keys: [jwk] }; },
  });
  assert.equal(await verify(sign({})), 'user_2abc');
  assert.equal(await verify(sign({})), 'user_2abc');
  assert.deepEqual(urls, [`${ISS}/.well-known/jwks.json`]);
  // An unknown kid refetches, at most once a minute.
  assert.equal(await verify(sign({}, { kid: 'ins_2' })), null);
  assert.equal(urls.length, 1);
  now += 61_000;
  assert.equal(await verify(sign({ exp: now / 1000 + 60 }, { kid: 'ins_2' })), null);
  assert.equal(urls.length, 2);
});

test('a failed JWKS fetch refuses the token without throwing', async () => {
  const verify = createClerkAuth({ issuer: ISS, now: () => NOW, fetchJson: async () => { throw new Error('down'); } });
  assert.equal(await verify(sign({})), null);
});

test('/v1/me keeps each person\'s teams and alerts', () => {
  const users = {};
  assert.equal(accountRoute({ method: 'GET', user: null }, users).status, 401);
  assert.deepEqual(accountRoute({ method: 'GET', user: 'user_1' }, users).body, { teams: [], alertDelay: 0, leagueOrder: [], gameCards: {}, updatedAt: null });
  const teams = [{ league: 'nfl', id: '12', name: 'Chiefs', abbr: 'KC', logo: '', color: null, alerts: { start: true } }];
  const put = accountRoute({ method: 'PUT', user: 'user_1', body: { teams, alertDelay: 30 } }, users);
  assert.equal(put.status, 200);
  assert.ok(put.changed);
  assert.deepEqual(users.user_1.teams[0].alerts, { start: true, score: false, end: false, lock: false, news: false });
  assert.equal(users.user_1.alertDelay, 30);
  assert.deepEqual(users.user_1.leagueOrder, []);
  accountRoute({ method: 'PUT', user: 'user_1', body: { teams, alertDelay: 30, leagueOrder: ['nhl', 'nfl', 'xfl'] } }, users);
  assert.deepEqual(users.user_1.leagueOrder, ['nhl', 'nfl']);
  accountRoute({ method: 'PUT', user: 'user_1', body: { teams, gameCards: { hockey: { order: ['teamStats', 'odds'], hidden: ['odds'] } } } }, users);
  assert.deepEqual(users.user_1.gameCards, { hockey: { order: ['teamStats', 'odds'], hidden: ['odds'] } });
  assert.equal(accountRoute({ method: 'GET', user: 'user_1' }, users).body, users.user_1);
  assert.deepEqual(accountRoute({ method: 'GET', user: 'user_2' }, users).body.teams, [], 'one person can\'t read another\'s');
  assert.equal(accountRoute({ method: 'PUT', user: 'user_1', body: { teams: 'x' } }, users).status, 400);
  assert.equal(accountRoute({ method: 'POST', user: 'user_1' }, users).status, 405);
  assert.ok(accountRoute({ method: 'DELETE', user: 'user_1' }, users).changed);
  assert.deepEqual(users, {});
});

test('/v1/me answers CORS only for the app\'s own sites', () => {
  const allowed = ['https://harkdigital.github.io', 'https://scores.phade.app'];
  assert.equal(corsHeaders('https://harkdigital.github.io', allowed)['access-control-allow-origin'], 'https://harkdigital.github.io');
  assert.match(corsHeaders('https://scores.phade.app', allowed)['access-control-allow-headers'], /authorization/);
  assert.deepEqual(corsHeaders('https://evil.example', allowed), {});
  assert.deepEqual(corsHeaders(undefined, allowed), {});
});

test('a CLERK_JWT_KEY that isn\'t a PEM key is refused with a clear error', () => {
  assert.throws(() => createClerkAuth({ issuer: ISS, jwtKey: 'not a key' }), /CLERK_JWT_KEY/);
  // Written on one line with \n, as .env needs.
  const oneLine = pem.trim().replace(/\n/g, '\\n');
  assert.doesNotThrow(() => createClerkAuth({ issuer: ISS, jwtKey: oneLine }));
});
