import SwiftUI
import WidgetKit

// The Home Screen and Lock Screen widgets' views (data in Widgets.swift).
// Team, look A: a band in the team's color with its logo, name and record,
// and the game under it on Phade's near-black (next game, live score, or the
// final). The Lock Screen versions are text only: iOS draws them in one tint
// over the wallpaper. My Teams: one row per game, away team left (soccer:
// home), the status between.

// MARK: - Shared pieces

/// The team band's colors: the team's own with white text, darkened a little
/// where white wouldn't read (4.5:1), or dark text on a light color.
enum TeamBandColors {
    static func of(_ hex: String?) -> (fill: Color, text: Color) {
        guard let rgb = Phade.rgb(hex) else { return (Phade.gray700, .white) }
        if contrastWithWhite(rgb) < 3 { return (color(rgb), Phade.background) }
        var darker = rgb
        for _ in 0..<8 where contrastWithWhite(darker) < 4.5 {
            darker = (darker.r * 0.94, darker.g * 0.94, darker.b * 0.94)
        }
        return (color(darker), .white)
    }

    private static func color(_ c: (r: Double, g: Double, b: Double)) -> Color {
        Color(red: c.r, green: c.g, blue: c.b)
    }

    private static func contrastWithWhite(_ c: (r: Double, g: Double, b: Double)) -> Double {
        func linear(_ v: Double) -> Double { v <= 0.03928 ? v / 12.92 : pow((v + 0.055) / 1.055, 2.4) }
        let luminance = 0.2126 * linear(c.r) + 0.7152 * linear(c.g) + 0.0722 * linear(c.b)
        return 1.05 / (luminance + 0.05)
    }
}

enum WidgetTime {
    /// "Tonight", "Today", "Tomorrow", "Sun", then "Oct 21".
    static func dayName(_ date: Date, now: Date) -> String {
        let calendar = Calendar.current
        if calendar.isDate(date, inSameDayAs: now) { return calendar.component(.hour, from: date) >= 17 ? "Tonight" : "Today" }
        if let tomorrow = calendar.date(byAdding: .day, value: 1, to: now), calendar.isDate(date, inSameDayAs: tomorrow) { return "Tomorrow" }
        if date < now.addingTimeInterval(6 * 86400) { return date.formatted(.dateTime.weekday(.abbreviated)) }
        return date.formatted(.dateTime.month(.abbreviated).day())
    }

    /// "7:00 PM", or TBD when the time isn't set.
    static func time(_ game: WidgetGame) -> String {
        game.timeTbd ? "TBD" : game.startDate.formatted(date: .omitted, time: .shortened)
    }

    /// "Tonight 7:00 PM".
    static func when(_ game: WidgetGame, now: Date) -> String {
        "\(dayName(game.startDate, now: now)) \(time(game))"
    }
}

enum WidgetText {
    /// "@ Senators", "vs Giants".
    static func matchup(_ game: WidgetGame) -> String {
        (game.home ? "vs " : "@ ") + game.opponent.name
    }

    /// The period alone ("2nd" from ESPN's "8:21 - 2nd").
    static func period(_ game: WidgetGame) -> String {
        game.status.components(separatedBy: " - ").last ?? game.status
    }

    static func finalLabel(_ game: WidgetGame) -> String {
        game.status.isEmpty ? "FINAL" : game.status.uppercased()
    }

    static func resultColor(_ result: String) -> Color {
        result == "W" ? Phade.mint : result == "L" ? Phade.live : Phade.gray400
    }

    /// "Live · 2nd • 8:21", "Final · W".
    static func status(_ game: WidgetGame) -> String {
        if game.isLive { return "Live · \(game.clock)" }
        return game.result.isEmpty ? "Final" : "Final · \(game.result)"
    }
}

enum WidgetBadge {
    /// A team's logo (saved by TeamLogos), else its color with its abbreviation.
    static func of(abbr: String, logo: String?, color: String?, size: CGFloat) -> TeamBadge {
        TeamBadge(team: GameAttributes.Team(abbr: abbr, name: abbr, color: color, logo: logo), size: size, glow: false)
    }
}

