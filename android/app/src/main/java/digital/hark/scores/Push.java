package digital.hark.scores;

import android.content.Context;
import android.util.Log;
import com.google.android.gms.tasks.Tasks;
import com.google.firebase.FirebaseApp;
import com.google.firebase.messaging.FirebaseMessaging;
import java.io.IOException;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

// The push server (scores.phade.app, R.string.push_server) and Firebase: the
// same API the iPhone app uses, with platform "android" and the phone's FCM
// token instead of APNs tokens. The server sends card updates, scheduled
// cards and team alerts back as FCM data messages (FcmService). Everything
// here blocks, so it runs on Push.WORK.
final class Push {

    private Push() {}

    private static final String TAG = "PhadeScores";

    // One background thread for the server and Firebase, in order.
    static final ExecutorService WORK = Executors.newSingleThreadExecutor();

    // Firebase needs android/app/google-services.json at build time; without
    // it the Lock Screen and alerts switches stay hidden.
    static boolean ready(Context c) {
        try {
            return !FirebaseApp.getApps(c).isEmpty() || FirebaseApp.initializeApp(c) != null;
        } catch (RuntimeException e) {
            return false;
        }
    }

    // The phone's FCM token, or the last one known.
    static String token(Context c) {
        if (!ready(c)) return null;
        try {
            String token = Tasks.await(FirebaseMessaging.getInstance().getToken(), 20, TimeUnit.SECONDS);
            if (token != null) Store.setToken(c, token);
            return token;
        } catch (Exception e) {
            Log.w(TAG, "no FCM token: " + e.getMessage());
            return Store.token(c);
        }
    }

    // POST /v1/activities: keep this card current.
    static boolean registerCard(Context c, String token, JSONObject card) {
        try {
            JSONObject body = new JSONObject()
                .put("platform", "android")
                .put("token", token)
                .put("league", card.getString("league"))
                .put("eventId", card.getString("eventId"))
                .put("start", card.optLong("start"));
            return send(c, "POST", "/v1/activities", body);
        } catch (JSONException e) {
            return false;
        }
    }

    // POST /v1/scheduled: put this card up 15 minutes before the start.
    static boolean schedule(Context c, String token, JSONObject card) {
        try {
            JSONObject plain = new JSONObject(card.toString());
            plain.remove("state");
            return send(c, "POST", "/v1/scheduled", new JSONObject().put("platform", "android").put("token", token).put("card", plain));
        } catch (JSONException e) {
            return false;
        }
    }

    // Stop this game's card, whether it's up or scheduled.
    static void forget(Context c, String token, String league, String eventId) {
        String game = "/" + encode(league) + "/" + encode(eventId);
        send(c, "DELETE", "/v1/activities/" + encode(token) + game, null);
        send(c, "DELETE", "/v1/scheduled/" + encode(token) + game, null);
    }

    // PUT /v1/devices/:token: the teams that want alerts (none forgets the phone).
    static boolean setTeams(Context c, String token, JSONArray teams) {
        try {
            return send(c, "PUT", "/v1/devices/" + encode(token), new JSONObject().put("platform", "android").put("teams", teams));
        } catch (JSONException e) {
            return false;
        }
    }

    // Everything the server should know, again: at launch and when Firebase
    // hands out a new token (the server keys it all by token).
    static void syncAll(Context c, String token) {
        if (token == null) return;
        JSONArray teams = Store.teams(c);
        if (teams.length() > 0) setTeams(c, token, teams);
        JSONObject cards = Store.cards(c);
        for (Iterator<String> it = cards.keys(); it.hasNext(); ) {
            JSONObject entry = cards.optJSONObject(it.next());
            if (entry != null && entry.optJSONObject("card") != null) registerCard(c, token, entry.optJSONObject("card"));
        }
        JSONObject scheduled = Store.scheduled(c);
        for (Iterator<String> it = scheduled.keys(); it.hasNext(); ) {
            JSONObject card = scheduled.optJSONObject(it.next());
            if (card != null) schedule(c, token, card);
        }
    }

    private static boolean send(Context c, String method, String path, JSONObject body) {
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(c.getString(R.string.push_server) + path).openConnection();
            conn.setRequestMethod(method);
            conn.setConnectTimeout(10_000);
            conn.setReadTimeout(10_000);
            if (body != null) {
                conn.setDoOutput(true);
                conn.setRequestProperty("Content-Type", "application/json");
                try (OutputStream out = conn.getOutputStream()) {
                    out.write(body.toString().getBytes(StandardCharsets.UTF_8));
                }
            }
            int status = conn.getResponseCode();
            if (status >= 300) Log.w(TAG, method + " " + path.split("/")[2] + " " + status);
            return status >= 200 && status < 300;
        } catch (IOException e) {
            Log.w(TAG, method + " failed: " + e.getMessage());
            return false;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private static String encode(String value) {
        try {
            return URLEncoder.encode(value, "UTF-8");
        } catch (java.io.UnsupportedEncodingException e) {
            return value;
        }
    }
}
