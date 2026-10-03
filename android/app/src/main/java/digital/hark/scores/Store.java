package digital.hark.scores;

import android.content.Context;
import android.content.SharedPreferences;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

// What the app remembers for its Lock Screen cards and alerts, in one
// SharedPreferences file: the cards up now with their latest state, the
// scheduled ones, the followed teams that want alerts, and the phone's FCM
// token. Cards are keyed "league:eventId".
final class Store {

    private Store() {}

    private static SharedPreferences prefs(Context c) {
        return c.getApplicationContext().getSharedPreferences("phade_scores", Context.MODE_PRIVATE);
    }

    static String key(String league, String eventId) {
        return league + ":" + eventId;
    }

    // ---- Cards up now: key -> {card, state} ----

    static synchronized JSONObject cards(Context c) {
        return object(c, "cards");
    }

    static synchronized JSONObject card(Context c, String key) {
        return cards(c).optJSONObject(key);
    }

    static synchronized void putCard(Context c, String key, JSONObject card, JSONObject state) {
        JSONObject cards = cards(c);
        try {
            cards.put(key, new JSONObject().put("card", card).put("state", state));
        } catch (JSONException ignored) {
            return;
        }
        save(c, "cards", cards);
    }

    static synchronized void removeCard(Context c, String key) {
        JSONObject cards = cards(c);
        cards.remove(key);
        save(c, "cards", cards);
    }

    // ---- Scheduled cards: key -> card ----

    static synchronized JSONObject scheduled(Context c) {
        return object(c, "scheduled");
    }

    static synchronized void putScheduled(Context c, String key, JSONObject card) {
        JSONObject scheduled = scheduled(c);
        try {
            scheduled.put(key, card);
        } catch (JSONException ignored) {
            return;
        }
        save(c, "scheduled", scheduled);
    }

    static synchronized void removeScheduled(Context c, String key) {
        JSONObject scheduled = scheduled(c);
        scheduled.remove(key);
        save(c, "scheduled", scheduled);
    }

    // ---- Alerts: [{league, id, start, score, end}] ----

    static synchronized JSONArray teams(Context c) {
        try {
            return new JSONArray(prefs(c).getString("teams", "[]"));
        } catch (JSONException e) {
            return new JSONArray();
        }
    }

    static synchronized void setTeams(Context c, JSONArray teams) {
        prefs(c).edit().putString("teams", teams.toString()).apply();
    }

    // ---- The phone's FCM token, and whether notifications were asked for ----

    static String token(Context c) {
        return prefs(c).getString("token", null);
    }

    static void setToken(Context c, String token) {
        prefs(c).edit().putString("token", token).apply();
    }

    static boolean askedForNotifications(Context c) {
        return prefs(c).getBoolean("asked", false);
    }

    static void setAskedForNotifications(Context c) {
        prefs(c).edit().putBoolean("asked", true).apply();
    }

    private static JSONObject object(Context c, String name) {
        try {
            return new JSONObject(prefs(c).getString(name, "{}"));
        } catch (JSONException e) {
            return new JSONObject();
        }
    }

    private static void save(Context c, String name, Object value) {
        prefs(c).edit().putString(name, value.toString()).apply();
    }
}
