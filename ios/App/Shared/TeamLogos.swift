import UIKit

// Team logos on the Lock Screen card. A Live Activity can't load images from
// the web, so the app saves each team's ESPN logo (shrunk to 120px) into the
// App Group container it shares with the LiveGame extension, which reads it
// back from there. In both targets; the fetching half is app-only
// (TeamLogos+Fetch.swift).
enum TeamLogos {
    static let group = "group.digital.hark.scores"

    /// Where a logo URL's file lives: a.espncdn.com/i/teamlogos/ncaa/500/87.png
    /// → logos/a-espncdn-com-i-teamlogos-ncaa-500-87-png.png
    static func file(for url: String) -> URL? {
        guard let dir = FileManager.default
            .containerURL(forSecurityApplicationGroupIdentifier: group)?
            .appendingPathComponent("logos", isDirectory: true) else { return nil }
        let safe = String(url.replacingOccurrences(of: "https://", with: "")
            .map { $0.isLetter || $0.isNumber ? $0 : "-" }
            .suffix(120))
        return dir.appendingPathComponent(safe + ".png")
    }

    /// The saved logo, or nil (the card then shows the team-color badge).
    static func image(for url: String?) -> UIImage? {
        guard let url, let file = file(for: url) else { return nil }
        return UIImage(contentsOfFile: file.path)
    }
}
