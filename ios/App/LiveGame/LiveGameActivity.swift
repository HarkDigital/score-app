import ActivityKit
import SwiftUI
import WidgetKit

// The Lock Screen card and Dynamic Island for one game, in Phade's look:
// glass on the Lock Screen (near-black in the island), mint accent, the red
// live dot, team logos (from the files the app saved, falling back to
// Phade's team-color badges), tabular numbers. Tapping opens the game page
// in the app.

@main
struct LiveGameBundle: WidgetBundle {
    var body: some Widget {
        LiveGameActivity()
    }
}

struct LiveGameActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: GameAttributes.self) { context in
            // A see-through tint lets iOS draw its glass behind the card (the
            // wallpaper shows through, blurred); 30% black keeps the white
            // score readable on a light wallpaper too.
            LockScreenView(game: Game(context.attributes, context.state))
                .activityBackgroundTint(Phade.background.opacity(0.3))
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
                        .font(.system(size: 12, weight: .bold))
                        .monospacedDigit()
                        .lineLimit(1)
                        .minimumScaleFactor(0.5)
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
    let leagueId: String
    let start: Date
    let left: GameAttributes.Team
    let right: GameAttributes.Team
    let leftScore: String
    let rightScore: String
    let state: String
    let status: String
    let detail: String
    let homeFirst: Bool
    /// Live football: timeouts left, and the team with the ball.
    let leftTimeouts: Int?
    let rightTimeouts: Int?
    let leftHasBall: Bool
    let rightHasBall: Bool

    init(_ a: GameAttributes, _ s: GameAttributes.ContentState) {
        league = a.leagueLabel
        leagueId = a.league
        start = a.start
        homeFirst = a.homeFirst
        left = a.homeFirst ? a.home : a.away
        right = a.homeFirst ? a.away : a.home
        leftScore = a.homeFirst ? s.home : s.away
        rightScore = a.homeFirst ? s.away : s.home
        state = s.state
        status = s.status
        detail = s.detail
        let live = s.state == "in"
        leftTimeouts = live ? (a.homeFirst ? s.homeTimeouts : s.awayTimeouts) : nil
        rightTimeouts = live ? (a.homeFirst ? s.awayTimeouts : s.homeTimeouts) : nil
        leftHasBall = live && s.possession == (a.homeFirst ? "home" : "away")
        rightHasBall = live && s.possession == (a.homeFirst ? "away" : "home")
    }

    var live: Bool { state == "in" }
    var final: Bool { state == "post" }
    var started: Bool { state != "pre" && !(leftScore.isEmpty && rightScore.isEmpty) }
    var separator: String { homeFirst ? "vs" : "@" }

    /// For the card's league pill: "NFL", but "EPL" and "UCL" rather than
    /// "Premier League" and "Champions League".
    var shortLeague: String { (league.contains(" ") ? leagueId : league).uppercased() }

    /// ESPN's "8:21 - 2nd" the way a scorebug reads it, "2nd • 8:21";
    /// anything else ("Halftime", "Top 5th") as it is.
    var clock: String {
        let parts = status.components(separatedBy: " - ")
        return parts.count == 2 ? "\(parts[1]) • \(parts[0])" : status
    }

    private var decided: (Int, Int)? {
        guard final, let l = Int(leftScore), let r = Int(rightScore), l != r else { return nil }
        return (l, r)
    }
    var leftLost: Bool { decided.map { $0.0 < $0.1 } ?? false }
    var rightLost: Bool { decided.map { $0.1 < $0.0 } ?? false }
}

// MARK: - Lock Screen

/// A scorebug: each team's logo on a block of its color at the card's edge,
/// the inner side slanted, with the scores beside them (football adds the
/// timeouts left and a ball by the team that has it) and the period and clock
/// between. Under that, a row of pills: the league, down and distance (or the
/// matchup) and LIVE.
struct LockScreenView: View {
    let game: Game

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 0) {
                TeamPanel(team: game.left, dim: game.leftLost)
                ScoreColumn(game: game, score: game.leftScore, abbr: abbr(game.left), dim: game.leftLost,
                            timeouts: game.leftTimeouts, hasBall: game.leftHasBall)
                Spacer(minLength: 4)
                CenterStatus(game: game)
                Spacer(minLength: 4)
                ScoreColumn(game: game, score: game.rightScore, abbr: abbr(game.right), dim: game.rightLost,
                            timeouts: game.rightTimeouts, hasBall: game.rightHasBall, trailing: true)
                TeamPanel(team: game.right, dim: game.rightLost, trailing: true)
            }
            .frame(height: 84)
            PillRow(game: game)
                .padding(.horizontal, 12)
                .padding(.top, 10)
                .padding(.bottom, 12)
        }
    }

    /// Before the start the scores' place shows the abbreviations, unless the
    /// block already does (Phade's badge, for a team without a logo).
    private func abbr(_ team: GameAttributes.Team) -> String {
        TeamLogos.saved(team.logo) ? team.abbr : ""
    }
}

