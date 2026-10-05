import UIKit

// Team logos on the Lock Screen card. A Live Activity can't load images from
// the web, so the app saves each team's ESPN logo (shrunk to 120px) into the
// App Group container it shares with the LiveGame extension, which reads it
// back from there. In both targets; the fetching half is app-only
// (TeamLogos+Fetch.swift).
enum TeamLogos {
    static let group = "group.digital.hark.scores"

    /// Where a logo URL's file lives: a.espncdn.com/i/teamlogos/ncaa/500/87.png
    /// → logos/dark-a-espncdn-com-i-teamlogos-ncaa-500-87-png.png. "dark-"
    /// since the files hold ESPN's dark-background logos (darkURL), so the
    /// plain ones saved by earlier builds aren't read.
    static func file(for url: String) -> URL? {
        guard let dir = FileManager.default
            .containerURL(forSecurityApplicationGroupIdentifier: group)?
            .appendingPathComponent("logos", isDirectory: true) else { return nil }
        let safe = String(url.replacingOccurrences(of: "https://", with: "")
            .map { $0.isLetter || $0.isNumber ? $0 : "-" }
            .suffix(120))
        return dir.appendingPathComponent("dark-" + safe + ".png")
    }

    /// ESPN's version of a logo for dark backgrounds (.../500-dark/...), which
    /// keeps a dark mark visible on the card's team-color blocks and the
    /// island's black: the Jets' green wordmark turns white, Iowa's black hawk
    /// gold. Teams without one get the same image back.
    static func darkURL(_ url: String) -> String? {
        guard url.hasPrefix("https://a.espncdn.com/i/teamlogos/"), url.contains("/500/") else { return nil }
        return url.replacingOccurrences(of: "/500/", with: "/500-dark/")
    }

    /// Whether the app saved this logo.
    static func saved(_ url: String?) -> Bool {
        guard let url, let file = file(for: url) else { return false }
        return FileManager.default.fileExists(atPath: file.path)
    }

    /// The saved logo, or nil (the card then shows the team-color badge).
    static func image(for url: String?) -> UIImage? {
        guard let url, let file = file(for: url) else { return nil }
        return UIImage(contentsOfFile: file.path)
    }
}
