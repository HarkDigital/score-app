import ActivityKit
import SwiftUI
import WidgetKit

// The Lock Screen card and Dynamic Island for one game, in Phade's look:
// near-black, mint accent, the red live dot, team logos (from the files
// logos the app saved, falling back to Phade's team-color badges), tabular
// numbers. Tapping opens the game page in the app.

@main
struct LiveGameBundle: WidgetBundle {
    var body: some Widget {
        LiveGameActivity()
    }
}

struct LiveGameActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: GameAttributes.self) { context in
            LockScreenView(game: Game(context.attributes, context.state))
                .activityBackgroundTint(Phade.background)
                .activitySystemActionForegroundColor(.white)
                .widgetURL(context.attributes.url)
        } dynamicIsland: { context in
            let game = Game(context.attributes, context.state)
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    IslandSide(team: game.left, score: game.leftScore, dim: game.leftLost, trailing: false)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    IslandSide(team: game.right, score: game.rightScore, dim: game.rightLost, trailing: true)
                }
                DynamicIslandExpandedRegion(.center) {
                    StatusLabel(game: game).font(.caption.weight(.semibold))
                }
                DynamicIslandExpandedRegion(.bottom) {
                    if !game.detail.isEmpty {
                        Text(game.detail)
                            .font(.caption2)
                            .foregroundStyle(Phade.gray400)
                            .lineLimit(1)
                    }
                }
            } compactLeading: {
                CompactSide(team: game.left, score: game.started ? game.leftScore : nil)
            } compactTrailing: {
                if game.started {
                    CompactSide(team: game.right, score: game.rightScore, trailing: true)
                } else {
                    Text(game.start, style: .time)
                        .font(.caption2.weight(.semibold))
                        .monospacedDigit()
                        .foregroundStyle(Phade.mint)
                }
            } minimal: {
                if game.started {
                    Text("\(game.leftScore)-\(game.rightScore)")
                        .font(.caption2.weight(.bold))
                        .monospacedDigit()
                        .minimumScaleFactor(0.6)
                        .foregroundStyle(game.live ? .white : Phade.gray400)
                } else {
                    TeamBadge(team: game.left, size: 22)
                }
            }
            .widgetURL(context.attributes.url)
            .keylineTint(Phade.mint)
        }
    }
}

// MARK: - The game, laid out as the app shows it

/// Left and right as the scoreboard reads: away @ home, or home vs away for soccer.
struct Game {
    let league: String
    let start: Date
    let left: GameAttributes.Team
    let right: GameAttributes.Team
    let leftScore: String
    let rightScore: String
    let state: String
    let status: String
    let detail: String
    let homeFirst: Bool

    init(_ a: GameAttributes, _ s: GameAttributes.ContentState) {
        league = a.leagueLabel
        start = a.start
        homeFirst = a.homeFirst
        left = a.homeFirst ? a.home : a.away
        right = a.homeFirst ? a.away : a.home
        leftScore = a.homeFirst ? s.home : s.away
        rightScore = a.homeFirst ? s.away : s.home
        state = s.state
        status = s.status
        detail = s.detail
    }

    var live: Bool { state == "in" }
    var final: Bool { state == "post" }
    var started: Bool { state != "pre" && !(leftScore.isEmpty && rightScore.isEmpty) }
    var separator: String { homeFirst ? "vs" : "@" }

    private var decided: (Int, Int)? {
        guard final, let l = Int(leftScore), let r = Int(rightScore), l != r else { return nil }
        return (l, r)
    }
    var leftLost: Bool { decided.map { $0.0 < $0.1 } ?? false }
    var rightLost: Bool { decided.map { $0.1 < $0.0 } ?? false }
}

// MARK: - Lock Screen

struct LockScreenView: View {
    let game: Game

    var body: some View {
        VStack(spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Text(game.league.uppercased())
                    .font(.caption2.weight(.bold))
                    .tracking(1.2)
                    .foregroundStyle(Phade.mint)
                Spacer(minLength: 8)
                StatusLabel(game: game).font(.caption.weight(.semibold))
            }
            HStack(alignment: .center, spacing: 12) {
                TeamColumn(team: game.left, dim: game.leftLost)
                Spacer(minLength: 4)
                if game.started {
                    HStack(spacing: 10) {
                        ScoreText(score: game.leftScore, dim: game.leftLost)
                        Text("-").font(.title2).foregroundStyle(Phade.gray500)
                        ScoreText(score: game.rightScore, dim: game.rightLost)
                    }
                } else {
                    VStack(spacing: 2) {
                        Text(game.separator)
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(Phade.gray500)
                        Text(game.start, style: .time)
                            .font(.title3.weight(.bold))
                            .monospacedDigit()
                            .foregroundStyle(.white)
                    }
                }
                Spacer(minLength: 4)
                TeamColumn(team: game.right, dim: game.rightLost)
            }
            if !game.detail.isEmpty {
                Text(game.detail)
                    .font(.caption)
                    .foregroundStyle(Phade.gray400)
                    .lineLimit(1)
            }
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 14)
    }
}

struct TeamColumn: View {
    let team: GameAttributes.Team
    var dim = false

