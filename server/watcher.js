// The polling loop: for each league with a lock-screen card or a followed
// team, fetch ESPN's scoreboard only as often as its watched games need,
// push card updates, and send alerts when a followed team's game starts or
// ends. Scoreboards are parsed with the app's own espn.js, so the server's
// scores and statuses read exactly like the app's.

import { leagueById, scoreboardUrl, parseScoreboard, fallbackUrl, addDays, ymd } from '../espn.js';
import { contentState, activityPlan, activityPayload, gameAlerts, gameMemo, wantsAlert, followsGame, startDue, startPayload } from './live.js';
import { prune } from './store.js';

const MIN = 60_000;
const HOUR = 60 * MIN;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

// ESPN's site.api, falling back to site.web.api (as getJson does in the app).
export async function fetchJson(url) {
  let lastError = null;
  for (const u of [url, fallbackUrl(url)].filter(Boolean)) {
    try {
      const res = await fetch(u, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
      if (res.ok) return await res.json();
      lastError = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

// The scoreboard days to fetch (the container runs on Eastern time, ESPN's
// day): today, yesterday too in the small hours for late games, and the day
// of each card's game.
export function scoreDays(nowMs, startsMs) {
  const now = new Date(nowMs);
  const days = [now, ...(now.getHours() < 6 ? [addDays(now, -1)] : []), ...startsMs.map((ms) => new Date(ms))];
  const seen = new Set();
  return days.filter((d) => !seen.has(ymd(d)) && seen.add(ymd(d)));
}

// How long until a league's next fetch, from its watched games.
export function pollDelay(games, nowMs) {
  if (games.some((g) => g.state === 'in')) return 15_000;
  const untilStart = games.filter((g) => g.state === 'pre').map((g) => g.start - nowMs);
  // About to start, or past its start time and not marked live yet.
  if (untilStart.some((ms) => ms < 15 * MIN && ms > -6 * HOUR)) return 15_000;
  if (untilStart.some((ms) => ms > 0 && ms < 6 * HOUR)) return 2 * MIN;
  return 15 * MIN;
}

export function createWatcher({ store, apns, fetchJson: getJson = fetchJson, log = console.log, now = () => Date.now() }) {
  const nextFetch = new Map();
  let running = false;

  const watched = (leagueId, game) => {
    const { activities, scheduled, devices } = store.data;
    return [...Object.values(activities), ...Object.values(scheduled)].some((a) => a.league === leagueId && a.eventId === game.id)
      || Object.values(devices).some((d) => followsGame(d, leagueId, game));
  };

  // Without a key the server runs dry: it logs what it would send.
  async function push(kind, token, env, payload, priority) {
    if (!apns) {
      log(`dry run ${kind} ${token.slice(0, 8)}… ${JSON.stringify(payload)}`);
      return { ok: true, dead: false };
    }
    const result = kind === 'activity' ? await apns.activity(token, env, payload, priority) : await apns.alert(token, env, payload);
    if (result.status !== 200) log(`apns ${kind} ${token.slice(0, 8)}… ${result.status} ${result.reason}`);
    return { ok: result.status === 200, dead: result.dead };
  }

  async function handleGame(league, game) {
    const { data } = store;
    const key = `${league.id}:${game.id}`;
    const prev = data.games[key] ?? null;
    data.games[key] = gameMemo(game, league, now());
    const nowSec = Math.floor(now() / 1000);

    for (const [token, card] of Object.entries(data.activities)) {
      if (card.league !== league.id || card.eventId !== game.id) continue;
      const state = contentState(game, league);
      const plan = activityPlan(card.last, state);
      if (!plan) continue;
      const result = await push('activity', token, card.env, activityPayload(state, plan, nowSec), plan.priority);
      if (result.dead || (plan.end && result.ok)) delete data.activities[token];
      else if (result.ok) card.last = state;
    }

    // Scheduled cards go up shortly before the game; the phone then registers
    // the new card's own token and it's updated like any other.
    for (const [id, entry] of Object.entries(data.scheduled)) {
      if (entry.league !== league.id || entry.eventId !== game.id) continue;
      if (game.state === 'post') {
        delete data.scheduled[id];
        continue;
      }
      if (!startDue(game, nowSec)) continue;
      const result = await push('activity', entry.token, entry.env, startPayload(entry.card, game, league, nowSec), 10);
      if (result.ok || result.dead) delete data.scheduled[id];
    }

    for (const { kind, payload } of gameAlerts(prev, game, league)) {
      for (const [token, device] of Object.entries(data.devices)) {
        if (!wantsAlert(device, league.id, game, kind)) continue;
        // One of each per game state, even if ESPN flickers.
        const mark = `${token}|${key}|${kind}|${payload.aps.alert.body}`;
        if (data.sent[mark]) continue;
        data.sent[mark] = now();
        const result = await push('alert', token, device.env, payload);
        if (result.dead) delete data.devices[token];
      }
    }
  }

  async function tick() {
    if (running) return;
    running = true;
    try {
      const { data } = store;
      prune(data, now());
      const leagues = new Set([
        ...Object.values(data.activities).map((a) => a.league),
        ...Object.values(data.scheduled).map((s) => s.league),
        ...Object.values(data.devices).flatMap((d) => d.teams.map((t) => t.league)),
      ]);
      for (const id of leagues) {
        if ((nextFetch.get(id) ?? 0) > now()) continue;
        const league = leagueById(id);
        const starts = [...Object.values(data.activities), ...Object.values(data.scheduled)]
          .filter((a) => a.league === id && a.start).map((a) => a.start * 1000);
        const games = new Map();
        try {
          for (const day of scoreDays(now(), starts)) {
            const board = parseScoreboard(await getJson(scoreboardUrl(league, { date: day, byDate: true })), league);
            for (const g of board.games) games.set(g.id, g);
          }
        } catch (err) {
          log(`espn ${id}: ${err.message}`);
          nextFetch.set(id, now() + 30_000);
          continue;
        }
        const mine = [...games.values()].filter((g) => watched(id, g));
        for (const game of mine) await handleGame(league, game);
        nextFetch.set(id, now() + pollDelay(mine, now()));
      }
      store.save();
    } catch (err) {
      log(`tick failed: ${err.stack ?? err.message}`);
    } finally {
      running = false;
    }
  }

  return {
    tick,
    // Something new to watch in this league: look at it on the next tick.
    poke: (leagueId) => nextFetch.delete(leagueId),
  };
}
