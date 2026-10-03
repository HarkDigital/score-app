import UIKit
import WebKit

// The web app's line to the Lock Screen card, team alerts and haptics, without any
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
        case "scheduleGame":
            guard #available(iOS 16.2, *), let card = body["card"] as? [String: Any] else { return ["ok": false] }
            return ["ok": await LiveGameManager.shared.schedule(card: card)]
        case "removeGame":
            if #available(iOS 16.2, *), let league = body["league"] as? String, let eventId = body["eventId"] as? String {
                await LiveGameManager.shared.remove(league: league, eventId: eventId)
            }
            return ["ok": true]
        case "haptic":
            Haptics.play(body["style"] as? String)
            return ["ok": true]
        case "enableAlerts":
            return await PushManager.shared.requestAuthorization()
        case "setAlertTeams":
            // [{league, id, start, score, end}]: which alerts each team wants.
            let teams = (body["teams"] as? [[String: Any]] ?? []).compactMap { team -> [String: Any]? in
                guard let league = team["league"] as? String, let id = team["id"] as? String else { return nil }
                var entry: [String: Any] = ["league": league, "id": id]
                for kind in ["start", "score", "end"] { entry[kind] = (team[kind] as? Bool) ?? false }
                return entry
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
            "canSchedule": false,
            "active": [Any](),
            "scheduled": [Any](),
            "alerts": await PushManager.shared.status(),
        ]
        if #available(iOS 16.2, *) {
            let manager = LiveGameManager.shared
            result["liveActivities"] = manager.enabled
            result["canSchedule"] = manager.canSchedule
            result["active"] = manager.active.map { ["league": $0.league, "eventId": $0.eventId] }
            result["scheduled"] = manager.scheduled.map { ["league": $0["league"] ?? "", "eventId": $0["eventId"] ?? ""] }
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

/// The taps the web app asks for (a web page can't reach the haptic engine).
/// iOS skips them when System Haptics is off in Settings.
@MainActor
private enum Haptics {
    private static let selection = UISelectionFeedbackGenerator()
    private static let light = UIImpactFeedbackGenerator(style: .light)
    private static let medium = UIImpactFeedbackGenerator(style: .medium)

    /// "selection": tabs, pickers, switches. "medium": pull to refresh
    /// letting go. Anything else: a light tap for a button.
    static func play(_ style: String?) {
        switch style {
        case "selection": selection.selectionChanged()
        case "medium": medium.impactOccurred()
        default: light.impactOccurred()
        }
    }
}
