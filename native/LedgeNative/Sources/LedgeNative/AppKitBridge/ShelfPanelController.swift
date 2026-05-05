import AppKit
import SwiftUI

@MainActor
final class ShelfPanelController: NSObject {
    private let model: LedgeAppModel
    private var panel: NSPanel?
    private var manualFrame: NSRect?
    private var programmaticMoveDepth = 0

    init(model: LedgeAppModel) {
        self.model = model
        super.init()
    }

    func showNear(point: CGPoint, inactive: Bool, sizeOverride: CGSize? = nil) {
        let panel = ensurePanel()
        let size = sizeOverride ?? panel.frame.size
        let frame = manualFrame ?? Self.computeFrame(point: point, size: size)
        withProgrammaticMove {
            panel.setFrame(frame, display: true)
        }

        if inactive {
            panel.orderFrontRegardless()
        } else {
            panel.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
        }
    }

    func hide() {
        panel?.orderOut(nil)
    }

    func resetPosition() {
        manualFrame = nil
    }

    private func ensurePanel() -> NSPanel {
        if let panel {
            return panel
        }

        let panel = LedgeShelfPanel(
            contentRect: NSRect(x: 0, y: 0, width: 320, height: 380),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        panel.isFloatingPanel = true
        panel.level = .floating
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .ignoresCycle]
        panel.hidesOnDeactivate = false
        panel.isMovableByWindowBackground = true
        panel.backgroundColor = .clear
        panel.isOpaque = false
        panel.hasShadow = true
        panel.titleVisibility = .hidden
        panel.titlebarAppearsTransparent = true
        panel.contentView = NSHostingView(rootView: ShelfView(model: model))
        panel.delegate = self
        self.panel = panel
        return panel
    }

    private func withProgrammaticMove(_ callback: () -> Void) {
        programmaticMoveDepth += 1
        callback()
        programmaticMoveDepth -= 1
    }

    private static func computeFrame(point: CGPoint, size: CGSize) -> NSRect {
        let screen = NSScreen.screens.first(where: { $0.frame.contains(point) }) ?? NSScreen.main
        let area = screen?.visibleFrame ?? NSScreen.main?.visibleFrame ?? .zero
        let padding: CGFloat = 16
        let x = min(max(area.minX + padding, point.x - size.width / 2), area.maxX - size.width - padding)
        let y = min(max(area.minY + padding, point.y - size.height + 52), area.maxY - size.height - padding)
        return NSRect(x: round(x), y: round(y), width: size.width, height: size.height)
    }
}

extension ShelfPanelController: NSWindowDelegate {
    nonisolated func windowDidMove(_ notification: Notification) {
        Task { @MainActor in
            guard programmaticMoveDepth == 0, let panel else { return }
            manualFrame = panel.frame
        }
    }

    nonisolated func windowWillClose(_ notification: Notification) {
        Task { @MainActor in
            manualFrame = nil
            panel = nil
        }
    }
}

final class LedgeShelfPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
}
