import Capacitor
import UIKit
import UserNotifications

// Team alerts: notification permission, the device's push token, the teams
// that want alerts (handed over by the web app, kept here between launches),
// and what a tapped alert opens. Capacitor's NotificationRouter is the
// notification center's delegate and passes remote notifications here.
@MainActor
final class PushManager: NSObject, NotificationHandlerProtocol {
    static let shared = PushManager()

    /// Opens a "#/game/..." route in the web app.
    weak var navigator: ViewController?

    private let teamsKey = "alertTeams"
    private var deviceToken: String?
    /// [{league, id, start, score, end}], as the web app sent them.
    private var teams: [[String: Any]] {
        get { UserDefaults.standard.array(forKey: teamsKey) as? [[String: Any]] ?? [] }
        set { UserDefaults.standard.set(newValue, forKey: teamsKey) }
    }

    func status() async -> String {
        switch await UNUserNotificationCenter.current().notificationSettings().authorizationStatus {
        case .authorized: return "authorized"
        case .provisional: return "provisional"
        case .ephemeral: return "ephemeral"
        case .denied: return "denied"
        default: return "notDetermined"
        }
    }

    /// Asks the first time; afterwards just reports (iOS won't ask twice).
    func requestAuthorization() async -> String {
        _ = try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])
        let result = await status()
        if result == "authorized" || result == "provisional" {
            UIApplication.shared.registerForRemoteNotifications()
        }
        return result
    }

    func setTeams(_ list: [[String: Any]]) {
        let changed = !(list as NSArray).isEqual(to: teams)
        teams = list
        if deviceToken == nil {
            // The first token arrives from registerForRemoteNotifications.
            Task { await registerIfAllowed() }
        } else if changed {
            sync()
        }
    }

    /// At launch, and whenever the teams change before a token is known.
    func registerIfAllowed() async {
        let s = await status()
        guard !teams.isEmpty, s == "authorized" || s == "provisional" else { return }
        UIApplication.shared.registerForRemoteNotifications()
    }

    func didRegister(deviceToken data: Data) {
        deviceToken = data.hex
        sync()
    }

    private func sync() {
        guard let token = deviceToken else { return }
        let list = teams
        Task { await PushServer.registerDevice(token: token, teams: list) }
    }

    // MARK: NotificationHandlerProtocol

    nonisolated func willPresent(notification: UNNotification) -> UNNotificationPresentationOptions {
        // Show the banner even with the app open.
        [.banner, .list, .sound]
    }

    nonisolated func didReceive(response: UNNotificationResponse) {
        guard let route = response.notification.request.content.userInfo["route"] as? String else { return }
        Task { @MainActor in self.navigator?.open(route: route) }
    }
}
