# Scores

Live scores, standings and your teams, without the ads. A single-page web app that you can add to your phone's home screen. There's no build step, no dependencies and no backend.

Leagues: NFL, NBA, MLB, NHL, NCAAF, NCAAM, WNBA, MLS, Premier League, Champions League. Edit `LEAGUES` in `espn.js` to add or remove leagues.

- **Scores** for every league. Football is browsed by week; everything else by day, on a sliding day strip.
- **My Teams**: follow teams from any league and see all of their games for a day in one place. Followed teams are starred everywhere else too. Follows are kept on the device.
- **Standings** for every league: conferences for the NFL, NBA, NHL and WNBA, leagues for MLB, conference tables for college, and the table with its qualification and relegation zones for soccer.
- **Betting lines** on upcoming games, from ESPN's sportsbook partner (DraftKings): each side's moneyline, the spread, the total and, for soccer, the draw. Lines disappear at kickoff, since ESPN's feed only carries the pre-game line.
- **Rankings** for college football and basketball: the AP and Coaches polls, plus the CFP rankings once they're out. Pro leagues have no polls; their standings are the ranking.

The look follows Phade's design language: dark-only, Poppins, the mint `#46bb93` accent on near-black, rounded gradient cards and Phade's day strip. Team logos come from ESPN; when one is missing or fails to load, the team's color with its abbreviation stands in, as in Phade's `TeamLogo`.

## Run it

```sh
npm start          # serves the folder at http://localhost:8080
npm test           # unit tests for the data layer (Node 18+)
```

Any static file server works. The app uses ES modules, so opening `index.html` straight from disk won't work.

## Put it on your phone

It's hosted with GitHub Pages at https://harkdigital.github.io/score-app/ (Settings → Pages → Build and deployment → Source: Deploy from a branch → `main`, `/ (root)`). Any other static host works too. Open the URL on your phone:

- **iPhone (Safari):** Share → Add to Home Screen
- **Android (Chrome):** ⋮ → Add to Home screen / Install app

The app opens full-screen like a native app and remembers the last league you viewed. It already lays out for a native shell: it draws under the status bar with safe-area padding, keeps the WebView background dark, and its text field is 16px so iOS doesn't zoom on focus.

## How fresh are the scores?

Scores come from ESPN's public scoreboard feed, which is the same data that powers espn.com's scoreboard. The app polls it on a schedule:

| Situation                                   | Refresh            |
| ------------------------------------------- | ------------------ |
| Any game on screen is live                  | every 15 seconds   |
| A game starts within 30 min (or is late)    | every 30 seconds   |
| Games later today                           | every 5 minutes    |
| Nothing upcoming (past days, all final)     | no auto-refresh    |

Scores are usually within about 15–30 seconds of ESPN's own feed. That's often ahead of a TV or streaming broadcast, which typically runs 30+ seconds behind live. The game clock jumps forward on each refresh rather than ticking every second. Polling pauses when the app is in the background and catches up as soon as you reopen it. The refresh button forces an immediate update. Standings and rankings load when you open them and refresh with the button.

Start times for upcoming games come from the league schedule and are shown in your local time zone.

**Caveat:** the ESPN feeds are unofficial and undocumented. They need no API key, but ESPN could change them without notice. All of the parsing lives in `espn.js` (scores) and `standings.js` (standings and polls), covered by the tests in `test/`, so if a feed changes, those are the files to fix. A few things the code works around:

- ESPN's teams list sends no CORS header, so browsers can't read it. The team picker builds its list from the standings feed instead (FBS teams for college football, Division I for basketball).
- ESPN sometimes lists projection models (numberfire) beside the sportsbook; their "odds" are win percentages, so they're skipped, and ESPN's consensus line is used only when no book is listed.
- Standings entries arrive in no useful order, so they're sorted by playoff seed (pro leagues), table position (soccer) or conference record (college).
- College standings repeat each stat once per split (home, road, conference) under the same name; only the totals are read.
- `site.api.espn.com` occasionally refuses requests; the app retries on `site.web.api.espn.com`, which serves the same feeds.
- College basketball standings are a large download (every Division I conference at once), so that tab is slower than the rest.

## Files

| File                             | What it does                                                         |
| -------------------------------- | -------------------------------------------------------------------- |
| `espn.js`                        | League list, scoreboard URLs and parsing, lines, refresh timing      |
| `standings.js`                   | Standings and poll URLs and parsing, the picker's team list          |
| `myteams.js`                     | Followed teams: storage and filtering games to them                  |
| `app.js`                         | Rendering, navigation, polling, the team picker                      |
| `index.html`, `styles.css`       | Page shell and styles                                                |
| `manifest.webmanifest`, `icons/` | Home-screen install metadata and icons                               |
| `test/`                          | Unit tests and feed responses trimmed from real ESPN data            |
