// scores.phade.app: keeps Phade Scores' lock-screen cards current and sends
// team alerts. The iPhone app registers a card's push token or a device's
// followed teams here; watcher.js does the rest. Runs in Docker on the Phade
// server behind its nginx (see server/README.md).
//
//   POST   /v1/activities          {token, env, league, eventId, start}
//   DELETE /v1/activities/:token
//   POST   /v1/scheduled           {token (push-to-start), env, card}
//   DELETE /v1/scheduled/:token/:league/:eventId
//   PUT    /v1/devices/:token      {env, teams: [{league, id}]}  (no teams = forget)
//   DELETE /v1/devices/:token
//   GET    /health

import http from 'node:http';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openStore } from './store.js';
import { createApns } from './apns.js';
import { createWatcher } from './watcher.js';
import { parseActivity, parseDevice, parseScheduled, validToken } from './live.js';

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

const watcher = createWatcher({ store, apns, log });
setInterval(watcher.tick, 5_000);
watcher.tick();

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
    const { pathname } = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && pathname === '/health') {
      return reply(200, {
        ok: true,
        push: apns ? 'live' : 'dry-run',
        activities: Object.keys(data.activities).length,
        scheduled: Object.keys(data.scheduled).length,
        devices: Object.keys(data.devices).length,
      });
    }
    const [, version, kind, rawToken, ...rest] = pathname.split('/');
    if (version !== 'v1' || !(kind in MAX) || rest.length > (kind === 'scheduled' ? 2 : 0)) return reply(404, { error: 'not found' });
    const token = validToken(rawToken) ? rawToken.toLowerCase() : null;

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
      delete data[kind][token];
      store.save();
      return reply(200, { ok: true });
    }

    if (kind === 'activities' && req.method === 'POST' && rawToken === undefined) {
      const card = parseActivity(await readJson(req));
      if (!card) return reply(400, { error: 'bad activity' });
      const existing = data.activities[card.token];
      if (!existing && Object.keys(data.activities).length >= MAX.activities) return reply(503, { error: 'full' });
      data.activities[card.token] = {
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
