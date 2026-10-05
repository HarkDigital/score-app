package digital.hark.scores;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Base64;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;

// Debug builds only: puts a hand-made Lock Screen card up (or updates one
// that's up) without the push server, to check the layouts on an emulator.
// The card is details.js lockScreenCard()'s JSON with its "state", base64'd
// so adb's shell quoting leaves it alone:
//   adb shell am broadcast -n digital.hark.scores/.DebugCards --es card <base64>
// A card left up gets the live server's updates if its game is real.
public final class DebugCards extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        Context c = context.getApplicationContext();
        String encoded = intent.getStringExtra("card");
        if (encoded == null) return;
        PendingResult result = goAsync();
        new Thread(() -> {
            try {
                String json = new String(Base64.decode(encoded, Base64.DEFAULT), StandardCharsets.UTF_8);
                LiveCards.show(c, new JSONObject(json));
            } catch (Exception ignored) {
                // a malformed test card
            } finally {
                result.finish();
            }
        }).start();
    }
}
