import AppKit
import ApplicationServices
import Foundation

final class NativeAgent {
    private let decoder = JSONDecoder()
    private let encoder = JSONEncoder()
    private let outputLock = NSLock()
    private let shakeDetector = ShakeDetector()
    private var isGestureEnabled = true
    private var excludedBundleIds: Set<String> = []
    private var monitors: [Any] = []
    private var dragActive = false

    func run() {
        installMonitorsIfNeeded()
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            self?.readLoop()
        }
        RunLoop.main.run()
    }

    private func readLoop() {
        while let line = readLine(), !line.isEmpty {
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
            shakeDetector.updateSensitivity(sensitivity)
            excludedBundleIds = Set(request.params?["excludedBundleIds"]?.arrayValue?.compactMap(\.stringValue) ?? [])
            installMonitorsIfNeeded()
            return .bool(true)
        case "gesture.stop":
            isGestureEnabled = false
            dragActive = false
            shakeDetector.reset()
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

    private func installMonitorsIfNeeded() {
        guard monitors.isEmpty else { return }

        let downMonitor = NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown]) { [weak self] _ in
            self?.shakeDetector.reset()
            self?.dragActive = false
        }

        let dragMonitor = NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDragged]) { [weak self] event in
            self?.handleDrag(event: event)
        }

        let upMonitor = NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseUp]) { [weak self] _ in
            self?.handleDragEnded()
        }

        monitors = [downMonitor, dragMonitor, upMonitor].compactMap { $0 }
    }

    private func handleDrag(event: NSEvent) {
        guard isGestureEnabled else { return }

        let bundleId = NSWorkspace.shared.frontmostApplication?.bundleIdentifier ?? ""
        guard !excludedBundleIds.contains(bundleId) else { return }

        if !dragActive {
            dragActive = true
            sendNotification(method: "gesture.dragStarted", params: [
                "sourceBundleId": .string(bundleId)
            ])
        }

        let point = NSEvent.mouseLocation
        if shakeDetector.ingest(x: point.x, timestamp: event.timestamp) {
            let translatedPoint = electronPoint(for: point)
            let displayId = displayIndex(for: point)
            sendNotification(method: "gesture.shakeDetected", params: [
                "x": .double(translatedPoint.x),
                "y": .double(translatedPoint.y),
                "displayId": .int(displayId),
                "sourceBundleId": .string(bundleId)
            ])
        }
    }

    private func handleDragEnded() {
        guard dragActive else { return }
        dragActive = false
        shakeDetector.reset()
        sendNotification(method: "gesture.dragEnded", params: nil)
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
}

if CommandLine.arguments.contains("--self-test") {
    exit(SelfTestRunner.run())
}

let agent = NativeAgent()
agent.run()
