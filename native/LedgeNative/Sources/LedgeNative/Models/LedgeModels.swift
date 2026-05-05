import Foundation

enum ShelfColor: String, Codable, CaseIterable {
    case ember
    case wave
    case forest
    case sand
}

enum ShelfOrigin: String, Codable {
    case shake
    case tray
    case shortcut
    case manual
    case restore
}

enum ShakeSensitivity: String, Codable, CaseIterable {
    case gentle
    case balanced
    case firm
}

struct FileRef: Codable, Equatable {
    var originalPath: String
    var bookmarkBase64: String
    var resolvedPath: String
    var isStale: Bool
    var isMissing: Bool

    init(
        originalPath: String,
        bookmarkBase64: String = "",
        resolvedPath: String = "",
        isStale: Bool = false,
        isMissing: Bool = false
    ) {
        self.originalPath = originalPath
        self.bookmarkBase64 = bookmarkBase64
        self.resolvedPath = resolvedPath
        self.isStale = isStale
        self.isMissing = isMissing
    }

    enum CodingKeys: String, CodingKey {
        case originalPath
        case bookmarkBase64
        case resolvedPath
        case isStale
        case isMissing
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        originalPath = try container.decode(String.self, forKey: .originalPath)
        bookmarkBase64 = try container.decodeIfPresent(String.self, forKey: .bookmarkBase64) ?? ""
        resolvedPath = try container.decodeIfPresent(String.self, forKey: .resolvedPath) ?? ""
        isStale = try container.decodeIfPresent(Bool.self, forKey: .isStale) ?? false
        isMissing = try container.decodeIfPresent(Bool.self, forKey: .isMissing) ?? false
    }
}

struct PreviewRecord: Codable, Equatable {
    var summary: String
    var detail: String

    init(summary: String, detail: String = "") {
        self.summary = summary
        self.detail = detail
    }

    enum CodingKeys: String, CodingKey {
        case summary
        case detail
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        summary = try container.decode(String.self, forKey: .summary)
        detail = try container.decodeIfPresent(String.self, forKey: .detail) ?? ""
    }
}

struct ShelfItemBase: Codable, Equatable {
    var id: String
    var createdAt: String
    var order: Int
    var title: String
    var subtitle: String
    var preview: PreviewRecord

    init(id: String, createdAt: String, order: Int, title: String, subtitle: String = "", preview: PreviewRecord) {
        self.id = id
        self.createdAt = createdAt
        self.order = order
        self.title = title
        self.subtitle = subtitle
        self.preview = preview
    }

    enum CodingKeys: String, CodingKey {
        case id
        case createdAt
        case order
        case title
        case subtitle
        case preview
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        createdAt = try container.decode(String.self, forKey: .createdAt)
        order = try container.decode(Int.self, forKey: .order)
        title = try container.decode(String.self, forKey: .title)
        subtitle = try container.decodeIfPresent(String.self, forKey: .subtitle) ?? ""
        preview = try container.decode(PreviewRecord.self, forKey: .preview)
    }
}

struct FileItemRecord: Codable, Equatable {
    var base: ShelfItemBase
    var file: FileRef
    var mimeType: String
}

struct FolderItemRecord: Codable, Equatable {
    var base: ShelfItemBase
    var file: FileRef
}

struct ImageAssetItemRecord: Codable, Equatable {
    var base: ShelfItemBase
    var file: FileRef
    var mimeType: String
}

struct TextItemRecord: Codable, Equatable {
    var base: ShelfItemBase
    var text: String
    var savedFilePath: String?
}

struct URLItemRecord: Codable, Equatable {
    var base: ShelfItemBase
    var url: String
    var savedFilePath: String?
}

enum ShelfItemRecord: Codable, Equatable, Identifiable {
    case file(FileItemRecord)
    case folder(FolderItemRecord)
    case imageAsset(ImageAssetItemRecord)
    case text(TextItemRecord)
    case url(URLItemRecord)

    enum Kind: String, Codable {
        case file
        case folder
        case imageAsset
        case text
        case url
    }

