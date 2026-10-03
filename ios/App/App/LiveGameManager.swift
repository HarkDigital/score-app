import ActivityKit
import Foundation

// The game on the Lock Screen: one at a time, started from the game page,
// kept current by the push server through the activity's own push token.
@available(iOS 16.2, *)
@MainActor
final class LiveGameManager {
    static let shared = LiveGameManager()

    private var watching = Set<String>()

    var enabled: Bool { ActivityAuthorizationInfo().areActivitiesEnabled }

    /// The game showing now, if any.
    var current: GameAttributes? {
        Activity<GameAttributes>.activities.first { $0.activityState == .active || $0.activityState == .stale }?.attributes
    }

    func start(_ attributes: GameAttributes, state: GameAttributes.ContentState) async throws {
        await endAll()
        let activity = try Activity.request(
            attributes: attributes,
            content: ActivityContent(state: state, staleDate: nil),
            pushType: .token
        )
        watch(activity)
    }

    func endAll() async {
        for activity in Activity<GameAttributes>.activities {
            await activity.end(nil, dismissalPolicy: .immediate)
        }
    }

    /// After a relaunch: pick the running card back up, so its token reaches
    /// the server again (the server may have restarted, or the token changed).
    func resume() {
        for activity in Activity<GameAttributes>.activities { watch(activity) }
    }

    private func watch(_ activity: Activity<GameAttributes>) {
        guard watching.insert(activity.id).inserted else { return }
        let attributes = activity.attributes
        Task {
            for await data in activity.pushTokenUpdates {
                await PushServer.registerCard(token: data.hex, attributes: attributes)
            }
        }
        Task {
            for await state in activity.activityStateUpdates where state == .ended || state == .dismissed {
                if let token = activity.pushToken { await PushServer.forgetCard(token: token.hex) }
                watching.remove(activity.id)
                break
            }
        }
    }
}
