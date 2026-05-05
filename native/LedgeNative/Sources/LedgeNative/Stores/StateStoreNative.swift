import Combine
import Foundation

final class StateStoreNative: ObservableObject {
    static let persistedStateVersion = 1

    let supportURL: URL
    let assetsURL: URL
    let exportsURL: URL

    @Published private(set) var appState: AppState

    private let stateURL: URL
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder
    private let writeQueue = DispatchQueue(label: "com.ollayor.ledge.native.state-store")
    private var persisted: PersistedStateEnvelope
    private var permissionStatus = PermissionStatus()

    init(
        supportURL: URL? = nil,
        readProductionState: Bool = ProcessInfo.processInfo.environment["LEDGE_NATIVE_READ_PRODUCTION_STATE"] == "1"
    ) {
        self.supportURL = supportURL ?? Self.defaultDevelopmentSupportURL()
        self.assetsURL = self.supportURL.appendingPathComponent("assets", isDirectory: true)
        self.exportsURL = self.supportURL.appendingPathComponent("exports", isDirectory: true)
        self.stateURL = self.supportURL.appendingPathComponent("state.json")
        self.encoder = JSONEncoder()
        self.decoder = JSONDecoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]

        try? FileManager.default.createDirectory(at: self.supportURL, withIntermediateDirectories: true)
        try? FileManager.default.createDirectory(at: self.assetsURL, withIntermediateDirectories: true)
        try? FileManager.default.createDirectory(at: self.exportsURL, withIntermediateDirectories: true)

        let loaded = Self.loadState(
            stateURL: self.stateURL,
            productionStateURL: readProductionState ? Self.productionStateURL() : nil,
            decoder: self.decoder
        )
        self.persisted = loaded.state
        self.appState = AppState(
            liveShelf: loaded.state.liveShelf,
            recentShelves: loaded.state.recentShelves,
            preferences: loaded.state.preferences,
            permissionStatus: permissionStatus
        )

