# Scores

Live scores, standings and your teams, without the ads. A single-page web app that you can add to your phone's home screen. There's no build step, no dependencies and no backend.

Leagues: NFL, NBA, MLB, NHL, NCAAF, NCAAM, WNBA, MLS, Premier League, Champions League. Edit `LEAGUES` in `espn.js` to add or remove leagues.

- **Scores** for every league. Football is browsed by week; everything else by day, on a sliding day strip.
- **College football filter**: NCAAF has a **Showing** dropdown with Top 25 (games with a ranked team), All FBS, All FCS and every FBS and FCS conference. A conference shows every game one of its teams plays, conference or not, and the standings follow it (that conference's table, or all of FBS or FCS). The choice is remembered. FCS teams can be followed like any other, and their games show in My Teams, alerts and on the Lock Screen.
- **My Teams**: follow teams from any league and see all of their games for a day in one place. Followed teams are starred everywhere else too. Follows are kept on the device.
- **Standings** for every league: conferences for the NFL, NBA, NHL and WNBA, leagues for MLB, conference tables for college, and the table with its qualification and relegation zones for soccer.
- **Box scores**: tap any game for the line score (innings with R/H/E for baseball), the scoring summary (touchdowns and field goals, goals, or soccer's goals and red cards), each team's player stats and the team stat comparison. On a live game the score and clock update every 5 seconds and the rest of the box score every 30 seconds, or straight away when someone scores.
- **Team pages**: tap a team in a box score, the standings, the rankings or the My Teams chips for its record, standing, upcoming games and results, and to follow or unfollow it. Game and team pages have their own links (`#/game/nfl/<id>`, `#/team/nfl/<id>`), so back, swipe-back and sharing work. Going back to a page you've just seen shows it straight away, scrolled where you left it, then refreshes it.
- **Lock Screen** (iPhone app): every game page that hasn't finished has a **Show on Lock Screen** switch. A game that's on or starts within six hours goes onto the Lock Screen and into the Dynamic Island straight away; a later game is scheduled and appears 30 minutes before the start (iPhones on iOS 17.2 or later). The push server (scores.phade.app) checks the score every 5 seconds and keeps the card current. The card is glass (the wallpaper shows through) and shows both teams' logos. Several games can be up at once; tap a card to open its game.
- **Team alerts** (iPhone app): on a followed team's page, the bell opens three switches for that team: **Game starts**, **Scores** (every score; in basketball, the score at the end of each quarter or half) and **Final score**. Tap an alert to open the game.
- **Gestures**: pull down from the top of any screen to refresh it. In the iPhone app, swipe right anywhere on the screen to go back and left to go forward: the page follows your finger, and letting go a third of the way across (or flicking) finishes the move. Swipes that start at the very edge are Safari's own, with a preview of the page underneath.
- **Betting lines** on upcoming games, from ESPN's sportsbook partner (DraftKings): each side's moneyline, the spread, the total and, for soccer, the draw. Lines disappear at kickoff, since ESPN's feed only carries the pre-game line.
- **Line movement**: on game pages for the NFL, college football, MLB, NBA and NHL, the LineSteam mark in the top-right corner of the score card opens the game's chart on [LineSteam](https://linesteam.com), which records every FanDuel spread, total and moneyline move. The link goes through `linesteam.com/espn/<league>/<ESPN id>`, which lands on the game, or on LineSteam's league page if it hasn't matched that game yet.
- **Rankings** for college football and basketball: the AP and Coaches polls, plus the CFP rankings once they're out, and the FCS Coaches Poll for college football. Pro leagues have no polls; their standings are the ranking.

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

The app opens full-screen like a native app and remembers the last league you viewed.

## iPhone app (TestFlight)

"Phade Scores" (bundle ID `digital.hark.scores`) is a thin [Capacitor](https://capacitorjs.com) app that opens the live site above, the same way Phade's app works. Changes to the web app reach the iPhone app as soon as they're merged to `main`; you only need a new build when the native shell itself changes (its icon, splash, name, settings or the Swift in `ios/App/App/`). Build 2 added the back and forward edge swipes. The Xcode project is in `ios/` and uses Swift Package Manager, so there's no CocoaPods step.

**First build** (on your Mac, with Xcode installed), from the `score-app` folder:

```
git pull
npm install
npm run ios:sync
npm run ios:open
```

`ios:sync` copies the settings and the offline page into the Xcode project; run it after every `git pull` that touches `capacitor.config.json` or `native/`. `ios:open` opens Xcode, which then downloads Capacitor (watch for "Resolving packages" to finish).

1. In Xcode, select the **App** project, then the **App** target, then **Signing & Capabilities**. Check that "Automatically manage signing" is on and **Team** is the same team as Phade. Xcode registers the bundle ID `digital.hark.scores` on its own.
2. Optional check: pick an iPhone simulator (or your plugged-in iPhone) at the top and press **Run** (⌘R).
3. In [App Store Connect](https://appstoreconnect.apple.com), go to **Apps**, then **+**, then **New App**:
   - **Platform:** iOS.
   - **Name:** must be unique on the App Store, e.g. "Phade Scores". The home-screen name is set separately in the project.
   - **Primary language:** English (U.S.).
   - **Bundle ID:** `digital.hark.scores`.
   - **SKU:** `phade-scores-ios`.
   - **User access:** Full Access.
4. Back in Xcode, choose **Any iOS Device (arm64)** at the top, then **Product**, then **Archive**. When the Organizer window opens, choose **Distribute App**, then **App Store Connect**, then **Upload**, keeping the defaults.
5. In App Store Connect, open the app's **TestFlight** tab. The build shows up after processing (usually 5 to 15 minutes). Export compliance is already answered in the app's settings. Under **Internal Testing**, create a group, add yourself, and install **Phade Scores** from the TestFlight app on your iPhone. Internal testers (people on your App Store Connect team) don't need App Review.

**Later builds:** raise the build number before each upload, then repeat step 4. The app and its Lock Screen extension (the **LiveGame** target) must carry the same number, so use the script rather than Xcode's General tab:

```
npm run ios:bump
```

The app needs iOS 16 or later. The Lock Screen card and alerts need the push server running (see `server/README.md`); without it the card shows the score from when it was added and alerts don't arrive.

**Before the App Store (not needed for TestFlight):**
- **External testers:** TestFlight testers outside your team need a quick Beta App Review.
- **Store listing:** the App Store version needs screenshots, including 13-inch iPad ones since the app supports iPad, plus a privacy policy URL and the App Privacy answers.
- **Age rating:** the betting lines will likely mean answering "Gambling: Yes" in the age rating; Phade was rejected under guideline 2.3.6 until it did.
- **Review risks:** Apple can reject apps that are mostly a website (guideline 4.2) or that use others' data and logos without permission (5.2: ESPN's feed and team logos).

## How fresh are the scores?

Scores come from ESPN's public scoreboard feed, which is the same data that powers espn.com's scoreboard. The app polls it on a schedule:

| Situation                                   | Refresh            |
| ------------------------------------------- | ------------------ |
| Any game on screen is live                  | every 5 seconds    |
| A game starts within 30 min (or is late)    | every 30 seconds   |
| Games later today                           | every 5 minutes    |
| Nothing upcoming (past days, all final)     | no auto-refresh    |

Scores are usually within about 5–10 seconds of ESPN's own feed (ESPN caches its scoreboard for just a second). That's often ahead of a TV or streaming broadcast, which typically runs 30+ seconds behind live. The game clock jumps forward on each refresh rather than ticking every second. Polling pauses when the app is in the background and catches up as soon as you reopen it. The app also checks then whether the site has been updated, and reloads itself if so, so new features arrive without force-quitting it. The refresh button, or pulling down from the top, forces an immediate update. Standings and rankings load when you open them and refresh with the button.

Start times for upcoming games come from the league schedule and are shown in your local time zone.

**Caveat:** the ESPN feeds are unofficial and undocumented. They need no API key, but ESPN could change them without notice. All of the parsing lives in `espn.js` (scores) and `standings.js` (standings and polls), covered by the tests in `test/`, so if a feed changes, those are the files to fix. A few things the code works around:

- ESPN's teams list sends no CORS header, so browsers can't read it. The team picker builds its list from the standings feed instead (FBS teams for college football, Division I for basketball).
- ESPN sometimes lists projection models (numberfire) beside the sportsbook; their "odds" are win percentages, so they're skipped, and ESPN's consensus line is used only when no book is listed.
- Standings entries arrive in no useful order, so they're sorted by playoff seed (pro leagues), table position (soccer) or conference record (college).
- College standings repeat each stat once per split (home, road, conference) under the same name; only the totals are read.
- `site.api.espn.com` occasionally refuses requests; the app retries on `site.web.api.espn.com`, which serves the same feeds.
- Team schedules come one season type per request, and only the current one by default (an empty list between seasons), so the app asks for the regular season and the postseason and merges them. Soccer instead splits results from fixtures still to play, so it asks for both.
- A game summary can be over a megabyte, so it's only fetched when a game is opened.
- College basketball standings are a large download (every Division I conference at once), so that tab is slower than the rest.

## Files

| File                             | What it does                                                         |
| -------------------------------- | -------------------------------------------------------------------- |
| `espn.js`                        | League list, scoreboard URLs and parsing, lines, refresh timing      |
| `standings.js`                   | Standings and poll URLs and parsing, the picker's team list          |
| `details.js`                     | Box score (game summary) and team schedule URLs and parsing          |
| `myteams.js`                     | Followed teams: storage and filtering games to them                  |
| `app.js`                         | Scoreboard rendering, navigation, polling, the team picker, routing  |
| `pages.js`                       | The game (box score) and team (schedule) pages                       |
| `ui.js`                          | Shared pieces: icons, fetching, team logos, empty states             |
| `pull.js`                        | Pull to refresh                                                      |
| `native.js`                      | The iPhone app's Lock Screen card and alerts, called from the pages  |
| `index.html`, `styles.css`       | Page shell and styles                                                |
| `manifest.webmanifest`, `icons/` | Home-screen install metadata and icons                               |
| `test/`                          | Unit tests and feed responses trimmed from real ESPN data            |
| `capacitor.config.json`          | iPhone app settings: app ID, name, the site it loads                 |
| `native/www/`                    | Offline page bundled into the iPhone app                             |
| `ios/`                           | The Xcode project: the app, and `LiveGame/` for the Lock Screen card |
| `server/`                        | The push server for Lock Screen cards and alerts (scores.phade.app)  |
| `scripts/bump-build.js`          | `npm run ios:bump`: next build number for the app and its extension  |