    var body: some View {
        VStack(spacing: 6) {
            TeamBadge(team: team, size: 40)
            Text(team.name)
                .font(.caption.weight(.semibold))
                .foregroundStyle(dim ? Phade.gray400 : .white)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        .frame(width: 84)
        .opacity(dim ? 0.75 : 1)
    }
}

struct ScoreText: View {
    let score: String
    var dim = false

    var body: some View {
        Text(score)
            .font(.system(size: 34, weight: .bold))
            .monospacedDigit()
            .foregroundStyle(dim ? Phade.gray500 : .white)
            .lineLimit(1)
            .minimumScaleFactor(0.6)
    }
}

/// "● LIVE  4:32 - 3rd", "Final", the start time, or ESPN's own word for
/// trouble ("Delayed").
struct StatusLabel: View {
    let game: Game

    var body: some View {
        if game.live {
            HStack(spacing: 6) {
                Circle().fill(Phade.live).frame(width: 7, height: 7)
                Text("LIVE").foregroundStyle(Phade.live).tracking(0.8)
                if !game.status.isEmpty {
                    Text(game.status).foregroundStyle(.white).monospacedDigit()
                }
            }
            .lineLimit(1)
        } else if game.final {
            Text(game.status.isEmpty ? "Final" : game.status).foregroundStyle(Phade.gray400)
        } else if !game.status.isEmpty {
            Text(game.status).foregroundStyle(Phade.amber).lineLimit(1)
        } else {
            Text(game.start, format: .dateTime.weekday(.abbreviated).hour().minute())
                .foregroundStyle(Phade.gray400)
                .monospacedDigit()
        }
    }
}

// MARK: - Dynamic Island

struct IslandSide: View {
    let team: GameAttributes.Team
    let score: String
    var dim = false
    var trailing = false

    var body: some View {
        HStack(spacing: 8) {
            if trailing { scoreText }
            TeamBadge(team: team, size: 34)
            if !trailing { scoreText }
        }
        .padding(.horizontal, 4)
    }

    private var scoreText: some View {
        Text(score.isEmpty ? " " : score)
            .font(.system(size: 26, weight: .bold))
            .monospacedDigit()
            .foregroundStyle(dim ? Phade.gray500 : .white)
            .minimumScaleFactor(0.6)
    }
}

struct CompactSide: View {
    let team: GameAttributes.Team
    let score: String?
    var trailing = false

    var body: some View {
        HStack(spacing: 5) {
            if trailing, let score { Text(score).font(.caption.weight(.bold)).monospacedDigit() }
            TeamBadge(team: team, size: 20)
            if !trailing, let score { Text(score).font(.caption.weight(.bold)).monospacedDigit() }
        }
        .foregroundStyle(.white)
    }
}

// MARK: - Phade pieces

/// The team's logo, saved by the app (TeamLogos); without one, Phade's
/// TeamLogo fallback: the team's color with its abbreviation.
struct TeamBadge: View {
    let team: GameAttributes.Team
    var size: CGFloat = 36

    var body: some View {
        if let logo = TeamLogos.image(for: team.logo) {
            Image(uiImage: logo)
                .resizable()
                .scaledToFit()
                .frame(width: size, height: size)
        } else {
            fallback
        }
    }

    private var fallback: some View {
        let hex = Phade.rgb(team.color)
        return Circle()
            .fill(hex.map { Color(red: $0.r, green: $0.g, blue: $0.b) } ?? Phade.gray700)
            .frame(width: size, height: size)
            .overlay(
                Text(team.abbr)
                    .font(.system(size: size * 0.3, weight: .bold))
                    .foregroundStyle(Phade.textOn(hex))
                    .lineLimit(1)
                    .minimumScaleFactor(0.5)
                    .padding(size * 0.08)
            )
    }
}

enum Phade {
    static let background = Color(red: 10 / 255, green: 10 / 255, blue: 10 / 255)
    static let mint = Color(red: 70 / 255, green: 187 / 255, blue: 147 / 255)
    static let live = Color(red: 239 / 255, green: 107 / 255, blue: 107 / 255)
    static let amber = Color(red: 251 / 255, green: 191 / 255, blue: 36 / 255)
    static let gray400 = Color(red: 156 / 255, green: 163 / 255, blue: 175 / 255)
    static let gray500 = Color(red: 107 / 255, green: 114 / 255, blue: 128 / 255)
    static let gray700 = Color(red: 55 / 255, green: 65 / 255, blue: 81 / 255)

    /// "#rrggbb" as 0...1 components, or nil.
    static func rgb(_ hex: String?) -> (r: Double, g: Double, b: Double)? {
        guard let hex, hex.count == 7, hex.hasPrefix("#"), let n = Int(hex.dropFirst(), radix: 16) else { return nil }
        return (Double((n >> 16) & 255) / 255, Double((n >> 8) & 255) / 255, Double(n & 255) / 255)
    }

    /// Dark text on light team colors, white otherwise (ui.js textOn).
    static func textOn(_ rgb: (r: Double, g: Double, b: Double)?) -> Color {
        guard let rgb else { return .white }
        let lum = 0.299 * rgb.r * 255 + 0.587 * rgb.g * 255 + 0.114 * rgb.b * 255
        return lum > 186 ? background : .white
    }
}
