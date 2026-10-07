// What the push server decides, kept pure so it can be tested: the lock-screen
// card's content for a game, whether a change is worth a push, the alerts a
// game's change of state sends, and request validation. index.js and
// watcher.js do the I/O.

import { leagueById, cardSituation } from '../espn.js';

// Statuses that mean the game won't go ahead as scheduled (ui.js's TROUBLE).
export const TROUBLE = /POSTPONED|CANCELED|CANCELLED|SUSPENDED|DELAYED|FORFEIT|ABANDONED/;

// parseGame lists away then home (soccer: home then away).
export function sides(game, league) {
  const [first, second] = game.teams;
  return league.homeFirst ? { home: first, away: second } : { away: first, home: second };
}

// The card's ContentState (GameAttributes.ContentState in the iPhone app; the
// keys must match). A normal pre-game status is left empty: the card shows the
// start time in the phone's own time zone instead.
export function contentState(game, league) {
  const { away, home } = sides(game, league);
  const scheduled = game.state === 'pre' && game.statusName === 'STATUS_SCHEDULED';
  return {
    away: away?.score ?? '',
    home: home?.score ?? '',
    state: game.state,
    status: scheduled ? '' : game.statusText,
    detail: game.detail ?? '',
    ...cardSituation(away, home, game.ball, game.diamond),
  };
}

// null when nothing changed. Score and state changes go out at priority 10;
// a clock or down-and-distance change only at 5, which Apple doesn't budget.
export function activityPlan(last, next) {
  const end = next.state === 'post';
  if (!last) return { priority: 10, end };
  const same = (k) => last[k] === next[k];
  if (['away', 'home', 'state', 'status', 'detail', 'awayTimeouts', 'homeTimeouts', 'possession', 'yardLine', 'toGo', 'bases', 'outs', 'balls', 'strikes'].every(same)) return null;
  const big = !same('away') || !same('home') || !same('state');
  return { priority: big ? 10 : 5, end };
}

const HOUR = 3600;

export function activityPayload(state, plan, nowSec) {
  const aps = {
    timestamp: nowSec,
    event: plan.end ? 'end' : 'update',
    'content-state': state,
  };
  if (plan.end) aps['dismissal-date'] = nowSec + 2 * HOUR;
  // Greyed out if the server goes quiet mid-game.
  else if (state.state === 'in') aps['stale-date'] = nowSec + 15 * 60;
  return { aps };
}

// What the server remembers of a game between polls, to see what changed.
export function gameMemo(game, league, now) {
  const { away, home } = sides(game, league);
  return { state: game.state, statusName: game.statusName, away: away?.score ?? '', home: home?.score ?? '', at: now };
}

// Basketball scores every few seconds, so its "score" alert is the score at
// each break (end of a quarter or half) instead of every basket.
const BREAKS = new Set(['STATUS_END_PERIOD', 'STATUS_HALFTIME']);
const isBasketball = (league) => league.path.startsWith('basketball/');

// The alerts a game's change sends, from what the server saw last time (null
// the first time: first sight is never a change, so a restart or a new
// follower never gets a late "starting now"). Each is { kind, payload }, and
// kind is the follower's switch it answers to: start, score or end.
export function gameAlerts(prev, game, league) {
  if (!prev) return [];
  const alerts = [];
  const say = (kind, body) => alerts.push({ kind, payload: alertPayload(game, league, body) });
  const { away, home } = sides(game, league);
  // Soccer reads home first, everything else away first.
  const [a, b] = league.homeFirst ? [home, away] : [away, home];
  const line = `${a.name} ${a.score}, ${b.name} ${b.score}`;

  if (game.state === 'in' && prev.state === 'pre') say('start', 'Starting now.');
  if (game.state === 'post' && prev.state !== 'post') {
    if (TROUBLE.test(game.statusName)) say('end', game.statusText || 'Postponed.');
    else say('end', `${game.statusText || 'Final'}: ${line}`);
  }
  if (game.state === 'in' && prev.state === 'in') {
    if (isBasketball(league)) {
      if (BREAKS.has(game.statusName) && prev.statusName !== game.statusName) say('score', `${game.statusText}: ${line}`);
    } else {
      const up = (side, was) => Number(side?.score) > Number(was);
      const awayUp = up(away, prev.away);
      const homeUp = up(home, prev.home);
      if (awayUp !== homeUp) {
        const scorer = awayUp ? away : home;
        const goal = league.path.startsWith('soccer/') || league.path.startsWith('hockey/');
        say('score', `${scorer.name} ${goal ? 'goal' : 'score'}: ${line}`);
      } else if (awayUp && homeUp) {
        say('score', `Score update: ${line}`);
      }
    }
  }
  return alerts;
}

