// /v1/me: a signed-in person's followed teams, their alerts, the spoiler
// delay, the league tabs' order and the game page's cards per sport, kept
// under their Clerk user id so every device they sign in on gets the same
// ones (account.js in the web app does the syncing). The browser
// calls it from another origin (the site on github.io) with an
// Authorization header, so it answers CORS preflights for ALLOWED origins.
//
//   GET    /v1/me   → {teams, alertDelay, leagueOrder, gameCards, scoreView, updatedAt}  (an empty account until the first PUT)
//   PUT    /v1/me   {teams, alertDelay, leagueOrder, gameCards, scoreView} → the same, as saved
//   DELETE /v1/me   forgets the account (the app's Delete account)

import { parseAccount } from '../account.js';

export const MAX_USERS = 100_000;

export function corsHeaders(origin, allowed) {
  if (!origin || !allowed.includes(origin)) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, PUT, DELETE',
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-max-age': '600',
    vary: 'Origin',
  };
}

// method, the verified user id (null when the token didn't check out), the
// parsed body for a PUT, and store.data.users. Returns {status, body,
// changed}; changed means the store needs saving.
export function accountRoute({ method, user, body }, users) {
  if (!user) return { status: 401, body: { error: 'sign in' } };
  if (method === 'GET') {
    const saved = users[user];
    return { status: 200, body: saved ?? { teams: [], alertDelay: 0, leagueOrder: [], gameCards: {}, scoreView: '', updatedAt: null } };
  }
  if (method === 'PUT') {
    const account = parseAccount(body);
    if (!account) return { status: 400, body: { error: 'bad account' } };
    if (!users[user] && Object.keys(users).length >= MAX_USERS) return { status: 503, body: { error: 'full' } };
    users[user] = { ...account, updatedAt: Date.now() };
    return { status: 200, body: users[user], changed: true };
  }
  if (method === 'DELETE') {
    const changed = user in users;
    delete users[user];
    return { status: 200, body: { ok: true }, changed };
  }
  return { status: 405, body: { error: 'method not allowed' } };
}
