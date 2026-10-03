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

    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        webView?.allowsBackForwardNavigationGestures = true

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
              url.scheme == "phadescores", url.host == "game" else { return }
        // phadescores://game/nfl/401547417 → #/game/nfl/401547417
        open(route: "#/game" + url.path)
    }

    /// Shows a route ("#/game/nfl/401547417") in the web app, loaded or not.
    func open(route: String) {
        guard route.range(of: #"^#/(game|team)/[a-z0-9]+/[\w-]+$"#, options: .regularExpression) != nil,
              let webView, let base = bridge?.config.appStartServerURL else { return }
        if let current = webView.url, current.host == base.host, current.path == base.path, !webView.isLoading {
            webView.evaluateJavaScript("location.hash = '\(route)'")
        } else {
            var parts = URLComponents(url: base, resolvingAgainstBaseURL: false)
            parts?.fragment = String(route.dropFirst())
            if let target = parts?.url { webView.load(URLRequest(url: target)) }
        }
    }
}
