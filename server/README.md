# scores.phade.app (push server)

Keeps the iPhone app's Lock Screen cards (Live Activities) current and sends team alerts. A locked phone can't poll ESPN, so this does it and pushes through Apple (APNs).

- **Runs** on the Phade server (74.208.219.49) as the `scores-push` container in `/opt/scores-push`, its own Docker Compose project on Phade's `phade_default` network. Phade's nginx terminates TLS for `scores.phade.app` and proxies to `scores-push:8080`. Nothing is published on the host.
- **Code**: `index.js` (HTTP API), `watcher.js` (polling and pushing), `live.js` (the decisions, unit-tested in `test/`), `apns.js` (HTTP/2 + ES256 token auth, no dependencies), `store.js` (one JSON file in `/opt/scores-push/data`). Scoreboards are parsed with the app's own `espn.js`.
- **No key, no pushes**: without `secrets/apns.p8` and `.env` it runs as a dry run and logs what it would send. Handy locally: `TZ=America/New_York PORT=8787 node server/index.js`.

## What it does

- **Cards**: the app registers a card's push token with the game (`POST /v1/activities`). The server fetches that league's scoreboard (every 15s while a watched game is live or about to start, 2 minutes before that, 15 minutes when nothing is close) and pushes the score, clock and down/distance whenever they change: priority 10 for score and state changes, 5 for clock-only changes. The final push ends the card and leaves it up for two hours.
- **Alerts**: the app registers its device token with the followed teams that have alerts on (`PUT /v1/devices/:token`). When the server sees one of their games go from scheduled to live it sends "Starting now."; live to final sends the final score; a postponement sends ESPN's status. Only a change the server saw counts, so a restart or a new follower never gets a stale "starting now".
- Dead tokens (Apple says 410 or BadDeviceToken) are dropped. Cards are forgotten after 12 hours (iOS ends them after 8).

## Deploying changes

```bash
npm run push:deploy
```

Runs the tests, copies `espn.js` and `server/` to the box and restarts the container (a second or two), then checks `/health`.

## One-time setup (needs the APNs key and the DNS record)

1. DNS: an A record `scores.phade.app` → `74.208.219.49`.
2. Apple push key: developer.apple.com → Certificates, Identifiers & Profiles → Keys → **+** → name it, tick **Apple Push Notifications service (APNs)** (Sandbox & Production, Team Scoped) → download the `.p8` (only once) and note the Key ID. On the box: `/opt/scores-push/secrets/apns.p8` (mode 600) and `/opt/scores-push/.env` with `APNS_KEY_ID=…` and `APNS_TEAM_ID=72U2ZL3GVM`.
3. `npm run push:deploy` (starts the container).
4. Certificate: `certbot certonly --webroot -w /var/www/certbot -d scores.phade.app`. phade.conf's port-80 server is nginx's default and already serves `/.well-known/acme-challenge/` from that folder for any host.
5. nginx: copy `server/scores.phade.app.conf` to `/var/www/phade/nginx/conf.d/`, then `docker exec phade-nginx nginx -t && docker exec phade-nginx nginx -s reload`. The upstream is resolved per request, so phade.app keeps working even if `scores-push` is down.
6. Check: `curl https://scores.phade.app/health` says `"push":"live"`.

Logs: `docker logs -f scores-push`.