    enum CodingKeys: String, CodingKey {
        case kind
        case id
        case createdAt
        case order
        case title
        case subtitle
        case preview
        case file
        case mimeType
        case text
        case savedFilePath
        case url
    }

    var id: String { base.id }
    var kind: Kind {
        switch self {
        case .file: return .file
        case .folder: return .folder
        case .imageAsset: return .imageAsset
        case .text: return .text
        case .url: return .url
        }
    }
    var base: ShelfItemBase {
        switch self {
        case .file(let item): return item.base
        case .folder(let item): return item.base
        case .imageAsset(let item): return item.base
        case .text(let item): return item.base
        case .url(let item): return item.base
        }
    }
    var title: String { base.title }
    var subtitle: String { base.subtitle }
    var preview: PreviewRecord { base.preview }

    var fileRef: FileRef? {
        switch self {
        case .file(let item): return item.file
        case .folder(let item): return item.file
        case .imageAsset(let item): return item.file
        case .text, .url: return nil
        }
    }

    var isFileBacked: Bool { fileRef != nil }

    var fileBackedPath: String? {
        guard let file = fileRef, !file.isMissing else { return nil }
        if !file.resolvedPath.isEmpty { return file.resolvedPath }
        if !file.originalPath.isEmpty { return file.originalPath }
        return nil
    }

    var isPreviewableImage: Bool {
        switch self {
        case .imageAsset(let item):
            return !item.file.isMissing
        case .file(let item):
            return item.mimeType.hasPrefix("image/") && !item.file.isMissing
        case .folder, .text, .url:
            return false
        }
    }

    func withOrder(_ order: Int) -> ShelfItemRecord {
        var nextBase = base
        nextBase.order = order
        switch self {
        case .file(let item):
            return .file(FileItemRecord(base: nextBase, file: item.file, mimeType: item.mimeType))
        case .folder(let item):
            return .folder(FolderItemRecord(base: nextBase, file: item.file))
        case .imageAsset(let item):
            return .imageAsset(ImageAssetItemRecord(base: nextBase, file: item.file, mimeType: item.mimeType))
        case .text(let item):
            return .text(TextItemRecord(base: nextBase, text: item.text, savedFilePath: item.savedFilePath))
        case .url(let item):
            return .url(URLItemRecord(base: nextBase, url: item.url, savedFilePath: item.savedFilePath))
        }
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let kind = try container.decode(Kind.self, forKey: .kind)
        let base = ShelfItemBase(
            id: try container.decode(String.self, forKey: .id),
            createdAt: try container.decode(String.self, forKey: .createdAt),
            order: try container.decode(Int.self, forKey: .order),
            title: try container.decode(String.self, forKey: .title),
            subtitle: try container.decodeIfPresent(String.self, forKey: .subtitle) ?? "",
            preview: try container.decode(PreviewRecord.self, forKey: .preview)
        )

        switch kind {
        case .file:
            self = .file(FileItemRecord(
                base: base,
                file: try container.decode(FileRef.self, forKey: .file),
                mimeType: try container.decodeIfPresent(String.self, forKey: .mimeType) ?? "application/octet-stream"
            ))
        case .folder:
            self = .folder(FolderItemRecord(
                base: base,
                file: try container.decode(FileRef.self, forKey: .file)
            ))
        case .imageAsset:
            self = .imageAsset(ImageAssetItemRecord(
                base: base,
                file: try container.decode(FileRef.self, forKey: .file),
                mimeType: try container.decodeIfPresent(String.self, forKey: .mimeType) ?? "image/png"
            ))
        case .text:
            self = .text(TextItemRecord(
                base: base,
                text: try container.decode(String.self, forKey: .text),
                savedFilePath: try container.decodeIfPresent(String.self, forKey: .savedFilePath)
            ))
        case .url:
            self = .url(URLItemRecord(
                base: base,
                url: try container.decode(String.self, forKey: .url),
                savedFilePath: try container.decodeIfPresent(String.self, forKey: .savedFilePath)
            ))
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(kind, forKey: .kind)
        try container.encode(base.id, forKey: .id)
        try container.encode(base.createdAt, forKey: .createdAt)
        try container.encode(base.order, forKey: .order)
        try container.encode(base.title, forKey: .title)
        try container.encode(base.subtitle, forKey: .subtitle)
        try container.encode(base.preview, forKey: .preview)

        switch self {
        case .file(let item):
            try container.encode(item.file, forKey: .file)
            try container.encode(item.mimeType, forKey: .mimeType)
        case .folder(let item):
            try container.encode(item.file, forKey: .file)
        case .imageAsset(let item):
            try container.encode(item.file, forKey: .file)
            try container.encode(item.mimeType, forKey: .mimeType)
        case .text(let item):
            try container.encode(item.text, forKey: .text)
            try container.encodeIfPresent(item.savedFilePath, forKey: .savedFilePath)
        case .url(let item):
            try container.encode(item.url, forKey: .url)
            try container.encodeIfPresent(item.savedFilePath, forKey: .savedFilePath)
        }
    }
}

struct ShelfRecord: Codable, Equatable, Identifiable {
    var id: String
    var name: String
    var color: ShelfColor
    var createdAt: String
    var updatedAt: String
    var origin: ShelfOrigin
    var items: [ShelfItemRecord]
}

struct PreferencesRecord: Codable, Equatable {
    var launchAtLogin: Bool
    var shakeEnabled: Bool
    var shakeSensitivity: ShakeSensitivity
    var excludedBundleIds: [String]
    var globalShortcut: String