/// Who the Team widget is about: the server's data, else the followed team
/// as the web app handed it over.
struct TeamFace {
    let league: String
    let id: String
    let name: String
    let abbr: String
    let logo: String?
    let color: String?
    /// "3-1-0 · 2nd Metropolitan".
    let recordLine: String

    init?(_ entry: TeamEntry) {
        let followed = entry.followed
        if let team = entry.team {
            league = team.league
            id = team.id
            name = team.shortName ?? team.name ?? followed?.name ?? ""
            abbr = team.abbr ?? followed?.abbr ?? ""
            logo = team.logo.flatMap { $0.isEmpty ? nil : $0 } ?? followed?.logo
            color = team.color ?? followed?.color
            let standing = (team.standing ?? "").replacingOccurrences(of: " in ", with: " ")
            recordLine = [team.record ?? "", standing].filter { !$0.isEmpty }.joined(separator: " · ")
        } else if let followed {
            league = followed.league
            id = followed.id
            name = followed.name
            abbr = followed.abbr
            logo = followed.logo
            color = followed.color
            recordLine = ""
        } else {
            return nil
        }
    }
}

// MARK: - Team widget

@available(iOS 17.0, *)
struct TeamWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: TeamEntry

    var body: some View {
        content
            .widgetURL(url)
            .containerBackground(for: .widget) { family == .systemSmall ? Phade.background : Color.clear }
    }

    @ViewBuilder private var content: some View {
        switch family {
        case .accessoryInline: TeamInline(entry: entry)
        case .accessoryRectangular: TeamRectangular(entry: entry)
        case .accessoryCircular: TeamCircular(entry: entry)
        default: TeamSmall(entry: entry)
        }
    }

    /// The game page while it's on or final, else the team page.
    private var url: URL? {
        guard let face = TeamFace(entry) else { return nil }
        if let game = entry.team?.game(at: entry.date), game.isLive || game.isFinal {
            return URL(string: "phadescores://game/\(face.league)/\(game.id)")
        }
        return URL(string: "phadescores://team/\(face.league)/\(face.id)")
    }
}

struct TeamSmall: View {
    let entry: TeamEntry

    var body: some View {
        let face = TeamFace(entry)
        let band = TeamBandColors.of(face?.color)
        VStack(spacing: 0) {
            HStack(spacing: 9) {
                BandBadge(abbr: face?.abbr ?? "", logo: face?.logo, text: band.text)
                VStack(alignment: .leading, spacing: 1) {
                    Text(face?.name ?? "Phade Scores")
                        .font(.system(size: 16, weight: .bold))
                    if let line = face?.recordLine, !line.isEmpty {
                        Text(line)
                            .font(.system(size: 11, weight: .medium))
                    }
                }
                .lineLimit(1)
                .minimumScaleFactor(0.7)
                Spacer(minLength: 0)
            }
            .foregroundStyle(band.text)
            .padding(.horizontal, 14)
            .frame(maxWidth: .infinity, minHeight: 62, maxHeight: 62)
            .background(band.fill)

            GameArea(entry: entry)
                .padding(EdgeInsets(top: 10, leading: 14, bottom: 12, trailing: 14))
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
        .foregroundStyle(.white)
    }
}

/// The team's logo on its band, else its abbreviation in a soft circle.
struct BandBadge: View {
    let abbr: String
    let logo: String?
    let text: Color
    var size: CGFloat = 38

    var body: some View {
        if let image = TeamLogos.image(for: logo) {
            Image(uiImage: image)
                .resizable()
                .scaledToFit()
                .frame(width: size, height: size)
        } else {
            Circle()
                .fill(text.opacity(0.16))
                .frame(width: size, height: size)
                .overlay(
                    Text(abbr)
                        .font(.system(size: size * 0.3, weight: .heavy))
                        .foregroundStyle(text)
                        .lineLimit(1)
                        .minimumScaleFactor(0.5)
                        .padding(size * 0.08)
                )
        }
    }
}

/// Under the band: the game on, the final, or the next game.
struct GameArea: View {
    let entry: TeamEntry

