import Foundation

// scores.phade.app (server/index.js): the app registers a Lock Screen card's
// push token and the device's alert teams there. Best-effort with a few
// retries; a card that never registers just stops updating, and the device
// re-registers its teams at every launch.
enum PushServer {
    static let base: URL = {
        let configured = Bundle.main.object(forInfoDictionaryKey: "ScoresPushServer") as? String
        return URL(string: configured ?? "") ?? URL(string: "https://scores.phade.app")!
    }()

    /// Debug builds get their tokens from Apple's sandbox, TestFlight and the
    /// App Store from production.
    static var environment: String {
        #if DEBUG
        return "sandbox"
        #else
        return "production"
        #endif
    }

    @available(iOS 16.1, *)
    static func registerCard(token: String, attributes: GameAttributes) async {
        await send("POST", "v1/activities", [
            "token": token,
            "env": environment,
            "league": attributes.league,
            "eventId": attributes.eventId,
            "start": Int(attributes.start.timeIntervalSince1970),
        ])
    }

    static func forgetCard(token: String) async {
        await send("DELETE", "v1/activities/\(token)", nil)
    }

    /// teams: [{league, id}]. Empty forgets the device.
    static func registerDevice(token: String, teams: [[String: String]]) async {
        await send("PUT", "v1/devices/\(token)", ["env": environment, "teams": teams])
    }

    private static func send(_ method: String, _ path: String, _ body: [String: Any]?) async {
        var request = URLRequest(url: base.appendingPathComponent(path))
        request.httpMethod = method
        request.timeoutInterval = 15
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try? JSONSerialization.data(withJSONObject: body)
        }
        for delay: UInt64 in [0, 2, 10, 30] {
            if delay > 0 { try? await Task.sleep(nanoseconds: delay * 1_000_000_000) }
            if let (_, response) = try? await URLSession.shared.data(for: request),
               let status = (response as? HTTPURLResponse)?.statusCode {
                // A 4xx won't get better by retrying.
                if status < 500 { return }
            }
        }
        print("PushServer: \(method) \(path) failed")
    }
}

extension Data {
    var hex: String { map { String(format: "%02x", $0) }.joined() }
}
