// swift-tools-version: 6.2
import PackageDescription

// Models that need a newer FluidAudio than the release TypeWhisper for macOS ships. The main
// fluidaudio-worker stays on that release, so its results keep matching the app. The Diarizer
// trait brings in Nemotron 3 Diarization; TTS and NeMo text processing stay out.
let package = Package(
    name: "FluidAudioNextWorker",
    platforms: [.macOS(.v15)],
    dependencies: [
        .package(url: "https://github.com/FluidInference/FluidAudio.git", exact: "0.18.0", traits: ["Diarizer"]),
    ],
    targets: [
        .executableTarget(
            name: "FluidAudioNextWorker",
            dependencies: [.product(name: "FluidAudio", package: "FluidAudio")]
        ),
    ]
)
