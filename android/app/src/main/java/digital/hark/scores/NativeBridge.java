package digital.hark.scores;

import android.app.Activity;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.view.HapticFeedbackConstants;
import android.webkit.WebView;
import androidx.annotation.NonNull;
import androidx.core.app.NotificationManagerCompat;
import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebMessageCompat;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import com.getcapacitor.Plugin;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.Collections;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.json.JSONArray;
import org.json.JSONObject;

// The web app's line to the Lock Screen card, team alerts and haptics: the
// Android side of native.js, as NativeBridge.swift is the iPhone's. The page
// gets window.phadeScoresAndroid (a WebView web message listener, only on
// the app's own site, main frame only), posts JSON {id, action, ...} and
// gets {id, result} back. Registered as a native-only Capacitor plugin
// because a plugin loads before the page does, so the object is there from
// the first page on. No Capacitor JS involved.
@CapacitorPlugin(name = "PhadeScoresBridge")
public class NativeBridge extends Plugin implements WebViewCompat.WebMessageListener {

    @Override
    public void load() {
        WebView webView = getBridge().getWebView();
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return;
        Uri site = Uri.parse(getBridge().getConfig().getServerUrl());
        String origin = site.getScheme() + "://" + site.getAuthority();
        WebViewCompat.addWebMessageListener(webView, "phadeScoresAndroid", Collections.singleton(origin), this);
    }

    @Override
    public void onPostMessage(@NonNull WebView view, @NonNull WebMessageCompat message, @NonNull Uri sourceOrigin,
                              boolean isMainFrame, @NonNull JavaScriptReplyProxy reply) {
        if (!isMainFrame || message.getData() == null) return;
        JSONObject request;
        try {
            request = new JSONObject(message.getData());
        } catch (Exception e) {
            return;
        }
        int id = request.optInt("id");
        String action = request.optString("action");
        // Haptics now, on the main thread, not queued behind the server.
        if ("haptic".equals(action)) {
            view.performHapticFeedback(haptic(request.optString("style")));
            answer(view, reply, id, ok(true));
            return;
        }
        Context c = getContext().getApplicationContext();
        Push.WORK.execute(() -> {
            Object result;
            try {
                result = handle(c, action, request);
            } catch (Exception e) {
                result = ok(false);
            }
            answer(view, reply, id, result);
        });
    }

    private Object handle(Context c, String action, JSONObject request) throws Exception {
        switch (action) {
            case "info": {
                boolean ready = Push.ready(c);
                return new JSONObject()
                    .put("platform", "android")
                    .put("liveActivities", ready)
                    .put("canSchedule", ready)
                    .put("teamLockScreen", ready)
                    // News alerts: the teams go to the server as they are.
                    .put("teamNews", ready)
                    // openSettings, and showGame/scheduleGame's reason.
                    .put("openSettings", true)
                    // setAlertTeams passes the spoiler delay on (versionCode 11 on).
                    .put("alertDelay", ready)
                    .put("active", LiveCards.list(Store.cards(c)))
                    .put("scheduled", LiveCards.list(Store.scheduled(c)))
                    .put("alerts", ready ? Alerts.status(c) : "unavailable");
            }
            case "showGame": {
                JSONObject card = request.getJSONObject("card");
                if (!notificationsOn(c)) return notificationsOff();
                LiveCards.show(c, card);
                String token = Push.token(c);
                if (token != null) Push.registerCard(c, token, card);
                return ok(true);
            }
            case "scheduleGame": {
                JSONObject card = request.getJSONObject("card");
                if (!notificationsOn(c)) return notificationsOff();
                String token = Push.token(c);
                if (token == null || !Push.schedule(c, token, card)) return ok(false);
                Store.putScheduled(c, Store.key(card.getString("league"), card.getString("eventId")), card);
                return ok(true);
            }
            case "removeGame": {
                String league = request.getString("league");
                String eventId = request.getString("eventId");
                LiveCards.remove(c, league, eventId);
                String token = Push.token(c);
                if (token != null) Push.forget(c, token, league, eventId);
                return ok(true);
            }
            case "enableAlerts":
                if (!Push.ready(c)) return "unavailable";
                askForNotifications();
                return Alerts.status(c);
            case "openSettings":
                openNotificationSettings(c);
                return ok(true);
            case "setAlertTeams": {
                JSONArray teams = request.optJSONArray("teams");
                if (teams == null) teams = new JSONArray();
                Store.setTeams(c, teams);
                // The spoiler delay in seconds: the push server holds the
                // game alerts that long (0 is off).
                Store.setAlertDelay(c, Math.max(0, request.optInt("delay", 0)));
                String token = Push.token(c);
                if (token != null) Push.setTeams(c, token, teams);
                return ok(true);
            }
            default:
                return new JSONObject().put("ok", false).put("error", "unknown action");
        }
    }

    // Asks for the notification permission if Android would still show the
    // prompt, then says whether notifications are on, the Live games
    // category included (a card in a category that's off never shows).
    private boolean notificationsOn(Context c) {
        askForNotifications();
        if (!NotificationManagerCompat.from(c).areNotificationsEnabled()) return false;
        if (Build.VERSION.SDK_INT < 26) return true;
        NotificationChannel live = c.getSystemService(NotificationManager.class).getNotificationChannel(LiveCards.CHANNEL);
        return live == null || live.getImportance() != NotificationManager.IMPORTANCE_NONE;
    }

    // Once Android has been told no twice (or the prompt was dismissed), it
    // won't ask again: Settings is the only way back, so the page offers it.
    private void openNotificationSettings(Context c) {
        Intent intent = Build.VERSION.SDK_INT >= 26
            ? new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, c.getPackageName())
            : new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", c.getPackageName(), null));
        Activity activity = getActivity();
        if (activity == null) return;
        activity.runOnUiThread(() -> {
            try {
                activity.startActivity(intent);
            } catch (Exception e) {
                // No settings screen to open.
            }
        });
    }

    private void askForNotifications() {
        if (Build.VERSION.SDK_INT < 33 || !(getActivity() instanceof MainActivity)) return;
        CountDownLatch done = new CountDownLatch(1);
        ((MainActivity) getActivity()).requestNotifications(done::countDown);
        try {
            done.await(120, TimeUnit.SECONDS);
        } catch (InterruptedException ignored) {
            Thread.currentThread().interrupt();
        }
    }

    // native.js's styles: selection ticks for tabs and pickers, a light tap
    // for buttons, a firmer one as pull to refresh arms.
    private static int haptic(String style) {
        switch (style) {
            case "selection":
                return HapticFeedbackConstants.CLOCK_TICK;
            case "medium":
                return Build.VERSION.SDK_INT >= 30 ? HapticFeedbackConstants.CONFIRM : HapticFeedbackConstants.LONG_PRESS;
            default:
                return HapticFeedbackConstants.KEYBOARD_TAP;
        }
    }

    private static JSONObject notificationsOff() {
        try {
            return new JSONObject().put("ok", false).put("reason", "notifications");
        } catch (Exception e) {
            return ok(false);
        }
    }

    private static JSONObject ok(boolean ok) {
        try {
            return new JSONObject().put("ok", ok);
        } catch (Exception e) {
            return new JSONObject();
        }
    }

    private static void answer(WebView view, JavaScriptReplyProxy reply, int id, Object result) {
        String text;
        try {
            text = new JSONObject().put("id", id).put("result", result).toString();
        } catch (Exception e) {
            return;
        }
        view.post(() -> reply.postMessage(text));
    }
}
