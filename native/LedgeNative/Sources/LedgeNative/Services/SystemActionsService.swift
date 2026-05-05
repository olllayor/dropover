import AppKit
import Foundation
import Quartz
import ServiceManagement

final class QuickLookService: NSObject, QLPreviewPanelDataSource, QLPreviewPanelDelegate {
    private var previewURL: URL?

    func preview(path: String) -> Bool {
        previewURL = URL(fileURLWithPath: path)
        guard let panel = QLPreviewPanel.shared() else { return false }
        panel.dataSource = self
        panel.delegate = self
        panel.reloadData()
        panel.makeKeyAndOrderFront(nil)
        return true
    }

    func numberOfPreviewItems(in panel: QLPreviewPanel!) -> Int {
        previewURL == nil ? 0 : 1
    }

    func previewPanel(_ panel: QLPreviewPanel!, previewItemAt index: Int) -> QLPreviewItem! {
        previewURL as NSURL?
    }
}

final class SystemActionsService {
    private let quickLookService = QuickLookService()

    func openPermissionSettings() {
        if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility") {
            NSWorkspace.shared.open(url)
        }
    }

    func previewItem(_ item: ShelfItemRecord) -> Bool {
        guard let path = item.fileBackedPath else { return false }
        return quickLookService.preview(path: path)
    }

    func revealItem(_ item: ShelfItemRecord) -> Bool {
        guard let path = item.fileBackedPath else { return false }
        NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: path)])
        return true
    }

    func openItem(_ item: ShelfItemRecord) -> Bool {
        switch item {
        case .url(let record):
            guard let url = URL(string: record.url) else { return false }
            NSWorkspace.shared.open(url)
            return true
        case .text(let record):
            guard let path = record.savedFilePath else { return false }
            NSWorkspace.shared.open(URL(fileURLWithPath: path))
            return true
        case .file, .folder, .imageAsset:
            guard let path = item.fileBackedPath else { return false }
            NSWorkspace.shared.open(URL(fileURLWithPath: path))
            return true
        }
    }

    func copyItem(_ item: ShelfItemRecord) -> Bool {
        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()

        switch item {
        case .text(let record):
            pasteboard.setString(record.text, forType: .string)
            return true
        case .url(let record):
            pasteboard.setString(record.url, forType: .string)
            return true
        case .file, .folder, .imageAsset:
            guard let path = item.fileBackedPath else { return false }
            pasteboard.writeObjects([URL(fileURLWithPath: path) as NSURL])
            pasteboard.setString(path, forType: .string)
            return true
        }
    }

    func saveItem(_ item: ShelfItemRecord, defaultDirectory: URL) -> Bool {
        let defaultName: String
        let contents: String

        switch item {
        case .text(let record):
            defaultName = "\(Self.sanitizeName(record.base.title)).txt"
            contents = record.text
        case .url(let record):
            defaultName = "\(Self.sanitizeName(record.base.title)).webloc"
            contents = ShortcutUtilities.urlToWebloc(record.url)
        case .file, .folder, .imageAsset:
            return false
        }

        let panel = NSSavePanel()
        panel.directoryURL = defaultDirectory
        panel.nameFieldStringValue = defaultName
        guard panel.runModal() == .OK, let url = panel.url else { return false }

        do {
            try contents.write(to: url, atomically: true, encoding: .utf8)
            return true
        } catch {
            return false
        }
    }

    func shareItems(_ items: [ShelfItemRecord], relativeTo rect: NSRect = .zero, in view: NSView? = nil) -> Bool {
        let urls = items.compactMap { item -> URL? in
            guard let path = item.fileBackedPath else { return nil }
            return URL(fileURLWithPath: path)
        }
        guard !urls.isEmpty else { return false }

        let picker = NSSharingServicePicker(items: urls)
        if let view {
            picker.show(relativeTo: rect, of: view, preferredEdge: .minY)
        } else {
            guard let contentView = NSApp.keyWindow?.contentView else { return false }
            picker.show(relativeTo: .zero, of: contentView, preferredEdge: .minY)
        }
        return true
    }

    func setLaunchAtLogin(_ enabled: Bool) {
        if #available(macOS 13.0, *) {
            do {
                if enabled {
                    try SMAppService.mainApp.register()
                } else {
                    try SMAppService.mainApp.unregister()
                }
            } catch {
                fputs("Unable to update launch at login: \(error)\n", stderr)
            }
        }
    }

    private static func sanitizeName(_ value: String) -> String {
        let cleaned = value
            .replacingOccurrences(of: #"[^a-z0-9-_]+"#, with: "-", options: [.regularExpression, .caseInsensitive])
            .replacingOccurrences(of: #"^-+|-+$"#, with: "", options: .regularExpression)
        return cleaned.isEmpty ? "drop-item" : cleaned
    }
}
