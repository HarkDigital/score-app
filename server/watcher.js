// The polling loop: for each league with a lock-screen card or a followed
// team, fetch ESPN's scoreboard only as often as its watched games need,
// push card updates, and send alerts when a followed team's game starts or
// ends. Scoreboards are parsed with the app's own espn.js, so the server's
// scores and statuses read exactly like the app's.

import { leagueById, dayUrls, parseScoreboard, fallbackUrl, addDays, ymd } from '../espn.js';
import {
  contentState, activityPlan, activityPayload, gameAlerts, gameMemo, wantsAlert, followsGame, startDue, startPayload, SCHEDULE_LEAD,
  isAndroid, activityKey, androidCardMessage, androidStartMessage, androidAlertMessage, wantsLock, cardFromGame,
  gameProgress, gamePeriods,
  newsTeams, newsPlan, newsPayload, wantsNews, NEWS_EVERY,
} from './live.js';
import { prune } from './store.js';
import { newsUrl, parseNews } from '../news.js';

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
  if (games.some((g) => g.state === 'in')) return 5_000;
  const untilStart = games.filter((g) => g.state === 'pre').map((g) => g.start - nowMs);
  // About to start, or past its start time and not marked live yet.
  if (untilStart.some((ms) => ms < 15 * MIN && ms > -6 * HOUR)) return 15_000;
  if (untilStart.some((ms) => ms > 0 && ms < 6 * HOUR)) return 2 * MIN;
  return 15 * MIN;
}

