# Submitting Phade Scores to the App Store

Everything App Store Connect asks for beyond the build, ready to paste. The build itself: `npm run ios:bump`, `npm run ios:sync`, archive in Xcode, upload (README.md, "iPhone app (TestFlight)").

## Before uploading: check the privacy report

The app and the LiveGame extension each carry a privacy manifest (`App/PrivacyInfo.xcprivacy`, `LiveGame/PrivacyInfo.xcprivacy`). After archiving, in Xcode's Organizer, right-click the archive → **Generate Privacy Report**. It should list:

- **App**: Device ID and Other Data, both for App Functionality, not linked, no tracking; User Defaults with reasons CA92.1 (the app's own settings) and 1C8F.1 (the App Group shared with the widgets).
- **LiveGame**: no data collected; User Defaults with reason 1C8F.1.
- **Capacitor**: its own manifest, if the Capacitor package ships one. If the report says Capacitor has none, tell Claude: the app's manifest may need Capacitor's API reasons too.

## URLs

| Field | Value |
| --- | --- |
| Privacy Policy URL | https://scores.phade.app/privacy |
| Support URL | https://scores.phade.app/support |
| Marketing URL | (optional, leave empty) |

## App Privacy ("Data Types")

Data is collected: yes. Two types, each **App Functionality** only, **not linked to the user's identity**, **not used for tracking**:

- **Identifiers → Device ID**: the push tokens (device, push-to-start and each Lock Screen card's), sent to scores.phade.app to deliver alerts and keep cards current.
- **Other Data → Other Data Types**: the followed teams with alerts on, which alerts, and the alert delay.

Nothing else: no contact info, location, usage data, diagnostics or purchases. No third-party SDKs, analytics or ads. These answers match the privacy manifest.

## Age rating

- Answer **None** or **No** for everything except gambling.
- **Gambling**: the app shows betting lines (DraftKings' moneylines, spreads and totals, from ESPN) for information only. There's no wagering and no sportsbook links. Use the same answer Phade passed with after its 2.3.6 rejection.
- **Unrestricted Web Access**: No. The web view only loads the app's own site; ESPN stories open in Safari, outside the app.
- **User-generated content, messaging, advertising, contests**: No.

## Screenshots

The app runs on iPad, so both sets are required:

- **iPhone 6.9"** (1320 x 2868, e.g. the iPhone 17 Pro Max simulator)
- **iPad 13"** (2064 x 2752, e.g. the iPad Pro 13-inch simulator)

Take them in the simulator with `xcrun simctl io booted screenshot ~/Desktop/shot.png`. A Lock Screen card, a game page, a team page and a player page show the app best. Check the iPad layout while you're there: reviewers often test on iPad.

## Notes for App Review

Paste into App Review Information → Notes:

> Phade Scores is a free sports scores app for the NFL, NBA, MLB, NHL, college football and basketball, the WNBA, MLS, the Premier League and the Champions League. There are no accounts and no sign-in: everything works at launch.
>
> Beyond scores, standings, box scores, team pages and player pages, the app is built around these iOS features:
>
> 1. Live Activities: open any game that hasn't finished and turn on "Show on Lock Screen". The card appears on the Lock Screen and in the Dynamic Island and updates by push as the game goes on. A game more than 15 minutes away is scheduled and appears 15 minutes before it starts.
> 2. Notifications: open a team (from the magnifier at the top, the standings or a game page), tap Follow, then the bell, and choose alerts for game starts, scores, finals and news, every game on the Lock Screen, and a delay that holds alerts back for people watching on a delayed stream.
> 3. Widgets: after following a team, add the Team or My Teams widget to the Home Screen or the Lock Screen.
> 4. Haptics, swiping back and forward anywhere on the screen, and pull to refresh.
>
> Scores and stats come from ESPN, credited at the bottom of the scoreboard; news stories open on ESPN's site in Safari. Betting lines are shown for information only: the app itself has no wagering and no links to sportsbooks. The LineSteam mark on NFL, college football, MLB, NBA and NHL game pages opens our own line-movement site.

If no game is live during review, a game later that day still shows the Lock Screen switch (it schedules the card), and any team's alerts can be set up at any time.
