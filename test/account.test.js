import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clerkFrontendApi, clerkScriptUrl, signInAllowed, cleanTeams, parseAccount, mergeAccounts, sameAccount,
  loadAccountMark, saveAccountMark, MAX_ACCOUNT_TEAMS,
} from '../account.js';

const memory = () => {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
};

const chiefs = { league: 'nfl', id: '12', name: 'Kansas City Chiefs', abbr: 'KC', logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/kc.png', color: '#e31837' };
const bruins = { league: 'nhl', id: '1', name: 'Boston Bruins', abbr: 'BOS', logo: 'https://a.espncdn.com/i/teamlogos/nhl/500/bos.png', color: '#fdb71a' };
const celtics = { league: 'nba', id: '2', name: 'Boston Celtics', abbr: 'BOS', logo: '', color: null };

test('the Frontend API host comes out of the publishable key', () => {
  const key = `pk_test_${btoa('clerk.phade.app$')}`;
  assert.equal(clerkFrontendApi(key), 'clerk.phade.app');
  assert.equal(clerkScriptUrl(key), 'https://clerk.phade.app/npm/@clerk/clerk-js@5/dist/clerk.browser.js');
  assert.equal(clerkFrontendApi(`pk_live_${btoa('humble-cat-12.clerk.accounts.dev$')}`), 'humble-cat-12.clerk.accounts.dev');
  assert.equal(clerkFrontendApi(''), null);
  assert.equal(clerkFrontendApi('sk_test_abc'), null);
  assert.equal(clerkFrontendApi(`pk_test_${btoa('evil.com/path$')}`), null);
  assert.equal(clerkScriptUrl(''), null);
});

test('a production key signs in only on its own site', () => {
  // The real production key: Frontend API clerk.scores.phade.app.
  const live = 'pk_live_Y2xlcmsuc2NvcmVzLnBoYWRlLmFwcCQ';
  assert.equal(clerkFrontendApi(live), 'clerk.scores.phade.app');
  assert.ok(signInAllowed(live, 'scores.phade.app'));
  assert.ok(signInAllowed(live, 'www.scores.phade.app'));
  assert.ok(!signInAllowed(live, 'harkdigital.github.io'));
  assert.ok(!signInAllowed(live, 'phade.app'));
  assert.ok(!signInAllowed(live, 'evilscores.phade.app'));
  assert.ok(!signInAllowed(live, 'localhost'));
  // A development key works anywhere; no key, nowhere.
  assert.ok(signInAllowed(`pk_test_${btoa('happy-otter-12.clerk.accounts.dev$')}`, 'harkdigital.github.io'));
  assert.ok(!signInAllowed('', 'scores.phade.app'));
});

test('teams are checked and trimmed before they reach an account', () => {
  const teams = cleanTeams([
    { ...chiefs, alerts: { start: true, score: 'yes', end: false } },
    { ...chiefs, name: 'again' },                      // each team once
    { league: 'xfl', id: '1' },                        // a league we don't carry
    { league: 'nba', id: 'not an id!' },
    { ...bruins, logo: 'javascript:alert(1)', color: 'red', alerts: { start: false } },
    { league: 'nba', id: 2, alerts: true },            // an early build's plain true
  ]);
  assert.deepEqual(teams, [
    { ...chiefs, alerts: { start: true, score: false, end: false, lock: false, news: false } },
    { ...bruins, logo: '', color: null },
    { league: 'nba', id: '2', name: '', abbr: '', logo: '', color: null, alerts: { start: true, score: false, end: true, lock: false, news: false } },
  ]);
  assert.equal(cleanTeams('nope'), null);
  const many = Array.from({ length: 80 }, (_, i) => ({ league: 'ncaaf', id: String(i) }));
  assert.equal(cleanTeams(many).length, MAX_ACCOUNT_TEAMS);
});

test('an account is its teams and a clamped delay', () => {
  assert.deepEqual(parseAccount({ teams: [celtics], alertDelay: 9000 }), { teams: [celtics], alertDelay: 300 });
  assert.deepEqual(parseAccount({ teams: [] }), { teams: [], alertDelay: 0 });
  assert.equal(parseAccount({ alertDelay: 30 }), null);
  assert.equal(parseAccount(null), null);
});

test('the first sign-in adds the device\'s teams after the account\'s', () => {
  const account = { teams: [{ ...chiefs, alerts: { start: true, score: false, end: false, lock: false, news: false } }, bruins], alertDelay: 0 };
  const device = { teams: [celtics, { ...chiefs, alerts: { end: true } }], alertDelay: 30 };
  assert.deepEqual(mergeAccounts(account, device), {
    teams: [
      { ...chiefs, alerts: { start: true, score: false, end: true, lock: false, news: false } },
      bruins,
      celtics,
    ],
    alertDelay: 30,
  });
  // The account's delay wins when it has one.
  assert.equal(mergeAccounts({ teams: [], alertDelay: 15 }, { teams: [], alertDelay: 60 }).alertDelay, 15);
  // A new account takes the device as it is; an empty device leaves the account alone.
  assert.deepEqual(mergeAccounts({ teams: [], alertDelay: 0 }, device), parseAccount(device));
  assert.deepEqual(mergeAccounts(account, { teams: [] }), parseAccount(account));
  assert.ok(sameAccount(mergeAccounts(account, { teams: [] }), account));
  assert.ok(!sameAccount(account, device));
});

test('the account mark survives storage and its absence', () => {
  const storage = memory();
  assert.equal(loadAccountMark(storage), null);
  saveAccountMark(storage, { user: 'user_2abc', dirty: true });
  assert.deepEqual(loadAccountMark(storage), { user: 'user_2abc', dirty: true });
  saveAccountMark(storage, null);
  assert.equal(loadAccountMark(storage), null);
  storage.setItem('scores.account', '{broken');
  assert.equal(loadAccountMark(storage), null);
  assert.equal(loadAccountMark(null), null);
});
