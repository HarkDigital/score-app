import AppIntents
import SwiftUI
import WidgetKit

// The Home Screen and Lock Screen widgets (iOS 17 on): Team, one followed
// team's game (its next one, the score while it plays, then the final), and
// My Teams, the games of every followed team. Their data comes from the push
// server's GET /v1/widget (server/widget.js), never from ESPN directly; the
// followed teams from the App Group (FollowedTeams, handed over by the web
// app). Views are in WidgetViews.swift.

// MARK: - The push server's answer

struct WidgetGame: Codable, Hashable {
    let id: String
    /// Seconds since 1970.
    let start: Double
    let timeTbd: Bool
    /// "pre", "in" or "post".
    let state: String
    /// Played to the end (not postponed or canceled): the server's "final".
    let isFinal: Bool
    /// ESPN's short status: "8:21 - 2nd", "Bot 7th", "Final/OT".
    let status: String
    /// The followed team plays at home.
    let home: Bool
    /// The followed team's score and the opponent's; empty before the start.
    let score: String
    let oppScore: String
    /// "W", "L", "T", or empty until it's final.
    let result: String
    let opponent: WidgetOpponent
    let broadcast: String

    enum CodingKeys: String, CodingKey {
        case id, start, timeTbd, state, isFinal = "final", status, home, score, oppScore, result, opponent, broadcast
    }

    var startDate: Date { Date(timeIntervalSince1970: start) }
    var isLive: Bool { state == "in" }
    /// "2nd • 8:21", as the Lock Screen card reads ESPN's "8:21 - 2nd".
    var clock: String {
        let parts = status.components(separatedBy: " - ")
        return parts.count == 2 ? "\(parts[1]) • \(parts[0])" : status
    }
}

struct WidgetOpponent: Codable, Hashable {
    let id: String
    let abbr: String
    let name: String
    let logo: String?
    let color: String?
    let record: String
}

struct WidgetTeam: Codable, Hashable {
    let league: String
    let id: String
    let name: String?
    let shortName: String?
    let abbr: String?
    let logo: String?
    let color: String?
    let record: String?
    let standing: String?
    let homeFirst: Bool?
    /// Which game to show ("live", "last", "next") and, for the last
    /// result, until when (seconds since 1970).
    let show: String?
    let showUntil: Double?
    let live: WidgetGame?
    let last: WidgetGame?
    let next: WidgetGame?
    let error: String?

    var key: String { "\(league):\(id)" }

    /// The game to show at a moment: the game on, else the last result until
    /// showUntil, else the next game (server/widget.js pickShow).
    func game(at date: Date) -> WidgetGame? {
        if let live { return live }
        if show == "last", let last, showUntil.map({ date.timeIntervalSince1970 < $0 }) ?? true { return last }
        return next ?? last
    }
}

private struct WidgetPayload: Codable {
    let updatedAt: Double
    let teams: [WidgetTeam]
}

// MARK: - Fetching, with the last answer kept

enum WidgetFeed {
    static let base: URL = {
        let configured = Bundle.main.object(forInfoDictionaryKey: "ScoresPushServer") as? String
        return URL(string: configured ?? "") ?? URL(string: "https://scores.phade.app")!
    }()

    private struct Kept: Codable {
        let team: WidgetTeam
        let at: Double
    }

    private static let keptKey = "widgetTeams"
    private static var defaults: UserDefaults? { UserDefaults(suiteName: TeamLogos.group) }

