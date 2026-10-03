# Scores

Ad-free live scores, standings, rankings, box scores and team pages for NFL, NBA, MLB, NHL, NCAAF, NCAAM, WNBA, MLS, Premier League and Champions League. A static single-page app (no build step, no dependencies, no backend) that reads ESPN's public JSON feeds straight from the browser. Owner: Mike (HarkDigital). The goal is an iOS app; see "iOS" below.

## Run, test, deploy

```
npm start   # serves the folder at http://localhost:8080 (npx serve)
npm test    # node --test, unit tests for the data layer (Node 18+)
```

- ES modules, so open it through a server, never `index.html` from disk.
- **Deploy = merge to `main`.** GitHub Pages serves `main` from the repo root (`.nojekyll` keeps Jekyll out) at https://harkdigital.github.io/score-app/. Every push to `main` triggers a "pages build and deployment" run (about a minute). Pages settings can't be changed from a cloud session; Mike flips those himself.
- Work on a branch, open a PR to `main`, merge when done. Mike merges or asks Claude to.

## Files

| File | What it does |
| --- | --- |
| `espn.js` | League list (`LEAGUES`), scoreboard URLs and parsing, grouping, refresh timing, betting lines (`parseOdds`), the `site.web.api` fallback URL |
| `standings.js` | Standings and poll URLs and parsing, the team picker's team list |
| `details.js` | Game summary (box score) and team schedule URLs and parsing |
| `myteams.js` | Followed teams: storage and filtering games to them |
| `app.js` | Scoreboard rendering, day strip, polling, team picker sheet, hash router |
| `pages.js` | Game page (box score) and team page (schedule) |
| `ui.js` | Shared: icons, `getJson` (with host fallback), team logos and fallback badges, empty states, odds row, `esc` |
| `styles.css` | All styles (Phade design language, see below) |
| `test/` | `node --test` suites; `test/fixtures/` are trimmed REAL ESPN responses |

All parsing lives in the data modules (`espn.js`, `standings.js`, `details.js`, `myteams.js`), which are pure and tested. Keep UI files free of feed-shape knowledge.

## ESPN feeds and their quirks (all learned the hard way)

The feeds are unofficial and undocumented. Before changing a parser, check the shape against a real response, not memory.

- **Endpoints**: scoreboard `site.api.espn.com/apis/site/v2/sports/{path}/scoreboard`; standings `.../apis/v2/sports/{path}/standings` (the `/apis/site/v2` standings path returns only a link); polls `.../apis/site/v2/sports/{path}/rankings`; box score `.../summary?event={id}`; team schedule `.../teams/{id}/schedule`.
- **CORS**: scoreboard, standings, rankings, summary and team schedule send `Access-Control-Allow-Origin: *`. The bulk `/teams` list does NOT, so the team picker builds its list from standings (`teamsFromStandings`). Never fetch `/teams` from the browser.
- **Host fallback**: `site.api.espn.com` sometimes answers 403 with no CORS header (looks like a network error). `getJson` retries once on `site.web.api.espn.com`, which serves the same feeds. Don't add custom request headers (ESPN doesn't answer the CORS preflight).
- **College `groups=`**: scoreboard uses `groups=80` (FBS) and `groups=50` (D-I) with a `limit`; standings use `group=80` / `group=50`.
- **Standings**: entries arrive in no useful order; sort by `rank` (soccer), else `playoffSeed` (pro), else the table's sort stat (college: `leagueWinPercent`, the conference win %). College entries repeat every stat once per split under the SAME `name`; split copies have an underscore in `type` (`vsconf_wins`), so only read stats whose `type` has no underscore. Conference record is the record stat with `type: "vsconf"`, overall is `type: "total"`. Soccer zone notes carry `{color: "#81D6AC", description}`. College basketball standings are a ~6 MB download.
- **Team colors** are bare hex without `#` ("e31837", sometimes uppercase); `teamColor()` normalizes and rejects anything else.
- **Lines**: `competitions[0].odds[]` on upcoming games only (gone after kickoff and on finals). Prefer a real book (DraftKings); skip projection models (`numberfire`, `teamrankings`), whose "odds" are win percentages; `consensus` only as a fallback. `spread` is from the home side; `details` is ESPN's wording ("KC -3.5", "EVEN"). A price must read as American odds (|n| >= 100 or EVEN).
- **Summaries** are 0.5 to 1.7 MB: fetch only when a game is opened; live box scores refresh every 30s (the scoreboard does 15s). Football scoring comes from `scoringPlays`, hockey from `plays` with `scoringPlay`, soccer from `keyEvents` (goals and red cards). Baseball and basketball get no scoring list (every pitch or basket is a "scoring play"). Baseball R/H/E come from header competitors' `hits`/`errors`; MLB team stats are grouped objects, so there is no team-stat comparison for baseball. Soccer period scores are garbled past full time (-1s, halves that don't add up), so soccer shows a line score only for a 2-period game.
- **Team schedules** return ONE season type per request and only the current one by default (an empty list between seasons): request `seasontype=2` and `seasontype=3` and merge by event id. Soccer splits results (default) from fixtures (`?fixture=true`): request both. Schedule competitors have `score` as an object (`{value, displayValue}`) and `logos[]` instead of `logo`; `parseGame` handles both shapes.
- **Football** is browsed by week using the scoreboard's `leagues[0].calendar` (entries carry `label`, `detail` like "Sep 9-15", season type label). Other sports by day. My Teams fetches football by date (`byDate`).

