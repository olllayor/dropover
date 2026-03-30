// swift-tools-version: 5.10

import PackageDescription

let package = Package(
    name: "DropShelfNativeAgent",
    platforms: [
        .macOS(.v12)
    ],
    products: [
        .executable(name: "DropShelfNativeAgent", targets: ["DropShelfNativeAgent"])
    ],
    targets: [
        .executableTarget(
            name: "DropShelfNativeAgent"
        )
    ]
)
