# scores.phade.app (push server)

Keeps the iPhone app's Lock Screen cards (Live Activities) current and sends team alerts. A locked phone can't poll ESPN, so this does it and pushes through Apple (APNs).

- **Runs** on the Phade server (74.208.219.49) as the `scores-push` container in `/opt/scores-push`, its own Docker Compose project on Phade's `phade_default` network. Phade's nginx terminates TLS for `scores.phade.app` and proxies to `scores-push:8080`. Nothing is published on the host.
- **Code**: `index.js` (HTTP API), `watcher.js` (polling and pushing), `live.js` (the decisions, unit-tested in `test/`), `apns.js` (HTTP/2 + ES256 token auth, no dependencies), `store.js` (one JSON file in `/opt/scores-push/data`). Scoreboards are parsed with the app's own `espn.js`.
- **No key, no pushes**: without `secrets/apns.p8` and `.env` it runs as a dry run and logs what it would send. Handy locally: `TZ=America/New_York PORT=8787 node server/index.js`.

## What it does

- **Cards**: the app registers a card's push token with the game (`POST /v1/activities`). The server fetches that league's scoreboard (every 5s while a watched game is live, 15s when one is about to start, 2 minutes before that, 15 minutes when nothing is close) and pushes the score, clock and down/distance whenever they change: priority 10 for score and state changes, 5 for clock-only changes. The final push ends the card and leaves it up for two hours.
- **Scheduled cards**: for a game more than 15 minutes out the app sends the card and its push-to-start token (`POST /v1/scheduled` `{token, env, card}`; cancel with `DELETE /v1/scheduled/:token/:league/:eventId`). 15 minutes before the start (or as soon as the game is on; the watcher fetches the league at that moment rather than at its next regular poll) the server sends Apple a push-to-start with the card's attributes and first state; iOS puts the card up and wakes the app, which registers the card's own token like any other. The start time in the payload's attributes is seconds since 2001, ActivityKit's Date format.
- **Alerts**: the app registers its device token with the followed teams that have alerts on, each with its switches (`PUT /v1/devices/:token`, teams `[{league, id, start, score, end, lock}]`, plus an iPhone's push-to-start `startToken`). `lock`: every game of the team on the Lock Screen; the server starts it when a scheduled card would be due (push-to-start to `startToken` on iPhone, a `start` message with `auto: "1"` on Android), once per device and game, skipping a game already up or scheduled from its page. `start`: the game goes from scheduled to live ("Starting now."). `score`: either side's score goes up ("Bills score: Chiefs 17, Bills 28", "Arsenal goal: ..."); in basketball, the score at each break instead ("Halftime: ..."). `end`: the final score, or ESPN's status for a postponement. Only a change the server saw counts, so a restart or a new follower never gets a stale alert.
- **Android**: the same three, with `platform: "android"` and the phone's FCM registration token instead of APNs tokens (no `env`). An Android phone has one token for all its cards, so its cards are stored as `token|league:eventId` and taken off with `DELETE /v1/activities/:token/:league/:eventId`. Everything goes out as FCM data messages (`server/fcm.js`, HTTP v1 with a service account; values are strings): `update`/`end` `{league, eventId, state, progress, periods}` (high priority for score and state changes, normal for the clock, one collapse key per game; `progress` is how far through the game it is, 0 to 1, for Android 16's Live Update bar), `start` `{card, state}` for a scheduled card (the server then keeps it current under the phone's token), and `alert` `{title, body, route}`. The app's `FcmService` turns them into notifications.
- Dead tokens (Apple says 410 or BadDeviceToken; FCM says UNREGISTERED or the token is invalid) are dropped. Cards are forgotten after 12 hours (iOS ends them after 8).

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
7. Android (Firebase, the Phade project): Firebase console → Project settings → Service accounts → **Generate new private key**. On the box: `/opt/scores-push/secrets/fcm.json` (mode 600), then `npm run push:deploy`. `/health` then says `"android":"live"`; without the file Android pushes are logged as a dry run.

Logs: `docker logs -f scores-push`.
