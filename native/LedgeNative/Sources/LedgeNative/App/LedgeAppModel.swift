import AppKit
import Combine
import Foundation

@MainActor
final class LedgeAppModel: ObservableObject {
    @Published private(set) var state: AppState
    @Published var isImporting = false

    let store: StateStoreNative
    let systemActions = SystemActionsService()

    var onShowShelfRequested: ((CGPoint, Bool, CGSize?) -> Void)?
    var onHideShelfRequested: (() -> Void)?
    var onShowPreferencesRequested: (() -> Void)?

    private let bookmarkService = FileBookmarkService()
    private let gestureService = NativeGestureService()
    private let shortcutService = GlobalShortcutService()
    private var cancellables = Set<AnyCancellable>()
    private var gestureStatus = PermissionStatus(nativeHelperAvailable: true)
    private var shortcutRegistered = false
    private var shortcutError = ""

    init(store: StateStoreNative = StateStoreNative()) {
        self.store = store
        self.state = store.appState
        store.$appState
            .receive(on: DispatchQueue.main)
            .sink { [weak self] state in
                self?.state = state
            }
            .store(in: &cancellables)
    }

    func start() {
        gestureService.onShakeDetected = { [weak self] event in
            Task { @MainActor in
                self?.handleShakeDetected(event)
            }
        }
        gestureService.onStatusChanged = { [weak self] status in
            Task { @MainActor in
                self?.gestureStatus = status
                self?.publishPermissionStatus()
            }
        }
        gestureService.start(preferences: state.preferences)
        syncSystemPreferences()
        publishPermissionStatus()
    }

    func createShelf(origin: ShelfOrigin, point: CGPoint = NSEvent.mouseLocation, inactive: Bool = false, sizeOverride: CGSize? = nil) {
        if state.liveShelf == nil {
            _ = store.createShelf(origin: origin)
        }
        onShowShelfRequested?(point, inactive, sizeOverride)
    }

    func closeShelf() {
        store.closeShelf()
        onHideShelfRequested?()
    }

    func restoreShelf(id: String) {
        guard var shelf = store.restoreShelf(id: id) else {
            publishState()
            return
        }
        shelf.items = shelf.items.map(refreshItem)
        store.replaceLiveShelf(shelf)
        onShowShelfRequested?(NSEvent.mouseLocation, false, nil)
    }

    func addPayloads(_ payloads: [IngestPayload], origin: ShelfOrigin = .manual, inactive: Bool = false) {
        guard !payloads.isEmpty else { return }
        isImporting = true
        let payloadService = PayloadService(assetsURL: store.assetsURL, bookmarkService: bookmarkService)

        Task {
            var allItems: [ShelfItemRecord] = []
            for payload in payloads {
                allItems.append(contentsOf: payloadService.items(from: payload))
            }

            await MainActor.run {
                self.isImporting = false
                guard !allItems.isEmpty else { return }
                _ = self.store.ensureLiveShelf(origin: origin)
                _ = self.store.appendItems(allItems)
                self.onShowShelfRequested?(NSEvent.mouseLocation, inactive, nil)
            }
        }
    }

    func createShelfFromClipboard() {
        let pasteboard = NSPasteboard.general

        if let fileURLs = pasteboard.readObjects(forClasses: [NSURL.self], options: nil) as? [URL], !fileURLs.isEmpty {
            addPayloads([.fileDrop(paths: fileURLs.map(\.path))], origin: .tray, inactive: true)
            return
        }

        if let image = NSImage(pasteboard: pasteboard), let payload = Self.imagePayload(from: image, filenameHint: "clipboard-image") {
            addPayloads([payload], origin: .tray, inactive: true)
            return
        }

        if let text = pasteboard.string(forType: .string)?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty {
            let payloadService = PayloadService(assetsURL: store.assetsURL, bookmarkService: bookmarkService)
            addPayloads([payloadService.detectPayload(fromText: text)], origin: .tray, inactive: true)
            return
        }

        createShelf(origin: .tray)
    }

    func removeItem(id: String) {
        _ = store.removeItem(id)
    }

    func clearShelf() {
        _ = store.clearLiveShelf()
    }

    func renameShelf(_ name: String) {
        _ = store.renameLiveShelf(name)
    }

    func reorderItems(_ itemIds: [String]) {
        _ = store.reorderItems(itemIds)
    }

    func setPreferences(_ update: (inout PreferencesRecord) -> Void) {
        _ = store.updatePreferences { preferences in
            update(&preferences)
            preferences.globalShortcut = ShortcutUtilities.normalizeGlobalShortcut(preferences.globalShortcut)
            preferences.excludedBundleIds = PreferencesUtilities.normalizeExcludedBundleIds(preferences.excludedBundleIds).normalized
        }
        gestureService.configure(preferences: state.preferences)
        syncSystemPreferences()
    }

    func openPermissionSettings() {
        gestureService.openPermissionSettings()
    }

    func showPreferences() {
        onShowPreferencesRequested?()
    }

    func dragProvider(for items: [ShelfItemRecord]) -> NSItemProvider {
        let urls = items.compactMap { item -> URL? in
            guard let path = item.fileBackedPath else { return nil }
            return URL(fileURLWithPath: path)
        }
        let provider = NSItemProvider()
        if let firstURL = urls.first {
            provider.registerFileRepresentation(forTypeIdentifier: "public.file-url", fileOptions: [], visibility: .all) { completion in
                completion(firstURL, true, nil)
                return nil
            }
        }
        clearShelf()
        return provider
    }

    private func handleShakeDetected(_ event: ShakeDetectedEvent) {
        let preferences = state.preferences
        guard preferences.shakeEnabled else { return }
        guard !preferences.excludedBundleIds.contains(event.sourceBundleId) else { return }
        createShelf(origin: .shake, point: event.point, inactive: true, sizeOverride: CGSize(width: 240, height: 296))
    }

    private func syncSystemPreferences() {
        systemActions.setLaunchAtLogin(state.preferences.launchAtLogin)
        let result = shortcutService.register(shortcut: state.preferences.globalShortcut) { [weak self] in
            Task { @MainActor in
                self?.createShelf(origin: .shortcut)
            }
        }
        shortcutRegistered = result.registered
        shortcutError = result.error
        publishPermissionStatus()
    }

    private func publishPermissionStatus() {
        var status = gestureStatus
        status.shortcutRegistered = shortcutRegistered
        status.shortcutError = shortcutError
        store.setPermissionStatus(status)
    }

    private func publishState() {
        _ = store.snapshot()
    }

    private func refreshItem(_ item: ShelfItemRecord) -> ShelfItemRecord {
        guard let refreshedFile = item.fileRef.map({ PayloadService(assetsURL: store.assetsURL, bookmarkService: bookmarkService).refreshFileRef($0) }) else {
            return item
        }

        switch item {
        case .file(let record):
            return .file(FileItemRecord(base: record.base, file: refreshedFile, mimeType: record.mimeType))
        case .folder(let record):
            return .folder(FolderItemRecord(base: record.base, file: refreshedFile))
        case .imageAsset(let record):
            return .imageAsset(ImageAssetItemRecord(base: record.base, file: refreshedFile, mimeType: record.mimeType))
        case .text, .url:
            return item
        }
    }

    private static func imagePayload(from image: NSImage, filenameHint: String) -> IngestPayload? {
        guard let tiff = image.tiffRepresentation,
              let bitmap = NSBitmapImageRep(data: tiff),
              let png = bitmap.representation(using: .png, properties: [:]) else {
            return nil
        }
        return .image(mimeType: "image/png", base64: png.base64EncodedString(), filenameHint: filenameHint)
    }
}
