// swift-tools-version: 5.10

import PackageDescription

let package = Package(
    name: "LedgeNative",
    platforms: [
        .macOS(.v12)
    ],
    products: [
        .executable(name: "LedgeNative", targets: ["LedgeNative"])
    ],
    targets: [
        .executableTarget(
            name: "LedgeNative",
            path: "Sources/LedgeNative"
        )
    ]
)
