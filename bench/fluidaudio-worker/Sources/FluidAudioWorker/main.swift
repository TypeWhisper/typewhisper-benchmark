// Persistent FluidAudio worker for the benchmark (Apple Silicon, macOS 15+).
//
// Runs Parakeet-family Core ML models the way TypeWhisper's Parakeet plugin does:
// ASRConfig(melChunkContext: true), clips padded to at least 1 s, a fresh decoder state per
// clip, no language hint, and a prewarm pass after loading.
//
// Reads one JSON request per line from stdin and answers with one JSON line on stdout:
//   -> {"id": 1, "model": "parakeet-ultra", "official": "ultra", "modelsRoot": "/abs/models/fluidaudio", "load": true}
//   -> {"id": 2, "model": "fluid-speech-mini", "local": "/abs/dir", "version": "ultra", "file": "/abs/clip.wav"}
//   <- {"id": 2, "text": "...", "durationMs": 12.3}
// Optional fields: "leadPadSeconds" (leading silence a model was evaluated with) and
// "shortFunction" (encoder function used for clips up to 8 s, e.g. Bark 3.0 Pro's "short8").
//
// Nemotron 3.5 ASR Streaming runs like the Parakeet plugin's batch path: a fresh stream per clip,
// fed in 10 s blocks, prompted with a locale such as "de-DE" (no "language" detects it), no padding
// unless "leadPadSeconds" / "tailPadSeconds" ask for silence around the clip:
//   -> {"id": 3, "model": "nemotron-3.5-asr-streaming-0.6b", "nemotron": "/abs/dir", "language": "de-DE", "file": "/abs/clip.wav"}
import CoreML
import FluidAudio
import Foundation

struct Request: Decodable {
    let id: Int?
    let model: String
    let official: String?
    let modelsRoot: String?
    let local: String?
    let version: String?
    let leadPadSeconds: Double?
    let shortFunction: String?
    let file: String?
    let load: Bool?
    /// Folder with the Nemotron streaming Core ML models (selects the Nemotron path)
    let nemotron: String?
    /// Nemotron locale prompt; nil detects the language
    let language: String?
    /// Trailing silence appended before decoding (Nemotron probe; TypeWhisper appends none)
    let tailPadSeconds: Double?
}

struct Failure: Error, CustomStringConvertible {
    let description: String
    init(_ description: String) { self.description = description }
}

struct LoadedModel {
    let manager: AsrManager
    /// Second manager whose encoder uses the short function, for clips that fit in 8 s.
    let shortManager: AsrManager?
    let leadPadSamples: Int
}

let sampleRate = 16_000
let shortFunctionMaxSamples = 8 * sampleRate
let config = ASRConfig(melChunkContext: true)
let converter = AudioConverter()
var loaded: [String: LoadedModel] = [:]
var loadedNemotron: [String: SharedNemotronMultilingualModels] = [:]
/// TypeWhisper's ParakeetPlugin.nemotronBlockSampleCount: 10 s per call in batch transcription.
let nemotronBlockSamples = 160_000

func asrVersion(_ name: String) throws -> AsrModelVersion {
    switch name {
    case "v2": return .v2
    case "v3": return .v3
    case "ultra": return .ultra
    default: throw Failure("unsupported FluidAudio version '\(name)'")
    }
}

/// FluidAudio's download folder names for the official Core ML repos.
func officialFolder(_ version: String) throws -> String {
    switch version {
    case "v2": return "parakeet-tdt-0.6b-v2-coreml"
    case "v3": return "parakeet-tdt-0.6b-v3-coreml"
    case "ultra": return "parakeet-ultra-coreml"
    default: throw Failure("unsupported official model '\(version)'")
    }
}

func transcribe(_ manager: AsrManager, _ samples: [Float]) async throws -> ASRResult {
    var state = TdtDecoderState.make(decoderLayers: await manager.decoderLayerCount)
    return try await manager.transcribe(samples, decoderState: &state, language: nil)
}

func makeManager(_ models: AsrModels) async throws -> AsrManager {
    let manager = AsrManager(config: config)
    try await manager.loadModels(models)
    return manager
}

@MainActor
func load(_ request: Request) async throws -> LoadedModel {
    if let cached = loaded[request.model] { return cached }

    let models: AsrModels
    var shortModels: AsrModels?
    if let official = request.official {
        guard let root = request.modelsRoot else { throw Failure("modelsRoot is required for official models") }
        let directory = URL(fileURLWithPath: root).appendingPathComponent(try officialFolder(official))
        models = try await AsrModels.downloadAndLoad(to: directory, version: try asrVersion(official))
    } else if let local = request.local {
        let directory = URL(fileURLWithPath: local)
        models = try AsrModels.loadLocal(from: directory, version: try asrVersion(request.version ?? "v3"))
        if let function = request.shortFunction {
            let encoderConfig = MLModelConfiguration()
            encoderConfig.computeUnits = AsrModels.defaultConfiguration().computeUnits
            encoderConfig.functionName = function
            let encoder = try MLModel(
                contentsOf: directory.appendingPathComponent("Encoder.mlmodelc"), configuration: encoderConfig)
            shortModels = AsrModels(
                encoder: encoder, preprocessor: models.preprocessor, decoder: models.decoder,
                joint: models.joint, configuration: models.configuration, vocabulary: models.vocabulary,
                version: models.version)
        }
    } else {
        throw Failure("request needs either 'official' or 'local'")
    }

    let manager = try await makeManager(models)
    var shortManager: AsrManager?
    if let shortModels { shortManager = try await makeManager(shortModels) }

    // Prewarm like TypeWhisper: silent input across the chunk worker pool.
    let warmSamples = ASRConstants.maxModelSamples * max(2, config.parallelChunkConcurrency)
    _ = try await transcribe(manager, [Float](repeating: 0, count: warmSamples))
    if let shortManager { _ = try await transcribe(shortManager, [Float](repeating: 0, count: 4 * sampleRate)) }

    let model = LoadedModel(
        manager: manager, shortManager: shortManager,
        leadPadSamples: Int((request.leadPadSeconds ?? 0) * Double(sampleRate)))
    loaded[request.model] = model
    return model
}

