// Persistent FluidAudio 0.18 worker for the benchmark (Apple Silicon, macOS 15+).
//
// Runs NVIDIA's Nemotron Unified ASR 0.6B (25 European languages) through FluidAudio's offline
// UnifiedAsrManager with the fp16 encoder, FluidAudio's default for this checkpoint. The suite
// language becomes the model's language prompt ("auto" detects it). Clips are padded to at least
// 1 s, as TypeWhisper's Parakeet plugin does for its models.
//
// Reads one JSON request per line from stdin and answers with one JSON line on stdout:
//   -> {"id": 1, "model": "nemotron-unified", "language": "de", "load": true}
//   -> {"id": 2, "model": "nemotron-unified", "language": "de", "file": "/abs/clip.wav"}
//   <- {"id": 2, "text": "...", "durationMs": 12.3}
// Timing covers transcription only; it excludes loading and reading the audio file.
import FluidAudio
import Foundation

struct Request: Decodable {
    let id: Int?
    let model: String
    let language: String?
    let file: String?
    let load: Bool?
}

struct Failure: Error, CustomStringConvertible {
    let description: String
    init(_ description: String) { self.description = description }
}

let sampleRate = 16_000
let converter = AudioConverter()
nonisolated(unsafe) var managers: [String: UnifiedAsrManager] = [:]

func manager(for request: Request) async throws -> UnifiedAsrManager {
    guard request.model == "nemotron-unified" else { throw Failure("unknown model \(request.model)") }
    let code = request.language ?? "auto"
    guard let language = NemotronUnifiedLanguage(rawValue: code) else {
        throw Failure("Nemotron Unified has no language prompt for '\(code)'")
    }
    if let cached = managers[code] { return cached }
    let manager = UnifiedAsrManager(
        config: UnifiedConfig(family: .nemotronMultilingual(language)),
        encoderPrecision: .fp16
    )
    try await manager.loadModels()
    // Prewarm, so Core ML compilation stays out of the first timed clip.
    _ = try await manager.transcribe([Float](repeating: 0, count: 2 * sampleRate))
    managers[code] = manager
    return manager
}

func handle(_ request: Request) async throws -> [String: Any] {
    let manager = try await manager(for: request)
    if request.load == true { return ["loaded": true] }
    guard let file = request.file else { throw Failure("request has no 'file'") }
    var samples = try converter.resampleAudioFile(URL(fileURLWithPath: file))
    if samples.count < sampleRate { samples += [Float](repeating: 0, count: sampleRate - samples.count) }

    let start = ContinuousClock.now
    let text = try await manager.transcribe(samples)
    let elapsed = ContinuousClock.now - start
    let ms = Double(elapsed.components.seconds) * 1000 + Double(elapsed.components.attoseconds) / 1e15
    return ["text": text, "durationMs": ms]
}

func reply(_ object: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: object),
          let line = String(data: data, encoding: .utf8) else { return }
    print(line)
    fflush(stdout)
}

reply(["ready": true])
let decoder = JSONDecoder()
while let line = readLine() {
    guard !line.trimmingCharacters(in: .whitespaces).isEmpty else { continue }
    let raw = (try? JSONSerialization.jsonObject(with: Data(line.utf8))) as? [String: Any]
    let id: Any = raw?["id"] ?? NSNull()
    do {
        let request = try decoder.decode(Request.self, from: Data(line.utf8))
        var response = try await handle(request)
        response["id"] = id
        reply(response)
    } catch {
        reply(["id": id, "error": "\(error)"])
    }
}