export function createWatcher({ store, apns, fcm = null, fetchJson: getJson = fetchJson, log = console.log, now = () => Date.now() }) {
  const nextFetch = new Map();
  const nextNews = new Map();
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

  // The Android app's messages, through Firebase (or logged without a key).
  async function sendAndroid(token, message) {
    if (!fcm) {
      log(`dry run android ${message.data.type} ${token.slice(0, 8)}… ${JSON.stringify(message.data)}`);
      return { ok: true, dead: false };
    }
    const result = await fcm.send(token, message);
    return { ok: result.ok, dead: result.dead };
  }

  async function handleGame(league, game) {
    const { data } = store;
    const key = `${league.id}:${game.id}`;
    const prev = data.games[key] ?? null;
    data.games[key] = gameMemo(game, league, now());
    const nowSec = Math.floor(now() / 1000);

    for (const [key, card] of Object.entries(data.activities)) {
      if (card.league !== league.id || card.eventId !== game.id) continue;
      const state = contentState(game, league);
      const plan = activityPlan(card.last, state);
      if (!plan) continue;
      // Entries from before Android keep their token as the key only.
      const token = card.token ?? key;
      const result = isAndroid(card)
        ? await sendAndroid(token, androidCardMessage(card, state, plan, gameProgress(game, league), gamePeriods(league).periods))
        : await push('activity', token, card.env, activityPayload(state, plan, nowSec), plan.priority);
      if (result.dead || (plan.end && result.ok)) delete data.activities[key];
      else if (result.ok) card.last = state;
    }

    // Followed teams with "every game on the Lock Screen": each game goes up
    // when a scheduled card would, once per phone (a card swiped away stays
    // away). Before the scheduled cards, so a game also scheduled by hand
    // isn't started twice.
    for (const [token, device] of Object.entries(data.devices)) {
      if (game.state === 'post' || !wantsLock(device, league.id, game) || !startDue(game, nowSec)) continue;
      const mark = `${token}|${key}|lock`;
      if (data.sent[mark]) continue;
      const card = cardFromGame(game, league);
      if (isAndroid(device)) {
        const cardKey = `${token}|${key}`;
        data.sent[mark] = now();
        // Already up or scheduled from the game page.
        if (data.activities[cardKey] || data.scheduled[cardKey]) continue;
        const result = await sendAndroid(token, androidStartMessage(card, game, league, { auto: true }));
        if (result.ok) {
          data.activities[cardKey] = {
            platform: 'android', token, env: 'production', league: league.id, eventId: game.id,
            start: card.start, createdAt: now(), last: contentState(game, league),
          };
        }
        if (result.dead) delete data.devices[token];
      } else {
        // Before iOS 17.2 (or before its token arrives) an iPhone can't be
        // started remotely; it's tried again on later polls.
        if (!device.startToken) continue;
        data.sent[mark] = now();
        if (data.scheduled[`${device.startToken}|${key}`]) continue;
        await push('activity', device.startToken, device.env, startPayload(card, game, league, nowSec), 10);
      }
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
      if (isAndroid(entry)) {
        // Android has no card token of its own: the phone's token now gets
        // this game's updates like a card it put up itself.
        const result = await sendAndroid(entry.token, androidStartMessage(entry.card, game, league));
        if (result.ok) {
          const card = { platform: 'android', token: entry.token, env: entry.env, league: league.id, eventId: game.id, start: entry.start };
          data.activities[activityKey(card)] = { ...card, createdAt: now(), last: contentState(game, league) };
        }
        if (result.ok || result.dead) delete data.scheduled[id];
        continue;
      }
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
        const result = isAndroid(device)
          ? await sendAndroid(token, androidAlertMessage(payload))
          : await push('alert', token, device.env, payload);
        if (result.dead) delete data.devices[token];
      }
    }
  }

  // Team news alerts: each wanted team's news every NEWS_EVERY, its new
  // stories to every phone that wants them. True when it looked at any.
  async function checkNews() {
    const { data } = store;
    data.news ??= {};
    const teams = newsTeams(data.devices);
    for (const key of Object.keys(data.news)) if (!teams.has(key)) delete data.news[key];
    let looked = false;
    for (const [key, team] of teams) {
      if ((nextNews.get(key) ?? 0) > now()) continue;
      nextNews.set(key, now() + NEWS_EVERY);
      const league = leagueById(team.league);
      if (!league) continue;
      let articles;
      try {
        articles = parseNews(await getJson(newsUrl(league, team.id, 25)), { teamId: team.id }).articles;
      } catch (err) {
        log(`espn news ${key}: ${err.message}`);
        continue;
      }
      looked = true;
      const { fresh, memo } = newsPlan(data.news[key] ?? null, articles, now());
      data.news[key] = memo;
      for (const article of fresh) {
        const payload = newsPayload(article, league, team.id);
        for (const [token, device] of Object.entries(data.devices)) {
          if (!wantsNews(device, team.league, team.id)) continue;
          const mark = `${token}|news|${article.id}`;
          if (data.sent[mark]) continue;
          data.sent[mark] = now();
          const result = isAndroid(device)
            ? await sendAndroid(token, androidAlertMessage(payload))
            : await push('alert', token, device.env, payload);
          if (result.dead) delete data.devices[token];
        }
      }
    }
    return looked;
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
      let fetched = false;
      for (const id of leagues) {
        if ((nextFetch.get(id) ?? 0) > now()) continue;
        fetched = true;
        const league = leagueById(id);
        const starts = [...Object.values(data.activities), ...Object.values(data.scheduled)]
          .filter((a) => a.league === id && a.start).map((a) => a.start * 1000);
        const games = new Map();
        try {
          // College football: the FBS and the FCS boards.
          for (const day of scoreDays(now(), starts)) {
            for (const url of dayUrls(league, day)) {
              const board = parseScoreboard(await getJson(url), league);
              for (const g of board.games) if (!games.has(g.id)) games.set(g.id, g);
            }
          }
        } catch (err) {
          log(`espn ${id}: ${err.message}`);
          nextFetch.set(id, now() + 30_000);
          continue;
        }
        const mine = [...games.values()].filter((g) => watched(id, g));
        for (const game of mine) await handleGame(league, game);
        // Be there when a scheduled card is due, or a followed team's game
        // for the Lock Screen, not up to a poll later.
        const lockGames = mine.filter((g) => g.state === 'pre' && Object.values(data.devices).some((d) => wantsLock(d, id, g)));
        const due = [
          ...Object.values(data.scheduled).filter((s) => s.league === id && s.start).map((s) => (s.start - SCHEDULE_LEAD) * 1000),
          ...lockGames.map((g) => g.start.getTime() - SCHEDULE_LEAD * 1000),
        ].filter((t) => t > now());
        nextFetch.set(id, Math.min(now() + pollDelay(mine, now()), ...due));
      }
      if (await checkNews()) fetched = true;
      if (fetched) store.save();
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
