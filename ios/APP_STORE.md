# Submitting Phade Scores to the App Store

Everything App Store Connect asks for, in the order its pages ask, ready to paste. Nothing here submits anything: you press Submit for Review yourself at the end.

## 1. The build

The store build has to be made from current `main`: it loads https://scores.phade.app/ (sign-in only works there) and carries the privacy manifest with sign-in's data types. A build made before October 14, 2026 has the old manifest, so make a new one even if build 21 or 22 is already in TestFlight.

```
cd ~/path/to/score-app
git checkout main && git pull
npm run ios:bump
npm run ios:sync
open ios/App/App.xcodeproj
```

In Xcode: pick **Any iOS Device (arm64)**, **Product > Archive**, then in the Organizer **Distribute App > App Store Connect > Upload**. Commit the bump afterwards (`git commit -am "Record iOS build N" && git push`) so the next bump doesn't reuse the number.

Before uploading, right-click the archive in the Organizer and choose **Generate Privacy Report**. It should list:

- **App**: Device ID (not linked), and Email Address, User ID and Other Data (linked), all for App Functionality, none for tracking. User Defaults with reasons CA92.1 and 1C8F.1.
- **LiveGame**: nothing collected. User Defaults with reason 1C8F.1.
- **Capacitor**: its own manifest. If the report says it has none, tell Claude.

Once the build finishes processing, pick it under the version's **Build** section. Export compliance won't ask anything: `ITSAppUsesNonExemptEncryption` is already NO.

## 2. App Information

