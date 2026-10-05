package digital.hark.scores;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.RectF;
import android.graphics.drawable.Icon;
import android.os.Build;
import android.widget.RemoteViews;
import androidx.annotation.RequiresApi;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import java.text.DateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Date;
import java.util.Iterator;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;

// The Lock Screen card on Android, the iPhone's Live Activity in Android's
// terms. On Android 16 and later it's a Live Update (a promoted ongoing
// notification): always in full on the Lock Screen and the always-on display,
// with the score in a status bar chip; Android only promotes its standard
// layouts, so it's each team's score as the title and, in live football, the
// field as the bar, like the iPhone card's. Before 16, an ongoing notification
// with Phade's own scoreboard layout (both logos either side of the score). It's put up
// from a game page (LiveCards.show), or by the push server 15 minutes before
// a scheduled game ("start"); the server keeps it current with "update"
// messages and ends it with "end" (FcmService). The card and state JSON are
// the iPhone's GameAttributes and ContentState: details.js lockScreenCard()
// and server/live.js contentState().
final class LiveCards {

    private LiveCards() {}

    static final String CHANNEL = "live_games";
    private static final long FINAL_STAYS = 2 * 60 * 60 * 1000L;
    private static final int MINT = 0xFF46BB93;
    private static final int AMBER = 0xFFFBBF24;
    // The iPhone card's turf green.
    private static final int TURF = 0xFF1E5C38;

