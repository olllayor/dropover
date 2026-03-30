import Foundation

enum SelfTestRunner {
    static func run() -> Int32 {
        let cases: [(String, Bool)] = [
            ("balanced detects intentional shake", balancedDetectsIntentionalShake()),
            ("jitter does not trigger shake", jitterDoesNotTriggerShake()),
            ("firm sensitivity needs more reversals", firmSensitivityNeedsMoreReversals())
        ]

        for (name, passed) in cases {
            if passed {
                fputs("PASS: \(name)\n", stdout)
            } else {
                fputs("FAIL: \(name)\n", stderr)
                return 1
            }
        }

        return 0
    }

    private static func balancedDetectsIntentionalShake() -> Bool {
        let detector = ShakeDetector(sensitivity: .balanced)
        let samples: [(CGFloat, TimeInterval)] = [
            (0, 0.00),
            (80, 0.10),
            (10, 0.20),
            (92, 0.28),
            (18, 0.38)
        ]

        return samples.contains { point in
            detector.ingest(x: point.0, timestamp: point.1)
        }
    }

    private static func jitterDoesNotTriggerShake() -> Bool {
        let detector = ShakeDetector(sensitivity: .balanced)
        let samples: [(CGFloat, TimeInterval)] = [
            (0, 0.00),
            (8, 0.05),
            (2, 0.11),
            (10, 0.16),
            (3, 0.20)
        ]

        return !samples.contains { point in
            detector.ingest(x: point.0, timestamp: point.1)
        }
    }

    private static func firmSensitivityNeedsMoreReversals() -> Bool {
        let detector = ShakeDetector(sensitivity: .firm)
        let samples: [(CGFloat, TimeInterval)] = [
            (0, 0.00),
            (120, 0.09),
            (20, 0.16),
            (132, 0.26),
            (28, 0.33)
        ]

        return !samples.contains { point in
            detector.ingest(x: point.0, timestamp: point.1)
        }
    }
}
