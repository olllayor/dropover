import AppKit

@MainActor
final class StatusBarController {
    private let model: LedgeAppModel
    private let statusItem: NSStatusItem

    init(model: LedgeAppModel) {
        self.model = model
        self.statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        configureButton()
        rebuildMenu()
    }

    func rebuildMenu() {
        let menu = NSMenu()
        menu.addItem(NSMenuItem(title: "New Shelf", action: #selector(newShelf), keyEquivalent: ""))
        menu.addItem(NSMenuItem(title: "New Shelf From Clipboard", action: #selector(newShelfFromClipboard), keyEquivalent: ""))

        let recentMenu = NSMenu()
        if model.state.recentShelves.isEmpty {
            let empty = NSMenuItem(title: "No recent shelves", action: nil, keyEquivalent: "")
            empty.isEnabled = false
            recentMenu.addItem(empty)
        } else {
            for shelf in model.state.recentShelves {
                let item = NSMenuItem(title: "\(shelf.name) (\(shelf.items.count))", action: #selector(restoreShelf(_:)), keyEquivalent: "")
                item.representedObject = shelf.id
                item.target = self
                recentMenu.addItem(item)
            }
        }
        let recentItem = NSMenuItem(title: "Recent Shelves", action: nil, keyEquivalent: "")
        recentItem.submenu = recentMenu
        menu.addItem(recentItem)

        menu.addItem(.separator())
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.1.9-native"
        let versionItem = NSMenuItem(title: "Version \(version)", action: nil, keyEquivalent: "")
        versionItem.isEnabled = false
        menu.addItem(versionItem)
        menu.addItem(NSMenuItem(title: "New in This Version...", action: #selector(openWhatsNew), keyEquivalent: ""))
        menu.addItem(NSMenuItem(title: "Quick Start Guide...", action: #selector(openQuickStart), keyEquivalent: ""))
        menu.addItem(NSMenuItem(title: "About Ledge...", action: #selector(showAbout), keyEquivalent: ""))
        menu.addItem(NSMenuItem(title: "Settings...", action: #selector(openSettings), keyEquivalent: ","))
        menu.addItem(.separator())
        menu.addItem(NSMenuItem(title: "Quit", action: #selector(quit), keyEquivalent: "q"))

        for item in menu.items where item.target == nil {
            item.target = self
        }
        statusItem.menu = menu
    }

    private func configureButton() {
        guard let button = statusItem.button else { return }
        button.image = Self.statusImage()
        button.image?.isTemplate = true
        button.toolTip = "Ledge"
    }

    @objc private func newShelf() {
        model.createShelf(origin: .tray)
    }

    @objc private func newShelfFromClipboard() {
        model.createShelfFromClipboard()
    }

    @objc private func restoreShelf(_ sender: NSMenuItem) {
        guard let id = sender.representedObject as? String else { return }
        model.restoreShelf(id: id)
    }

    @objc private func openWhatsNew() {
        NSWorkspace.shared.open(URL(string: "https://github.com/olllayor/ledge/releases")!)
    }

    @objc private func openQuickStart() {
        NSWorkspace.shared.open(URL(string: "https://github.com/olllayor/ledge#readme")!)
    }

    @objc private func showAbout() {
        NSApp.orderFrontStandardAboutPanel(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    @objc private func openSettings() {
        model.showPreferences()
    }

    @objc private func quit() {
        NSApp.terminate(nil)
    }

    private static func statusImage() -> NSImage {
        let image = NSImage(size: NSSize(width: 18, height: 18))
        image.lockFocus()
        NSColor.black.setFill()
        NSBezierPath(roundedRect: NSRect(x: 2.2, y: 4.2, width: 13.6, height: 3.1), xRadius: 1.55, yRadius: 1.55).fill()
        NSBezierPath(roundedRect: NSRect(x: 5.3, y: 9.0, width: 7.4, height: 4.9), xRadius: 1.8, yRadius: 1.8).fill()
        NSColor.white.setFill()
        NSBezierPath(roundedRect: NSRect(x: 6.7, y: 11.45, width: 4.6, height: 0.95), xRadius: 0.475, yRadius: 0.475).fill()
        NSBezierPath(roundedRect: NSRect(x: 6.25, y: 5.3, width: 5.5, height: 0.95), xRadius: 0.475, yRadius: 0.475).fill()
        image.unlockFocus()
        image.isTemplate = true
        return image
    }
}