    static void channels(Context c) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        NotificationChannel live = new NotificationChannel(CHANNEL, "Live games", NotificationManager.IMPORTANCE_DEFAULT);
        live.setDescription("Games you put on your Lock Screen, kept up to date.");
        live.setSound(null, null);
        live.enableVibration(false);
        live.setShowBadge(false);
        live.setLockscreenVisibility(NotificationCompat.VISIBILITY_PUBLIC);
        nm.createNotificationChannel(live);
        Alerts.channel(nm);
    }

    // From a game page: put it up now. Blocks for the logos.
    static void show(Context c, JSONObject card) {
        JSONObject state = card.optJSONObject("state");
        if (state == null) state = new JSONObject();
        String key = Store.key(card.optString("league"), card.optString("eventId"));
        Store.removeScheduled(c, key);
        Store.putCard(c, key, card, state);
        post(c, key, card, state, false);
    }

    // From the server: a scheduled card's time has come, or (auto) a followed
    // team's game with "every game on the Lock Screen" on.
    static boolean start(Context c, JSONObject card, JSONObject state, boolean auto) {
        String key = Store.key(card.optString("league"), card.optString("eventId"));
        if (auto && Store.card(c, key) != null) return true; // up from its game page already
        if (!auto && !Store.scheduled(c).has(key)) return false; // turned off since; FcmService tells the server
        Store.removeScheduled(c, key);
        Store.putCard(c, key, card, state);
        post(c, key, card, state, false);
        return true;
    }

    // From the server: the latest state, or the final one.
    static boolean update(Context c, String league, String eventId, JSONObject state, boolean end) {
        String key = Store.key(league, eventId);
        JSONObject entry = Store.card(c, key);
        if (entry == null) return false; // taken off since; FcmService tells the server
        JSONObject card = entry.optJSONObject("card");
        if (end) Store.removeCard(c, key);
        else Store.putCard(c, key, card, state);
        post(c, key, card, state, end);
        return true;
    }

    // Off the Lock Screen (the switch, or swiped away).
    static void remove(Context c, String league, String eventId) {
        String key = Store.key(league, eventId);
        Store.removeCard(c, key);
        Store.removeScheduled(c, key);
        NotificationManagerCompat.from(c).cancel(id(key));
    }

    static JSONArray list(JSONObject byKey) {
        JSONArray list = new JSONArray();
        for (Iterator<String> it = byKey.keys(); it.hasNext(); ) {
            String[] parts = it.next().split(":", 2);
            if (parts.length != 2) continue;
            try {
                list.put(new JSONObject().put("league", parts[0]).put("eventId", parts[1]));
            } catch (Exception ignored) {
                // skip it
            }
        }
        return list;
    }

    static int id(String key) {
        return key.hashCode() & 0x3fffffff;
    }

    private static void post(Context c, String key, JSONObject card, JSONObject state, boolean end) {
        if (!NotificationManagerCompat.from(c).areNotificationsEnabled()) return;
        channels(c);
        Game game = new Game(card, state);
        int px = Math.round(44 * c.getResources().getDisplayMetrics().density);
        Bitmap left = TeamLogos.badge(c, game.left, px);
        Bitmap right = TeamLogos.badge(c, game.right, px);

        int id = id(key);
        Intent openGame = new Intent(c, MainActivity.class)
            .setAction(Intent.ACTION_VIEW)
            .putExtra(MainActivity.EXTRA_ROUTE, "#/game/" + card.optString("league") + "/" + card.optString("eventId"))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        Intent swiped = new Intent(c, CardDismissedReceiver.class)
            .putExtra("league", card.optString("league"))
            .putExtra("eventId", card.optString("eventId"));
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        PendingIntent open = PendingIntent.getActivity(c, id, openGame, flags);
        PendingIntent dismissed = PendingIntent.getBroadcast(c, id, swiped, flags);

        Notification notification = Build.VERSION.SDK_INT >= 36
            ? liveUpdate(c, key, game, left, right, end, open, dismissed)
            : scoreboard(c, key, game, left, right, end, open, dismissed);
        try {
            NotificationManagerCompat.from(c).notify(id, notification);
        } catch (SecurityException ignored) {
            // notifications were turned off meanwhile
        }
    }

    // Android 16 and later: a Live Update, as close to the iPhone card as
    // Android's standard layouts go: each team's score in the title, the
    // clock and the down underneath, the timeouts above them, and in live
    // football the field as the bar (see field). No bar for other games. The
    // chip shows who's ahead ("PHI 20-10"), or counts down to the start.
    @RequiresApi(36)
    private static Notification liveUpdate(Context c, String key, Game game, Bitmap left, Bitmap right, boolean end,
                                           PendingIntent open, PendingIntent dismissed) {
        Notification.Builder n = new Notification.Builder(c, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_scores)
            .setColor(MINT)
            .setContentTitle(game.scoreTitle())
            .setContentText(game.statusLine(c))
            .setSubText(game.timeouts())
            .setCategory(Notification.CATEGORY_STATUS)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setOnlyAlertOnce(true)
            .setOngoing(!end)
            .setGroup("card:" + key)
            .setContentIntent(open)
            .setDeleteIntent(dismissed);
        if (game.showsField()) n.setStyle(field(c, game, left, right));
        if (end) {
            n.setAutoCancel(true).setTimeoutAfter(FINAL_STAYS).setShowWhen(false);
        } else {
            // Ask Android to promote it (Android 16's SDK has no setter yet;
            // this is the extra NotificationCompat's setRequestPromotedOngoing sets).
            android.os.Bundle promote = new android.os.Bundle();
            promote.putBoolean(NotificationCompat.EXTRA_REQUEST_PROMOTED_ONGOING, true);
            n.addExtras(promote);
            if (game.started()) n.setShortCriticalText(game.chip()).setShowWhen(false);
            else n.setWhen(game.start).setShowWhen(true).setUsesChronometer(true).setChronometerCountDown(true);
        }
        return n.build();
    }

    // Live football's field as the Live Update's bar, 120 yards long: each
    // end zone (10) in its team's color next to that team's logo (the left
    // team defends the left goal line, as on the iPhone), the field between
    // in ten 10-yard segments (Android's gaps between segments are the yard
    // lines), the ball where it's spotted and an amber dot on the first-down
    // line. Between plays there's no spot, so no ball.
    @RequiresApi(36)
    private static Notification.ProgressStyle field(Context c, Game game, Bitmap left, Bitmap right) {
        List<Notification.ProgressStyle.Segment> yards = new ArrayList<>();
        yards.add(new Notification.ProgressStyle.Segment(10).setColor(game.color(game.left)));
        yards.add(new Notification.ProgressStyle.Segment(100).setColor(TURF));
        yards.add(new Notification.ProgressStyle.Segment(10).setColor(game.color(game.right)));
        Notification.ProgressStyle style = new Notification.ProgressStyle()
            .setStyledByProgress(false)
            .setProgressSegments(yards)
            .setProgressStartIcon(Icon.createWithBitmap(left))
            .setProgressEndIcon(Icon.createWithBitmap(right));
        if (!Double.isNaN(game.ball)) {
            style.setProgress((int) Math.round(10 + game.ball)).setProgressTrackerIcon(Icon.createWithBitmap(football(c)));
        }
        if (!Double.isNaN(game.firstDown)) {
            List<Notification.ProgressStyle.Point> marks = new ArrayList<>();
            marks.add(new Notification.ProgressStyle.Point((int) Math.round(10 + game.firstDown)).setColor(AMBER));
            style.setProgressPoints(marks);
        }
        return style;
    }

    // The ball for the field: brown, white laces and a white edge so it reads
    // on the turf, tipped like a ball in flight.
    private static Bitmap football(Context c) {
        int px = Math.round(24 * c.getResources().getDisplayMetrics().density);
        Bitmap ball = Bitmap.createBitmap(px, px, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(ball);
        canvas.rotate(-30, px / 2f, px / 2f);
        RectF body = new RectF(px * 0.06f, px * 0.27f, px * 0.94f, px * 0.73f);
        Paint fill = new Paint(Paint.ANTI_ALIAS_FLAG);
        fill.setColor(0xFF8B4A2B);
        canvas.drawOval(body, fill);
        Paint white = new Paint(Paint.ANTI_ALIAS_FLAG);
        white.setColor(Color.WHITE);
        white.setStyle(Paint.Style.STROKE);
        white.setStrokeCap(Paint.Cap.ROUND);
        white.setStrokeWidth(px * 0.06f);
        canvas.drawOval(body, white);
        float mid = px / 2f;
        canvas.drawLine(px * 0.34f, mid, px * 0.66f, mid, white);
        for (float x = 0.40f; x <= 0.61f; x += 0.1f) canvas.drawLine(px * x, mid - px * 0.07f, px * x, mid + px * 0.07f, white);
        return ball;
    }

    // Before Android 16: Phade's scoreboard layout. Android draws its own
    // header (the app's icon and name) over any custom layout; the status
    // goes in the card itself.
    private static Notification scoreboard(Context c, String key, Game game, Bitmap left, Bitmap right, boolean end,
                                           PendingIntent open, PendingIntent dismissed) {
        NotificationCompat.Builder n = new NotificationCompat.Builder(c, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_scores)
            .setColor(MINT)
            .setContentTitle(game.scoreTitle())
            .setContentText(game.statusText(c))
            .setStyle(new NotificationCompat.DecoratedCustomViewStyle())
            .setCustomContentView(views(c, R.layout.notification_card, game, left, right))
            .setCustomBigContentView(views(c, R.layout.notification_card_big, game, left, right))
            .setCategory(NotificationCompat.CATEGORY_STATUS)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .setOngoing(!end)
            // Its own group, so Android never bundles a card with alerts
            // (a bundle hides the scoreboard layout).
            .setGroup("card:" + key)
            .setContentIntent(open)
            .setDeleteIntent(dismissed);
        if (end) n.setAutoCancel(true).setTimeoutAfter(FINAL_STAYS);
        return n.build();
    }

    private static RemoteViews views(Context c, int layout, Game game, Bitmap left, Bitmap right) {
        RemoteViews v = new RemoteViews(c.getPackageName(), layout);
        v.setImageViewBitmap(R.id.left_logo, left);
        v.setImageViewBitmap(R.id.right_logo, right);
        boolean big = layout == R.layout.notification_card_big;
        // Collapsed has room for abbreviations only, as the island does.
        String name = big ? "name" : "abbr";
        v.setTextViewText(R.id.left_name, game.left.optString(name));
        v.setTextViewText(R.id.right_name, game.right.optString(name));
        v.setTextViewText(R.id.score, game.middle(big));
        if (big) {
            v.setTextViewText(R.id.status, game.league + " · " + game.statusText(c));
            v.setTextViewText(R.id.detail, game.detail);
            v.setViewVisibility(R.id.detail, game.detail.isEmpty() ? android.view.View.GONE : android.view.View.VISIBLE);
        } else {
            v.setTextViewText(R.id.status, game.statusText(c));
        }
        return v;
    }

    // The game as the app shows it: away @ home, or home vs away for soccer.
    private static final class Game {
        final String league;
        final JSONObject left;
        final JSONObject right;
        final String leftScore;
        final String rightScore;
        final String state;
        final String status;
        final String detail;
        final boolean homeFirst;
        final long start;
        // Live football (server/live.js contentState): timeouts left (-1 when
        // ESPN gave none), who has the ball, and the ball's spot and the
        // first-down line in yards from the left team's goal line (NaN when
        // there's none).
        final int leftTimeouts;
        final int rightTimeouts;
        final boolean leftHasBall;
        final boolean rightHasBall;
        final double ball;
        final double firstDown;

        Game(JSONObject card, JSONObject s) {
            league = card.optString("leagueLabel", card.optString("league").toUpperCase());
            homeFirst = card.optBoolean("homeFirst");
            JSONObject away = card.optJSONObject("away");
            JSONObject home = card.optJSONObject("home");
            left = homeFirst ? home : away;
            right = homeFirst ? away : home;
            leftScore = s.optString(homeFirst ? "home" : "away");
            rightScore = s.optString(homeFirst ? "away" : "home");
            state = s.optString("state", "pre");
            status = s.optString("status");
            detail = s.optString("detail");
            start = card.optLong("start") * 1000;
            boolean live = "in".equals(state);
            int awayTimeouts = s.optInt("awayTimeouts", -1);
            int homeTimeouts = s.optInt("homeTimeouts", -1);
            leftTimeouts = live ? (homeFirst ? homeTimeouts : awayTimeouts) : -1;
            rightTimeouts = live ? (homeFirst ? awayTimeouts : homeTimeouts) : -1;
            String possession = s.optString("possession");
            leftHasBall = live && possession.equals(homeFirst ? "home" : "away");
            rightHasBall = live && possession.equals(homeFirst ? "away" : "home");
            // ESPN counts the spot from the home team's goal line; the left
            // team defends the left one.
            int spot = s.optInt("yardLine", -1);
            if (live && spot >= 0 && spot <= 100) {
                ball = homeFirst ? spot : 100 - spot;
                int toGo = s.optInt("toGo", 0);
                int heading = leftHasBall ? 1 : rightHasBall ? -1 : 0;
                firstDown = toGo > 0 && heading != 0 ? Math.max(0, Math.min(100, ball + heading * toGo)) : Double.NaN;
            } else {
                ball = Double.NaN;
                firstDown = Double.NaN;
            }
        }

        // The field shows for the whole of a live football game (the timeouts
        // come with every update), so the card keeps its size between plays.
        boolean showsField() {
            return "in".equals(state) && (leftTimeouts >= 0 || !Double.isNaN(ball));
        }

        // "Patriots 14 · Bills 7", with a football by the team that has the
        // ball; "Patriots @ Bills" before the start.
        String scoreTitle() {
            String l = left.optString("name"), r = right.optString("name");
            if (!started()) return l + (homeFirst ? " vs " : " @ ") + r;
            return l + " " + leftScore + (leftHasBall ? " \uD83C\uDFC8" : "") + "  ·  "
                + r + " " + rightScore + (rightHasBall ? " \uD83C\uDFC8" : "");
        }

        // For the status bar chip, which shows about ten characters' width
        // and drops anything wider: the team ahead and the score from its
        // side ("PHI 20-10"), else the bare score (tied, or too wide).
        String chip() {
            String plain = leftScore + "-" + rightScore;
            int l = number(leftScore), r = number(rightScore);
            String abbr = (l > r ? left : right).optString("abbr");
            if (l < 0 || r < 0 || l == r || abbr.isEmpty()) return plain;
            String lead = abbr + " " + Math.max(l, r) + "-" + Math.min(l, r);
            return fitsChip(lead) ? lead : plain;
        }

        // Measured on Android 16: "BOS 99-101" shows, "MORG 21-14" doesn't.
        private static boolean fitsChip(String text) {
            Paint paint = new Paint();
            paint.setTextSize(100);
            return paint.measureText(text) <= paint.measureText("BOS 99-101");
        }

        private static int number(String score) {
            try {
                return Integer.parseInt(score.trim());
            } catch (NumberFormatException e) {
                return -1;
            }
        }

        // "2nd • 8:21 · 1st & 10 at NE 37", "Halftime", "Final"; the start
        // time only before the game.
        String statusLine(Context c) {
            if (!"in".equals(state)) return statusText(c);
            String clock = clock();
            return detail.isEmpty() ? clock : clock + " · " + detail;
        }

        // ESPN's "8:21 - 2nd" the way a scorebug reads it, "2nd • 8:21".
        private String clock() {
            if (status.isEmpty()) return "Live";
            String[] parts = status.split(" - ");
            return parts.length == 2 ? parts[1] + " \u2022 " + parts[0] : status;
        }

        // Live football's timeouts, as the iPhone's dashes: "NE ●●○  BUF ●●●".
        String timeouts() {
            if (leftTimeouts < 0 || rightTimeouts < 0) return null;
            return "Timeouts  " + left.optString("abbr") + " " + dots(leftTimeouts) + "   " + right.optString("abbr") + " " + dots(rightTimeouts);
        }

        private static String dots(int left) {
            StringBuilder out = new StringBuilder();
            for (int i = 0; i < Math.max(3, left); i++) out.append(i < left ? '\u25CF' : '\u25CB');
            return out.toString();
        }

        // The team's color for its end zone, or Phade's gray.
        int color(JSONObject team) {
            String hex = team.optString("color", "");
            return hex.matches("#[0-9a-fA-F]{6}") ? Color.parseColor(hex) : 0xFF374151;
        }

        boolean started() {
            return !"pre".equals(state) && !(leftScore.isEmpty() && rightScore.isEmpty());
        }

        String middle(boolean big) {
            if (!started()) return homeFirst ? "vs" : "@";
            return leftScore + " - " + rightScore;
        }


        // "Live · 7:41 - 2nd", "Final", or the start in the phone's own time.
        String statusText(Context c) {
            if ("in".equals(state)) return status.isEmpty() ? "Live" : "Live · " + status;
            if (!status.isEmpty()) return status;
            if ("post".equals(state)) return "Final";
            // As the scoreboard words it: "Today 7:30 PM", "Tomorrow 1:00 PM",
            // "Sun 1:00 PM" within the week, else the date.
            String time = android.text.format.DateFormat.getTimeFormat(c).format(new Date(start));
            long days = dayNumber(start) - dayNumber(System.currentTimeMillis());
            if (days == 0) return "Today " + time;
            if (days == 1) return "Tomorrow " + time;
            String day = days > 1 && days < 7
                ? new java.text.SimpleDateFormat("EEE", java.util.Locale.getDefault()).format(new Date(start))
                : DateFormat.getDateInstance(DateFormat.SHORT).format(new Date(start));
            return day + " " + time;
        }

        // Days since 1970 in the phone's own time zone.
        private static long dayNumber(long millis) {
            Calendar cal = Calendar.getInstance();
            cal.setTimeInMillis(millis);
            return (millis + cal.get(Calendar.ZONE_OFFSET) + cal.get(Calendar.DST_OFFSET)) / 86_400_000L;
        }
    }
}
