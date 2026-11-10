// Speaker diarization the way TypeWhisper's Speaker Detection plugin (macOS) and
// SpeakerDiarizationService (iOS) run it: FluidAudio's offline diarizer (pyannote community-1
// segmentation and embeddings, VBx clustering) with clustering threshold 0.7, and without the
// segments no speaker embedding voted for (quality 0).
//
//   -> {"id": 1, "model": "offline-diarizer", "load": true}
//   -> {"id": 2, "model": "offline-diarizer", "diarize": "/abs/meeting.wav", "threshold": 0.7}
//   <- {"id": 2, "turns": [[0.48, 2.1, "S1"], ...], "durationMs": 9876.5}
// Timing covers reading the file and diarizing it, like the plugin's call with the file URL.
import FluidAudio
import Foundation

nonisolated(unsafe) var offlineDiarizerModels: OfflineDiarizerModels?

@MainActor
func handleOfflineDiarizer(_ request: Request) async throws -> [String: Any] {
    if offlineDiarizerModels == nil {
        offlineDiarizerModels = try await OfflineDiarizerModels.load()
    }
    guard let models = offlineDiarizerModels else { throw Failure("offline diarizer models did not load") }
    if request.load == true { return ["loaded": true] }
    guard let file = request.diarize else { throw Failure("request has no 'diarize'") }

    let config = OfflineDiarizerConfig(clusteringThreshold: request.threshold ?? 0.7)
    let manager = OfflineDiarizerManager(config: config)
    manager.initialize(models: models)

    let start = ContinuousClock.now
    var turns: [[Any]] = []
    do {
        let result = try await manager.process(URL(fileURLWithPath: file))
        turns = result.segments
            .filter { request.keepUnbacked == true || $0.qualityScore > 0 }
            .map { [Double($0.startTimeSeconds), Double($0.endTimeSeconds), $0.speakerId] }
    } catch OfflineDiarizationError.noSpeechDetected {
        turns = []
    }
    let elapsed = ContinuousClock.now - start
    let ms = Double(elapsed.components.seconds) * 1000 + Double(elapsed.components.attoseconds) / 1e15
    return ["turns": turns, "durationMs": ms]
}