/// The team's logo on its color, flush with the card's side; the inner edge
/// leans, with a thin stripe of the same color beside it.
struct TeamPanel: View {
    let team: GameAttributes.Team
    var dim = false
    var trailing = false

    private let width: CGFloat = 80
    private let slant: CGFloat = 16

    var body: some View {
        let rgb = Phade.rgb(team.color)
        let base = rgb.map { Color(red: $0.r, green: $0.g, blue: $0.b) } ?? Phade.gray700
        let light = rgb.map { Color(red: $0.r + (1 - $0.r) * 0.18, green: $0.g + (1 - $0.g) * 0.18, blue: $0.b + (1 - $0.b) * 0.18) } ?? Phade.gray500
        // The logo centers on the block's own middle, not the frame's.
        let shift = (7 + slant / 2) / 2
        return ZStack {
            ZStack(alignment: .leading) {
                SlantBand(to: width - 7, slant: slant)
                    .fill(LinearGradient(colors: [light, base], startPoint: .top, endPoint: .bottom))
                SlantBand(from: width - 4, to: width - 1, slant: slant)
                    .fill(base.opacity(0.7))
            }
            .scaleEffect(x: trailing ? -1 : 1, y: 1)
            TeamBadge(team: team, size: 50, glow: false)
                .offset(x: trailing ? shift : -shift)
        }
        .frame(width: width)
        .opacity(dim ? 0.55 : 1)
    }
}

/// The full height of its frame, its sides leaning: from..to across the top,
/// slant points further left across the bottom. from 0 is the straight outer
/// edge.
struct SlantBand: Shape {
    var from: CGFloat = 0
    var to: CGFloat
    var slant: CGFloat

    func path(in rect: CGRect) -> Path {
        Path { p in
            p.move(to: CGPoint(x: from, y: 0))
            p.addLine(to: CGPoint(x: to, y: 0))
            p.addLine(to: CGPoint(x: to - slant, y: rect.height))
            p.addLine(to: CGPoint(x: from == 0 ? 0 : from - slant, y: rect.height))
            p.closeSubpath()
        }
    }
}

/// A side's score (its abbreviation before the start); live football adds
/// dashes for the timeouts left and a ball on the inner side for the team
/// that has it.
struct ScoreColumn: View {
    let game: Game
    let score: String
    let abbr: String
    var dim = false
    var timeouts: Int?
    var hasBall = false
    var trailing = false

    var body: some View {
        VStack(spacing: 7) {
            if game.started {
                Text(score)
                    .font(.system(size: 38, weight: .bold))
                    .monospacedDigit()
                    .foregroundStyle(dim ? Phade.gray500 : .white)
            } else {
                Text(abbr)
                    .font(.system(size: 20, weight: .bold))
                    .foregroundStyle(.white)
            }
            if timeouts != nil || hasBall {
                TimeoutDashes(left: timeouts ?? 0, shown: timeouts != nil)
                    .overlay(alignment: trailing ? .leading : .trailing) {
                        if hasBall {
                            Image(systemName: "football.fill")
                                .font(.system(size: 10))
                                .foregroundStyle(.white)
                                .offset(x: trailing ? -20 : 20)
                        }
                    }
            }
        }
        .lineLimit(1)
        .minimumScaleFactor(0.5)
        .frame(minWidth: 46)
        .padding(.leading, trailing ? 0 : 8)
        .padding(.trailing, trailing ? 8 : 0)
    }
}

/// Football's timeouts: a dash each, bright while it's still there.
struct TimeoutDashes: View {
    let left: Int
    var shown = true

    var body: some View {
        HStack(spacing: 3) {
            ForEach(0..<max(3, left), id: \.self) { i in
                Capsule()
                    .fill(Color.white.opacity(i < left ? 1 : 0.22))
                    .frame(width: 9, height: 3)
            }
        }
        .opacity(shown ? 1 : 0)
    }
}

