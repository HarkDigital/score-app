import Foundation

// The teams followed in the web app (scores.myTeams), handed over by the page
// (bridge action setFollowedTeams) and kept in the App Group, where the
// widgets read them: the Team widget's picker and the My Teams widget. In
// both targets.
struct FollowedTeam: Codable, Hashable {
    var league: String
    var id: String
    var name: String
    var abbr: String
    var logo: String?
    var color: String?

    /// "nhl:4", as the push server's widget endpoint takes it.
    var key: String { "\(league):\(id)" }
}

enum FollowedTeams {
    private static let key = "followedTeams"
    private static var defaults: UserDefaults? { UserDefaults(suiteName: TeamLogos.group) }

    static func load() -> [FollowedTeam] {
        guard let data = defaults?.data(forKey: key) else { return [] }
        return (try? JSONDecoder().decode([FollowedTeam].self, from: data)) ?? []
    }

    /// True when the list changed (the widgets then reload).
    @discardableResult
    static func save(_ teams: [FollowedTeam]) -> Bool {
        let encoder = JSONEncoder()
        encoder.outputFormatting = .sortedKeys
        guard let data = try? encoder.encode(teams), defaults?.data(forKey: key) != data else { return false }
        defaults?.set(data, forKey: key)
        return true
    }
}
