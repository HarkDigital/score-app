import ActivityKit
import Foundation

// Games on the Lock Screen. Each game page has its own toggle:
// - a game that's on or starts within six hours goes up straight away;
// - a later one is scheduled: the push server starts it 30 minutes before the
//   game with Apple's push-to-start (iOS 17.2+), since iOS ends a card after
//   eight hours.
// Either way the push server keeps it current through the card's own token.
@available(iOS 16.2, *)
@MainActor
final class LiveGameManager {
    static let shared = LiveGameManager()

    private var watching = Set<String>()
    private var begun = false
    private let scheduledKey = "scheduledGames"
    private let startTokenKey = "pushToStartToken"

    var enabled: Bool { ActivityAuthorizationInfo().areActivitiesEnabled }

    var canSchedule: Bool {
        if #available(iOS 17.2, *) { return true }
        return false
    }

    /// Games showing now.
    var active: [GameAttributes] {
        Activity<GameAttributes>.activities
            .filter { $0.activityState == .active || $0.activityState == .stale }
            .map(\.attributes)
    }

    /// Games waiting to go up before kickoff: details.js lockScreenCard()s,
    /// dropped once their game is well past.
    private(set) var scheduled: [[String: Any]] {
        get {
            let cutoff = Date().timeIntervalSince1970 - 12 * 3600
            let all = UserDefaults.standard.array(forKey: scheduledKey) as? [[String: Any]] ?? []
            return all.filter { ($0["start"] as? Double ?? 0) > cutoff }
        }
        set { UserDefaults.standard.set(newValue, forKey: scheduledKey) }
    }

    private var startToken: String? {
        get { UserDefaults.standard.string(forKey: startTokenKey) }
        set { UserDefaults.standard.set(newValue, forKey: startTokenKey) }
    }

    /// At every launch, including the background launch iOS gives the app
    /// when the server starts a card, so the new card's token reaches the
    /// server and its updates can flow.
    func begin() {
        guard !begun else { return }
        begun = true
        for activity in Activity<GameAttributes>.activities { watch(activity) }
        Task {
            for await activity in Activity<GameAttributes>.activityUpdates {
                watch(activity)
                forgetScheduled(league: activity.attributes.league, eventId: activity.attributes.eventId)
            }
        }
        if #available(iOS 17.2, *) {
            Task {
                for await data in Activity<GameAttributes>.pushToStartTokenUpdates {
                    let token = data.hex
                    let changed = token != startToken
                    startToken = token
                    // A new token: the server needs every scheduled game again.
                    if changed { for card in scheduled { await PushServer.schedule(card: card, startToken: token) } }
                }
            }
        }
    }

    func isShowing(league: String, eventId: String) -> Bool {
        active.contains { $0.league == league && $0.eventId == eventId }
    }

    func start(_ attributes: GameAttributes, state: GameAttributes.ContentState) async throws {
        if isShowing(league: attributes.league, eventId: attributes.eventId) { return }
        let activity = try Activity.request(
            attributes: attributes,
            content: ActivityContent(state: state, staleDate: nil),
            pushType: .token
        )
        watch(activity)
    }

    /// Hands a later game to the server to start before kickoff. False when
    /// this iPhone can't be started remotely (before iOS 17.2) or has no
    /// push-to-start token yet.
    func schedule(card: [String: Any]) async -> Bool {
        guard canSchedule, let league = card["league"] as? String, let eventId = card["eventId"] as? String else { return false }
        var token = startToken
        // The token arrives shortly after launch; give it a moment.
        for _ in 0..<10 where token == nil {
            try? await Task.sleep(nanoseconds: 500_000_000)
            token = startToken
        }
        guard let token else { return false }
        forgetScheduled(league: league, eventId: eventId)
        scheduled.append(card)
        await PushServer.schedule(card: card, startToken: token)
        return true
    }

    /// The toggle off: ends the card if it's up, and cancels it if it's waiting.
    func remove(league: String, eventId: String) async {
        for activity in Activity<GameAttributes>.activities
        where activity.attributes.league == league && activity.attributes.eventId == eventId {
            await activity.end(nil, dismissalPolicy: .immediate)
        }
        if scheduled.contains(where: { $0["league"] as? String == league && $0["eventId"] as? String == eventId }) {
            forgetScheduled(league: league, eventId: eventId)
            if let token = startToken { await PushServer.unschedule(startToken: token, league: league, eventId: eventId) }
        }
    }

    func isScheduled(league: String, eventId: String) -> Bool {
        scheduled.contains { $0["league"] as? String == league && $0["eventId"] as? String == eventId }
    }

    private func forgetScheduled(league: String, eventId: String) {
        scheduled = scheduled.filter { !($0["league"] as? String == league && $0["eventId"] as? String == eventId) }
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
