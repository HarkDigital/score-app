# Scores

Live scores without the ads. A single-page web app that you can add to your phone's home screen. There's no build step, no dependencies and no backend.

Leagues: NFL, NBA, MLB, NHL, NCAAF, NCAAM, WNBA, MLS, Premier League, Champions League. Edit `LEAGUES` in `espn.js` to add or remove leagues.

## Run it

```sh
npm start          # serves the folder at http://localhost:8080
npm test           # unit tests for the data layer (Node 18+)
```

Any static file server works. The app uses ES modules, so opening `index.html` straight from disk won't work.

## Put it on your phone

Host the folder on any static host. GitHub Pages is the simplest: Settings → Pages → deploy from `main`, root folder. Then open the URL on your phone:

- **iPhone (Safari):** Share → Add to Home Screen
- **Android (Chrome):** ⋮ → Add to Home screen / Install app

The app opens full-screen like a native app and remembers the last league you viewed.

## How fresh are the scores?

Scores come from ESPN's public scoreboard feed, which is the same data that powers espn.com's scoreboard. The app polls it on a schedule:

| Situation                                   | Refresh            |
| ------------------------------------------- | ------------------ |
| Any game on screen is live                  | every 15 seconds   |
| A game starts within 30 min (or is late)    | every 30 seconds   |
| Games later today                           | every 5 minutes    |
| Nothing upcoming (past days, all final)     | no auto-refresh    |

Scores are usually within about 15–30 seconds of ESPN's own feed. That's often ahead of a TV or streaming broadcast, which typically runs 30+ seconds behind live. The game clock jumps forward on each refresh rather than ticking every second. Polling pauses when the app is in the background and catches up as soon as you reopen it. The refresh button forces an immediate update.

Start times for upcoming games come from the league schedule and are shown in your local time zone.

**Caveat:** the ESPN feed is unofficial and undocumented. It needs no API key, but ESPN could change it without notice. All of the parsing lives in `espn.js` and is covered by `test/espn.test.js`, so if the feed changes, that's the one file to fix.

## Files

| File                    | What it does                                                      |
| ----------------------- | ----------------------------------------------------------------- |
| `espn.js`               | League list, feed URLs, parsing, grouping, refresh timing (pure)  |
| `app.js`                | Rendering, navigation, polling                                    |
| `index.html`, `styles.css` | Page shell and styles (light and dark mode)                   |
| `manifest.webmanifest`, `icons/` | Home-screen install metadata and icons                   |
| `test/`                 | Unit tests and sample feed responses                              |