    var body: some View {
        if let team = entry.team, let game = team.game(at: entry.date) {
            if game.isLive {
                LiveArea(game: game)
            } else if game.state == "post" {
                FinalArea(team: team, game: game, now: entry.date)
            } else {
                NextArea(game: game, now: entry.date)
            }
        } else {
            VStack(alignment: .leading, spacing: 4) {
                WidgetLabel(text: "PHADE SCORES", color: Phade.mint)
                Text(message)
                    .font(.system(size: 12))
                    .foregroundStyle(Phade.gray400)
            }
        }
    }

    private var message: String {
        switch entry.problem {
        case .noTeam: return "Follow a team in the app to see its games here."
        case .unavailable: return "Can't reach the scores right now."
        case nil: return "No games scheduled."
        }
    }
}

/// An uppercase 10pt label, as the app's section labels.
struct WidgetLabel: View {
    let text: String
    var color: Color = Phade.gray400

    var body: some View {
        Text(text)
            .font(.system(size: 10, weight: .semibold))
            .tracking(1)
            .foregroundStyle(color)
            .lineLimit(1)
            .minimumScaleFactor(0.7)
    }
}

struct NextArea: View {
    let game: WidgetGame
    let now: Date

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            WidgetLabel(text: "NEXT", color: Phade.mint)
            Spacer(minLength: 4)
            HStack(spacing: 8) {
                WidgetBadge.of(abbr: game.opponent.abbr, logo: game.opponent.logo, color: game.opponent.color, size: 26)
                VStack(alignment: .leading, spacing: 0) {
                    Text(WidgetText.matchup(game))
                        .font(.system(size: 15, weight: .bold))
                    Text(WidgetTime.when(game, now: now))
                        .font(.system(size: 11))
                        .foregroundStyle(Phade.gray400)
                }
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            }
            Spacer(minLength: 4)
            if game.timeTbd || game.startDate.timeIntervalSince(now) > 24 * 3600 {
                Text(game.broadcast)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(Phade.gray400)
                    .lineLimit(1)
            } else if game.startDate > now {
                Text("in \(game.startDate, style: .relative)")
                    .font(.system(size: 12, weight: .semibold))
                    .lineLimit(1)
            } else {
                Text("Starting soon")
                    .font(.system(size: 12, weight: .semibold))
            }
        }
    }
}

struct LiveArea: View {
    let game: WidgetGame

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 5) {
                Circle().fill(Phade.live).frame(width: 6, height: 6)
                WidgetLabel(text: "LIVE · \(game.clock)", color: Phade.live)
            }
            Spacer(minLength: 2)
            ScoreLine(game: game)
            Spacer(minLength: 2)
            Text(WidgetText.matchup(game))
                .font(.system(size: 11))
                .foregroundStyle(Phade.gray400)
                .lineLimit(1)
        }
    }
}

struct FinalArea: View {
    let team: WidgetTeam
    let game: WidgetGame
    let now: Date

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 0) {
                WidgetLabel(text: WidgetText.finalLabel(game))
                if !game.result.isEmpty {
                    WidgetLabel(text: " · ")
                    WidgetLabel(text: game.result, color: WidgetText.resultColor(game.result))
                }
            }
            Spacer(minLength: 2)
            ScoreLine(game: game)
            Spacer(minLength: 2)
            Text(footer)
                .font(.system(size: 11))
                .foregroundStyle(Phade.gray400)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
    }

    private var footer: String {
        guard let next = team.next else { return WidgetText.matchup(game) }
        return "\(WidgetText.matchup(game)) · Next: \(WidgetTime.dayName(next.startDate, now: now))"
    }
}

/// The team's score, then the opponent's (the loser in gray), and the
/// opponent's logo.
struct ScoreLine: View {
    let game: WidgetGame