/// One clip through a fresh Nemotron stream, as ParakeetPlugin.transcribeWithNemotron does.
func transcribeNemotron(_ shared: SharedNemotronMultilingualModels, _ samples: [Float], language: String?) async throws -> String {
    let manager = StreamingNemotronMultilingualAsrManager()
    try await manager.loadFromShared(shared)
    await manager.setLanguage(language)
    var offset = 0
    while offset < samples.count {
        let end = min(offset + nemotronBlockSamples, samples.count)
        _ = try await manager.process(samples: Array(samples[offset..<end]))
        offset = end
    }
    let (text, _) = try await manager.finishWithTokenTimings()
    return removingUnknownTokens(text).trimmingCharacters(in: .whitespacesAndNewlines)
}

/// TypeWhisper's ParakeetPlugin.removingUnknownTokens.
func removingUnknownTokens(_ text: String) -> String {
    let marker = "<unk>"
    guard text.contains(marker) else { return text }
    var cleaned = text
        .replacingOccurrences(of: "(?<=\\p{Lu})<unk>(?=\\p{Lu})", with: "&", options: .regularExpression)
        .replacingOccurrences(of: "(?<=\\w)<unk>(?=\\w)", with: "", options: .regularExpression)
        .replacingOccurrences(of: marker, with: " ")
    cleaned = cleaned
        .replacingOccurrences(of: " {2,}", with: " ", options: .regularExpression)
        .replacingOccurrences(of: " +([,.;:!?)\\]}…])", with: "$1", options: .regularExpression)
    return cleaned.trimmingCharacters(in: .whitespaces)
}

@MainActor
func loadNemotron(_ request: Request, directory: String) async throws -> SharedNemotronMultilingualModels {
    // Keyed by directory: the plain and the padded benchmark entries share one model bundle.
    if let cached = loadedNemotron[directory] { return cached }
    let shared = try await StreamingNemotronMultilingualAsrManager.preloadShared(from: URL(fileURLWithPath: directory))
    // TypeWhisper does not prewarm Nemotron; one silent stream keeps Core ML's first-use
    // compilation out of the first timed clip.
    _ = try await transcribeNemotron(shared, [Float](repeating: 0, count: 2 * sampleRate), language: nil)
    loadedNemotron[directory] = shared
    return shared
}

@MainActor
func handleNemotron(_ request: Request, directory: String) async throws -> [String: Any] {
    let shared = try await loadNemotron(request, directory: directory)
    if request.load == true { return ["loaded": true] }
    guard let file = request.file else { throw Failure("request has no 'file'") }
    var samples = [Float](repeating: 0, count: Int((request.leadPadSeconds ?? 0) * Double(sampleRate)))
    samples += try converter.resampleAudioFile(URL(fileURLWithPath: file))
    samples += [Float](repeating: 0, count: Int((request.tailPadSeconds ?? 0) * Double(sampleRate)))

    let start = ContinuousClock.now
    let text = try await transcribeNemotron(shared, samples, language: request.language)
    let elapsed = ContinuousClock.now - start
    let ms = Double(elapsed.components.seconds) * 1000 + Double(elapsed.components.attoseconds) / 1e15
    return ["text": text, "durationMs": ms]
}

@MainActor
func handle(_ request: Request) async throws -> [String: Any] {
    if let directory = request.nemotron { return try await handleNemotron(request, directory: directory) }
    let model = try await load(request)
    if request.load == true { return ["loaded": true] }
    guard let file = request.file else { throw Failure("request has no 'file'") }

    var samples = [Float](repeating: 0, count: model.leadPadSamples)
    samples += try converter.resampleAudioFile(URL(fileURLWithPath: file))
    // TypeWhisper's PluginAudioUtils.paddedSamples(minimumDuration: 1.0)
    if samples.count < sampleRate { samples += [Float](repeating: 0, count: sampleRate - samples.count) }
    let manager = (model.shortManager != nil && samples.count <= shortFunctionMaxSamples)
        ? model.shortManager! : model.manager

    let start = ContinuousClock.now
    let result = try await transcribe(manager, samples)
    let elapsed = ContinuousClock.now - start
    let ms = Double(elapsed.components.seconds) * 1000 + Double(elapsed.components.attoseconds) / 1e15
    return ["text": result.text, "durationMs": ms]
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
    // Read the id first, so even a malformed request gets an answer the caller can match.
    let raw = (try? JSONSerialization.jsonObject(with: Data(line.utf8))) as? [String: Any]
    let id: Any = raw?["id"] ?? NSNull()
    do {
        let request = try decoder.decode(Request.self, from: Data(line.utf8))
        var response = try await handle(request)
        response["id"] = id
        reply(response)
    } catch {
        // Report per-request failures without killing the worker.
        reply(["id": id, "error": "\(error)"])
    }
}
