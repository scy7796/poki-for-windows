// swift-tools-version: 5.10
// The part of the Poki keyboard that needs no UIKit: the mailbox the app and the keyboard share, and
// the plan for how text is typed. The app and the keyboard compile these files directly
// (project-base.yml); this package exists so they are tested on Linux and macOS with `swift test`.
import PackageDescription

let package = Package(
    name: "KeyboardShared",
    platforms: [.iOS(.v17), .macOS(.v14)],
    targets: [
        .target(name: "KeyboardShared"),
        .testTarget(name: "KeyboardSharedTests", dependencies: ["KeyboardShared"]),
    ]
)