function alertPayload(game, league, body) {
  const { away, home } = sides(game, league);
  const title = league.homeFirst ? `${home.name} vs ${away.name}` : `${away.name} @ ${home.name}`;
  return {
    aps: { alert: { title, body }, sound: 'default', 'thread-id': `${league.id}-${game.id}` },
    route: `#/game/${league.id}/${game.id}`,
  };
}

// Whether a device follows a team in this game with this alert switched on.
// Teams stored before the switches existed mean starts and finals.
export function wantsAlert(device, leagueId, game, kind) {
  const ids = new Set(game.teams.map((t) => String(t.id)));
  const on = (t) => (['start', 'score', 'end'].some((k) => k in t) ? t[kind] === true : kind !== 'score');
  return device.teams.some((t) => t.league === leagueId && ids.has(t.id) && on(t));
}

// Whether a device wants this game on the Lock Screen: a followed team in it
// has "every game on the Lock Screen" on.
export function wantsLock(device, leagueId, game) {
  const ids = new Set(game.teams.map((t) => String(t.id)));
  return device.teams.some((t) => t.league === leagueId && ids.has(t.id) && t.lock === true);
}

// A Lock Screen card made from the scoreboard, for a game the server puts up
// by itself (a followed team's): what details.js lockScreenCard() makes in
// the app, without the state.
export function cardFromGame(game, league) {
  const { away, home } = sides(game, league);
  const team = (t) => ({
    abbr: t.abbr || t.name,
    name: t.name,
    color: HEX.test(t.color ?? '') ? t.color : null,
    logo: LOGO.test(t.logo ?? '') ? t.logo : null,
  });
  return {
    league: league.id,
    leagueLabel: league.label,
    eventId: game.id,
    start: Math.round(game.start.getTime() / 1000),
    homeFirst: Boolean(league.homeFirst),
    away: team(away),
    home: team(home),
  };
}

// Whether a device follows a team in this game at all (for polling).
export function followsGame(device, leagueId, game) {
  const ids = new Set(game.teams.map((t) => String(t.id)));
  return device.teams.some((t) => t.league === leagueId && ids.has(t.id));
}

// ---- Scheduled cards ----

// A card for a later game is started by the server with Apple's
// push-to-start, this long before the game (the web app's
// LOCK_LEAD_MINUTES; iOS ends a card after 8 hours anyway).
export const SCHEDULE_LEAD = 15 * 60;

// ActivityKit decodes a Date from JSON as seconds since 2001-01-01.
const APPLE_EPOCH = 978_307_200;

export function startDue(game, nowSec) {
  if (game.state === 'in') return true;
  if (game.state !== 'pre' || game.statusName !== 'STATUS_SCHEDULED') return false;
  return game.start.getTime() / 1000 - nowSec <= SCHEDULE_LEAD;
}

// The push-to-start payload: the card's attributes (GameAttributes; the
// start comes from the scoreboard, in case the time moved) and its first
// state, with a quiet banner saying it's there.
export function startPayload(card, game, league, nowSec) {
  const { away, home } = card;
  const title = card.homeFirst ? `${home.name} vs ${away.name}` : `${away.name} @ ${home.name}`;
  const aps = {
    timestamp: nowSec,
    event: 'start',
    'content-state': contentState(game, league),
    'attributes-type': 'GameAttributes',
    attributes: { ...card, start: Math.round(game.start.getTime() / 1000) - APPLE_EPOCH },
    alert: { title, body: game.state === 'in' ? 'Live now on your Lock Screen.' : 'Starting soon. The score is on your Lock Screen.' },
  };
  if (game.state === 'in') aps['stale-date'] = nowSec + 15 * 60;
  return { aps };
}

