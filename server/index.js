// scores.phade.app: keeps Phade Scores' lock-screen cards current and sends
// team alerts. The iPhone app registers a card's push token or a device's
// followed teams here, the Android app its FCM token (platform: 'android');
// watcher.js does the rest. Runs in Docker on the Phade server behind its
// nginx (see server/README.md).
//
//   POST   /v1/activities          {platform, token, env, league, eventId, start}
//   DELETE /v1/activities/:token                    (an iPhone card)
//   DELETE /v1/activities/:token/:league/:eventId   (an Android card)
//   POST   /v1/scheduled           {platform, token (push-to-start or FCM), env, card}
//   DELETE /v1/scheduled/:token/:league/:eventId
//   PUT    /v1/devices/:token      {platform, env, teams: [{league, id}]}  (no teams = forget)
//   DELETE /v1/devices/:token
//   GET    /v1/widget?teams=nhl:4,nfl:21     (the iPhone widgets: each team's live, last and next game)
//   GET    /health

import http from 'node:http';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openStore } from './store.js';
import { createApns } from './apns.js';
import { createFcm, readAccount } from './fcm.js';
import { createWatcher, fetchJson } from './watcher.js';
import { createWidgetSource, parseWidgetTeams } from './widget.js';
import { parseActivity, parseDevice, parseScheduled, normalizeToken, activityKey } from './live.js';

const env = process.env;
const log = (msg) => console.log(`${new Date().toISOString()} ${msg}`);

const store = await openStore(env.DATA_DIR ?? fileURLToPath(new URL('./data', import.meta.url)));

const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };

let apns = null;
if (env.APNS_KEY_PATH && isFile(env.APNS_KEY_PATH) && env.APNS_KEY_ID && env.APNS_TEAM_ID) {
  apns = createApns({
    keyPem: fs.readFileSync(env.APNS_KEY_PATH, 'utf8'),
    keyId: env.APNS_KEY_ID,
    teamId: env.APNS_TEAM_ID,
    bundleId: env.APNS_BUNDLE_ID ?? 'digital.hark.scores',
    log,
  });
  log(`pushing as key ${env.APNS_KEY_ID}`);
} else {
  log('no APNs key configured: dry run, pushes are logged instead of sent');
}

// Android: the Firebase service account for the Phade project.
let fcm = null;
const account = env.FCM_ACCOUNT_PATH && isFile(env.FCM_ACCOUNT_PATH) ? readAccount(fs.readFileSync(env.FCM_ACCOUNT_PATH, 'utf8')) : null;
if (account) {
  fcm = createFcm({ account, log });
  log(`android pushes through Firebase project ${account.project_id}`);
} else {
  log('no Firebase service account: Android pushes are a dry run');
}

const watcher = createWatcher({ store, apns, fcm, log });
// Every second, so a league due every 5s is fetched on time; a tick with
// nothing due does nothing.
setInterval(watcher.tick, 1_000);
watcher.tick();

const widgets = createWidgetSource({ fetchJson, log });

const MAX = { activities: 5_000, scheduled: 20_000, devices: 50_000 };

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 16_384) reject(new Error('too large'));
    });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); } catch (err) { reject(err); }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const reply = (status, body) => {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  };
  const { data } = store;
  try {
    const { pathname, searchParams } = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && pathname === '/health') {
      return reply(200, {
        ok: true,
        push: apns ? 'live' : 'dry-run',
        android: fcm ? 'live' : 'dry-run',
        activities: Object.keys(data.activities).length,
        scheduled: Object.keys(data.scheduled).length,
        devices: Object.keys(data.devices).length,
      });
    }
    if (req.method === 'GET' && pathname === '/v1/widget') {
      const teams = parseWidgetTeams(searchParams.get('teams'));
      if (!teams.length) return reply(400, { error: 'no teams' });
      return reply(200, await widgets.teams(teams));
    }
    const [, version, kind, rawToken, ...rest] = pathname.split('/');
    if (version !== 'v1' || !(kind in MAX) || rest.length > (kind === 'devices' ? 0 : 2)) return reply(404, { error: 'not found' });
    // An FCM token's colon may arrive percent-encoded.
    let token = null;
    try { token = rawToken === undefined ? null : normalizeToken(decodeURIComponent(rawToken)); } catch { /* bad escape */ }

    if (kind === 'scheduled') {
      if (req.method === 'DELETE' && token && rest.length === 2) {
        delete data.scheduled[`${token}|${rest[0]}:${rest[1]}`];
        store.save();
        return reply(200, { ok: true });
      }
      if (req.method === 'POST' && rawToken === undefined) {
        const entry = parseScheduled(await readJson(req));
        if (!entry) return reply(400, { error: 'bad card' });
        const id = `${entry.token}|${entry.league}:${entry.eventId}`;
        if (!data.scheduled[id] && Object.keys(data.scheduled).length >= MAX.scheduled) return reply(503, { error: 'full' });
        data.scheduled[id] = { ...entry, createdAt: Date.now() };
        watcher.poke(entry.league);
        store.save();
        return reply(200, { ok: true });
      }
      return reply(405, { error: 'method not allowed' });
    }

    if (req.method === 'DELETE' && token) {
      // An Android card is one game of the phone's token.
      delete data[kind][rest.length === 2 ? `${token}|${rest[0]}:${rest[1]}` : token];
      store.save();
      return reply(200, { ok: true });
    }

    if (kind === 'activities' && req.method === 'POST' && rawToken === undefined) {
      const card = parseActivity(await readJson(req));
      if (!card) return reply(400, { error: 'bad activity' });
      const key = activityKey(card);
      const existing = data.activities[key];
      if (!existing && Object.keys(data.activities).length >= MAX.activities) return reply(503, { error: 'full' });
      data.activities[key] = {
        platform: card.platform,
        token: card.token,
        env: card.env,
        league: card.league,
        eventId: card.eventId,
        start: card.start,
        createdAt: existing?.createdAt ?? Date.now(),
        last: existing?.eventId === card.eventId ? existing.last : null,
      };
      watcher.poke(card.league);
      store.save();
      return reply(200, { ok: true });
    }

    if (kind === 'devices' && req.method === 'PUT' && token) {
      const device = parseDevice(await readJson(req));
      if (!device) return reply(400, { error: 'bad device' });
      if (!device.teams.length) delete data.devices[token];
      else {
        if (!data.devices[token] && Object.keys(data.devices).length >= MAX.devices) return reply(503, { error: 'full' });
        data.devices[token] = { ...device, updatedAt: Date.now() };
        for (const league of new Set(device.teams.map((t) => t.league))) watcher.poke(league);
      }
      store.save();
      return reply(200, { ok: true });
    }

    return reply(405, { error: 'method not allowed' });
  } catch {
    return reply(400, { error: 'bad request' });
  }
});

const port = Number(env.PORT ?? 8080);
server.listen(port, () => log(`listening on ${port}`));

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, async () => {
    server.close();
    await store.flush();
    process.exit(0);
  });
}