    var body: some View {
        HStack(alignment: .center, spacing: 0) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(game.score.isEmpty ? "–" : game.score)
                    .font(.system(size: 32, weight: .heavy))
                    .foregroundStyle(game.result == "L" ? Phade.gray400 : .white)
                Text("-")
                    .font(.system(size: 18, weight: .medium))
                    .foregroundStyle(Phade.gray500)
                Text(game.oppScore.isEmpty ? "–" : game.oppScore)
                    .font(.system(size: 32, weight: .heavy))
                    .foregroundStyle(game.result == "L" ? .white : Phade.gray400)
            }
            .monospacedDigit()
            .lineLimit(1)
            .minimumScaleFactor(0.6)
            Spacer(minLength: 4)
            WidgetBadge.of(abbr: game.opponent.abbr, logo: game.opponent.logo, color: game.opponent.color, size: 26)
        }
    }
}

// MARK: Lock Screen

struct TeamInline: View {
    let entry: TeamEntry

    var body: some View {
        Text(line)
    }

    private var line: String {
        guard let face = TeamFace(entry), let game = entry.team?.game(at: entry.date) else { return "Phade Scores" }
        let score = "\(face.abbr) \(game.score)-\(game.oppScore) \(game.opponent.abbr)"
        if game.isLive { return "\(score) · \(WidgetText.period(game))" }
        if game.state == "post" { return "Final: \(score)" }
        return "\(face.name) \(game.home ? "vs" : "@") \(game.opponent.abbr) · \(WidgetTime.when(game, now: entry.date))"
    }
}

struct TeamRectangular: View {
    let entry: TeamEntry

