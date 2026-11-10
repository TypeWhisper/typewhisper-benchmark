// NVIDIA Nemotron 3 Diarization (streaming Sortformer successor, up to 8 speakers) through
// FluidAudio's Nemotron3Diarizer, which FluidAudio 0.17.5 in the apps does not have yet.
// The preset picks chunk size and latency; see FluidAudio's Documentation/Diarization/Nemotron3.md.
// Frame probabilities become turns with FluidAudio's own defaults: threshold 0.5, turns of at
// least 0.2 s.
//
//   -> {"id": 1, "model": "nemotron3-diarization", "preset": "fast32", "load": true}
//   -> {"id": 2, "model": "nemotron3-diarization", "preset": "fast32", "diarize": "/abs/meeting.wav"}
//   <- {"id": 2, "turns": [[0.48, 2.1, "S0"], ...], "durationMs": 1234.5}
// Optional "computeUnits": "all" (default), "ane", "gpu" or "cpu".
// Timing covers reading and resampling the file and diarizing it.
import CoreML
import FluidAudio
import Foundation

nonisolated(unsafe) var nemotron3Diarizers: [String: Nemotron3Diarizer] = [:]

func computeUnits(_ name: String?) throws -> MLComputeUnits {
    switch name {
    case nil, "all": return .all
    case "ane": return .cpuAndNeuralEngine
    case "gpu": return .cpuAndGPU
    case "cpu": return .cpuOnly
    default: throw Failure("unknown compute units '\(name!)'")
    }
}

func handleNemotron3Diarization(_ request: Request) async throws -> [String: Any] {
    let presetName = request.preset ?? "fast32"
    guard let config = Nemotron3Config.preset(named: presetName) else {
        throw Failure("unknown Nemotron 3 preset '\(presetName)'")
    }
    let key = "\(presetName)|\(request.computeUnits ?? "all")"
    if nemotron3Diarizers[key] == nil {
        let models = try await Nemotron3Models.loadFromHuggingFace(
            config: config, computeUnits: try computeUnits(request.computeUnits))
        let diarizer = Nemotron3Diarizer(config: config, models: models)
        // One short pass keeps Core ML's first-use work out of the first timed file.
        _ = try diarizer.processComplete([Float](repeating: 0, count: 5 * sampleRate))
        nemotron3Diarizers[key] = diarizer
    }
    guard let diarizer = nemotron3Diarizers[key] else { throw Failure("Nemotron 3 did not load") }
    if request.load == true { return ["loaded": true] }
    guard let file = request.diarize else { throw Failure("request has no 'diarize'") }

    let start = ContinuousClock.now
    let samples = try converter.resampleAudioFile(URL(fileURLWithPath: file))
    let (probabilities, frames) = try diarizer.processComplete(samples)
    let segments = Nemotron3Diarizer.segments(
        probabilities: probabilities, frameCount: frames, numSpeakers: config.numSpeakers)
    let elapsed = ContinuousClock.now - start
    let ms = Double(elapsed.components.seconds) * 1000 + Double(elapsed.components.attoseconds) / 1e15
    let turns: [[Any]] = segments.map {
        [Double($0.startSeconds), Double($0.endSeconds), "S\($0.speakerIndex)"]
    }
    return ["turns": turns, "durationMs": ms]
}