// ---- Android (Firebase Cloud Messaging) ----

// The Android app gets the same cards and alerts as data messages, which its
// FirebaseMessagingService turns into notifications. Entries from the Android
// app carry platform: 'android'; everything else is the iPhone app.
export const isAndroid = (entry) => entry?.platform === 'android';

// How far through a game is (0 to 1), from ESPN's status text, for the
// Android Live Update's progress bar; null when the text doesn't say.
// Periods and their length in minutes, by sport: football and basketball
// quarters (college basketball halves), hockey periods, baseball innings,
// soccer halves. Overtime and extra innings read as nearly done.
export function gamePeriods(league) {
  const [sport, name] = league.path.split('/');
  if (sport === 'football') return { periods: 4, minutes: 15 };
  if (name === 'mens-college-basketball') return { periods: 2, minutes: 20 };
  if (sport === 'basketball') return { periods: 4, minutes: name === 'wnba' ? 10 : 12 };
  if (sport === 'hockey') return { periods: 3, minutes: 20 };
  if (sport === 'baseball') return { periods: 9, minutes: null };
  return { periods: 2, minutes: 45 };
}

export function gameProgress(game, league) {
  if (game.state === 'pre') return 0;
  if (game.state === 'post') return 1;
  const text = String(game.statusText ?? '');
  const { periods, minutes } = gamePeriods(league);
  const nearlyDone = 0.99;
  const ordinal = text.match(/(\d+)(?:st|nd|rd|th)/i);
  const period = ordinal ? Number(ordinal[1]) : null;
  if (league.path.startsWith('soccer/')) {
    if (/^HT$|half\s*time/i.test(text)) return 0.5;
    const minute = text.match(/(\d+)'/);
    return minute ? Math.min(nearlyDone, Number(minute[1]) / 90) : null;
  }
  if (/halftime/i.test(text)) return 0.5;
  if (league.path.startsWith('baseball/')) {
    if (!period) return null;
    const done = /^end/i.test(text) ? period : /^(mid|bot)/i.test(text) ? period - 0.5 : period - 1;
    return Math.min(nearlyDone, done / periods);
  }
  if (!period) return /\bOT\b|\bSO\b/.test(text) ? nearlyDone : null;
  if (period > periods) return nearlyDone;
  if (/^end/i.test(text)) return Math.min(nearlyDone, period / periods);
  const clock = text.match(/(\d{1,2}):(\d{2})/);
  const left = clock ? (Number(clock[1]) * 60 + Number(clock[2])) / (minutes * 60) : 1;
  return Math.min(nearlyDone, Math.max(0, (period - 1 + (1 - Math.min(1, left))) / periods));
}

// A card's update, or its final state. Score and state changes go at high
// priority; a clock or down-and-distance change at normal, which Android may
// hold while the phone dozes (as Apple does with priority 5).
// progress: gameProgress (or null), and the game's periods, for the bar.
export function androidCardMessage(entry, state, plan, progress = null, periods = null) {
  return {
    data: {
      type: plan.end ? 'end' : 'update',
      league: entry.league,
      eventId: entry.eventId,
      state: JSON.stringify(state),
      ...(progress === null ? {} : { progress: String(Math.round(progress * 1000) / 1000) }),
      ...(periods ? { periods: String(periods) } : {}),
    },
    priority: plan.priority === 10 ? 'HIGH' : 'NORMAL',
    collapseKey: `${entry.league}:${entry.eventId}`,
    ttl: plan.end ? '7200s' : '600s',
  };
}

// A scheduled card going up: the whole card (start in seconds since 1970;
// from the scoreboard, in case the time moved) and its first state.
// auto: put up for a followed team ("every game on the Lock Screen") rather
// than scheduled from the game page; the phone takes it unless it's up already.
export function androidStartMessage(card, game, league, { auto = false } = {}) {
  return {
    data: {
      type: 'start',
      ...(auto ? { auto: '1' } : {}),
      league: card.league,
      eventId: card.eventId,
      card: JSON.stringify({ ...card, start: Math.round(game.start.getTime() / 1000) }),
      state: JSON.stringify(contentState(game, league)),
      progress: String(Math.round((gameProgress(game, league) ?? 0) * 1000) / 1000),
      periods: String(gamePeriods(league).periods),
    },
    priority: 'HIGH',
    collapseKey: `${card.league}:${card.eventId}`,
    ttl: '1800s',
  };
}

// A team alert, from the same payload the iPhone gets.
export function androidAlertMessage(payload) {
  const { title, body } = payload.aps.alert;
  return {
    data: { type: 'alert', title, body, route: payload.route, thread: payload.aps['thread-id'] ?? '' },
    priority: 'HIGH',
    ttl: '3600s',
  };
}

// ---- Requests ----

// iPhone tokens are hex, so their case doesn't matter; FCM registration
// tokens are an id, a colon and a long base64url-ish string, case-sensitive.
const APNS_TOKEN = /^[0-9a-f]{32,512}$/i;
const FCM_TOKEN = /^[\w-]{8,300}:[\w-]{20,600}$/;
const EVENT = /^\d{1,14}$/;
const TEAM = /^[\w-]{1,20}$/;
const ENVS = new Set(['production', 'sandbox']);

export const validToken = (token) => typeof token === 'string' && (APNS_TOKEN.test(token) || FCM_TOKEN.test(token));

// The token as stored: hex lowercased, FCM as is, anything else null.
export function normalizeToken(token) {
  if (typeof token !== 'string') return null;
  if (APNS_TOKEN.test(token)) return token.toLowerCase();
  return FCM_TOKEN.test(token) ? token : null;
}

// Which app sent a request, and whether its token and environment fit it.
// Android has no APNs environment; its entries say 'production'.
function platformOf(body) {
  const platform = body?.platform === 'android' ? 'android' : 'ios';
  const token = typeof body?.token === 'string' ? body.token : null;
  if (platform === 'android') {
    return token && FCM_TOKEN.test(token) ? { platform, token, env: 'production' } : null;
  }
  return token && APNS_TOKEN.test(token) && ENVS.has(body?.env) ? { platform, token: token.toLowerCase(), env: body.env } : null;
}

// The key an entry is stored under: an iPhone card has a token of its own;
// an Android phone has one token for all its cards, so the game is added.
export const activityKey = (entry) => (isAndroid(entry) ? `${entry.token}|${entry.league}:${entry.eventId}` : entry.token);

export function parseActivity(body) {
  const who = platformOf(body);
  const { league, eventId, start } = body ?? {};
  if (!who || !leagueById(league) || !EVENT.test(String(eventId ?? ''))) return null;
  const startSec = Number(start);
  return {
    ...who,
    league,
    eventId: String(eventId),
    start: Number.isFinite(startSec) && startSec > 0 ? startSec : null,
  };
}

const HEX = /^#[0-9a-f]{6}$/i;
const text = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max;

// ESPN's logo CDN only; anything else is dropped (the card shows the badge).
const LOGO = /^https:\/\/a\.espncdn\.com\/[\w./-]{1,240}$/;

function parseCardTeam(t) {
  if (!t || !text(t.abbr, 12) || !text(t.name, 60) || (t.color != null && !HEX.test(t.color))) return null;
  return { abbr: t.abbr, name: t.name, color: t.color ?? null, logo: LOGO.test(t.logo ?? '') ? t.logo : null };
}

// POST /v1/scheduled: {token (push-to-start, or the Android phone's FCM
// token with platform: 'android'), env, card (details.js lockScreenCard)}.
export function parseScheduled(body) {
  const who = platformOf(body);
  const { card } = body ?? {};
  if (!who || !card || typeof card !== 'object') return null;
  const league = leagueById(card.league);
  const start = Number(card.start);
  const away = parseCardTeam(card.away);
  const home = parseCardTeam(card.home);
  if (!league || !EVENT.test(String(card.eventId ?? '')) || !Number.isFinite(start) || start <= 0
    || !text(card.leagueLabel, 40) || !away || !home) return null;
  const eventId = String(card.eventId);
  return {
    ...who,
    league: league.id,
    eventId,
    start,
    card: { league: league.id, leagueLabel: card.leagueLabel, eventId, start, homeFirst: card.homeFirst === true, away, home },
  };
}

// PUT /v1/devices/:token: {platform, env, teams, startToken}. The token is
// in the path. startToken: an iPhone's push-to-start token (iOS 17.2+), for
// followed teams' games on the Lock Screen.
export function parseDevice(body) {
  const android = body?.platform === 'android';
  const env = android ? 'production' : body?.env;
  const { teams } = body ?? {};
  if (!ENVS.has(env) || !Array.isArray(teams) || teams.length > 200) return null;
  const list = [];
  for (const t of teams) {
    if (!leagueById(t?.league) || !TEAM.test(String(t?.id ?? ''))) return null;
    // A team without switches comes from an early build: starts and finals.
    const legacy = !['start', 'score', 'end', 'lock', 'news'].some((k) => k in t);
    list.push({
      league: t.league,
      id: String(t.id),
      start: legacy || t.start === true,
      score: !legacy && t.score === true,
      end: legacy || t.end === true,
      lock: t.lock === true,
      news: t.news === true,
    });
  }
  const startToken = !android && typeof body.startToken === 'string' && APNS_TOKEN.test(body.startToken) ? body.startToken.toLowerCase() : null;
  return {
    platform: android ? 'android' : 'ios',
    env,
    teams: list.filter((t) => t.start || t.score || t.end || t.lock || t.news),
    ...(startToken ? { startToken } : {}),
  };
}

// ---- Team news alerts ----

// A follower's "news" switch: ESPN's new stories about the team (news.js
// parseNews with its teamId), each sent once. Videos, recaps and previews
// stay out: the game alerts cover games. The first look at a team only notes
// what's there, so turning the switch on never sends a backlog, and a story
// more than a day old is never news.
export const NEWS_EVERY = 10 * 60_000;
const NEWS_KEEP = 200;
const NEWS_FRESH = 24 * 3600_000;
const NEWS_PER_LOOK = 2;

export const wantsNews = (device, leagueId, teamId) => device?.teams?.some((t) => t.league === leagueId && t.id === teamId && t.news === true);

// Every team someone wants news for, as "league:id" → {league, id}.
export function newsTeams(devices) {
  const teams = new Map();
  for (const device of Object.values(devices ?? {})) {
    for (const t of device.teams ?? []) if (t.news) teams.set(`${t.league}:${t.id}`, { league: t.league, id: t.id });
  }
  return teams;
}

// memo: what the server has seen of this team's news ({seen: [ids]}), or
// null the first time. Returns the stories to send and the new memo.
export function newsPlan(memo, articles, nowMs) {
  const stories = articles.filter((a) => !a.kind);
  if (!memo) return { fresh: [], memo: { seen: stories.map((a) => a.id).slice(0, NEWS_KEEP) } };
  const seen = new Set(memo.seen);
  const fresh = stories
    .filter((a) => !seen.has(a.id) && a.published && nowMs - a.published.getTime() < NEWS_FRESH)
    .slice(0, NEWS_PER_LOOK);
  const ids = [...new Set([...stories.map((a) => a.id), ...memo.seen])].slice(0, NEWS_KEEP);
  return { fresh, memo: { seen: ids } };
}

// The alert for a story: the team's name over the headline. A tap opens the
// team page's News tab.
export function newsPayload(article, league, teamId) {
  return {
    aps: {
      alert: { title: article.teamName || `${league.label} news`, body: article.headline },
      sound: 'default',
      'thread-id': `news-${league.id}-${teamId}`,
    },
    route: `#/team/${league.id}/${teamId}/news`,
  };
}
