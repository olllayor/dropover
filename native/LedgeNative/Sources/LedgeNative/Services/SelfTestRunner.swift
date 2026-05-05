import Foundation

enum SelfTestRunner {
    static func run() -> Int32 {
        let cases: [(String, () throws -> Bool)] = [
            ("archives non-empty live shelves into recents", archivesNonEmptyLiveShelvesIntoRecents),
            ("restores a recent shelf into the live slot", restoresRecentShelfIntoLiveSlot),
            ("does not archive empty shelves", doesNotArchiveEmptyShelves),
            ("migrates legacy state to version one", migratesLegacyStateToVersionOne),
            ("flushes latest state after rapid mutations", flushesLatestStateAfterRapidMutations),
            ("creates file-backed items from dropped paths", createsFileBackedItemsFromDroppedPaths),
            ("imports pathless images into app storage", importsPathlessImagesIntoAppStorage),
            ("skips invalid dropped paths", skipsInvalidDroppedPaths),
            ("detects payloads from text", detectsPayloadsFromText),
            ("marks missing non-bookmarked refs unavailable", marksMissingRefsUnavailable),
            ("normalizes excluded bundle identifiers", normalizesExcludedBundleIdentifiers),
            ("validates global shortcuts", validatesGlobalShortcuts),
            ("balanced drag shake is detected", detectsBalancedDragShake)
        ]

        for (name, test) in cases {
            do {
                if try test() {
                    fputs("PASS: \(name)\n", stdout)
                } else {
                    fputs("FAIL: \(name)\n", stderr)
                    return 1
                }
            } catch {
                fputs("FAIL: \(name): \(error)\n", stderr)
                return 1
            }
        }

        return 0
    }

    private static func archivesNonEmptyLiveShelvesIntoRecents() throws -> Bool {
        let dir = tempDirectory()
        defer { removeTemp(dir) }
        let store = StateStoreNative(supportURL: dir)
        store.createShelf(origin: .manual)
        store.appendItems([textItem(id: "item-1", text: "Hello")])
        store.closeShelf()
        store.whenIdle()
        return store.appState.liveShelf == nil && store.appState.recentShelves.count == 1
    }

    private static func restoresRecentShelfIntoLiveSlot() throws -> Bool {
        let dir = tempDirectory()
        defer { removeTemp(dir) }
        let store = StateStoreNative(supportURL: dir)
        let live = store.createShelf(origin: .manual)
        store.appendItems([textItem(id: "item-1", text: "Hello")])
        store.closeShelf()
        let restored = store.restoreShelf(id: live.id)
        store.whenIdle()
        return restored?.id == live.id && store.appState.liveShelf?.items.count == 1 && store.appState.recentShelves.isEmpty
    }

    private static func doesNotArchiveEmptyShelves() throws -> Bool {
        let dir = tempDirectory()
        defer { removeTemp(dir) }
        let store = StateStoreNative(supportURL: dir)
        store.createShelf(origin: .manual)
        store.closeShelf()
        store.whenIdle()
        return store.appState.liveShelf == nil && store.appState.recentShelves.isEmpty
    }

    private static func migratesLegacyStateToVersionOne() throws -> Bool {
        let dir = tempDirectory()
        defer { removeTemp(dir) }
        let stateURL = dir.appendingPathComponent("state.json")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try #"{"liveShelf":null,"recentShelves":[],"preferences":{}}"#.write(to: stateURL, atomically: true, encoding: .utf8)
        let store = StateStoreNative(supportURL: dir)
        store.whenIdle()
        let envelope = try JSONDecoder().decode(PersistedStateEnvelope.self, from: Data(contentsOf: stateURL))
        return envelope.version == 1 && envelope.preferences.globalShortcut == "CommandOrControl+Shift+Space"
    }

    private static func flushesLatestStateAfterRapidMutations() throws -> Bool {
        let dir = tempDirectory()
        defer { removeTemp(dir) }
        let stateURL = dir.appendingPathComponent("state.json")
        let store = StateStoreNative(supportURL: dir)
        store.createShelf(origin: .manual)
        store.renameLiveShelf("Pinned")
        store.updatePreferences { $0.launchAtLogin = true }
        store.closeShelf()
        store.whenIdle()
        let envelope = try JSONDecoder().decode(PersistedStateEnvelope.self, from: Data(contentsOf: stateURL))
        return envelope.liveShelf == nil && envelope.preferences.launchAtLogin
    }

    private static func createsFileBackedItemsFromDroppedPaths() throws -> Bool {
        let dir = tempDirectory()
        defer { removeTemp(dir) }
        let fileURL = dir.appendingPathComponent("sample.txt")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try "hello".write(to: fileURL, atomically: true, encoding: .utf8)
        let service = PayloadService(assetsURL: dir, bookmarkService: MockBookmarkService())
        let items = service.items(from: .fileDrop(paths: [fileURL.path]))
        guard items.count == 1, items.first?.kind == .file, items.first?.fileBackedPath == fileURL.path else {
            return false
        }
        if case .file(let item) = items.first {
            return item.mimeType == "text/plain"
        }
        return false
    }