    /// The teams' widget data by key ("nhl:4"): fresh from the push server,
    /// else the copy kept from the last answer (under 12 hours old), so a
    /// widget that loses the network for a while still shows something. Also
    /// saves the logos the widgets will draw.
    static func load(_ followed: [FollowedTeam]) async -> (teams: [String: WidgetTeam], updated: Date?) {
        var kept = keptTeams()
        let now = Date().timeIntervalSince1970
        if let fresh = await fetch(followed) {
            for team in fresh where team.error == nil { kept[team.key] = Kept(team: team, at: now) }
            // Teams nobody has asked about for two days go.
            kept = kept.filter { now - $0.value.at < 2 * 86400 }
            if let data = try? JSONEncoder().encode(kept) { defaults?.set(data, forKey: keptKey) }
        }
        let wanted = Set(followed.map(\.key))
        let usable = kept.filter { wanted.contains($0.key) && now - $0.value.at < 12 * 3600 }
        let teams = usable.mapValues(\.team)
        await TeamLogos.fetch(logos(Array(teams.values)) + followed.map(\.logo))
        return (teams, usable.values.map(\.at).max().map(Date.init(timeIntervalSince1970:)))
    }

    private static func keptTeams() -> [String: Kept] {
        guard let data = defaults?.data(forKey: keptKey) else { return [:] }
        return (try? JSONDecoder().decode([String: Kept].self, from: data)) ?? [:]
    }

    private static func fetch(_ followed: [FollowedTeam]) async -> [WidgetTeam]? {
        guard !followed.isEmpty,
              var parts = URLComponents(url: base.appendingPathComponent("v1/widget"), resolvingAgainstBaseURL: false) else { return nil }
        parts.queryItems = [URLQueryItem(name: "teams", value: followed.prefix(12).map(\.key).joined(separator: ","))]
        guard let url = parts.url else { return nil }
        var request = URLRequest(url: url)
        request.timeoutInterval = 10
        guard let (data, response) = try? await URLSession.shared.data(for: request),
              (response as? HTTPURLResponse)?.statusCode == 200,
              let payload = try? JSONDecoder().decode(WidgetPayload.self, from: data) else { return nil }
        return payload.teams
    }

    /// Every logo a widget may draw: the teams' and their opponents'.
    static func logos(_ teams: [WidgetTeam]) -> [String?] {
        teams.flatMap { team in [team.logo] + [team.live, team.last, team.next].map { $0?.opponent.logo } }
    }

    /// When to ask again. Apple allows each widget a few dozen reloads a day,
    /// so: every 10 minutes while a game is on (and when one is past its
    /// start but not marked live yet), just after the next start, when a
    /// final gives way to the next game, else in 4 hours.
    static func nextReload(_ teams: [WidgetTeam], now: Date = Date()) -> Date {
        let soon = now.addingTimeInterval(10 * 60)
        var candidates = [now.addingTimeInterval(4 * 3600)]
        for team in teams {
            if team.live != nil { return soon }
            if let next = team.next {
                candidates.append(next.startDate <= now ? soon : next.startDate.addingTimeInterval(60))
            }
            if let until = team.showUntil { candidates.append(Date(timeIntervalSince1970: until)) }
        }
        let soonest = candidates.filter { $0 > now }.min() ?? now.addingTimeInterval(4 * 3600)
        return max(soonest, now.addingTimeInterval(5 * 60))
    }

    /// The moments the shown game changes without a reload (a final giving
    /// way to the next game), so the widget turns over on time.
    static func turnovers(_ teams: [WidgetTeam], now: Date = Date()) -> [Date] {
        let horizon = now.addingTimeInterval(24 * 3600)
        let dates = teams.compactMap { $0.live == nil ? $0.showUntil.map(Date.init(timeIntervalSince1970:)) : nil }
        return Array(Set(dates.filter { $0 > now && $0 < horizon })).sorted()
    }
}

// MARK: - Team widget

enum WidgetProblem {
    /// No team followed yet (or picked).
    case noTeam
    /// No answer from the server, and nothing kept.
    case unavailable
}

struct TeamEntry: TimelineEntry {
    let date: Date
    let followed: FollowedTeam?
    let team: WidgetTeam?
    let problem: WidgetProblem?

    func at(_ date: Date) -> TeamEntry { TeamEntry(date: date, followed: followed, team: team, problem: problem) }
}

/// A followed team in the Team widget's picker.
@available(iOS 17.0, *)
struct TeamChoice: AppEntity {
    /// "nhl:4".
    let id: String
    let name: String

