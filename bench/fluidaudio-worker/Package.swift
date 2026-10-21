// swift-tools-version: 6.2
import PackageDescription

// FluidAudio is pinned to the release TypeWhisper for macOS ships
// (TypeWhisperPluginSDK/Package.swift in typewhisper-mac), so results match the app's runtime.
let package = Package(
    name: "FluidAudioWorker",
    platforms: [.macOS(.v15)],
    dependencies: [
        .package(url: "https://github.com/FluidInference/FluidAudio.git", exact: "0.17.5", traits: []),
    ],
    targets: [
        .executableTarget(
            name: "FluidAudioWorker",
            dependencies: [.product(name: "FluidAudio", package: "FluidAudio")]
        ),
    ]
)
