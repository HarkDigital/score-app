import UIKit
import Capacitor

// Capacitor's bridge, plus what the app adds to the web app:
// - Safari's edge swipes: in from the left edge to go back, from the right to
//   go forward. Game and team pages are history entries (pushState), so the
//   swipes walk them with live snapshots, just like Safari.
// - The phadeScores message handler (NativeBridge) for the Lock Screen card
//   and team alerts.
// - Opening a game from a tapped card (phadescores://game/...) or alert.
class ViewController: CAPBridgeViewController {
    private var nativeBridge: NativeBridge?
    /// A tapped card's or alert's route, kept until the page says it has it.
    /// The page may still be loading, or iOS may have closed it while the app
    /// sat in the background: Capacitor then reloads it, and a route set on
    /// the old page is lost (alerts opened the scoreboard).
    private var pendingRoute: String?
    private var routeLoads = 0
    private var loadingObservation: NSKeyValueObservation?

    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        webView?.allowsBackForwardNavigationGestures = true
        // Each finished load (the first, a reload) gets a waiting route.
        loadingObservation = webView?.observe(\.isLoading) { [weak self] webView, _ in
            guard !webView.isLoading else { return }
            DispatchQueue.main.async { self?.deliverRoute() }
        }

        let handler = NativeBridge(allowedHost: bridge?.config.appStartServerURL.host)
        webView?.configuration.userContentController.addScriptMessageHandler(handler, contentWorld: .page, name: "phadeScores")
        nativeBridge = handler

        bridge?.notificationRouter.pushNotificationHandler = PushManager.shared
        PushManager.shared.navigator = self
        NotificationCenter.default.addObserver(self, selector: #selector(openURL(_:)), name: .capacitorOpenURL, object: nil)

        if #available(iOS 16.2, *) { LiveGameManager.shared.begin() }
        Task { await PushManager.shared.registerIfAllowed() }
    }

    @objc private func openURL(_ notification: Notification) {
        guard let url = (notification.object as? [String: Any])?["url"] as? URL,
              url.scheme == "phadescores", let host = url.host, host == "game" || host == "team" else { return }
        // phadescores://game/nfl/401547417 → #/game/nfl/401547417 (a card or
        // widget game); phadescores://team/nhl/4 → #/team/nhl/4 (the Team widget).
        open(route: "#/\(host)" + url.path)
    }

    /// Shows a route ("#/game/nfl/401547417", "#/team/nfl/12/news") in the
    /// web app, loaded or not.
    func open(route: String) {
        // A team page may name its tab ("#/team/nfl/12/news", a news alert).
        guard route.range(of: #"^#/(game|team)/[a-z0-9]+/[\w-]+(/(schedule|stats|news))?$"#, options: .regularExpression) != nil,
              let webView else { return }
        // The same tap again (from the scene and the notification delegate).
        if route == pendingRoute, webView.isLoading { return }
        pendingRoute = route
        routeLoads = 0
        // Still loading (a launch, a reload): load the page on the route.
        if webView.isLoading || webView.url == nil { loadPage(on: route) } else { deliverRoute() }
    }

    /// Hands the waiting route to the page; if the page is gone, loads it on
    /// the route. Done once the page answers that its hash is the route.
    private func deliverRoute() {
        guard let route = pendingRoute, let webView, !webView.isLoading else { return }
        guard let current = webView.url, let base = bridge?.config.appStartServerURL,
              current.host == base.host, current.path == base.path else { return loadPage(on: route) }
        // The same hash sets nothing, so it's announced again: a team page
        // showing another tab still turns to News.
        let script = "(function (r) { if (location.hash === r) dispatchEvent(new HashChangeEvent('hashchange')); else location.hash = r; return location.hash === r; })('\(route)')"
        webView.evaluateJavaScript(script) { [weak self] result, _ in
            guard let self, self.pendingRoute == route else { return }
            if result as? Bool == true { self.pendingRoute = nil } else { self.loadPage(on: route) }
        }
    }

    private func loadPage(on route: String) {
        // Twice at most, so a page that never answers can't loop.
        guard routeLoads < 2, let webView, let base = bridge?.config.appStartServerURL else {
            pendingRoute = nil
            return
        }
        routeLoads += 1
        var parts = URLComponents(url: base, resolvingAgainstBaseURL: false)
        parts?.fragment = String(route.dropFirst())
        if let target = parts?.url { webView.load(URLRequest(url: target)) }
    }
}
