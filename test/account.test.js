import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clerkFrontendApi, clerkScriptUrl, signInAllowed, cleanTeams, parseAccount, mergeAccounts, sameAccount, keepDeviceSettings,
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

test('an account is its teams, a clamped delay, a league order, game page layouts and a score view', () => {
  assert.deepEqual(parseAccount({ teams: [celtics], alertDelay: 9000 }), { teams: [celtics], alertDelay: 300, leagueOrder: [], gameCards: {}, scoreView: '' });
  assert.deepEqual(parseAccount({ teams: [] }), { teams: [], alertDelay: 0, leagueOrder: [], gameCards: {}, scoreView: '' });
  assert.equal(parseAccount({ teams: [], scoreView: 'compact' }).scoreView, 'compact');
  assert.equal(parseAccount({ teams: [], scoreView: 'tiny' }).scoreView, '');
  // Known sports and their own cards only.
  assert.deepEqual(parseAccount({ teams: [], gameCards: { soccer: { order: ['lineups', 'boxScore', 'odds'], hidden: ['odds'] }, curling: { order: ['odds'] } } }).gameCards,
    { soccer: { order: ['lineups', 'odds'], hidden: ['odds'] } });
  // Known leagues only, each once.
  assert.deepEqual(parseAccount({ teams: [], leagueOrder: ['epl', 'nba', 'curling', 'epl', 7] }).leagueOrder, ['epl', 'nba']);
  assert.deepEqual(parseAccount({ teams: [], leagueOrder: 'nba' }).leagueOrder, []);
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
    leagueOrder: [],
    gameCards: {},
    scoreView: '',
  });
  // The account's delay wins when it has one.
  assert.equal(mergeAccounts({ teams: [], alertDelay: 15 }, { teams: [], alertDelay: 60 }).alertDelay, 15);
  // A new account takes the device as it is; an empty device leaves the account alone.
  assert.deepEqual(mergeAccounts({ teams: [], alertDelay: 0 }, device), parseAccount(device));
  assert.deepEqual(mergeAccounts(account, { teams: [] }), parseAccount(account));
  assert.ok(sameAccount(mergeAccounts(account, { teams: [] }), account));
  assert.ok(!sameAccount(account, device));
  // So does its league order; a device's goes up to an account without one.
  assert.deepEqual(mergeAccounts({ teams: [], leagueOrder: ['nhl'] }, { teams: [], leagueOrder: ['epl'] }).leagueOrder, ['nhl']);
  assert.deepEqual(mergeAccounts({ teams: [] }, { teams: [], leagueOrder: ['epl'] }).leagueOrder, ['epl']);
  // Game page layouts: the account's sport wins, the device fills the rest.
  const football = { order: ['boxScore', 'odds'], hidden: [] };
  const hockey = { order: ['scoring'], hidden: ['scoring'] };
  assert.deepEqual(mergeAccounts(
    { teams: [], gameCards: { football } },
    { teams: [], gameCards: { football: { order: ['odds'], hidden: ['odds'] }, hockey } },
  ).gameCards, { football, hockey });
  // The score view: the account's unless it never set one.
  assert.equal(mergeAccounts({ teams: [], scoreView: 'detailed' }, { teams: [], scoreView: 'compact' }).scoreView, 'detailed');
  assert.equal(mergeAccounts({ teams: [] }, { teams: [], scoreView: 'compact' }).scoreView, 'compact');
});

test('a later sync keeps the device\'s league order when the account has none', () => {
  const remote = parseAccount({ teams: [celtics] });
  // A server from before the league order answers without one.
  assert.deepEqual(keepDeviceSettings(remote, { teams: [], leagueOrder: ['nba', 'nfl'] }), { ...remote, leagueOrder: ['nba', 'nfl'] });
  assert.equal(keepDeviceSettings(remote, { teams: [] }), remote);
  const ordered = parseAccount({ teams: [], leagueOrder: ['mls'] });
  assert.equal(keepDeviceSettings(ordered, { teams: [], leagueOrder: ['nba'] }), ordered);
  // The same for the game page's layouts.
  const cards = { hockey: { order: ['scoring'], hidden: [] } };
  assert.deepEqual(keepDeviceSettings(remote, { teams: [], gameCards: cards }), { ...remote, gameCards: cards });
  const laidOut = parseAccount({ teams: [], gameCards: { soccer: { order: ['lineups'], hidden: [] } } });
  assert.equal(keepDeviceSettings(laidOut, { teams: [], gameCards: cards }), laidOut);
  // And the score view.
  assert.deepEqual(keepDeviceSettings(remote, { teams: [], scoreView: 'compact' }), { ...remote, scoreView: 'compact' });
  const compact = parseAccount({ teams: [], scoreView: 'compact' });
  assert.equal(keepDeviceSettings(compact, { teams: [], scoreView: 'detailed' }), compact);
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
