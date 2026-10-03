package digital.hark.scores;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

// A Lock Screen card swiped away: forget it, and tell the push server to
// stop sending its updates (as iOS does when a Live Activity is dismissed).
public class CardDismissedReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        String league = intent.getStringExtra("league");
        String eventId = intent.getStringExtra("eventId");
        if (league == null || eventId == null) return;
        Context c = context.getApplicationContext();
        Store.removeCard(c, Store.key(league, eventId));
        PendingResult done = goAsync();
        Push.WORK.execute(() -> {
            try {
                String token = Store.token(c);
                if (token != null) Push.forget(c, token, league, eventId);
            } finally {
                done.finish();
            }
        });
    }
}
