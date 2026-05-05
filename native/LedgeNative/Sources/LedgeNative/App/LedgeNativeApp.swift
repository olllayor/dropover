import AppKit
import Combine
import SwiftUI

@main
struct LedgeNativeApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    init() {
        if CommandLine.arguments.contains("--self-test") {
            exit(SelfTestRunner.run())
        }
    }

    var body: some Scene {
        Settings {
            EmptyView()
        }
    }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private let model = LedgeAppModel()
    private var shelfPanelController: ShelfPanelController?
    private var preferencesWindowController: PreferencesWindowController?
    private var statusBarController: StatusBarController?
    private var cancellables = Set<AnyCancellable>()

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)

        let shelfPanelController = ShelfPanelController(model: model)
        let preferencesWindowController = PreferencesWindowController(model: model)
        let statusBarController = StatusBarController(model: model)

        self.shelfPanelController = shelfPanelController
        self.preferencesWindowController = preferencesWindowController
        self.statusBarController = statusBarController

        model.onShowShelfRequested = { point, inactive, sizeOverride in
            shelfPanelController.showNear(point: point, inactive: inactive, sizeOverride: sizeOverride)
        }
        model.onHideShelfRequested = {
            shelfPanelController.resetPosition()
            shelfPanelController.hide()
        }
        model.onShowPreferencesRequested = {
            preferencesWindowController.show()
        }

        model.$state
            .receive(on: DispatchQueue.main)
            .sink { _ in
                statusBarController.rebuildMenu()
            }
            .store(in: &cancellables)

        model.start()
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        model.showPreferences()
        return true
    }
}