    var body: some View {
        if let face = TeamFace(entry), let game = entry.team?.game(at: entry.date) {
            if game.state == "pre" {
                VStack(alignment: .leading, spacing: 0) {
                    Text(face.name + (game.home ? " vs " : " @ ") + game.opponent.abbr)
                        .font(.system(size: 15, weight: .bold))
                    Text(WidgetTime.when(game, now: entry.date))
                        .font(.system(size: 14, weight: .medium))
                    if !game.timeTbd, game.startDate > entry.date, game.startDate.timeIntervalSince(entry.date) < 24 * 3600 {
                        Text("in \(game.startDate, style: .relative)")
                            .font(.system(size: 13))
                            .foregroundStyle(.secondary)
                    }
                }
                .lineLimit(1)
                .minimumScaleFactor(0.7)
                .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                VStack(alignment: .leading, spacing: 0) {
                    HStack {
                        Text(face.abbr)
                        Spacer(minLength: 4)
                        Text(game.score)
                    }
                    .font(.system(size: 15, weight: .bold))
                    HStack {
                        Text(game.opponent.abbr)
                        Spacer(minLength: 4)
                        Text(game.oppScore)
                    }
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(.secondary)
                    Text(WidgetText.status(game))
                        .font(.system(size: 13, weight: .medium))
                }
                .monospacedDigit()
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            }
        } else {
            VStack(alignment: .leading, spacing: 0) {
                Text("Phade Scores").font(.system(size: 15, weight: .bold))
                Text(entry.problem == .noTeam ? "Follow a team in the app." : "No game to show.")
                    .font(.system(size: 13))
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

struct TeamCircular: View {
    let entry: TeamEntry

    var body: some View {
        ZStack {
            AccessoryWidgetBackground()
            VStack(spacing: 0) {
                Text(top).font(.system(size: 11, weight: .bold))
                Text(middle).font(.system(size: 17, weight: .heavy)).monospacedDigit()
                Text(bottom).font(.system(size: 9, weight: .medium))
            }
            .lineLimit(1)
            .minimumScaleFactor(0.5)
            .padding(5)
        }
    }

    private var game: WidgetGame? { entry.team?.game(at: entry.date) }
    private var top: String { TeamFace(entry)?.abbr ?? "" }

    private var middle: String {
        guard let game else { return "–" }
        return game.state == "pre" ? WidgetTime.time(game) : "\(game.score)-\(game.oppScore)"
    }

    private var bottom: String {
        guard let game else { return "" }
        if game.isLive { return WidgetText.period(game) }
        if game.state == "post" { return "Final" }
        return WidgetTime.dayName(game.startDate, now: entry.date)
    }
}

// MARK: - My Teams widget

/// One game in My Teams: the two sides, away left (soccer: home left).
struct GameRow: Identifiable {
    struct Side {
        let abbr: String
        let logo: String?
        let color: String?
        let score: String
        let record: String
        /// The side that lost a final.
        let dim: Bool
    }

    let id: String
    let league: String
    let game: WidgetGame
    let left: Side
    let right: Side

    init(team: WidgetTeam, game: WidgetGame) {
        let ours = Side(abbr: team.abbr ?? "", logo: team.logo, color: team.color, score: game.score,
                        record: team.record ?? "", dim: game.result == "L")
        let theirs = Side(abbr: game.opponent.abbr, logo: game.opponent.logo, color: game.opponent.color, score: game.oppScore,
                          record: game.opponent.record, dim: game.result == "W")
        let home = game.home ? ours : theirs
        let away = game.home ? theirs : ours
        let homeFirst = team.homeFirst ?? false
        id = game.id
        league = team.league
        self.game = game
        left = homeFirst ? home : away
        right = homeFirst ? away : home
    }

    var url: URL? { URL(string: "phadescores://game/\(league)/\(game.id)") }

    /// Not today and not started: "Coming up".
    func isLater(_ now: Date) -> Bool {
        game.state == "pre" && !Calendar.current.isDate(game.startDate, inSameDayAs: now)
    }

    /// Each followed team's game (a game between two of them once): live
    /// first, then today's and the latest finals, then later games, each by
    /// start time.
    static func rows(_ teams: [WidgetTeam], at now: Date) -> [GameRow] {
        var seen = Set<String>()
        var rows: [GameRow] = []
        for team in teams {
            guard let game = team.game(at: now), seen.insert(game.id).inserted else { continue }
            rows.append(GameRow(team: team, game: game))
        }
        func rank(_ row: GameRow) -> Int { row.game.isLive ? 0 : row.isLater(now) ? 2 : 1 }
        return rows.sorted { a, b in rank(a) != rank(b) ? rank(a) < rank(b) : a.game.start < b.game.start }
    }
}

@available(iOS 17.0, *)
struct MyTeamsView: View {
    @Environment(\.widgetFamily) private var family
    let entry: MyTeamsEntry

    var body: some View {
        let rows = GameRow.rows(entry.teams, at: entry.date)
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                WidgetLabel(text: "MY TEAMS", color: Phade.mint)
                Spacer()
                Text(entry.date.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day()))
                    .font(.system(size: 10))
                    .foregroundStyle(Phade.gray400)
            }
            .padding(.bottom, 4)
            if rows.isEmpty {
                Spacer()
                Text(emptyText)
                    .font(.system(size: 13))
                    .foregroundStyle(Phade.gray400)
                Spacer()
            } else if family == .systemLarge {
                LargeRows(rows: Array(rows.prefix(6)), now: entry.date)
                Spacer(minLength: 0)
                if let updated = entry.updated {
                    Text("Updated \(updated, style: .time)")
                        .font(.system(size: 9))
                        .foregroundStyle(Phade.gray500)
                        .frame(maxWidth: .infinity, alignment: .trailing)
                }
            } else {
                ForEach(Array(rows.prefix(3).enumerated()), id: \.element.id) { index, row in
                    if index > 0 { Rectangle().fill(Phade.gray700.opacity(0.6)).frame(height: 0.5) }
                    GameRowView(row: row, now: entry.date)
                        .frame(maxHeight: .infinity)
                }
            }
        }
        .foregroundStyle(.white)
        .containerBackground(for: .widget) {
            LinearGradient(colors: [Color(red: 24 / 255, green: 24 / 255, blue: 27 / 255), Phade.background], startPoint: .top, endPoint: .bottom)
        }
    }

    private var emptyText: String {
        if entry.followed.isEmpty { return "Follow teams in Phade Scores to see their games here." }
        if entry.teams.isEmpty { return "Can't reach the scores right now." }
        return "No games coming up."
    }
}

struct LargeRows: View {
    let rows: [GameRow]
    let now: Date

