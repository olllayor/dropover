import AppKit
import ApplicationServices
import Foundation

final class NativeAgent {
    private let decoder = JSONDecoder()
    private let encoder = JSONEncoder()
    private let outputLock = NSLock()
    private let gestureTracker = DragGestureTracker(
        currentBundleId: {
            NSWorkspace.shared.frontmostApplication?.bundleIdentifier ?? ""
        }
    )
    private var isGestureEnabled = true
    private var excludedBundleIds: Set<String> = []
    private var eventTap: CFMachPort?
    private var eventTapSource: CFRunLoopSource?
    private var tapReinstallScheduled = false

    func run() {
        installEventTapIfNeeded()
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            self?.readLoop()
        }
        RunLoop.main.run()
    }

    private func readLoop() {
        while let line = readLine() {
            if line.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                continue
            }

            handle(line: line)
        }
    }

    private func handle(line: String) {
        guard let data = line.data(using: .utf8) else { return }

        do {
            let request = try decoder.decode(JsonRpcRequest.self, from: data)
            let result = try handle(request: request)
            sendResponse(JsonRpcResponse(id: request.id, result: result, error: nil))
        } catch {
            sendResponse(JsonRpcResponse(id: nil, result: nil, error: JsonRpcError(code: -32603, message: error.localizedDescription)))
        }
    }

    private func handle(request: JsonRpcRequest) throws -> JSONValue {
        switch request.method {
        case "permissions.getStatus":
            return .object([
                "accessibilityTrusted": .bool(AXIsProcessTrusted())
            ])
        case "permissions.openSettings":
            if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility") {
                NSWorkspace.shared.open(url)
            }
            return .bool(true)
        case "gesture.start":
            isGestureEnabled = request.params?["enabled"]?.boolValue ?? true
            let sensitivity = ShakeSensitivity(rawValue: request.params?["sensitivity"]?.stringValue ?? "balanced") ?? .balanced
            gestureTracker.updateSensitivity(sensitivity)
            excludedBundleIds = Set(request.params?["excludedBundleIds"]?.arrayValue?.compactMap(\.stringValue) ?? [])
            installEventTapIfNeeded()
            return .bool(true)
        case "gesture.stop":
            isGestureEnabled = false
            gestureTracker.reset()
            return .bool(true)
        case "bookmarks.create":
            guard let path = request.params?["path"]?.stringValue else {
                return .string("")
            }
            return .string(try createBookmark(path: path))
        case "bookmarks.resolve":
            guard let bookmarkBase64 = request.params?["bookmarkBase64"]?.stringValue,
                  let originalPath = request.params?["originalPath"]?.stringValue else {
                return .object([
                    "resolvedPath": .string(""),
                    "isStale": .bool(false),
                    "isMissing": .bool(true)
                ])
            }
            let resolution = resolveBookmark(bookmarkBase64: bookmarkBase64, originalPath: originalPath)
            return .object([
                "resolvedPath": .string(resolution.resolvedPath),
                "isStale": .bool(resolution.isStale),
                "isMissing": .bool(resolution.isMissing)
            ])
        default:
            throw NSError(domain: "DropShelfNativeAgent", code: -32601, userInfo: [NSLocalizedDescriptionKey: "Unknown method \(request.method)"])
        }
    }

    private func createBookmark(path: String) throws -> String {
        let url = URL(fileURLWithPath: path)
        let data = try url.bookmarkData(options: .minimalBookmark, includingResourceValuesForKeys: nil, relativeTo: nil)
        return data.base64EncodedString()
    }

    private func resolveBookmark(bookmarkBase64: String, originalPath: String) -> (resolvedPath: String, isStale: Bool, isMissing: Bool) {
        guard let bookmarkData = Data(base64Encoded: bookmarkBase64) else {
            return (originalPath, false, !FileManager.default.fileExists(atPath: originalPath))
        }

        do {
            var isStale = false
            let url = try URL(resolvingBookmarkData: bookmarkData, options: [.withoutUI], relativeTo: nil, bookmarkDataIsStale: &isStale)
            let path = url.path
            return (path, isStale, !FileManager.default.fileExists(atPath: path))
        } catch {
            return (originalPath, false, !FileManager.default.fileExists(atPath: originalPath))
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

                let agent = Unmanaged<NativeAgent>.fromOpaque(userInfo).takeUnretainedValue()
                return agent.handleEventTap(type: type, event: event)
            },
            userInfo: Unmanaged.passUnretained(self).toOpaque()
        ) else {
            writeError("Unable to install session event tap for shake detection.")
            return
        }

        let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
        eventTap = tap
        eventTapSource = source

        if let source {
            CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
        }

        CGEvent.tapEnable(tap: tap, enable: true)
    }

    private func handleEventTapDisabled(type: CGEventType) {
        guard !tapReinstallScheduled else { return }

        tapReinstallScheduled = true
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.tapReinstallScheduled = false
            self.gestureTracker.reset()
            self.invalidateEventTap()
            self.installEventTapIfNeeded()
            if self.eventTap == nil {
                self.writeError("Shake event tap did not recover after \(type.rawValue).")
            }
        }
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
            let point = event.location
            let events = gestureTracker.handleMouseDragged(
                point: point,
                timestamp: eventTimestampInSeconds(event.timestamp),
                isGestureEnabled: isGestureEnabled,
                excludedBundleIds: excludedBundleIds
            )
            emit(events: events)
        case .leftMouseUp:
            emit(events: gestureTracker.handleMouseUp())
        default:
            break
        }

        return Unmanaged.passUnretained(event)
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

    private func emit(events: [DragGestureEvent]) {
        for event in events {
            switch event {
            case .dragStarted(let sourceBundleId):
                sendNotification(method: "gesture.dragStarted", params: [
                    "sourceBundleId": .string(sourceBundleId)
                ])
            case .shakeDetected(let point, let sourceBundleId):
                let translatedPoint = electronPoint(for: point)
                let displayId = displayIndex(for: point)
                sendNotification(method: "gesture.shakeDetected", params: [
                    "x": .double(translatedPoint.x),
                    "y": .double(translatedPoint.y),
                    "displayId": .int(displayId),
                    "sourceBundleId": .string(sourceBundleId)
                ])
            case .dragEnded:
                sendNotification(method: "gesture.dragEnded", params: nil)
            }
        }
    }

    private func displayIndex(for point: CGPoint) -> Int {
        for (index, screen) in NSScreen.screens.enumerated() where screen.frame.contains(point) {
            return index
        }
        return 0
    }

    private func electronPoint(for point: CGPoint) -> CGPoint {
        for screen in NSScreen.screens where screen.frame.contains(point) {
            let translatedY = screen.frame.maxY - point.y
            return CGPoint(x: point.x, y: translatedY)
        }

        return point
    }

    private func sendNotification(method: String, params: [String: JSONValue]?) {
        let notification = JsonRpcNotification(method: method, params: params)
        sendEncodable(notification)
    }

    private func sendResponse(_ response: JsonRpcResponse) {
        sendEncodable(response)
    }

    private func sendEncodable<T: Encodable>(_ value: T) {
        do {
            let data = try encoder.encode(value)
            outputLock.lock()
            defer { outputLock.unlock() }
            FileHandle.standardOutput.write(data)
            FileHandle.standardOutput.write("\n".data(using: .utf8)!)
        } catch {
            // Ignore serialization errors to keep the agent alive.
        }
    }

    private func writeError(_ message: String) {
        guard let data = "\(message)\n".data(using: .utf8) else { return }
        FileHandle.standardError.write(data)
    }

    private func eventMask(for type: CGEventType) -> CGEventMask {
        CGEventMask(1) << type.rawValue
    }

    private func eventTimestampInSeconds(_ timestamp: CGEventTimestamp) -> TimeInterval {
        TimeInterval(timestamp) / 1_000_000_000
    }
}

if CommandLine.arguments.contains("--self-test") {
    exit(SelfTestRunner.run())
}

let agent = NativeAgent()
agent.run()
