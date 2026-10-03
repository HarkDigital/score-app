package digital.hark.scores;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

// Team alerts on Android: game starts, scores and finals for followed teams,
// sent by the push server as "alert" data messages (FcmService), shown as
// notifications that open the game.
final class Alerts {

    private Alerts() {}

    static final String CHANNEL = "team_alerts";

    static void channel(NotificationManager nm) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationChannel alerts = new NotificationChannel(CHANNEL, "Team alerts", NotificationManager.IMPORTANCE_HIGH);
        alerts.setDescription("When your teams' games start, when they score, and final scores.");
        alerts.setLockscreenVisibility(NotificationCompat.VISIBILITY_PUBLIC);
        nm.createNotificationChannel(alerts);
    }

    // The permission as the iPhone app words it, which the web page reads:
    // "authorized", "notDetermined" (not asked yet) or "denied".
    static String status(Context c) {
        if (NotificationManagerCompat.from(c).areNotificationsEnabled()) {
            if (Build.VERSION.SDK_INT < 33) return "authorized";
            boolean granted = ContextCompat.checkSelfPermission(c, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
            if (granted) return "authorized";
        }
        if (Build.VERSION.SDK_INT >= 33 && !Store.askedForNotifications(c)) return "notDetermined";
        return "denied";
    }

    static void show(Context c, String title, String body, String route) {
        if (!NotificationManagerCompat.from(c).areNotificationsEnabled()) return;
        LiveCards.channels(c);
        int id = (int) (System.currentTimeMillis() & 0x3fffffff) | 0x40000000;
        Intent open = new Intent(c, MainActivity.class)
            .setAction(Intent.ACTION_VIEW)
            .putExtra(MainActivity.EXTRA_ROUTE, route)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        NotificationCompat.Builder n = new NotificationCompat.Builder(c, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_scores)
            .setColor(0xFF46BB93)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_EVENT)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setAutoCancel(true)
            .setContentIntent(PendingIntent.getActivity(c, id, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
        try {
            NotificationManagerCompat.from(c).notify(id, n.build());
        } catch (SecurityException ignored) {
            // notifications were turned off meanwhile
        }
    }
}
