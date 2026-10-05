import UIKit

// The app's half of TeamLogos: download ESPN's logo once (its dark-background
// version when there is one), shrink it to 120px
// (plenty for a 40pt badge at 3x, and small enough for the extension's tight
// memory) and save it where the LiveGame extension can read it.
extension TeamLogos {
    static func fetch(_ urls: [String?]) async {
        await withTaskGroup(of: Void.self) { group in
            for case let url? in urls where url.hasPrefix("https://") {
                group.addTask { await save(url) }
            }
        }
    }

    private static func save(_ url: String) async {
        guard let file = file(for: url) else { return }
        if FileManager.default.fileExists(atPath: file.path) { return }
        var image: UIImage?
        for candidate in [darkURL(url), url].compactMap({ $0 }) {
            image = await download(candidate)
            if image != nil { break }
        }
        guard let image else { return }
        let side: CGFloat = 120
        let scale = min(side / image.size.width, side / image.size.height, 1)
        let size = CGSize(width: (image.size.width * scale).rounded(), height: (image.size.height * scale).rounded())
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let png = UIGraphicsImageRenderer(size: size, format: format).pngData { _ in
            image.draw(in: CGRect(origin: .zero, size: size))
        }
        try? FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? png.write(to: file, options: .atomic)
    }

    private static func download(_ url: String) async -> UIImage? {
        guard let remote = URL(string: url) else { return nil }
        var request = URLRequest(url: remote)
        request.timeoutInterval = 6
        guard let (data, response) = try? await URLSession.shared.data(for: request),
              (response as? HTTPURLResponse)?.statusCode == 200,
              let image = UIImage(data: data), image.size.width > 0, image.size.height > 0 else { return nil }
        return image
    }
}
