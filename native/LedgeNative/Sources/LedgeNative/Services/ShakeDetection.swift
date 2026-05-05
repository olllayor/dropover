import CoreGraphics
import Foundation

struct SensitivityProfile {
    var minimumReversals: Int
    var minimumDistance: CGFloat
    var segmentThreshold: CGFloat
    var window: TimeInterval
}

extension ShakeSensitivity {
    var profile: SensitivityProfile {
        switch self {
        case .gentle:
            SensitivityProfile(minimumReversals: 2, minimumDistance: 26, segmentThreshold: 8, window: 0.65)
        case .balanced:
            SensitivityProfile(minimumReversals: 2, minimumDistance: 34, segmentThreshold: 10, window: 0.62)
        case .firm:
            SensitivityProfile(minimumReversals: 4, minimumDistance: 44, segmentThreshold: 12, window: 0.62)
        }
    }
}

struct DragPoint {
    var x: CGFloat
    var timestamp: TimeInterval
}

final class ShakeDetector {
    private var lastPoint: DragPoint?
    private var lastDirection: CGFloat = 0
    private var lastTurningPointX: CGFloat?
    private var reversalTimestamps: [TimeInterval] = []
    private(set) var sensitivity: ShakeSensitivity

    init(sensitivity: ShakeSensitivity = .balanced) {
        self.sensitivity = sensitivity
    }

    func reset() {
        lastPoint = nil
        lastDirection = 0
        lastTurningPointX = nil
        reversalTimestamps.removeAll()
    }

    func updateSensitivity(_ sensitivity: ShakeSensitivity) {
        self.sensitivity = sensitivity
        reset()
    }

    func ingest(x: CGFloat, timestamp: TimeInterval) -> Bool {
        let profile = sensitivity.profile
        defer {
            reversalTimestamps.removeAll { timestamp - $0 > profile.window }
        }

        guard let previous = lastPoint else {
            lastPoint = DragPoint(x: x, timestamp: timestamp)
            lastTurningPointX = x
            return false
        }

        let delta = x - previous.x
        lastPoint = DragPoint(x: x, timestamp: timestamp)

        guard abs(delta) >= profile.segmentThreshold else {
            return false
        }

        let direction: CGFloat = delta > 0 ? 1 : -1
        if lastDirection == 0 {
            lastDirection = direction
            lastTurningPointX = previous.x
            return false
        }

        guard direction != lastDirection else {
            return false
        }

        let turningPointX = lastTurningPointX ?? previous.x
        let traveled = abs(previous.x - turningPointX)
        lastDirection = direction
        lastTurningPointX = previous.x

        guard traveled >= profile.minimumDistance else {
            return false
        }

        reversalTimestamps.append(timestamp)
        if reversalTimestamps.count >= profile.minimumReversals {
            reset()
            return true
        }

        return false
    }
}

enum DragGestureEvent: Equatable {
    case dragStarted(sourceBundleId: String)
    case shakeDetected(point: CGPoint, sourceBundleId: String)
    case dragEnded
}

final class DragGestureTracker {
    private let shakeDetector: ShakeDetector
    private let currentBundleId: () -> String
    private var isArmed = false
    private var dragActive = false

    init(shakeDetector: ShakeDetector = ShakeDetector(), currentBundleId: @escaping () -> String = { "" }) {
        self.shakeDetector = shakeDetector
        self.currentBundleId = currentBundleId
    }

    func updateSensitivity(_ sensitivity: ShakeSensitivity) {
        shakeDetector.updateSensitivity(sensitivity)
    }

    func handleMouseDown() {
        isArmed = true
        dragActive = false
        shakeDetector.reset()
    }

    func handleMouseDragged(
        point: CGPoint,
        timestamp: TimeInterval,
        isGestureEnabled: Bool,
        excludedBundleIds: Set<String>
    ) -> [DragGestureEvent] {
        guard isGestureEnabled, isArmed else { return [] }

        let bundleId = currentBundleId()
        guard !excludedBundleIds.contains(bundleId) else { return [] }

        var events: [DragGestureEvent] = []
        if !dragActive {
            dragActive = true
            events.append(.dragStarted(sourceBundleId: bundleId))
        }
        if shakeDetector.ingest(x: point.x, timestamp: timestamp) {
            events.append(.shakeDetected(point: point, sourceBundleId: bundleId))
        }
        return events
    }

    func handleMouseUp() -> [DragGestureEvent] {
        let shouldEmitDragEnded = dragActive
        reset()
        return shouldEmitDragEnded ? [.dragEnded] : []
    }

    func reset() {
        isArmed = false
        dragActive = false
        shakeDetector.reset()
    }
}
