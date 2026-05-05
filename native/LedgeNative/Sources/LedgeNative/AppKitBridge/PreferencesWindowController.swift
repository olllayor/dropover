import AppKit
import SwiftUI

@MainActor
final class PreferencesWindowController: NSObject {
    private let model: LedgeAppModel
    private var window: NSWindow?

    init(model: LedgeAppModel) {
        self.model = model
        super.init()
    }

    func show() {
        let window = ensureWindow()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    private func ensureWindow() -> NSWindow {
        if let window {
            return window
        }

        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 780, height: 640),
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        window.minSize = NSSize(width: 680, height: 520)
        window.title = "Ledge Settings"
        window.titlebarAppearsTransparent = true
        window.contentView = NSHostingView(rootView: PreferencesView(model: model))
        window.center()
        window.delegate = self
        self.window = window
        return window
    }
}

extension PreferencesWindowController: NSWindowDelegate {
    nonisolated func windowWillClose(_ notification: Notification) {
        Task { @MainActor in
            window = nil
        }
    }
}
