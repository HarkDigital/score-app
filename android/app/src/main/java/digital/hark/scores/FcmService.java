package digital.hark.scores;

import androidx.annotation.NonNull;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;
import java.util.Map;
import org.json.JSONException;
import org.json.JSONObject;

// The push server's messages (server/live.js android*Message), which wake the
// app even when it isn't open:
//   update / end: a card's latest or final state {league, eventId, state}
//   start:        a scheduled card's time has come {card, state}, or a
//                 followed team's game (auto: "1")
//   alert:        a team alert {title, body, route}
// Runs on a background thread, so logos can download here.
public class FcmService extends FirebaseMessagingService {

    @Override
    public void onNewToken(@NonNull String token) {
        Store.setToken(this, token);
        // The server keys everything by token: tell it again under the new one.
        Push.WORK.execute(() -> Push.syncAll(getApplicationContext(), token));
    }

    @Override
    public void onMessageReceived(@NonNull RemoteMessage message) {
        Map<String, String> data = message.getData();
        String type = data.get("type");
        if (type == null) return;
        try {
            switch (type) {
                case "update":
                case "end": {
                    String league = data.get("league");
                    String eventId = data.get("eventId");
                    JSONObject state = new JSONObject(data.get("state"));
                    boolean shown = LiveCards.update(this, league, eventId, state, "end".equals(type));
                    if (!shown) stop(league, eventId);
                    break;
                }
                case "start": {
                    JSONObject card = new JSONObject(data.get("card"));
                    boolean auto = "1".equals(data.get("auto"));
                    JSONObject state = new JSONObject(data.get("state"));
                    if (!LiveCards.start(this, card, state, auto)) stop(card.optString("league"), card.optString("eventId"));
                    break;
                }
                case "alert":
                    Alerts.show(this, data.get("title"), data.get("body"), data.get("route"), data.get("thread"));
                    break;
                default:
                    break;
            }
        } catch (JSONException | NullPointerException | NumberFormatException ignored) {
            // a message from a newer server
        }
    }

    // An update for a card this phone no longer has (turned off while the
    // server was unreachable): ask the server to stop.
    private void stop(String league, String eventId) {
        String token = Store.token(this);
        if (token != null && league != null && eventId != null) Push.forget(getApplicationContext(), token, league, eventId);
    }
}
