import ActivityKit
import Foundation

// One game on the Lock Screen and in the Dynamic Island (a Live Activity).
// Compiled into both the app, which starts it from the game page, and the
// LiveGame widget extension, which draws it. The web app builds the first
// state (details.js lockScreenCard) and scores.phade.app pushes the rest
// (server/live.js contentState), so the JSON keys here must match theirs.
@available(iOS 16.1, *)
struct GameAttributes: ActivityAttributes {
    struct Team: Codable, Hashable {
        var abbr: String
        var name: String
        /// ESPN's team color as "#rrggbb", or nil.
        var color: String?
        /// ESPN's logo URL; the app saves the image for the card (TeamLogos).
        var logo: String?
    }

    struct ContentState: Codable, Hashable {
        /// Scores as ESPN shows them; empty before the start.
        var away: String
        var home: String
        /// "pre", "in" or "post".
        var state: String
        /// ESPN's short status ("4:32 - 3rd", "Halftime", "Final"). Empty for
        /// a normally scheduled game: the card shows the local start time.
        var status: String
        /// Down and distance, outs and runners, or empty.
        var detail: String
    }

    var league: String
    var leagueLabel: String
    var eventId: String
    var start: Date
    /// Soccer lists the home side first.
    var homeFirst: Bool
    var away: Team
    var home: Team
}

/// The deep link a tap on the card opens: phadescores://game/nfl/401547417.
@available(iOS 16.1, *)
extension GameAttributes {
    var url: URL? { URL(string: "phadescores://game/\(league)/\(eventId)") }
}