    private static func importsPathlessImagesIntoAppStorage() throws -> Bool {
        let dir = tempDirectory()
        defer { removeTemp(dir) }
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let service = PayloadService(assetsURL: dir, bookmarkService: MockBookmarkService())
        let items = service.items(from: .image(
            mimeType: "image/png",
            base64: Data("png-data".utf8).base64EncodedString(),
            filenameHint: "dragged-image"
        ))
        return items.first?.kind == .imageAsset &&
            items.first?.fileBackedPath?.contains(dir.path) == true &&
            items.first?.title == "dragged-image.png"
    }

    private static func skipsInvalidDroppedPaths() throws -> Bool {
        let dir = tempDirectory()
        defer { removeTemp(dir) }
        let fileURL = dir.appendingPathComponent("sample.txt")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try "hello".write(to: fileURL, atomically: true, encoding: .utf8)
        let service = PayloadService(assetsURL: dir, bookmarkService: MockBookmarkService())
        let items = service.items(from: .fileDrop(paths: [fileURL.path, dir.appendingPathComponent("missing.txt").path]))
        return items.count == 1 && items.first?.kind == .file
    }

    private static func detectsPayloadsFromText() throws -> Bool {
        let service = PayloadService(assetsURL: tempDirectory(), bookmarkService: MockBookmarkService())
        return service.detectPayload(fromText: "https://example.com/test") == .url(url: "https://example.com/test", label: "https://example.com/test") &&
            service.detectPayload(fromText: "just a note") == .text("just a note")
    }

    private static func marksMissingRefsUnavailable() throws -> Bool {
        let service = PayloadService(assetsURL: tempDirectory(), bookmarkService: MockBookmarkService())
        let refreshed = service.refreshFileRef(FileRef(
            originalPath: "/tmp/ledge-native-missing-item.txt",
            resolvedPath: "/tmp/ledge-native-missing-item.txt",
            isMissing: false
        ))
        return refreshed.isMissing && refreshed.resolvedPath.isEmpty
    }

    private static func normalizesExcludedBundleIdentifiers() throws -> Bool {
        let result = PreferencesUtilities.normalizeExcludedBundleIds([
            " com.apple.finder ",
            "com.apple.finder",
            "",
            "com.example.Ledge"
        ])
        return result.normalized == ["com.apple.finder", "com.example.Ledge"] && result.invalid.isEmpty
    }

    private static func validatesGlobalShortcuts() throws -> Bool {
        ShortcutUtilities.validateGlobalShortcut("").isEmpty &&
            ShortcutUtilities.normalizeGlobalShortcut(" CommandOrControl + Shift + Space ") == "CommandOrControl+Shift+Space" &&
            ShortcutUtilities.validateGlobalShortcut("Command+Command+Space") == "Shortcut contains duplicate modifier keys." &&
            ShortcutUtilities.validateGlobalShortcut("Command+Shift") == "Shortcut needs a non-modifier key."
    }

    private static func detectsBalancedDragShake() throws -> Bool {
        let tracker = DragGestureTracker(
            shakeDetector: ShakeDetector(sensitivity: .balanced),
            currentBundleId: { "com.apple.finder" }
        )
        tracker.handleMouseDown()

        let samples: [(CGFloat, TimeInterval)] = [
            (0, 0.00),
            (80, 0.10),
            (10, 0.20),
            (92, 0.28),
            (18, 0.38)
        ]

        return samples.contains { sample in
            tracker.handleMouseDragged(
                point: CGPoint(x: sample.0, y: 48),
                timestamp: sample.1,
                isGestureEnabled: true,
                excludedBundleIds: []
            ).contains { event in
                if case .shakeDetected = event { return true }
                return false
            }
        }
    }

    private static func textItem(id: String, text: String) -> ShelfItemRecord {
        .text(TextItemRecord(
            base: ShelfItemBase(
                id: id,
                createdAt: ISO8601DateFormatter().string(from: Date()),
                order: 0,
                title: text,
                preview: PreviewRecord(summary: text)
            ),
            text: text,
            savedFilePath: nil
        ))
    }

    private static func tempDirectory() -> URL {
        FileManager.default.temporaryDirectory.appendingPathComponent("ledge-native-self-test-\(UUID().uuidString)", isDirectory: true)
    }

    private static func removeTemp(_ url: URL) {
        try? FileManager.default.removeItem(at: url)
    }
}

private struct MockBookmarkService: BookmarkServicing {
    func createBookmark(path: String) throws -> String {
        "bookmark:\(path)"
    }

    func resolveBookmark(bookmarkBase64: String, originalPath: String) -> BookmarkResolution {
        BookmarkResolution(
            resolvedPath: bookmarkBase64.replacingOccurrences(of: "bookmark:", with: ""),
            isStale: false,
            isMissing: false
        )
    }
}