| Field | Value |
| --- | --- |
| Name | Phade Scores |
| Subtitle | Live scores, stats and alerts |
| Bundle ID | digital.hark.scores |
| SKU | phade-scores |
| Primary language | English (U.S.) |
| Primary category | Sports |
| Secondary category | (none) |
| Content rights | "Yes, it contains third-party content" (ESPN's scores, stats, news, photos and team logos), then tick that you have the rights to use it. That's your call: see "Risks" at the end. |
| Age rating | see section 6 |

## 3. Pricing and Availability

- Price: **Free** (USD 0).
- Availability: all countries, or only the United States if you'd rather start there (the leagues are mostly American).
- iPad and Mac: leave "Make this app available on Apple silicon Macs" **off** (the app was never tested on a Mac).

## 4. Version 1.0 page

**Promotional text** (170 max, can change any time without review):

> Every game, no ads. Follow your teams across ten leagues, put any game on your Lock Screen, and get alerts for starts, scores and finals with an optional spoiler delay.

**Description** (4000 max):

> Phade Scores is live scores without the clutter: no ads, no autoplay video, no account needed. Open it and your games are there.
>
> TEN LEAGUES
> NFL, NBA, MLB, NHL, college football, college basketball, WNBA, MLS, the Premier League and the Champions League.
>
> YOUR TEAMS FIRST
> Follow teams from any league and see all of their games in one place, in the order you choose. Rearrange the leagues across the top, too.
>
> ON YOUR LOCK SCREEN
> Turn on Show on Lock Screen for any game and follow it live on the Lock Screen and in the Dynamic Island: the score, the clock, the ball's spot and the down in football, runners, count and outs in baseball. Games later in the day go up on their own 15 minutes before the start.
>
> ALERTS THAT DON'T SPOIL
> Choose alerts for each team: game starts, every score, finals and news, or every game on the Lock Screen. Watching on a stream that runs behind? Set a delay and alerts wait for you.
>
> WIDGETS
> A Team widget with your team's next game, live score or final, and a My Teams widget with all of them, on the Home Screen or the Lock Screen.
>
> EVERYTHING ABOUT THE GAME
> Box scores, scoring plays, line scores, team stats, soccer lineups, playoff series and betting lines before kickoff. Arrange a game page's cards the way you like and hide the ones you don't.
>
> TEAMS AND PLAYERS
> Schedules, rosters, season stats with league ranks, and team news. Player pages with key stats, the last five games and career numbers.
>
> STANDINGS AND RANKINGS
> Division, conference and playoff picture views, soccer tables with their zones, and the AP, Coaches and CFP polls.
>
> SEARCH
> Find any team or player from the magnifier at the top.
>
> SYNC, IF YOU WANT
> Sign in with your email to keep your teams, alerts and layout the same on every device. It's optional: everything works without it.
>
> Scores and stats come from ESPN. Phade Scores isn't affiliated with ESPN or any league or team. Betting lines are shown for information only; the app takes no bets.

**Keywords** (100 max, commas, no spaces needed):

> live scores,nfl,nba,mlb,nhl,college football,soccer,premier league,box score,standings,lock screen

**Support URL**: https://scores.phade.app/support

**Marketing URL**: (leave empty)

**Copyright**: 2026 Hark Digital

**Version**: 1.0 (already set in Xcode)

**Screenshots**: section 7.

## 5. App Privacy

Privacy Policy URL: **https://scores.phade.app/privacy**

Click **Get Started** and answer **Yes, we collect data**. Tick these four types, nothing else:

| Category | Type | Used for | Linked to the user? | Tracking? |
| --- | --- | --- | --- | --- |
| Contact Info | **Email Address** | App Functionality | **Yes** | No |
| Identifiers | **User ID** | App Functionality | **Yes** | No |
| Identifiers | **Device ID** | App Functionality | **No** | No |
| Other Data | **Other Data Types** | App Functionality | **Yes** | No |

What each one is, in case Apple asks:

- **Email Address**: only if you sign in (optional). Clerk, the sign-in service, keeps it and sends the codes.
- **User ID**: the account's Clerk id, under which the server keeps a signed-in person's teams.
- **Device ID**: the push tokens (the device's, push-to-start and each Lock Screen card's), sent to scores.phade.app to deliver alerts and keep cards current. The server's device records never name an account, so they're not linked.
- **Other Data Types**: the followed teams, their alert switches, the alert delay, league order and game page layout. Linked because a signed-in account keeps them under its user id.

No contact info beyond email, no location, no usage data, no diagnostics, no purchases, no third-party analytics or ads. This matches the privacy manifest and the privacy page.

## 6. Age Rating

Answer **None** / **No** to everything except:

- **Simulated Gambling: None.** **Gambling (real money): No.** The app takes no bets.
- **Gambling and Contests** / **Gambling references** (the newer questionnaire's wording): mark **Infrequent/Mild** for the betting lines (DraftKings moneylines, spreads and totals shown for information). Use whatever Phade answered after its 2.3.6 rejection if that differs: that answer passed review.
- **Unrestricted Web Access: No.** The web view loads only the app's own site; ESPN stories and the privacy and support pages open in Safari.
- **User-generated content, messaging, advertising, contests, medical, violence: No / None.**

The rating App Store Connect works out from these answers is fine either way; the betting lines may push it up a level.

## 7. Screenshots

Use the set on your Desktop in **Phade Scores screenshots** (checked October 14, 2026: all are the right sizes).

- **iPhone 6.9" Display** (1320 x 2868): upload in this order: `iphone-5-lockscreen.png`, `iphone-1-scores.png`, `iphone-2-game.png`, `iphone-3-team.png`, `iphone-4-player.png`. The 6.5" and smaller sizes are filled in from these automatically.
- **iPad 13" Display** (2064 x 2752): `ipad-1-scores.png`, `ipad-2-game.png`, `ipad-3-team.png`, `ipad-4-player.png`.

The scores, game and Lock Screen shots are current (menu button, LineSteam logo, Detailed cards, the card gear and lock). The team and player shots are from the evening before and are missing only the menu button at the top right. Apple doesn't require pixel-exact screenshots, so they can go as they are; retake them in the Simulator later if you want them to match (`xcrun simctl io booted screenshot ~/Desktop/shot.png`).

## 8. App Review Information

- **Sign-in required: No** (leave "Sign-in required" unticked; there is no demo account, as no feature needs one).
- **Contact**: your name, phone and email (support@phade.app works).
- **Notes**: paste this:

> Phade Scores is a free sports scores app for the NFL, NBA, MLB, NHL, college football and basketball, the WNBA, MLS, the Premier League and the Champions League. No account is needed: everything works at launch.
>
> Sign-in is optional and only keeps a person's followed teams, alert settings and layout the same across their devices. It's in the menu (top right) under Sign in, with a one-time code sent to any email address, so you can try it with your own address; no password or demo account is needed. Once signed in, the same menu shows Account, which has Sign out and Delete account. Delete account removes the account and its data at once (guideline 5.1.1(v)).
>
> Beyond scores, standings, box scores, team pages and player pages, the app is built around these iOS features:
>
> 1. Live Activities: open any game that hasn't finished and turn on the lock switch at the top right of its score card. The card appears on the Lock Screen and in the Dynamic Island and updates by push as the game goes on. A game more than 15 minutes away is scheduled and appears 15 minutes before it starts.
> 2. Notifications: open a team (from the magnifier at the top, the standings or a game page), tap Follow, then the bell, and choose alerts for game starts, scores, finals and news, every game on the Lock Screen, and a delay that holds alerts back for people watching on a delayed stream.
> 3. Widgets: after following a team, add the Team or My Teams widget to the Home Screen or the Lock Screen.
> 4. Haptics, swiping back and forward anywhere on the screen, and pull to refresh.
>
> Scores and stats come from ESPN, credited on the Support page in the app's menu; news stories open on ESPN's site in Safari. Betting lines are shown for information only: the app has no wagering and no links to sportsbooks. The LineSteam logo on NFL, college football, MLB, NBA and NHL game pages opens our own line-movement site.
>
> If no game is live during review, any upcoming game still shows the Lock Screen switch (it schedules the card), and a team's alerts can be set up at any time.

- **Attachment**: none needed.

## 9. Version Release

Pick **Manually release this version**, so it doesn't go live the moment it's approved. Then **Add for Review** and **Submit to App Review**.

## Risks to know before submitting

- **4.2 (minimum functionality / web wrapper)**: the app loads a website. The review notes lead with the native parts (Live Activities, push alerts, widgets, haptics, gestures) for this reason. If it's rejected under 4.2, the answer is to point at those again in Resolution Center.
- **5.2 (intellectual property)**: ESPN's data, news photos and team logos. Phade was approved using logos and ESPN data, but a reviewer can ask for proof of rights. If they do, the real fix is a licensed data provider; reply in Resolution Center and tell Claude.
- **2.3.6 / age rating**: Phade was rejected once over gambling in the age rating. Answer the gambling question the way Phade's accepted submission did.
