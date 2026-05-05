import Foundation

struct PayloadService {
    var assetsURL: URL
    var bookmarkService: BookmarkServicing

    func detectPayload(fromText text: String) -> IngestPayload {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if let url = URL(string: trimmed), url.scheme == "http" || url.scheme == "https" {
            return .url(url: url.absoluteString, label: trimmed)
        }
        return .text(text)
    }

    func items(from payload: IngestPayload) -> [ShelfItemRecord] {
        switch payload {
        case .fileDrop(let paths):
            var items: [ShelfItemRecord] = []
            for (index, path) in paths.enumerated() {
                if let item = try? createPathItem(path: path, order: index) {
                    items.append(item)
                }
            }
            return items
        case .text(let text):
            return [createTextItem(text: text, order: 0)]
        case .url(let url, let label):
            return [createURLItem(url: url, label: label, order: 0)]
        case .image(let mimeType, let base64, let filenameHint):
            if let item = try? createImageAssetItem(base64: base64, mimeType: mimeType, filenameHint: filenameHint) {
                return [item]
            }
            return []
        }
    }

    func refreshFileRef(_ file: FileRef) -> FileRef {
        if file.bookmarkBase64.isEmpty {
            let exists = FileManager.default.fileExists(atPath: file.originalPath)
            return FileRef(
                originalPath: file.originalPath,
                bookmarkBase64: "",
                resolvedPath: exists ? file.originalPath : "",
                isStale: false,
                isMissing: !exists
            )
        }

        let resolved = bookmarkService.resolveBookmark(bookmarkBase64: file.bookmarkBase64, originalPath: file.originalPath)
        return FileRef(
            originalPath: file.originalPath,
            bookmarkBase64: file.bookmarkBase64,
            resolvedPath: resolved.resolvedPath,
            isStale: resolved.isStale,
            isMissing: resolved.isMissing
        )
    }

    private func createPathItem(path: String, order: Int) throws -> ShelfItemRecord {
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: path, isDirectory: &isDirectory) else {
            throw CocoaError(.fileNoSuchFile)
        }

        let bookmarkBase64 = (try? bookmarkService.createBookmark(path: path)) ?? ""
        let file = FileRef(
            originalPath: path,
            bookmarkBase64: bookmarkBase64,
            resolvedPath: path,
            isStale: false,
            isMissing: false
        )
        let base = ShelfItemBase(
            id: UUID().uuidString,
            createdAt: Self.isoNow(),
            order: order,
            title: URL(fileURLWithPath: path).lastPathComponent,
            subtitle: isDirectory.boolValue ? "Folder" : Self.formatBytes(Self.fileSize(path: path)),
            preview: PreviewRecord(summary: isDirectory.boolValue ? "Folder reference" : Self.fileExtensionSummary(path), detail: path)
        )

        if isDirectory.boolValue {
            return .folder(FolderItemRecord(base: base, file: file))
        }