    static let typeDisplayRepresentation: TypeDisplayRepresentation = "Team"
    static let defaultQuery = TeamChoiceQuery()
    var displayRepresentation: DisplayRepresentation { DisplayRepresentation(title: "\(name)") }

    init(_ team: FollowedTeam) {
        id = team.key
        name = team.name.isEmpty ? team.abbr : team.name
    }
}

@available(iOS 17.0, *)
struct TeamChoiceQuery: EntityQuery {
    func entities(for identifiers: [String]) async throws -> [TeamChoice] {
        FollowedTeams.load().map(TeamChoice.init).filter { identifiers.contains($0.id) }
    }

    func suggestedEntities() async throws -> [TeamChoice] {
        FollowedTeams.load().map(TeamChoice.init)
    }

    func defaultResult() async -> TeamChoice? {
        FollowedTeams.load().first.map(TeamChoice.init)
    }
}

@available(iOS 17.0, *)
struct TeamWidgetIntent: WidgetConfigurationIntent {
    static let title: LocalizedStringResource = "Team"
    static let description = IntentDescription("One of the teams you follow.")

    @Parameter(title: "Team")
    var team: TeamChoice?
}

@available(iOS 17.0, *)
struct TeamProvider: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> TeamEntry { WidgetSamples.teamEntry }

    func snapshot(for configuration: TeamWidgetIntent, in context: Context) async -> TeamEntry {
        if context.isPreview { return WidgetSamples.teamEntry }
        return await entry(for: configuration, now: Date())
    }

    func timeline(for configuration: TeamWidgetIntent, in context: Context) async -> Timeline<TeamEntry> {
        let now = Date()
        let first = await entry(for: configuration, now: now)
        guard let team = first.team else {
            // Nothing to show: try again in 15 minutes (a new follow reloads
            // every widget at once anyway).
            return Timeline(entries: [first], policy: first.problem == .noTeam ? .never : .after(now.addingTimeInterval(15 * 60)))
        }
        let entries = [first] + WidgetFeed.turnovers([team], now: now).map(first.at)
        return Timeline(entries: entries, policy: .after(WidgetFeed.nextReload([team], now: now)))
    }

    private func entry(for configuration: TeamWidgetIntent, now: Date) async -> TeamEntry {
        let followed = FollowedTeams.load()
        // The team picked (still shown if it's since been unfollowed), else
        // the first one followed.
        let picked = configuration.team.map { choice in
            followed.first { $0.key == choice.id } ?? FollowedTeam(choice: choice)
        }
        guard let team = picked ?? followed.first else {
            return TeamEntry(date: now, followed: nil, team: nil, problem: .noTeam)
        }
        let data = await WidgetFeed.load([team])
        let current = data.teams[team.key]
        return TeamEntry(date: now, followed: team, team: current, problem: current == nil ? .unavailable : nil)
    }
}

@available(iOS 17.0, *)
private extension FollowedTeam {
    init(choice: TeamChoice) {
        let parts = choice.id.split(separator: ":", maxSplits: 1).map(String.init)
        self.init(league: parts.first ?? "", id: parts.count > 1 ? parts[1] : "", name: choice.name, abbr: "", logo: nil, color: nil)
    }
}

@available(iOS 17.0, *)
struct TeamWidget: Widget {
    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: "team", intent: TeamWidgetIntent.self, provider: TeamProvider()) { entry in
            TeamWidgetView(entry: entry)
        }
        .configurationDisplayName("Team")
        .description("A team you follow: its next game, the score while it plays, then the final.")
        .supportedFamilies([.systemSmall, .accessoryRectangular, .accessoryCircular, .accessoryInline])
        // The team's color runs to the widget's edges.
        .contentMarginsDisabled()
    }
}

// MARK: - My Teams widget

struct MyTeamsEntry: TimelineEntry {
    let date: Date
    let followed: [FollowedTeam]
    let teams: [WidgetTeam]
    let updated: Date?