    init(
        launchAtLogin: Bool = false,
        shakeEnabled: Bool = true,
        shakeSensitivity: ShakeSensitivity = .balanced,
        excludedBundleIds: [String] = [],
        globalShortcut: String = "CommandOrControl+Shift+Space"
    ) {
        self.launchAtLogin = launchAtLogin
        self.shakeEnabled = shakeEnabled
        self.shakeSensitivity = shakeSensitivity
        self.excludedBundleIds = excludedBundleIds
        self.globalShortcut = globalShortcut
    }

    enum CodingKeys: String, CodingKey {
        case launchAtLogin
        case shakeEnabled
        case shakeSensitivity
        case excludedBundleIds
        case globalShortcut
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        launchAtLogin = try container.decodeIfPresent(Bool.self, forKey: .launchAtLogin) ?? false
        shakeEnabled = try container.decodeIfPresent(Bool.self, forKey: .shakeEnabled) ?? true
        shakeSensitivity = try container.decodeIfPresent(ShakeSensitivity.self, forKey: .shakeSensitivity) ?? .balanced
        excludedBundleIds = try container.decodeIfPresent([String].self, forKey: .excludedBundleIds) ?? []
        globalShortcut = try container.decodeIfPresent(String.self, forKey: .globalShortcut) ?? "CommandOrControl+Shift+Space"
    }
}

struct PermissionStatus: Codable, Equatable {
    var nativeHelperAvailable: Bool
    var accessibilityTrusted: Bool
    var shakeReady: Bool
    var lastError: String
    var shortcutRegistered: Bool
    var shortcutError: String

    init(
        nativeHelperAvailable: Bool = true,
        accessibilityTrusted: Bool = false,
        shakeReady: Bool = false,
        lastError: String = "",
        shortcutRegistered: Bool = false,
        shortcutError: String = ""
    ) {
        self.nativeHelperAvailable = nativeHelperAvailable
        self.accessibilityTrusted = accessibilityTrusted
        self.shakeReady = shakeReady
        self.lastError = lastError
        self.shortcutRegistered = shortcutRegistered
        self.shortcutError = shortcutError
    }
}

struct AppState: Codable, Equatable {
    var liveShelf: ShelfRecord?
    var recentShelves: [ShelfRecord]
    var preferences: PreferencesRecord
    var permissionStatus: PermissionStatus
}

struct PersistedStateEnvelope: Codable, Equatable {
    var version: Int
    var liveShelf: ShelfRecord?
    var recentShelves: [ShelfRecord]
    var preferences: PreferencesRecord
}

enum IngestPayload: Equatable {
    case fileDrop(paths: [String])
    case text(String)
    case url(url: String, label: String)
    case image(mimeType: String, base64: String, filenameHint: String)
}
