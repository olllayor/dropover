import Foundation

struct BookmarkResolution: Equatable {
    var resolvedPath: String
    var isStale: Bool
    var isMissing: Bool
}

protocol BookmarkServicing {
    func createBookmark(path: String) throws -> String
    func resolveBookmark(bookmarkBase64: String, originalPath: String) -> BookmarkResolution
}

struct FileBookmarkService: BookmarkServicing {
    func createBookmark(path: String) throws -> String {
        let url = URL(fileURLWithPath: path)
        let data = try url.bookmarkData(options: .minimalBookmark, includingResourceValuesForKeys: nil, relativeTo: nil)
        return data.base64EncodedString()
    }

    func resolveBookmark(bookmarkBase64: String, originalPath: String) -> BookmarkResolution {
        guard let bookmarkData = Data(base64Encoded: bookmarkBase64) else {
            return BookmarkResolution(
                resolvedPath: originalPath,
                isStale: false,
                isMissing: !FileManager.default.fileExists(atPath: originalPath)
            )
        }

        do {
            var isStale = false
            let url = try URL(
                resolvingBookmarkData: bookmarkData,
                options: [.withoutUI],
                relativeTo: nil,
                bookmarkDataIsStale: &isStale
            )
            let path = url.path
            return BookmarkResolution(
                resolvedPath: path,
                isStale: isStale,
                isMissing: !FileManager.default.fileExists(atPath: path)
            )
        } catch {
            return BookmarkResolution(
                resolvedPath: originalPath,
                isStale: false,
                isMissing: !FileManager.default.fileExists(atPath: originalPath)
            )
        }
    }
}