    func at(_ date: Date) -> MyTeamsEntry { MyTeamsEntry(date: date, followed: followed, teams: teams, updated: updated) }
}

@available(iOS 17.0, *)
struct MyTeamsProvider: TimelineProvider {
    func placeholder(in context: Context) -> MyTeamsEntry { WidgetSamples.myTeamsEntry }

    func getSnapshot(in context: Context, completion: @escaping (MyTeamsEntry) -> Void) {
        if context.isPreview {
            completion(WidgetSamples.myTeamsEntry)
            return
        }
        Task { completion(await Self.entry(now: Date())) }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<MyTeamsEntry>) -> Void) {
        Task {
            let now = Date()
            let first = await Self.entry(now: now)
            if first.followed.isEmpty {
                completion(Timeline(entries: [first], policy: .never))
                return
            }
            let entries = [first] + WidgetFeed.turnovers(first.teams, now: now).map(first.at)
            let reload = first.teams.isEmpty ? now.addingTimeInterval(15 * 60) : WidgetFeed.nextReload(first.teams, now: now)
            completion(Timeline(entries: entries, policy: .after(reload)))
        }
    }

    private static func entry(now: Date) async -> MyTeamsEntry {
        let followed = FollowedTeams.load()
        guard !followed.isEmpty else { return MyTeamsEntry(date: now, followed: [], teams: [], updated: nil) }
        let data = await WidgetFeed.load(followed)
        // In the order they were followed; the rows sort themselves.
        let teams = followed.compactMap { data.teams[$0.key] }
        return MyTeamsEntry(date: now, followed: followed, teams: teams, updated: data.updated)
    }
}

@available(iOS 17.0, *)
struct MyTeamsWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "myTeams", provider: MyTeamsProvider()) { entry in
            MyTeamsView(entry: entry)
        }
        .configurationDisplayName("My Teams")
        .description("Your teams' games: live scores, finals, and what's next.")
        .supportedFamilies([.systemMedium, .systemLarge])
    }
}

// MARK: - Samples (the widget gallery and placeholders)

enum WidgetSamples {
    private static let start = Date().addingTimeInterval(2 * 3600 + 14 * 60).timeIntervalSince1970

    static let flyers = WidgetTeam(
        league: "nhl", id: "15", name: "Philadelphia Flyers", shortName: "Flyers", abbr: "PHI", logo: nil, color: "#f74902",
        record: "3-1-0", standing: "2nd in Metropolitan", homeFirst: false, show: "next", showUntil: nil, live: nil, last: nil,
        next: WidgetGame(
            id: "sample-1", start: start, timeTbd: false, state: "pre", isFinal: false, status: "7:00 PM", home: false,
            score: "", oppScore: "", result: "",
            opponent: WidgetOpponent(id: "14", abbr: "OTT", name: "Senators", logo: nil, color: "#c52032", record: "2-2-0"),
            broadcast: ""
        ),
        error: nil
    )

    static let eagles = WidgetTeam(
        league: "nfl", id: "21", name: "Philadelphia Eagles", shortName: "Eagles", abbr: "PHI", logo: nil, color: "#004c54",
        record: "4-1", standing: "1st in NFC East", homeFirst: false, show: "live", showUntil: nil,
        live: WidgetGame(
            id: "sample-2", start: Date().addingTimeInterval(-3600).timeIntervalSince1970, timeTbd: false, state: "in", isFinal: false,
            status: "4:12 - 3rd", home: false, score: "17", oppScore: "21", result: "",
            opponent: WidgetOpponent(id: "19", abbr: "NYG", name: "Giants", logo: nil, color: "#0b2265", record: "2-3"),
            broadcast: ""
        ),
        last: nil, next: nil, error: nil
    )

    static var teamEntry: TeamEntry {
        TeamEntry(date: Date(), followed: nil, team: flyers, problem: nil)
    }

    static var myTeamsEntry: MyTeamsEntry {
        MyTeamsEntry(date: Date(), followed: [], teams: [eagles, flyers], updated: Date())
    }
}