        return .file(FileItemRecord(base: base, file: file, mimeType: Self.lookupMimeType(path)))
    }

    private func createTextItem(text: String, order: Int) -> ShelfItemRecord {
        let lines = text
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .components(separatedBy: .newlines)
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        let title = String((lines.first ?? "Text snippet").prefix(56))
        let base = ShelfItemBase(
            id: UUID().uuidString,
            createdAt: Self.isoNow(),
            order: order,
            title: title,
            subtitle: "\(text.count) characters",
            preview: PreviewRecord(
                summary: String((lines.first ?? "Plain text").prefix(72)),
                detail: String((lines.dropFirst().first ?? "").prefix(72))
            )
        )
        return .text(TextItemRecord(base: base, text: text, savedFilePath: nil))
    }

    private func createURLItem(url: String, label: String, order: Int) -> ShelfItemRecord {
        let parsed = URL(string: url)
        let host = parsed?.host?.replacingOccurrences(of: #"^www\."#, with: "", options: .regularExpression) ?? url
        let title = label.isEmpty ? host : label
        let path = parsed?.path == "/" ? "" : (parsed?.path ?? "")
        let base = ShelfItemBase(
            id: UUID().uuidString,
            createdAt: Self.isoNow(),
            order: order,
            title: title,
            subtitle: parsed?.absoluteString ?? url,
            preview: PreviewRecord(summary: parsed?.host ?? host, detail: path)
        )
        return .url(URLItemRecord(base: base, url: url, savedFilePath: nil))
    }

    private func createImageAssetItem(base64: String, mimeType: String, filenameHint: String) throws -> ShelfItemRecord {
        guard let data = Data(base64Encoded: base64) else {
            throw CocoaError(.fileReadCorruptFile)
        }

        let id = UUID().uuidString
        let ext = Self.extensionForMimeType(mimeType)
        let storageName = "\(id)-\(Self.sanitizeFileName(filenameHint)).\(ext)"
        let assetURL = assetsURL.appendingPathComponent(storageName)
        try data.write(to: assetURL, options: [.atomic])
        let bookmarkBase64 = (try? bookmarkService.createBookmark(path: assetURL.path)) ?? ""
        let displayName = Self.displayNameForImportedImage(filenameHint: filenameHint, ext: ext)
        let base = ShelfItemBase(
            id: id,
            createdAt: Self.isoNow(),
            order: 0,
            title: displayName,
            subtitle: Self.formatBytes(UInt64(data.count)),
            preview: PreviewRecord(summary: mimeType, detail: "Imported image asset")
        )

        return .imageAsset(ImageAssetItemRecord(
            base: base,
            file: FileRef(
                originalPath: assetURL.path,
                bookmarkBase64: bookmarkBase64,
                resolvedPath: assetURL.path,
                isStale: false,
                isMissing: false
            ),
            mimeType: mimeType
        ))
    }

    private static func isoNow() -> String {
        ISO8601DateFormatter().string(from: Date())
    }

    private static func fileSize(path: String) -> UInt64 {
        guard let attrs = try? FileManager.default.attributesOfItem(atPath: path),
              let size = attrs[.size] as? NSNumber else {
            return 0
        }
        return size.uint64Value
    }

    private static func fileExtensionSummary(_ path: String) -> String {
        let ext = URL(fileURLWithPath: path).pathExtension
        return ext.isEmpty ? "File" : ext.uppercased()
    }

    private static func extensionForMimeType(_ mimeType: String) -> String {
        switch mimeType {
        case "image/jpeg": return "jpg"
        case "image/gif": return "gif"
        case "image/webp": return "webp"
        default: return "png"
        }
    }

    private static func sanitizeFileName(_ name: String) -> String {
        let cleaned = name
            .replacingOccurrences(of: #"[^a-z0-9-_]+"#, with: "-", options: [.regularExpression, .caseInsensitive])
            .replacingOccurrences(of: #"^-+|-+$"#, with: "", options: .regularExpression)
        return cleaned.isEmpty ? "drop-image" : cleaned
    }

    private static func displayNameForImportedImage(filenameHint: String, ext: String) -> String {
        let trimmed = URL(fileURLWithPath: filenameHint.trimmingCharacters(in: .whitespacesAndNewlines)).lastPathComponent
        guard !trimmed.isEmpty else { return "drop-image.\(ext)" }
        let existingExtension = URL(fileURLWithPath: trimmed).pathExtension.lowercased()
        if existingExtension == ext.lowercased() || !existingExtension.isEmpty {
            return trimmed
        }
        return "\(trimmed).\(ext)"
    }

    private static func formatBytes(_ size: UInt64) -> String {
        if size < 1024 { return "\(size) B" }
        let units = ["KB", "MB", "GB", "TB"]
        var value = Double(size) / 1024
        var unitIndex = 0
        while value >= 1024, unitIndex < units.count - 1 {
            value /= 1024
            unitIndex += 1
        }
        return String(format: value >= 10 ? "%.0f %@" : "%.1f %@", value, units[unitIndex])
    }

    private static func lookupMimeType(_ path: String) -> String {
        let ext = URL(fileURLWithPath: path).pathExtension.lowercased()
        guard !ext.isEmpty else { return "application/octet-stream" }
        return mimeTypesByExtension[ext] ?? "application/octet-stream"
    }

    private static let mimeTypesByExtension: [String: String] = [
        "aac": "audio/aac",
        "csv": "text/csv",
        "gif": "image/gif",
        "heic": "image/heic",
        "heif": "image/heif",
        "html": "text/html",
        "jpeg": "image/jpeg",
        "jpg": "image/jpeg",
        "json": "application/json",
        "md": "text/markdown",
        "mov": "video/quicktime",
        "mp3": "audio/mpeg",
        "mp4": "video/mp4",
        "pdf": "application/pdf",
        "png": "image/png",
        "svg": "image/svg+xml",
        "txt": "text/plain",
        "wav": "audio/wav",
        "webm": "video/webm",
        "webp": "image/webp",
        "xml": "application/xml",
        "zip": "application/zip"
    ]
}