/// "2nd • 8:21", "Halftime", "Final", ESPN's word for trouble ("Delayed"), or
/// the start time.
struct CenterStatus: View {
    let game: Game

    var body: some View {
        Group {
            if game.live {
                Text(game.clock).foregroundStyle(.white)
            } else if game.final {
                Text(game.status.isEmpty ? "Final" : game.status).foregroundStyle(Phade.gray400)
            } else if !game.status.isEmpty {
                Text(game.status).foregroundStyle(Phade.amber)
            } else {
                VStack(spacing: 2) {
                    Text(game.separator).foregroundStyle(Phade.gray400)
                    Text(game.start, style: .time)
                        .font(.system(size: 17, weight: .bold))
                        .foregroundStyle(.white)
                }
            }
        }
        .font(.system(size: 15, weight: .semibold))
        .monospacedDigit()
        .lineLimit(1)
        .minimumScaleFactor(0.7)
        .multilineTextAlignment(.center)
    }
}

/// The league; down and distance (or outs and runners), else the matchup;
/// and LIVE while it's on.
struct PillRow: View {
    let game: Game

    var body: some View {
        HStack(spacing: 6) {
            // Mint with dark text, so it reads on any wallpaper.
            Pill(fill: Phade.mint) {
                Text(game.shortLeague)
                    .font(.caption.weight(.bold))
                    .tracking(1)
                    .foregroundStyle(Phade.background)
            }
            .fixedSize()
            Pill {
                Text(game.live && !game.detail.isEmpty ? game.detail : "\(game.left.name) \(game.separator) \(game.right.name)")
                    .foregroundStyle(.white)
            }
            Spacer(minLength: 0)
            if game.live {
                Pill {
                    HStack(spacing: 5) {
                        Circle().fill(Phade.live).frame(width: 6, height: 6)
                        Text("LIVE").tracking(0.8).foregroundStyle(Phade.live)
                    }
                }
                .fixedSize()
            }
        }
        .font(.caption.weight(.semibold))
    }
}

struct Pill<Content: View>: View {
    var fill = Color.white.opacity(0.12)
    @ViewBuilder let content: Content

    var body: some View {
        content
            .lineLimit(1)
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(Capsule().fill(fill))
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

    // Logo and score, shrinking a step at a time when iOS squeezes the island
    // (another app's Live Activity running too, which on newer iPhones halves
    // it): a smaller logo and tighter spacing first, then smaller still. The
    // score alone is the last resort; a game not yet started keeps its logo.
    var body: some View {
        ViewThatFits(in: .horizontal) {
            side(logo: 20, spacing: 5, font: .caption)
            side(logo: 16, spacing: 3, font: .caption)
            side(logo: 13, spacing: 2, font: .caption2)
            if let score {
                scoreText(score, font: .caption2)
            } else {
                TeamBadge(team: team, size: 13)
            }
        }
        .foregroundStyle(.white)
    }

    private func side(logo: CGFloat, spacing: CGFloat, font: Font) -> some View {
        HStack(spacing: spacing) {
            if trailing, let score { scoreText(score, font: font) }
            TeamBadge(team: team, size: logo)
            if !trailing, let score { scoreText(score, font: font) }
        }
    }

    private func scoreText(_ score: String, font: Font) -> some View {
        Text(score)
            .font(font.weight(.bold))
            .monospacedDigit()
            .lineLimit(1)
            .fixedSize()
    }
}

// MARK: - Phade pieces

/// The team's logo, saved by the app (TeamLogos); without one, Phade's
/// TeamLogo fallback: the team's color with its abbreviation.
struct TeamBadge: View {
    let team: GameAttributes.Team
    var size: CGFloat = 36
    var glow = true

    var body: some View {
        if let logo = TeamLogos.image(for: team.logo) {
            Image(uiImage: logo)
                .resizable()
                .scaledToFit()
                .frame(width: size, height: size)
                // A soft white glow, a tight one and a wide one, so a dark
                // logo shows on the island's black. Not on the card's team
                // color, where the dark-background logo needs no help.
                .shadow(color: .white.opacity(glow ? 0.55 : 0), radius: max(1, size * 0.04))
                .shadow(color: .white.opacity(glow ? 0.35 : 0), radius: max(2, size * 0.12))
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