        if loaded.needsMigration {
            save()
        }
    }

    func snapshot(permissionStatus: PermissionStatus? = nil) -> AppState {
        if let permissionStatus {
            self.permissionStatus = permissionStatus
        }
        appState = AppState(
            liveShelf: persisted.liveShelf,
            recentShelves: persisted.recentShelves,
            preferences: persisted.preferences,
            permissionStatus: self.permissionStatus
        )
        return appState
    }

    func whenIdle() {
        writeQueue.sync {}
    }

    @discardableResult
    func createShelf(origin: ShelfOrigin) -> ShelfRecord {
        archiveLiveShelf()
        let now = Self.isoNow()
        let shelf = ShelfRecord(
            id: UUID().uuidString,
            name: Self.defaultShelfName(),
            color: Self.nextShelfColor(seed: persisted.recentShelves.count),
            createdAt: now,
            updatedAt: now,
            origin: origin,
            items: []
        )
        persisted.liveShelf = shelf
        persistAndPublish()
        return shelf
    }

    @discardableResult
    func ensureLiveShelf(origin: ShelfOrigin) -> ShelfRecord {
        if let liveShelf = persisted.liveShelf {
            return liveShelf
        }
        return createShelf(origin: origin)
    }

    @discardableResult
    func appendItems(_ items: [ShelfItemRecord]) -> ShelfRecord {
        var liveShelf = ensureLiveShelf(origin: .manual)
        let nextOrder = liveShelf.items.count
        liveShelf.items.append(contentsOf: items.enumerated().map { index, item in
            item.withOrder(nextOrder + index)
        })
        liveShelf.updatedAt = Self.isoNow()
        persisted.liveShelf = liveShelf
        persistAndPublish()
        return liveShelf
    }

    @discardableResult
    func renameLiveShelf(_ name: String) -> ShelfRecord? {
        guard var liveShelf = persisted.liveShelf else { return nil }
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        liveShelf.name = trimmed.isEmpty ? Self.defaultShelfName() : trimmed
        liveShelf.updatedAt = Self.isoNow()
        persisted.liveShelf = liveShelf
        persistAndPublish()
        return liveShelf
    }

    @discardableResult
    func removeItem(_ itemId: String) -> ShelfRecord? {
        guard var liveShelf = persisted.liveShelf else { return nil }
        liveShelf.items = liveShelf.items
            .filter { $0.id != itemId }
            .enumerated()
            .map { index, item in item.withOrder(index) }
        liveShelf.updatedAt = Self.isoNow()
        persisted.liveShelf = liveShelf
        persistAndPublish()
        return liveShelf
    }

    @discardableResult
    func clearLiveShelf() -> ShelfRecord? {
        guard var liveShelf = persisted.liveShelf else { return nil }
        liveShelf.items = []
        liveShelf.updatedAt = Self.isoNow()
        persisted.liveShelf = liveShelf
        persistAndPublish()
        return liveShelf
    }

    @discardableResult
    func reorderItems(_ itemIds: [String]) -> ShelfRecord? {
        guard var liveShelf = persisted.liveShelf else { return nil }
        let byId = Dictionary(uniqueKeysWithValues: liveShelf.items.map { ($0.id, $0) })
        let requested = itemIds.compactMap { byId[$0] }
        let requestedIds = Set(itemIds)
        let missing = liveShelf.items.filter { !requestedIds.contains($0.id) }
        liveShelf.items = (requested + missing).enumerated().map { index, item in
            item.withOrder(index)
        }
        liveShelf.updatedAt = Self.isoNow()
        persisted.liveShelf = liveShelf
        persistAndPublish()
        return liveShelf
    }

    func replaceLiveShelf(_ shelf: ShelfRecord?) {
        persisted.liveShelf = shelf
        persistAndPublish()
    }

    func closeShelf() {
        archiveLiveShelf()
        persistAndPublish()
    }

    @discardableResult
    func restoreShelf(id: String) -> ShelfRecord? {
        guard let shelf = persisted.recentShelves.first(where: { $0.id == id }) else {
            return nil
        }
        archiveLiveShelf()
        persisted.recentShelves.removeAll { $0.id == id }
        var restored = shelf
        restored.origin = .restore
        restored.updatedAt = Self.isoNow()
        persisted.liveShelf = restored
        persistAndPublish()
        return restored
    }

    @discardableResult
    func updatePreferences(_ transform: (inout PreferencesRecord) -> Void) -> PreferencesRecord {
        var next = persisted.preferences
        transform(&next)
        persisted.preferences = next
        persistAndPublish()
        return next
    }

    func setPermissionStatus(_ status: PermissionStatus) {
        permissionStatus = status
        _ = snapshot()
    }

    private func archiveLiveShelf() {
        guard let liveShelf = persisted.liveShelf else { return }
        if !liveShelf.items.isEmpty {
            let existing = persisted.recentShelves.filter { $0.id != liveShelf.id }
            persisted.recentShelves = Array(([liveShelf] + existing).prefix(10))
        }
        persisted.liveShelf = nil
    }

    private func persistAndPublish() {
        save()
        _ = snapshot()
    }

    private func save() {
        let envelope = persisted
        let stateURL = stateURL
        let encoder = encoder
        writeQueue.async {
            do {
                let data = try encoder.encode(envelope)
                try data.write(to: stateURL, options: [.atomic])
            } catch {
                fputs("Failed to persist Ledge native state: \(error)\n", stderr)
            }
        }
    }

    private static func loadState(
        stateURL: URL,
        productionStateURL: URL?,
        decoder: JSONDecoder
    ) -> (state: PersistedStateEnvelope, needsMigration: Bool) {
        let candidateURLs = [stateURL, productionStateURL].compactMap { $0 }

        for candidateURL in candidateURLs {
            guard let data = try? Data(contentsOf: candidateURL) else { continue }
            if let envelope = try? decoder.decode(PersistedStateEnvelope.self, from: data), envelope.version == persistedStateVersion {
                return (state: envelope, needsMigration: candidateURL != stateURL)
            }
            if let legacy = try? decoder.decode(LegacyPersistedState.self, from: data) {
                return (
                    state: PersistedStateEnvelope(
                        version: persistedStateVersion,
                        liveShelf: legacy.liveShelf,
                        recentShelves: Array(legacy.recentShelves.prefix(10)),
                        preferences: legacy.preferences
                    ),
                    needsMigration: true
                )
            }
        }

        return (
            state: PersistedStateEnvelope(
                version: persistedStateVersion,
                liveShelf: nil,
                recentShelves: [],
                preferences: PreferencesRecord()
            ),
            needsMigration: false
        )
    }

    private static func defaultDevelopmentSupportURL() -> URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return base.appendingPathComponent("LedgeNativeDev", isDirectory: true)
    }

    private static func productionStateURL() -> URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return base
            .appendingPathComponent("Ledge", isDirectory: true)
            .appendingPathComponent("state.json")
    }

    private static func isoNow() -> String {
        ISO8601DateFormatter().string(from: Date())
    }

    private static func defaultShelfName() -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US")
        formatter.dateStyle = .none
        formatter.timeStyle = .short
        return "Shelf \(formatter.string(from: Date()))"
    }

    private static func nextShelfColor(seed: Int) -> ShelfColor {
        ShelfColor.allCases[seed % ShelfColor.allCases.count]
    }
}

private struct LegacyPersistedState: Codable {
    var liveShelf: ShelfRecord?
    var recentShelves: [ShelfRecord]
    var preferences: PreferencesRecord
}
