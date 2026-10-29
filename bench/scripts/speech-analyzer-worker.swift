// Persistent worker for Apple's SpeechAnalyzer with SpeechTranscriber (macOS 26 or later).
// It transcribes a recording the way TypeWhisper's Apple Speech plugin does after a dictation with
// live preview off, in `SpeechAnalyzerPlugin.transcribe(audio:language:translate:prompt:onProgress:)`
// (the plugin supports streaming, so the app calls this variant): a fresh `SpeechTranscriber` with
// volatile results and a fresh `SpeechAnalyzer` per recording, an empty analysis context, the
// 16 kHz mono samples converted to the analyzer's best format and fed as one buffer, and the final
// results joined. Like the plugin, it keeps one locale reserved at a time.
//
// Protocol: one JSON request per line on stdin, one JSON line per answer on stdout.
//   -> {"id": 1, "load": "1", "locale": "de-DE"}             installs and reserves the locale's model
//   -> {"id": 2, "locale": "de-DE", "file": "/abs/clip.wav"}
//   <- {"id": 2, "text": "...", "durationMs": 123.4}
// Timing covers the plugin's transcribe() work and excludes reading the audio file.
import AVFoundation
import Foundation
import Speech

struct WorkerError: Error, CustomStringConvertible {
    let description: String
}

func emit(_ object: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: object) else { return }
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data("\n".utf8))
}

func supportedLocale(_ identifier: String) async throws -> Locale {
    guard let locale = await SpeechTranscriber.supportedLocale(equivalentTo: Locale(identifier: identifier)) else {
        throw WorkerError(description: "SpeechTranscriber does not support \(identifier)")
    }
    return locale
}

nonisolated(unsafe) var reservedLocale: Locale?

/**
 * Downloads the locale's assets if needed and reserves them, like the plugin's model load. The
 * previous locale is released first: macOS allows only a few reserved locales.
 */
func prepare(_ locale: Locale) async throws {
    let transcriber = SpeechTranscriber(locale: locale, preset: .transcription)
    if let request = try await AssetInventory.assetInstallationRequest(supporting: [transcriber]) {
        try await request.downloadAndInstall()
    }
    guard reservedLocale?.identifier != locale.identifier else { return }
    if let previous = reservedLocale {
        await AssetInventory.release(reservedLocale: previous)
        reservedLocale = nil
    }
    _ = try await AssetInventory.reserve(locale: locale)
    reservedLocale = locale
}

/** Reads an audio file as 16 kHz mono Float32 samples, the format TypeWhisper hands its plugins. */
func readSamples(_ path: String) throws -> [Float] {
    let file = try AVAudioFile(forReading: URL(fileURLWithPath: path))
    let source = file.processingFormat
    guard let input = AVAudioPCMBuffer(pcmFormat: source, frameCapacity: AVAudioFrameCount(file.length)) else {
        throw WorkerError(description: "Cannot allocate a buffer for \(path)")
    }
    try file.read(into: input)
    let target = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 16000, channels: 1, interleaved: false)!
    var output = input
    if source.sampleRate != target.sampleRate || source.channelCount != 1 || source.commonFormat != .pcmFormatFloat32 {
        guard let converter = AVAudioConverter(from: source, to: target),
              let converted = AVAudioPCMBuffer(
                  pcmFormat: target,
                  frameCapacity: AVAudioFrameCount((Double(input.frameLength) * target.sampleRate / source.sampleRate).rounded(.up)) + 1
              )
        else { throw WorkerError(description: "Cannot convert \(path) to 16 kHz mono") }
        var consumed = false
        var conversionError: NSError?
        converter.convert(to: converted, error: &conversionError) { _, status in
            if consumed {
                status.pointee = .endOfStream
                return nil
            }
            consumed = true
            status.pointee = .haveData
            return input
        }
        if let conversionError { throw conversionError }
        output = converted
    }
    return Array(UnsafeBufferPointer(start: output.floatChannelData![0], count: Int(output.frameLength)))
}

