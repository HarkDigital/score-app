package digital.hark.scores;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.os.Build;
import android.widget.RemoteViews;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import java.text.DateFormat;
import java.util.Calendar;
import java.util.Date;
import java.util.Iterator;
import org.json.JSONArray;
import org.json.JSONObject;

// The Lock Screen card on Android: an ongoing notification with both logos
// and the score, the iPhone's Live Activity in Android's terms. It's put up
// from a game page (LiveCards.show), or by the push server 15 minutes before
// a scheduled game ("start"); the server keeps it current with "update"
// messages and ends it with "end" (FcmService). The card and state JSON are
// the iPhone's GameAttributes and ContentState: details.js lockScreenCard()
// and server/live.js contentState().
final class LiveCards {

    private LiveCards() {}

    static final String CHANNEL = "live_games";
    private static final long FINAL_STAYS = 2 * 60 * 60 * 1000L;

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

    // From the server: a scheduled card's time has come.
    static boolean start(Context c, JSONObject card, JSONObject state) {
        String key = Store.key(card.optString("league"), card.optString("eventId"));
        if (!Store.scheduled(c).has(key)) return false; // turned off since; FcmService tells the server
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

        RemoteViews small = views(c, R.layout.notification_card, game, left, right);
        RemoteViews big = views(c, R.layout.notification_card_big, game, left, right);

        int id = id(key);
        Intent open = new Intent(c, MainActivity.class)
            .setAction(Intent.ACTION_VIEW)
            .putExtra(MainActivity.EXTRA_ROUTE, "#/game/" + card.optString("league") + "/" + card.optString("eventId"))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        Intent dismissed = new Intent(c, CardDismissedReceiver.class)
            .putExtra("league", card.optString("league"))
            .putExtra("eventId", card.optString("eventId"));
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;

        NotificationCompat.Builder n = new NotificationCompat.Builder(c, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_scores)
            .setColor(0xFF46BB93)
            .setContentTitle(game.title())
            .setContentText(game.statusText(c))
            .setSubText(game.league + " · " + game.statusText(c))
            .setStyle(new NotificationCompat.DecoratedCustomViewStyle())
            .setCustomContentView(small)
            .setCustomBigContentView(big)
            .setCategory(NotificationCompat.CATEGORY_STATUS)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .setOngoing(!end)
            // Its own group, so Android never bundles a card with alerts
            // (a bundle hides the scoreboard layout).
            .setGroup("card:" + key)
            .setContentIntent(PendingIntent.getActivity(c, id, open, flags))
            .setDeleteIntent(PendingIntent.getBroadcast(c, id, dismissed, flags));
        if (end) n.setAutoCancel(true).setTimeoutAfter(FINAL_STAYS);
        try {
            NotificationManagerCompat.from(c).notify(id, n.build());
        } catch (SecurityException ignored) {
            // notifications were turned off meanwhile
        }
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
        }

        boolean started() {
            return !"pre".equals(state) && !(leftScore.isEmpty() && rightScore.isEmpty());
        }

        String middle(boolean big) {
            if (!started()) return homeFirst ? "vs" : "@";
            return big ? leftScore + "  -  " + rightScore : leftScore + " - " + rightScore;
        }

        String title() {
            String l = left.optString("name"), r = right.optString("name");
            return started() ? l + " " + leftScore + ", " + r + " " + rightScore : l + (homeFirst ? " vs " : " @ ") + r;
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
