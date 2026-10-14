// Accounts: signing in (Clerk) keeps the followed teams (in the person's
// order), their alerts, the spoiler delay, the league tabs' order and the
// game page's cards per sport on the push server under the person's
// account, so every device they sign in on gets the same ones. Signed out,
// everything stays on the device as before. Pure, and shared with server/ (deploy.sh ships it).

import { leagueById } from './espn.js';
import { ALERT_KINDS, clampDelay, cleanLeagueOrder, cleanGameCards } from './myteams.js';

// Clerk's publishable key (Clerk dashboard > API keys): pk_test_... for the
// development instance, pk_live_... for production. Not a secret. Empty
// turns sign-in off: no account button, nothing loaded. This is the
// production instance on scores.phade.app (Frontend API
// clerk.scores.phade.app), so sign-in shows only on that site
// (signInAllowed): not on harkdigital.github.io, nor in the apps while they
// load github.io.
export const CLERK_PUBLISHABLE_KEY = 'pk_live_Y2xlcmsuc2NvcmVzLnBoYWRlLmFwcCQ';

// Where the account lives: the push server's /v1/me.
export const ACCOUNT_API = 'https://scores.phade.app';

// localStorage: {user, dirty}. user is the Clerk user this device last
// synced with (another id, or none, means the next sync merges this
// device's teams into the account); dirty means a change hasn't reached the
// server yet.
export const ACCOUNT_KEY = 'scores.account';

// About 220 bytes a team, so 60 stay under the server's 16 KB body limit.
export const MAX_ACCOUNT_TEAMS = 60;

// A publishable key carries the instance's Frontend API host in base64:
// pk_test_Y2xlcmsuZXhhbXBsZS5jb20k is "clerk.example.com$".
export function clerkFrontendApi(key) {
  const match = /^pk_(test|live)_([A-Za-z0-9+/=_-]+)$/.exec(String(key ?? ''));
  if (!match) return null;
  let host = '';
  try {
    host = atob(match[2].replace(/-/g, '+').replace(/_/g, '/'));
  } catch {
    return null;
  }
  host = host.replace(/\$$/, '');
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(host) ? host : null;
}

// Whether sign-in works on this site. A development key works anywhere; a
// production key only on the domain its instance belongs to (Clerk's
// cookies are first-party there), which is its Frontend API host without
// the "clerk." in front: clerk.scores.phade.app → scores.phade.app.
export function signInAllowed(key, hostname) {
  const host = clerkFrontendApi(key);
  if (!host) return false;
  if (String(key).startsWith('pk_test_')) return true;
  const site = host.replace(/^clerk\./, '');
  const here = String(hostname ?? '').toLowerCase();
  return here === site || here.endsWith(`.${site}`);
}

// Clerk's browser bundle, served by the instance itself (major version 5).
export function clerkScriptUrl(key) {
  const host = clerkFrontendApi(key);
  return host ? `https://${host}/npm/@clerk/clerk-js@5/dist/clerk.browser.js` : null;
}

const TEAM_ID = /^[\w-]{1,20}$/;
const COLOR = /^#?[0-9a-f]{6}$/i;
const text = (value, max) => (typeof value === 'string' ? value.slice(0, max) : '');

function cleanAlerts(alerts) {
  // Early builds stored a plain true for "starts and finals".
  if (alerts === true) return { start: true, score: false, end: true, lock: false, news: false };
  if (!alerts || typeof alerts !== 'object') return null;
  const clean = Object.fromEntries(ALERT_KINDS.map((k) => [k, alerts[k] === true]));
  return Object.values(clean).some(Boolean) ? clean : null;
}

// The followed teams as myteams.js keeps them, checked and trimmed: a known
// league, a plausible id, short strings, an https logo, each team once. Null
// when it isn't a list.
export function cleanTeams(list) {
  if (!Array.isArray(list)) return null;
  const seen = new Set();
  const teams = [];
  for (const t of list) {
    const id = String(t?.id ?? '');
    if (!leagueById(t?.league) || !TEAM_ID.test(id) || seen.has(`${t.league}:${id}`)) continue;
    seen.add(`${t.league}:${id}`);
    const logo = text(t.logo, 300);
    const team = {
      league: t.league,
      id,
      name: text(t.name, 80),
      abbr: text(t.abbr, 12),
      logo: logo.startsWith('https://') ? logo : '',
      color: typeof t.color === 'string' && COLOR.test(t.color) ? t.color : null,
    };
    const alerts = cleanAlerts(t.alerts);
    teams.push(alerts ? { ...team, alerts } : team);
    if (teams.length === MAX_ACCOUNT_TEAMS) break;
  }
  return teams;
}

// An account's settings, from the server or for it: {teams, alertDelay,
// leagueOrder, gameCards}. An empty leagueOrder is the app's own order, an
// empty gameCards the app's game page layout for every sport (and what a
// server from before them answers).
export function parseAccount(body) {
  const teams = cleanTeams(body?.teams);
  if (!teams) return null;
  return {
    teams,
    alertDelay: clampDelay(body.alertDelay),
    leagueOrder: cleanLeagueOrder(body.leagueOrder),
    gameCards: cleanGameCards(body.gameCards),
  };
}

// The account read back on a later sync: an account with no league order,
// or no game page layouts (never set, or a server that drops them), leaves
// this device's alone.
export function keepDeviceSettings(account, device) {
  const order = cleanLeagueOrder(device?.leagueOrder);
  const cards = cleanGameCards(device?.gameCards);
  let kept = account;
  if (!account.leagueOrder.length && order.length) kept = { ...kept, leagueOrder: order };
  if (!Object.keys(account.gameCards).length && Object.keys(cards).length) kept = { ...kept, gameCards: cards };
  return kept;
}

// The first sign-in on a device: the account's teams, then this device's
// that the account doesn't have yet. A team on both keeps every alert either
// side had on, and the account's delay, league order and each sport's game
// page layout win unless unset.
export function mergeAccounts(account, device) {
  const empty = { teams: [], alertDelay: 0, leagueOrder: [], gameCards: {} };
  const local = parseAccount(device) ?? empty;
  const remote = parseAccount(account) ?? empty;
  const key = (t) => `${t.league}:${t.id}`;
  const fromDevice = new Map(local.teams.map((t) => [key(t), t]));
  const teams = remote.teams.map((t) => {
    const other = fromDevice.get(key(t));
    fromDevice.delete(key(t));
    if (!other?.alerts) return t;
    const alerts = Object.fromEntries(ALERT_KINDS.map((k) => [k, Boolean(t.alerts?.[k] || other.alerts[k])]));
    return { ...t, alerts };
  });
  return parseAccount({
    teams: [...teams, ...fromDevice.values()],
    alertDelay: remote.alertDelay || local.alertDelay,
    leagueOrder: remote.leagueOrder.length ? remote.leagueOrder : local.leagueOrder,
    gameCards: { ...local.gameCards, ...remote.gameCards },
  });
}

export const sameAccount = (a, b) => JSON.stringify(parseAccount(a)) === JSON.stringify(parseAccount(b));

export function loadAccountMark(storage) {
  try {
    const mark = JSON.parse(storage?.getItem(ACCOUNT_KEY) ?? 'null');
    return mark && typeof mark.user === 'string' ? { user: mark.user, dirty: mark.dirty === true } : null;
  } catch {
    return null;
  }
}

export function saveAccountMark(storage, mark) {
  try {
    if (mark) storage?.setItem(ACCOUNT_KEY, JSON.stringify(mark));
    else storage?.removeItem(ACCOUNT_KEY);
  } catch { /* full or blocked */ }
}