// The plugin's createBuffer(from:) and prepareBuffer(_:for:).
func createBuffer(from samples: [Float]) -> AVAudioPCMBuffer {
    let format = AVAudioFormat(standardFormatWithSampleRate: 16000, channels: 1)!
    let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(samples.count))!
    buffer.frameLength = AVAudioFrameCount(samples.count)
    samples.withUnsafeBufferPointer { pointer in
        buffer.floatChannelData![0].update(from: pointer.baseAddress!, count: samples.count)
    }
    return buffer
}

func prepareBuffer(_ samples: [Float], for modules: [SpeechTranscriber]) async -> AVAudioPCMBuffer {
    let sourceBuffer = createBuffer(from: samples)
    guard let targetFormat = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: modules),
          sourceBuffer.format != targetFormat,
          let converter = AVAudioConverter(from: sourceBuffer.format, to: targetFormat)
    else { return sourceBuffer }
    let ratio = targetFormat.sampleRate / sourceBuffer.format.sampleRate
    let capacity = AVAudioFrameCount((Double(sourceBuffer.frameLength) * ratio).rounded(.up))
    guard let convertedBuffer = AVAudioPCMBuffer(pcmFormat: targetFormat, frameCapacity: capacity) else {
        return sourceBuffer
    }
    var consumed = false
    var conversionError: NSError?
    converter.convert(to: convertedBuffer, error: &conversionError) { _, status in
        if consumed {
            status.pointee = .noDataNow
            return nil
        }
        consumed = true
        status.pointee = .haveData
        return sourceBuffer
    }
    return conversionError == nil ? convertedBuffer : sourceBuffer
}

func transcribe(_ samples: [Float], locale: Locale) async throws -> String {
    let transcriber = SpeechTranscriber(
        locale: locale,
        transcriptionOptions: [],
        reportingOptions: [.volatileResults],
        attributeOptions: []
    )
    let analyzer = SpeechAnalyzer(modules: [transcriber])
    try await analyzer.setContext(AnalysisContext())

    let buffer = await prepareBuffer(samples, for: [transcriber])
    let (stream, continuation) = AsyncStream<AnalyzerInput>.makeStream()
    continuation.yield(AnalyzerInput(buffer: buffer))
    continuation.finish()

    let resultTask = Task<String, Error> {
        var fullText = ""
        for try await result in transcriber.results where result.isFinal {
            fullText += String(result.text.characters)
        }
        return fullText
    }

    try await analyzer.start(inputSequence: stream)
    try await analyzer.finalizeAndFinishThroughEndOfInput()
    return try await resultTask.value.trimmingCharacters(in: .whitespacesAndNewlines)
}

func handle(_ request: [String: Any]) async throws -> [String: Any] {
    guard let localeId = request["locale"] as? String else { throw WorkerError(description: "Missing locale") }
    let locale = try await supportedLocale(localeId)
    try await prepare(locale)
    if request["load"] != nil { return ["loaded": true, "locale": locale.identifier] }
    guard let path = request["file"] as? String else { throw WorkerError(description: "Missing file") }
    let samples = try readSamples(path)
    let start = DispatchTime.now().uptimeNanoseconds
    let text = try await transcribe(samples, locale: locale)
    let durationMs = Double(DispatchTime.now().uptimeNanoseconds - start) / 1_000_000
    return ["text": text, "durationMs": durationMs]
}

emit(["ready": true])
while let line = readLine() {
    guard !line.trimmingCharacters(in: .whitespaces).isEmpty else { continue }
    let request = (try? JSONSerialization.jsonObject(with: Data(line.utf8))) as? [String: Any] ?? [:]
    var response: [String: Any]
    do {
        response = try await handle(request)
    } catch {
        response = ["error": "\(error)"]
    }
    response["id"] = request["id"] ?? NSNull()
    emit(response)
}
