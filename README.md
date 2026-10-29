# Scores

Live scores, standings and your teams, without the ads. A single-page web app that you can add to your phone's home screen. There's no build step, no dependencies and no backend.

Leagues: NFL, NBA, MLB, NHL, NCAAF, NCAAM, WNBA, MLS, Premier League, Champions League. Edit `LEAGUES` in `espn.js` to add or remove leagues.

- **Scores** for every league. Football is browsed by week; everything else by day, on a sliding day strip, or a whole week at once (Day / Week, remembered; My Teams too), grouped by day with live games on top. Detailed or Compact cards (the menu's Score Cards row, one setting for every list, synced when signed in): Detailed adds a live game's situation (baseball's runners, count, outs, pitcher and batter; football's field with the ball and the first-down line; the last play wherever ESPN sends one) and soccer's goals and red cards; Compact is just the teams, the score and the time, inning or period, two across on a phone.
- **College football filter**: NCAAF has a **Showing** dropdown with Top 25 (games with a ranked team), All FBS, All FCS and every FBS and FCS conference. A conference shows every game one of its teams plays, conference or not, and the standings follow it (that conference's table, or all of FBS or FCS). The choice is remembered. FCS teams can be followed like any other, and their games show in My Teams, alerts and on the Lock Screen.
- **Search**: the magnifier at the top right searches every league's teams by name, city or abbreviation ("phi", "tigers", "st louis"), and players by name from three letters on ("mahomes", "patrick mah", "mbappe" finds Mbappé), with your teams listed before you type. Players come from ESPN's search a moment after you stop typing, with their team, position and league; only players in the app's leagues are listed (a Real Madrid player isn't, though the club plays the Champions League, as ESPN files players under their domestic league). Tap a result, or Go on the keyboard for the top one, to open the team's or the player's page.
- **My Teams**: follow teams from any league and see all of their games for a day in one place. Followed teams are starred everywhere else too. Follows are kept on the device, or in your account when you're signed in. Games are listed in the order of your teams (within Live, Upcoming and Final, or within each day of a week): **Reorder** (or the menu's **Change League Order**) lets you drag your teams into the order you want.
- **League order**: the menu's **Change League Order** lets you drag the leagues across the top into your own order (with a way back to the standard one). Kept on the device, or in your account when you're signed in.
- **Game page layout**: the gear at the top left of a game's score card lets you drag the cards under it (lines, line score, scoring, box score, lineups, team stats and the playoff series) into your own order and switch off the ones you don't want. It's per sport, so every football game (NFL and college) looks the same, with a way back to the standard layout. Kept on the device, or in your account when you're signed in.
- **Standings** for every league: conferences for the WNBA, conference tables for college, and the table with its qualification and relegation zones for soccer. The NFL, MLB, NBA and NHL have three views: **Division** (the default), **Conference** (MLB: **League**; each conference's teams by record, the NHL's by points) and **Playoff Picture**, by each league's rules: NFL division leaders 1 to 4 and three wild cards with a bye for the 1 seed; MLB division leaders 1 to 3 and three wild cards with byes for seeds 1 and 2; NBA seeds 1 to 6 and the play-in for 7 to 10; NHL the top 3 in each division (A1, M1...) and two wild cards per conference. Then the teams in the hunt; the NFL's clinch marks are explained.
- **Box scores**: tap any game for the line score (innings with R/H/E for baseball), the scoring summary (touchdowns and field goals, goals, or soccer's goals and red cards), each team's player stats (tap a player for their page) and the team stat comparison. Soccer games show each side's lineup instead, once the teams are named (before kickoff too): the formation, the starting XI and the substitutes, each with their goals, assists, cards and the minute they came on or off. On a live game the score and clock update every 5 seconds and the rest of the box score every 30 seconds, or straight away when someone scores. A playoff game shows its series under the score: the round and game ("NLDS - Game 3"), best of how many, each team's wins as dots toward the wins it takes, ESPN's summary ("LAD lead series 2-1") and a link to every game in the series; the scoreboard's cards add the summary too. A live baseball game shows a diamond under the score (runners on base in amber, the count and the outs, who's batting and pitching with their lines for the day). A live NFL or college football game also shows the field under the score: each end zone in its team's colors, the ball where it's spotted, the yards to go lit up to a yellow first-down line, and who has the ball with the down and distance.
- **Team pages**: tap a team in a box score, the standings, the rankings or the My Teams chips for its record, standing, upcoming games and results, and to follow or unfollow it. A team page has **Schedule**, **Roster**, **Stats** and **News** tabs. Game, team and player pages have their own links (`#/game/nfl/<id>`, `#/team/nfl/<id>`, `#/player/nfl/<id>`), so back, swipe-back and sharing work. Going back to a page you've just seen shows it straight away, scrolled where you left it, then refreshes it.
- **Rosters**: a team page's **Roster** tab lists its players with their headshots, numbers, positions, height and weight (and class in college), in ESPN's groups (offense, defense and special teams, injured reserve and the practice squad in football; pitchers, catchers, infielders and outfielders in baseball; centers, wings, defense and goalies in hockey) or by position (guards, forwards and centers; goalkeepers, defenders, midfielders and forwards). Injured players carry their status (Questionable, Out, IR).
- **Player pages**: tap a player in a roster, a box score or a lineup. The page shows their headshot, number, position and team (tap it for the team page), any injury with ESPN's note, this season's four key stats for the position with the player's league rank (passing yards and QBR for a quarterback, ERA and WHIP for a pitcher, save percentage for a goalie), their bio (height, weight, birthday and age, birthplace, college or class, experience, the draft, bats and throws, which way a hockey player shoots), the last five games (tap one to open it) and the career by season, one table per category with the career total. Soccer players show this season by competition instead of a career.
- **Team stats**: a team page's **Stats** tab shows its season: the key numbers for its sport as tiles with the team's league rank (points and yards per game, 3rd down, turnover margin in football; shooting percentages in basketball; AVG, OPS, ERA and WHIP in baseball; goals for and against, power play and penalty kill in hockey; goals, clean sheets and possession in soccer, which ESPN doesn't rank), then every stat ESPN keeps, by category, folded. It's this season's regular season, or last season's (labelled) before this one has games.
- **Lock Screen** (iPhone app): every game page that hasn't finished has a **Show on Lock Screen** switch (a lock and a small switch at the top right of the score card). A game that's on or starts within 15 minutes goes onto the Lock Screen and into the Dynamic Island straight away; a later game is scheduled and appears 15 minutes before the start (iPhones on iOS 17.2 or later; older ones show a game within six hours straight away). The push server (scores.phade.app) checks the score every 5 seconds and keeps the card current. The card is glass (the wallpaper shows through) and reads like a scorebug: each team's logo on a slanted block of its color at either edge, the scores beside them, the period and clock between ("2nd • 8:21"), live baseball shows the diamond with the runners on, the count and the outs under the inning, and live football adds each side's timeouts left as dashes under its score, a ball by the team that has it, and a strip of the field: each team's end zone in its color on its side, the ball where it's spotted and the yards to go lit up to a yellow first-down line. A row of pills underneath carries the down and distance (or outs and runners, else the matchup) and LIVE. Before kickoff it shows the teams' abbreviations and the start time. Several games can be up at once; tap a card to open its game.
- **Widgets** (iPhone app, iOS 17 and later, build 17 on): **Team**, one team you follow, picked when you add the widget: a band in the team's color with its logo, name and record, and under it the next game (opponent, day and time, a countdown), the score while it's on, then the final for the rest of the night (until the next morning, or two hours before the next game). On the Home Screen (small) and in StandBy, and on the Lock Screen as one line above the clock, a rectangle or a circle (text only: iOS tints Lock Screen widgets). Tap it for the team, or for the game while it's on or final. **My Teams** (medium or large): every followed team's game, live first, then today's and last night's finals, then what's coming up; tap a game to open it. Widgets refresh about every 10 minutes during a game (Apple limits how often widgets update; the Lock Screen card stays the live view), just after a start, and every few hours otherwise.
- **Team alerts** (the apps): on a followed team's page, the bell opens switches for that team: **Game starts**, **Scores** (every score; in basketball, the score at the end of each quarter or half), **Final score**, **Lock Screen**, which puts every one of the team's games on the Lock Screen 15 minutes before it starts, without turning it on game by game (iPhones on iOS 17.2 or later, and Android), and **News**: the team's new stories as ESPN posts them (not videos, previews or recaps), the team's name over the headline; a tap opens the team's News tab (iPhone build 15 on, and Android). Tap an alert to open the game. A team game swiped off the Lock Screen stays off. Under the switches, **Delay game alerts** (Off, 15s, 30s, 60s, or any number of seconds up to 5 minutes, for all your teams) holds game starts, scores and finals that long, so a game streamed behind live (YouTube TV and the like run 15 to 60 seconds back) isn't spoiled by your phone; news isn't delayed (iPhone build 17 on, Android versionCode 11 on). The same setting is in the menu as **Delay Score Alerts**: tap it for a list from Off to 5 minutes. The Lock Screen card isn't delayed.
- **Menu**: the button at the top right opens the menu: **Sign in** (or **Account** once signed in), **Change League Order** (the leagues across the top and your teams), the **Privacy policy** and **Support** (which also says where the scores come from: ESPN). The policy pages open in the browser.
- **Sign in** (optional; on scores.phade.app, where the Clerk key works): the menu's **Sign in** signs in with an email code. Nobody needs an account to use the app. Your followed teams (in your order), their alerts, the alert delay, the league order and the game page layouts are then kept in your account, so every phone, tablet or browser you sign in on has the same ones. The first time you sign in on a device, its teams are added to the account's; after that the account wins, and a change on any device shows on the others the next time they open. Signed out, everything works as before and stays on the device; signing out keeps the teams there. **Delete account** removes your teams from the server and deletes the sign-in (if you signed in more than 10 minutes ago, Clerk asks for a new code first), then says the account is deleted. The menu button has a mint dot while you're signed in.
- **Gestures**: pull down from the top of any screen to refresh it. In the iPhone app, swipe right anywhere on the screen to go back and left to go forward: the page follows your finger, and letting go a third of the way across (or flicking) finishes the move. Swipes that start at the very edge are Safari's own, with a preview of the page underneath.
- **Haptics** (iPhone app, build 7 on): every button gives a light tap, tabs and switches between views a selection tick, and pull to refresh a firmer tap the moment letting go would refresh. They follow the phone's System Haptics setting.
- **Betting lines** on upcoming games, from ESPN's sportsbook partner (DraftKings): each side's moneyline, the spread, the total and, for soccer, the draw. Lines disappear at kickoff, since ESPN's feed only carries the pre-game line.
- **Line movement**: on game pages for the NFL, college football, MLB, NBA and NHL, the LineSteam logo (its mark over the LINESTEAM wordmark) sits in the middle of the top bar and opens the game's chart on [LineSteam](https://linesteam.com), which records every FanDuel spread, total and moneyline move. The link goes through `linesteam.com/espn/<league>/<ESPN id>`, which lands on the game, or on LineSteam's league page if it hasn't matched that game yet. Other pages don't show it.
- **News**: every league has a **News** tab next to Scores and Standings with ESPN's latest stories and videos, and every team page has a **News** tab. A team's news is only about that team: stories, videos, previews and recaps that tag it (and at most its opponent), without the league-wide round-ups (power rankings, fantasy, the draft order) that mention every team. My Teams has **Scores** and **News** too: its News is every followed team's own news together, newest first, each story tagged with the team it's about (a story about two of your teams, like their game, shows once with both). Stories open on ESPN (in the apps, in the phone's browser); ESPN+ stories are marked.
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

"Phade Scores" (bundle ID `digital.hark.scores`) is a thin [Capacitor](https://capacitorjs.com) app that opens the live site above, the same way Phade's app works. Changes to the web app reach the iPhone app as soon as they're merged to `main`; you only need a new build when the native shell itself changes (its icon, splash, name, settings or the Swift in `ios/App/App/`). Build 2 added the back and forward edge swipes; build 7 the haptics; build 20 the privacy manifests the App Store needs. The Xcode project is in `ios/` and uses Swift Package Manager, so there's no CocoaPods step.

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

**Before the App Store (not needed for TestFlight):** everything to paste into App Store Connect is in [`ios/APP_STORE.md`](ios/APP_STORE.md): the privacy policy and support URLs (https://scores.phade.app/privacy and /support, served by the push server from `server/site/` and linked from the app's menu; after changing them, `npm run push:deploy`), the App Privacy answers (they match the app's privacy manifests), the age rating, the screenshot sizes and the notes for App Review. In short:
- **External testers:** TestFlight testers outside your team need a quick Beta App Review.
- **Store listing:** screenshots, including 13-inch iPad ones since the app supports iPad.
- **Age rating:** the betting lines will likely mean answering "Gambling: Yes"; Phade was rejected under guideline 2.3.6 until it did, so use Phade's answer.
- **Review risks:** Apple can reject apps that are mostly a website (guideline 4.2; the review notes lead with the Lock Screen cards, alerts and widgets) or that show others' content without permission (5.2: ESPN's data, photos and news, and team logos). Phade was approved with team logos and ESPN data behind the scenes.

## Android app (testers)

"Phade Scores" for Android is the same thin shell as the iPhone app (the Capacitor project in `android/`, app ID `digital.hark.scores`): it opens the live site, so web changes reach it as soon as they're merged, and it reloads itself when the site has been updated. Back (the gesture or the button) steps back through the app's pages and leaves the app from the first one. Buttons give a short haptic buzz.

It has the iPhone app's features too:
- **Lock Screen card**: the game page's **Show on Lock Screen** switch puts the game up as a live notification. On Android 16 and later it's a **Live Update**: always shown in full on the locked screen and the always-on display, with a status bar chip naming the team ahead ("PHI 20-10"; just the score when tied, or when the leader's name would make it too wide for Android to show), each team's score as its title ("Patriots 14 🏈 · Bills 7", the ball by the team that has it), and the clock and down underneath ("2nd • 8:21 · 1st & 10 at NE 37"). Live football adds the timeouts above the title and the field as the bar: each end zone in its team's color by its logo, the ball where it's spotted and a yellow dot on the first-down line. Other games have no bar, and the start time shows only before kickoff. Before Android 16 it's Phade's own scoreboard layout, both logos either side of the score (collapsed it reads like the iPhone's Dynamic Island: "OSU 31 - 14 IOWA" over the clock); Android always adds its own app icon and name above either. Later games appear 15 minutes before the start. The push server keeps it current; tap it to open the game, swipe it away to stop it.
- **Team alerts**: the same switches per followed team (game starts, scores, final score, and every game on the Lock Screen).
- **Swipes**: swipe anywhere to go back or forward, as on iPhone (the screen's edges are Android's own Back gesture).
- **Haptics** on every button.

Android asks for permission to send notifications the first time you turn on a card or an alert. If they're off (Android stops asking after two refusals), the switch says so, with an **Open settings** button that goes straight to Phade Scores' notification settings (APK versionCode 9 on). The status bar icon is Phade's arrow P. The card and alerts come through Google's Firebase (the Phade project): a build needs `android/app/google-services.json` (from the Firebase console, kept out of git), and the push server needs its own Firebase key (see `server/README.md`). Without the config file the app still works, minus those two switches.

**Make a build for testers:**

```
npm run android:apk
```

That raises the build number, builds a signed APK and puts it at `dist/PhadeScores.apk` (not in git). It needs Android Studio's SDK and Java 21 (`brew install openjdk@21`; Android Studio's own Java is too new for this Gradle).

**Get it onto a tester's phone:** send them the APK (for example a Dropbox link to `dist/PhadeScores.apk`). On the phone, open the file, let the browser or Files app "Install unknown apps" when Android asks, and tap Install. Google Play Protect may warn that the developer is unknown: choose "More details", then "Install anyway". For a new version, run `npm run android:apk` again and send the new file; it installs over the old one. Only needed for changes to the Android shell itself; site changes arrive by themselves.

**The signing key:** `android/keystore/phade-scores-release.jks` and `android/keystore.properties` (passwords) are kept out of git. Back them both up (a password manager is good): every update has to be signed with this key, or phones refuse to install it over the old version. The same key is the upload key for Google Play.

**Google Play:** `npm run android:aab` builds the app bundle Play takes (`dist/PhadeScores.aab`, versionCode raised as for the APK). Everything Play Console asks for, from the developer account to production, is in `android/PLAY_STORE.md`. A phone with the sideloaded APK can't update to the Play version (Play signs with its own key): uninstall the APK once, then install from Play.

Other commands: `npm run android:open` opens the project in Android Studio, `npm run android:sync` copies the Capacitor config into it, and `npm run android:icons` re-renders the launcher icons from the iPhone icon's design.

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
| `players.js`                     | Rosters and player pages: URLs and parsing                           |
| `pages.js`                       | The game, team and player pages                                      |
| `ui.js`                          | Shared pieces: icons, fetching, team logos, empty states             |
| `pull.js`                        | Pull to refresh                                                      |
| `native.js`                      | The iPhone app's Lock Screen card and alerts, called from the pages  |
| `account.js`, `signin.js`        | Sign-in (Clerk): the key, merging and syncing teams with the account |
| `index.html`, `styles.css`       | Page shell and styles                                                |
| `manifest.webmanifest`, `icons/` | Home-screen install metadata and icons                               |
| `test/`                          | Unit tests and feed responses trimmed from real ESPN data            |
| `capacitor.config.json`          | App settings (iPhone and Android): app ID, name, the site it loads   |
| `native/www/`                    | Offline page bundled into the apps                                   |
| `android/`                       | The Android Studio project                                           |
| `ios/`                           | The Xcode project: the app, and `LiveGame/` for the Lock Screen card |
| `server/`                        | The push server for Lock Screen cards and alerts (scores.phade.app)  |
| `scripts/bump-build.js`          | `npm run ios:bump`: next build number for the app and its extension  |
| `scripts/android-apk.js`         | `npm run android:apk`: a signed APK for testers in `dist/`           |
| `scripts/android-icons.js`       | `npm run android:icons`: Android launcher icons from the icon design |
| `scripts/capture-players.js`     | `npm run capture:players`: saves real roster and player feeds (Mac)  |

## Turning on sign-in (Clerk)

The Clerk production instance is set up for **scores.phade.app** (Frontend API `clerk.scores.phade.app`, DNS records in Cloudflare), and its publishable key is in `CLERK_PUBLISHABLE_KEY` at the top of `account.js`. A production key only works on its own domain, so the account button shows only on https://scores.phade.app/ (not on harkdigital.github.io, and not in the apps while they load github.io). What's left:

1. **Clerk**: finish domain verification once Cloudflare is live. Switch the dashboard to the **Production** instance first (its settings are separate from Development's), then under **User & authentication**: **Email address** on, with **Sign-in with email verification code** on and **Verify at sign-up** set to **Email verification code** (not email link: a link opens Safari, not the app, so sign-up can't finish in the iPhone app); **Password** off; Google, Apple and other social sign-ins off (Google refuses sign-in inside the apps' web view, and offering Google on iPhone would also require Sign in with Apple). Make sure users can delete their own accounts (App Store rule 5.1.1). Check the result with `curl -s https://clerk.scores.phade.app/v1/environment` (see CLAUDE.md, Sign-in).
2. **Server**: add to `/opt/scores-push/.env` on the Phade box, then `npm run push:deploy` (this also ships `account.js` and `myteams.js`):
   ```
   CLERK_ISSUER=https://clerk.scores.phade.app
   CLERK_AUTHORIZED_PARTIES=https://scores.phade.app
   ```
   Optionally also `CLERK_JWT_KEY` with the **JWT public key** (PEM, under **API keys > Show JWT public key**, newlines written as `\n`) so tokens are checked without asking Clerk for its keys. `curl https://scores.phade.app/health` then shows `"accounts": 0` instead of `"off"`.
3. **The site on scores.phade.app**: PR #45's nginx config on the box.
4. **The apps**: they load `https://scores.phade.app/` (`capacitor.config.json`), so sign-in shows in them from the next iPhone build and APK. Their saved teams and settings live under the old github.io address; the first launch on the new one fetches them from github.io's `move.html` once (a blink of the screen), so nobody loses their teams or alerts.

For testing anywhere else (github.io, localhost), a Clerk **development** instance's `pk_test_` key works on any site, with `CLERK_ISSUER` set to its `*.clerk.accounts.dev` host.
