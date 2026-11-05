// swift-tools-version:5.9
// EvenhandCore: the capture app's logic without UI, testable on a Mac with `swift test`.
// Add it to the Xcode app as a local package (File > Add Package Dependencies > Add Local…).
import PackageDescription

let package = Package(
    name: "EvenhandCore",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [.library(name: "EvenhandCore", targets: ["EvenhandCore"])],
    targets: [
        .target(name: "EvenhandCore"),
        .executableTarget(name: "fixture-sign", dependencies: ["EvenhandCore"]),
        .testTarget(name: "EvenhandCoreTests", dependencies: ["EvenhandCore"]),
    ]
)
