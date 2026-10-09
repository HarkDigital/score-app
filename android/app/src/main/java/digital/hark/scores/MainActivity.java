package digital.hark.scores;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONObject;

// Phade Scores on Android: a thin shell around the live site
// (capacitor.config.json server.url), as on iPhone, plus the iPhone app's
// native features: Lock Screen cards and team alerts (LiveCards, Alerts,
// FcmService, through the push server and Firebase) and haptics, all reached
// from the page through NativeBridge.
//
// Back, the gesture or the button, walks the web app's own history first, so
// a game or team page returns to where it was opened from; only on the first
// page does Back leave the app. A tapped card or alert opens its game.
public class MainActivity extends BridgeActivity {

    static final String EXTRA_ROUTE = "route";
    // A team page may name its tab ("#/team/nfl/12/news", a news alert).
    private static final String ROUTE = "#/(game|team)/[\\w-]{1,20}/[\\w-]{1,20}(/(schedule|stats|news))?";

    private String pendingRoute;
    private int routeTries;
    private final List<Runnable> waitingForPermission = new ArrayList<>();
    private final ActivityResultLauncher<String> notificationPermission =
        registerForActivityResult(new ActivityResultContracts.RequestPermission(), granted -> {
            Store.setAskedForNotifications(this);
            List<Runnable> waiting = new ArrayList<>(waitingForPermission);
            waitingForPermission.clear();
            for (Runnable done : waiting) done.run();
        });

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(NativeBridge.class);
        super.onCreate(savedInstanceState);
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView webView = getBridge() == null ? null : getBridge().getWebView();
                if (webView != null && webView.canGoBack()) {
                    webView.goBack();
                    return;
                }
                // Nothing to go back to: let Android leave the app as usual.
                setEnabled(false);
                getOnBackPressedDispatcher().onBackPressed();
                setEnabled(true);
            }
        });

        pendingRoute = routeOf(getIntent());
        getBridge().addWebViewListener(new WebViewListener() {
            @Override
            public void onPageLoaded(WebView webView) {
                openPendingRoute();
            }
        });
        openPendingRoute();

        // Remind the server of this phone's cards and teams (its token may
        // have changed while the app was closed).
        android.content.Context app = getApplicationContext();
        Push.WORK.execute(() -> {
            if (Push.ready(app)) Push.syncAll(app, Push.token(app));
        });
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        String route = routeOf(intent);
        if (route != null) {
            pendingRoute = route;
            routeTries = 0;
            openPendingRoute();
        }
    }

    private static String routeOf(Intent intent) {
        String route = intent == null ? null : intent.getStringExtra(EXTRA_ROUTE);
        return route != null && route.matches(ROUTE) ? route : null;
    }

    // Opens a tapped card's or alert's route once the page is there, and keeps
    // it until the page says it has it. Capacitor reports a page loaded only
    // when its progress is already 100 as it finishes, which a launch can
    // miss (the alert then opened the scoreboard), so a page not there yet
    // (still loading, or not the site yet) is looked at again shortly, for
    // up to 15 seconds.
    private void openPendingRoute() {
        WebView webView = getBridge() == null ? null : getBridge().getWebView();
        if (pendingRoute == null || webView == null) return;
        webView.removeCallbacks(retryRoute);
        String url = webView.getUrl();
        if (webView.getProgress() < 100 || url == null || !url.startsWith(getBridge().getAppUrl())) {
            if (++routeTries < 60) webView.postDelayed(retryRoute, 250);
            return;
        }
        String route = pendingRoute;
        // The same hash sets nothing, so it's announced again: a team page
        // showing another tab still turns to News.
        String script = "(function (r) { if (location.hash === r) dispatchEvent(new HashChangeEvent('hashchange'));"
            + " else location.hash = r; return location.hash === r; })(" + JSONObject.quote(route) + ")";
        webView.evaluateJavascript(script, result -> {
            if (!route.equals(pendingRoute)) return;
            if ("true".equals(result)) pendingRoute = null;
            else if (++routeTries < 60) webView.postDelayed(retryRoute, 250);
        });
    }

    private final Runnable retryRoute = this::openPendingRoute;

    // Android 13 and later ask before an app may post notifications. Runs
    // done once the person has answered (or straight away when there's
    // nothing to ask). Called from NativeBridge's background thread.
    void requestNotifications(Runnable done) {
        runOnUiThread(() -> {
            boolean granted = Build.VERSION.SDK_INT < 33
                || ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
            boolean canAsk = !Store.askedForNotifications(this)
                || (Build.VERSION.SDK_INT >= 33 && shouldShowRequestPermissionRationale(Manifest.permission.POST_NOTIFICATIONS));
            if (granted || !canAsk) {
                done.run();
                return;
            }
            waitingForPermission.add(done);
            if (waitingForPermission.size() == 1) notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS);
        });
    }
}
