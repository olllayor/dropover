import AppKit
import ApplicationServices
import Foundation

struct ShakeDetectedEvent {
    var point: CGPoint
    var displayId: Int
    var sourceBundleId: String
}

final class NativeGestureService {
    var onShakeDetected: ((ShakeDetectedEvent) -> Void)?
    var onStatusChanged: ((PermissionStatus) -> Void)?

    private let gestureTracker = DragGestureTracker(
        currentBundleId: {
            NSWorkspace.shared.frontmostApplication?.bundleIdentifier ?? ""
        }
    )
    private var isGestureEnabled = true
    private var excludedBundleIds = Set<String>()
    private var eventTap: CFMachPort?
    private var eventTapSource: CFRunLoopSource?
    private var tapReinstallScheduled = false
    private var status = PermissionStatus(nativeHelperAvailable: true)

    deinit {
        invalidateEventTap()
    }

    func start(preferences: PreferencesRecord) {
        configure(preferences: preferences)
        installEventTapIfNeeded()
        updateStatus(lastError: "")
    }

    func configure(preferences: PreferencesRecord) {
        isGestureEnabled = preferences.shakeEnabled
        excludedBundleIds = Set(preferences.excludedBundleIds)
        gestureTracker.updateSensitivity(preferences.shakeSensitivity)
        updateStatus(lastError: status.lastError)
    }

    func stop() {
        isGestureEnabled = false
        gestureTracker.reset()
        updateStatus(lastError: status.lastError)
    }

    func openPermissionSettings() {
        if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility") {
            NSWorkspace.shared.open(url)
        }
    }

    private func installEventTapIfNeeded() {
        guard eventTap == nil else { return }

        let eventsOfInterest =
            eventMask(for: .leftMouseDown) |
            eventMask(for: .leftMouseDragged) |
            eventMask(for: .leftMouseUp)

        guard let tap = CGEvent.tapCreate(
            tap: .cgSessionEventTap,
            place: .headInsertEventTap,
            options: .listenOnly,
            eventsOfInterest: eventsOfInterest,
            callback: { _, type, event, userInfo in
                guard let userInfo else {
                    return Unmanaged.passUnretained(event)
                }
                let service = Unmanaged<NativeGestureService>.fromOpaque(userInfo).takeUnretainedValue()
                return service.handleEventTap(type: type, event: event)
            },
            userInfo: Unmanaged.passUnretained(self).toOpaque()
        ) else {
            updateStatus(lastError: "Unable to install session event tap for shake detection.")
            return
        }

        let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
        eventTap = tap
        eventTapSource = source
        if let source {
            CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
        }
        CGEvent.tapEnable(tap: tap, enable: true)
        updateStatus(lastError: "")
    }

    private func handleEventTap(type: CGEventType, event: CGEvent) -> Unmanaged<CGEvent>? {
        if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
            handleEventTapDisabled(type: type)
            return Unmanaged.passUnretained(event)
        }

        switch type {
        case .leftMouseDown:
            gestureTracker.handleMouseDown()
        case .leftMouseDragged:
            emit(events: gestureTracker.handleMouseDragged(
                point: event.location,
                timestamp: TimeInterval(event.timestamp) / 1_000_000_000,
                isGestureEnabled: isGestureEnabled,
                excludedBundleIds: excludedBundleIds
            ))
        case .leftMouseUp:
            emit(events: gestureTracker.handleMouseUp())
        default:
            break
        }

        return Unmanaged.passUnretained(event)
    }

    private func handleEventTapDisabled(type: CGEventType) {
        guard !tapReinstallScheduled else { return }

        tapReinstallScheduled = true
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            tapReinstallScheduled = false
            gestureTracker.reset()
            invalidateEventTap()
            installEventTapIfNeeded()
            if eventTap == nil {
                updateStatus(lastError: "Shake event tap did not recover after \(type.rawValue).")
            }
        }
    }

    private func emit(events: [DragGestureEvent]) {
        for event in events {
            if case .shakeDetected(let point, let sourceBundleId) = event {
                onShakeDetected?(ShakeDetectedEvent(
                    point: point,
                    displayId: displayIndex(for: point),
                    sourceBundleId: sourceBundleId
                ))
            }
        }
    }

    private func displayIndex(for point: CGPoint) -> Int {
        for (index, screen) in NSScreen.screens.enumerated() where screen.frame.contains(point) {
            return index
        }
        return 0
    }

    private func invalidateEventTap() {
        if let source = eventTapSource {
            CFRunLoopRemoveSource(CFRunLoopGetMain(), source, .commonModes)
            eventTapSource = nil
        }
        if let tap = eventTap {
            CFMachPortInvalidate(tap)
            eventTap = nil
        }
    }

    private func updateStatus(lastError: String) {
        let trusted = AXIsProcessTrusted()
        status = PermissionStatus(
            nativeHelperAvailable: true,
            accessibilityTrusted: trusted,
            shakeReady: trusted && isGestureEnabled && eventTap != nil,
            lastError: lastError,
            shortcutRegistered: status.shortcutRegistered,
            shortcutError: status.shortcutError
        )
        onStatusChanged?(status)
    }

    private func eventMask(for type: CGEventType) -> CGEventMask {
        CGEventMask(1) << type.rawValue
    }
}
