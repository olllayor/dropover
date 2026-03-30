import Foundation

public enum ShakeSensitivity: String, Codable {
    case gentle
    case balanced
    case firm

    var profile: SensitivityProfile {
        switch self {
        case .gentle:
            return SensitivityProfile(minimumReversals: 2, minimumDistance: 26, segmentThreshold: 8, window: 0.65)
        case .balanced:
            return SensitivityProfile(minimumReversals: 2, minimumDistance: 34, segmentThreshold: 10, window: 0.62)
        case .firm:
            return SensitivityProfile(minimumReversals: 4, minimumDistance: 44, segmentThreshold: 12, window: 0.62)
        }
    }
}

public struct SensitivityProfile {
    let minimumReversals: Int
    let minimumDistance: CGFloat
    let segmentThreshold: CGFloat
    let window: TimeInterval
}

public struct DragPoint {
    let x: CGFloat
    let timestamp: TimeInterval
}

public final class ShakeDetector {
    private var lastPoint: DragPoint?
    private var lastDirection: CGFloat = 0
    private var lastTurningPointX: CGFloat?
    private var reversalTimestamps: [TimeInterval] = []
    private(set) var sensitivity: ShakeSensitivity

    public init(sensitivity: ShakeSensitivity = .balanced) {
        self.sensitivity = sensitivity
    }

    public func reset() {
        lastPoint = nil
        lastDirection = 0
        lastTurningPointX = nil
        reversalTimestamps.removeAll()
    }

    public func updateSensitivity(_ sensitivity: ShakeSensitivity) {
        self.sensitivity = sensitivity
        reset()
    }

    public func ingest(x: CGFloat, timestamp: TimeInterval) -> Bool {
        let profile = sensitivity.profile
        defer {
            pruneOldReversals(now: timestamp, window: profile.window)
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

    private func pruneOldReversals(now: TimeInterval, window: TimeInterval) {
        reversalTimestamps.removeAll { now - $0 > window }
    }
}