    var body: some View {
        let current = rows.filter { !$0.isLater(now) }
        let later = rows.filter { $0.isLater(now) }
        VStack(alignment: .leading, spacing: 0) {
            ForEach(current) { row in
                GameRowView(row: row, now: now).padding(.vertical, 7)
            }
            if !later.isEmpty {
                WidgetLabel(text: "COMING UP")
                    .padding(.top, current.isEmpty ? 2 : 10)
                    .padding(.bottom, 2)
                ForEach(later) { row in
                    GameRowView(row: row, now: now).padding(.vertical, 7)
                }
            }
        }
    }
}

struct GameRowView: View {
    let row: GameRow
    let now: Date

    var body: some View {
        if let url = row.url {
            Link(destination: url) { line }
        } else {
            line
        }
    }

    private var line: some View {
        HStack(spacing: 6) {
            SideView(side: row.left, played: row.game.state != "pre", trailing: false)
            RowStatus(game: row.game, now: now)
                .frame(width: 74)
            SideView(side: row.right, played: row.game.state != "pre", trailing: true)
        }
    }
}

struct SideView: View {
    let side: GameRow.Side
    let played: Bool
    let trailing: Bool

    var body: some View {
        HStack(spacing: 6) {
            if trailing {
                value
                Spacer(minLength: 0)
                abbr
                WidgetBadge.of(abbr: side.abbr, logo: side.logo, color: side.color, size: 22)
            } else {
                WidgetBadge.of(abbr: side.abbr, logo: side.logo, color: side.color, size: 22)
                abbr
                Spacer(minLength: 0)
                value
            }
        }
        .frame(maxWidth: .infinity)
    }

    private var abbr: some View {
        Text(side.abbr)
            .font(.system(size: 13, weight: .bold))
            .foregroundStyle(side.dim ? Phade.gray400 : .white)
            .lineLimit(1)
            .minimumScaleFactor(0.7)
    }

    @ViewBuilder private var value: some View {
        if played {
            Text(side.score)
                .font(.system(size: 17, weight: .heavy))
                .monospacedDigit()
                .foregroundStyle(side.dim ? Phade.gray400 : .white)
        } else {
            Text(side.record)
                .font(.system(size: 11))
                .foregroundStyle(Phade.gray400)
                .lineLimit(1)
        }
    }
}

struct RowStatus: View {
    let game: WidgetGame
    let now: Date

    var body: some View {
        if game.isLive {
            HStack(spacing: 4) {
                Circle().fill(Phade.live).frame(width: 5, height: 5)
                Text(game.clock)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(Phade.live)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
            }
        } else if game.state == "post" {
            Text(WidgetText.finalLabel(game))
                .font(.system(size: 9, weight: .bold))
                .tracking(0.6)
                .foregroundStyle(Color(white: 0.83))
                .lineLimit(1)
                .minimumScaleFactor(0.7)
                .padding(.horizontal, 7)
                .padding(.vertical, 2)
                .background(Capsule().fill(Phade.gray400.opacity(0.16)))
        } else if Calendar.current.isDate(game.startDate, inSameDayAs: now) {
            Text(WidgetTime.time(game))
                .font(.system(size: 12, weight: .semibold))
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        } else {
            VStack(spacing: 0) {
                Text(WidgetTime.dayName(game.startDate, now: now))
                    .font(.system(size: 10))
                    .foregroundStyle(Phade.gray400)
                Text(WidgetTime.time(game))
                    .font(.system(size: 12, weight: .semibold))
            }
            .lineLimit(1)
            .minimumScaleFactor(0.7)
        }
    }
}