## Tests and fixtures

- Fixtures in `test/fixtures/` are trimmed from REAL ESPN responses (mostly sportsdataverse's saved captures). Never invent data inside a fixture file; build synthetic edge cases inline in the test instead.
- Add a test for every feed quirk you handle.

## Verifying in a browser

- Cloud sessions can't reach ESPN (or its logo CDN) through the egress proxy. To see the UI, drive the app with Playwright (preinstalled at `$(npm root -g)/playwright`) and answer ESPN requests from fixtures with `context.route`. Serve the app itself through `route` too (Chromium there sends even localhost through the proxy), and fetch Google Fonts with Node and fulfill them (Chromium doesn't trust the proxy CA; never disable TLS checks).
- Without the CDN, logos render as the team-color fallback badges; real logos load on a device.
- On a Mac, `npm start` and a normal browser just work against live ESPN.

## Design: Phade's language (Mike's other app, HarkDigital/Phade)

- Dark only: background `#0a0a0a`, text `#ededed`, accent mint `#46bb93`, navy `#05203c`, live/loss red `#ef6b6b`. Tailwind grays as CSS variables. Font: Poppins (400 to 800, Google Fonts), `font-variant-numeric: tabular-nums` everywhere.
- Cards: 12px radius, `gray-800/60` border, gradient `gray-900/80` to `gray-950/80`. Pill badges (Final gray, Live red with pulsing dot, Postponed amber), uppercase 11px tracking-wide section labels, Phade's sliding day strip, segmented tabs, the navy-to-mint gradient primary button.
- Team logos: ESPN's image; on a missing or failed image, a circle in the team's color with its abbreviation (Phade's `TeamLogo` rule).
- Respect `prefers-reduced-motion`. Tap targets at least 44px.
- **No em dashes in any user-facing text** (labels, messages, empty states, tooltips). Use a period, comma, colon or parentheses. En dashes and hyphens are fine. Code comments may use them.

## Navigation and state

- Hash routes: `#/game/{leagueId}/{eventId}` and `#/team/{leagueId}/{teamId}`, rendered by `pages.js` over the scoreboard. In-app links push history entries with a `depth`; the header back button goes back within the app, or to the scoreboard when the page was opened from a shared link. The scoreboard pauses polling while a page is open and restores its scroll on return.
- Refresh cadence: live 15s, kickoff within 30 min 30s, later today 5 min, otherwise none; polling stops while the app is hidden.
- `localStorage` keys: `scores.league` (last tab), `scores.myTeams` (followed teams `{league, id, name, abbr, logo, color}`). Wrap every storage access in try/catch.
- Chrome (tabs, mode switch, day strip) re-renders only when its inputs change, so a refresh never steals focus or scroll.

## iOS (the goal; not started)

- Plan: a thin Capacitor shell like Phade's (`server.url` pointing at the Pages site, `contentInset: "never"`, dark `backgroundColor`, StatusBar overlay). The web side is ready: `viewport-fit=cover`, safe-area padding, `black-translucent` status bar, dark overscroll, 16px search input (no iOS focus zoom). Needs Mike's Mac and Xcode, a bundle ID and his Apple Developer account.
- Lock-screen scores = iOS Live Activities: needs the native shell, a Widget Extension (ActivityKit/SwiftUI), a Capacitor plugin bridge, and a small always-on server that polls ESPN and pushes updates through APNs (a locked phone can't poll). Not buildable from a Linux cloud session.
- App Store risks to keep in mind: guideline 4.2 (thin web wrappers) and 5.2 (ESPN's unofficial data and team logos are third-party IP; Phade keeps a logo kill switch). A licensed data provider may be needed for the store version.

## Working with Mike

- Give exact commands for anything he runs himself.
- Keep README.md in step with user-visible features.
