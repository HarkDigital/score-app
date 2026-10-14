# Putting Phade Scores on Google Play

Everything Play Console asks for, in the order its pages ask, ready to paste. Nothing here publishes anything: you press the buttons yourself. The iPhone sheet is `ios/APP_STORE.md`; answers here match it where the two stores ask the same thing.

The graphics are in the project's **play-store-submission** folder: `app-icon-512.png`, `feature-graphic.png`, `phone/` and `tablet/`. `shoot.mjs` there re-renders the screenshots and feature graphic from the app's code (cloud session; ESPN answered from test fixtures, so logos are the team-color badges).

## 1. The developer account

Go to https://play.google.com/console and sign up (USD 25, once) if you don't have an account yet. Google checks your identity, which can take a few days.

- **Organization** (Hark Digital, needs a D-U-N-S number) or **Personal** (just you). Pick Organization if Hark Digital has a D-U-N-S number, as the store then shows "Hark Digital" and skips the testing rule below. Phade's account works too if it's already on Play.
- **The testing rule for new personal accounts**: before the app can go to production, it has to run in a **closed test with at least 12 testers opted in for 14 days in a row**. Plan for it: section 10.

## 2. Create the app

**Home > Create app**:

| Field | Value |
| --- | --- |
| App name | Phade Scores |
| Default language | English (United States) - en-US |
| App or game | App |
| Free or paid | Free (can't be changed to paid later) |
| Declarations | tick both (Developer Program Policies, US export laws) |

The package name, `digital.hark.scores`, comes from the first upload and can never change.

## 3. The build

Play takes an app bundle (`.aab`), not the APK. From current `main` (it loads https://scores.phade.app/, where sign-in works):

```
cd ~/path/to/score-app
git checkout main && git pull
npm run android:aab
git commit -am "Record Android versionCode N" && git push
```

That raises the versionCode, builds `dist/PhadeScores.aab` signed with the release key (`android/keystore.properties`, as for the APK) and needs `android/app/google-services.json` in place, or alerts and Lock Screen cards won't work in the Play build.

**App signing**: the first upload asks how the app is signed. Keep the default, **Use Google-generated key** (Play App Signing). Your release key becomes the **upload key**: keep using it and keep it backed up. One consequence: a phone with the sideloaded APK can't update to the Play version (different signature), so testers uninstall the APK once and install from Play. From then on, send testers Play's testing link instead of the APK.

## 4. Internal testing first

**Test and release > Testing > Internal testing > Create new release**: upload `dist/PhadeScores.aab`, release name `1.0 (N)`, release notes:

> First release: live scores for ten leagues, Lock Screen cards, team alerts and spoiler delay.

Add yourself under **Testers** (an email list), save, and **Start rollout to Internal testing**. Open the opt-in link on your phone, install from Play and check that a game's Lock Screen switch and a team's alerts work (that proves `google-services.json` made it in).

## 5. App content (Policy > App content)

Each item is a short form. Answers:

- **Privacy policy**: https://scores.phade.app/privacy
- **App access**: **All functionality is available without special access** (sign-in is optional).
- **Ads**: **No, my app does not contain ads.**
- **Content rating**: section 6.
- **Target audience and content**: **18 and over** only (the betting lines; it also keeps the app out of the Families program). "Could the app appeal to children?": **No**.
- **News apps**: **No** (it's a scores app; news is one tab of headlines linking to ESPN).
- **Data safety**: section 7.
- **Advertising ID**: **No**. The manifest removes Google's AD_ID permission, so this is true.
- **Government apps**: No. **Financial features**: My app doesn't provide any financial features. **Health apps**: none. **COVID-19**: not a COVID-19 app.
- **Photo and video permissions**, **foreground services**, **full-screen intents**, **exact alarms**: not asked (the app uses none of them).

## 6. Content rating

**Start questionnaire**: email support@phade.app, category **All Other App Types**. Answer **No** to everything (violence, fear, sexuality, language, controlled substances, crude humor, user interaction, sharing location, digital purchases, web browser) except the gambling questions:

- Simulated gambling: **No**. Real-money gambling: **No** (the app takes no bets).
- If it asks whether the app **references or promotes gambling**: **Yes, references only** (DraftKings lines shown for information, no links to sportsbooks). Use whatever Phade answered if it differs and passed.

The rating comes out per region automatically. A gambling reference may raise it (for example PEGI 12 or IARC 12+); that's fine.

## 7. Data safety

Matches the iPhone App Privacy answers and the privacy page.

**Data collection and security**:
- Does your app collect or share any of the required user data types? **Yes**
- Is all of the user data collected by your app encrypted in transit? **Yes**
- Which of the following methods of account creation does your app support? **Username and other authentication** (email address with a one-time code), and **Delete account URL**: https://scores.phade.app/support#delete-account
- Do you provide a way for users to request that some or all of their data is deleted, without requiring them to delete their account? **Yes** (turning a device's alerts off deletes its settings).

**Data types**: tick these four, nothing else. For each: **Collected: Yes, Shared: No** (Clerk and Firebase are service providers acting for us, which Play doesn't count as sharing), **Processed ephemerally: No**, **Required or optional: Optional**.

| Section | Type | Purposes |
| --- | --- | --- |
| Personal info | **Email address** | App functionality, Account management |
| Personal info | **User IDs** | App functionality, Account management |
| App activity | **Other actions** (the followed teams and their alert switches, delay and layout) | App functionality |
| Device or other IDs | **Device or other IDs** (the Firebase push token and each Lock Screen card's) | App functionality |

No location, no contacts, no financial info, no messages, no photos, no app performance or crash data, no advertising. Then **Save** and check the preview reads "No data shared with third parties".

## 8. Store settings (Grow > Store presence > Store settings)

- **App category**: Sports. **Tags**: Sports, Scores, Football (pick up to five that Play offers).
- **Store listing contact details**: email support@phade.app, website https://scores.phade.app/. Phone: leave empty.
- **External marketing**: on.

## 9. Main store listing (Grow > Store presence > Main store listing)

**App name** (30): Phade Scores

**Short description** (80):

> Ad-free live scores, stats and alerts for ten leagues, on your Lock Screen.

**Full description** (4000):

> Phade Scores is live scores without the clutter: no ads, no autoplay video, no account needed. Open it and your games are there.
>
> TEN LEAGUES
> NFL, NBA, MLB, NHL, college football, college basketball, WNBA, MLS, the Premier League and the Champions League.
>
> YOUR TEAMS FIRST
> Follow teams from any league and see all of their games in one place, in the order you choose. Rearrange the leagues across the top, too.
>
> ON YOUR LOCK SCREEN
> Turn on Show on Lock Screen for any game and follow it live without opening the app: the score, the clock, the ball's spot and the down in football. On Android 16 it's a Live Update, in full on the Lock Screen and the always-on display with the score in the status bar. Games later in the day go up on their own 15 minutes before the start.
>
> ALERTS THAT DON'T SPOIL
> Choose alerts for each team: game starts, every score, finals and news, or every game on the Lock Screen. Watching on a stream that runs behind? Set a delay and alerts wait for you.
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
> Sign in with your email to keep your teams, alerts and layout the same on every device, Android and iPhone alike. It's optional: everything works without it.
>
> Scores and stats come from ESPN. Phade Scores isn't affiliated with ESPN or any league or team. Betting lines are shown for information only; the app takes no bets.

**Graphics**:

| Slot | File | Size |
| --- | --- | --- |
| App icon | `app-icon-512.png` | 512 x 512 |
| Feature graphic | `feature-graphic.png` | 1024 x 500 |
| Phone screenshots (2 to 8) | `phone/phone-1-scores.png` to `phone-5-standings.png`, in that order | 1080 x 1920 |
| 7-inch tablet screenshots | `tablet/tablet-1-scores.png` to `tablet-5-standings.png` | 1440 x 2560 |
| 10-inch tablet screenshots | the same tablet set | 1440 x 2560 |

The rendered screenshots show team-color badges where a phone shows real logos. For real logos (and a Lock Screen shot, the best one the iPhone set has), take them on your phone or the `scores16` emulator: `adb exec-out screencap -p > shot.png`. Play takes any 9:16 phone screenshot 1080 px wide or more (no side over twice the other).

**Video**: leave empty.

## 10. Closed testing (new personal accounts only)

Skip this for an organization account, or an account made before November 2023.

1. **Test and release > Testing > Closed testing > Create track** (or use the default **Alpha**), **Countries/regions**: United States (or all).
2. **Testers**: an email list of at least 12 Google accounts (your Android testers, friends, family). A Google Group works too.
3. **Create new release**: promote the internal testing release (**Promote release > Closed testing**), or upload the same `.aab`. Send for review: the first review of a closed test takes a few days.
4. Send testers the **opt-in link** from the Testers tab. Each one opens it, taps **Become a tester**, then installs from Play. They have to stay opted in for **14 days in a row**: ask them to open the app now and then.
5. After 14 days, **Dashboard > Apply for production**. Google asks a few questions about the test (how testers were found, what feedback changed). Answer plainly: testers were friends and existing APK testers, feedback covered the Lock Screen card and alerts. Approval takes about a week.

## 11. Production

**Test and release > Production > Countries/regions**: all, or the United States to start (the leagues are mostly American). Then **Create new release**, promote the tested release, release notes as in section 4, **Next > Save > Send for review** (**Publishing overview** shows what's waiting). Leave **Managed publishing** on if you want to choose the moment it goes live after approval.

## After it's live

- Web changes still ship by merging to `main`; the Play app loads the site like the APK.
- A native change: `npm run android:aab`, upload to a new release, roll out. Play refuses a versionCode it has seen, and the script raises it each time.
- Sideloading still works for quick tests (`npm run android:apk`), but a sideloaded APK and the Play app can't update each other: uninstall one to install the other.

## Risks

- **Intellectual property** (Play's counterpart of Apple's 5.2): ESPN's news photos, headshots and team logos. Scores and stats are facts. If Play flags it, the fix is the same as for Apple: headlines-only news linking out to ESPN, and no headshots. Tell Claude.
- **WebView apps**: Play allows an app that shows its developer's own site; the native parts (Lock Screen card, Live Updates, alerts, haptics, swipes) are what make it more than a bookmark. If review calls it spam or minimal functionality, appeal pointing at those.
- **Gambling**: the app shows lines for information only. Don't link to sportsbooks or Play treats it as a gambling app (which needs a license and approval per country).
