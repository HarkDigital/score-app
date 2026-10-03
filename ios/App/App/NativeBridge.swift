import UIKit
import WebKit

// The web app's line to the Lock Screen card and team alerts, without any
// Capacitor JS: native.js calls
// window.webkit.messageHandlers.phadeScores.postMessage({action, ...}) and
// gets a promise of the reply. Only the app's own site, in the main frame,
// is answered.
final class NativeBridge: NSObject, WKScriptMessageHandlerWithReply {
    private let allowedHost: String?

    init(allowedHost: String?) {
        self.allowedHost = allowedHost
    }

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        guard message.frameInfo.isMainFrame,
              message.frameInfo.securityOrigin.host == allowedHost,
              let body = message.body as? [String: Any],
              let action = body["action"] as? String else {
            replyHandler(nil, "not allowed")
            return
        }
        Task { @MainActor in
            replyHandler(await self.handle(action, body), nil)
        }
    }

    @MainActor
    private func handle(_ action: String, _ body: [String: Any]) async -> Any {
        switch action {
        case "info":
            return await info()
        case "showGame":
            return await showGame(body["card"])
        case "removeGame":
            if #available(iOS 16.2, *) { await LiveGameManager.shared.endAll() }
            return ["ok": true]
        case "enableAlerts":
            return await PushManager.shared.requestAuthorization()
        case "setAlertTeams":
            let teams = (body["teams"] as? [[String: Any]] ?? []).compactMap { team -> [String: String]? in
                guard let league = team["league"] as? String, let id = team["id"] as? String else { return nil }
                return ["league": league, "id": id]
            }
            PushManager.shared.setTeams(teams)
            return ["ok": true]
        default:
            return ["ok": false, "error": "unknown action"]
        }
    }

    @MainActor
    private func info() async -> [String: Any] {
        var result: [String: Any] = [
            "liveActivities": false,
            "current": NSNull(),
            "alerts": await PushManager.shared.status(),
        ]
        if #available(iOS 16.2, *) {
            let manager = LiveGameManager.shared
            result["liveActivities"] = manager.enabled
            if let game = manager.current {
                result["current"] = ["league": game.league, "eventId": game.eventId]
            }
        }
        return result
    }

    @MainActor
    private func showGame(_ card: Any?) async -> [String: Any] {
        guard #available(iOS 16.2, *) else { return ["ok": false, "error": "needs iOS 16.2"] }
        guard let object = card as? [String: Any],
              let data = try? JSONSerialization.data(withJSONObject: object),
              let parsed = try? JSONDecoder().decode(Card.self, from: data) else {
            return ["ok": false, "error": "bad card"]
        }
        do {
            try await LiveGameManager.shared.start(parsed.attributes, state: parsed.state)
            return ["ok": true]
        } catch {
            return ["ok": false, "error": error.localizedDescription]
        }
    }
}

/// details.js lockScreenCard(): the attributes plus the first state, with the
/// start time in epoch seconds.
@available(iOS 16.1, *)
private struct Card: Decodable {
    let league: String
    let leagueLabel: String
    let eventId: String
    let start: Double
    let homeFirst: Bool
    let away: GameAttributes.Team
    let home: GameAttributes.Team
    let state: GameAttributes.ContentState

    var attributes: GameAttributes {
        GameAttributes(
            league: league,
            leagueLabel: leagueLabel,
            eventId: eventId,
            start: Date(timeIntervalSince1970: start),
            homeFirst: homeFirst,
            away: away,
            home: home
        )
    }
}
