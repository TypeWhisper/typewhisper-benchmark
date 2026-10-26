// Measures two decoding questions on benchmark suites, with Parakeet TDT v3 run the way
// TypeWhisper's Parakeet plugin runs it (ASRConfig(melChunkContext: true), clips padded to 1 s,
// a fresh decoder state per clip).
//
//   ParakeetProbe padding  [--out file.jsonl] suite.json...
//     Two extra decodes with 0.5 s and 1.0 s of silence around the clip, run in parallel
//     with the normal one. Reports whether they recover words the normal decode skipped.
//
//   ParakeetProbe boosting --terms terms.txt [--similarity auto|0.80] [--out file.jsonl] suite.json...
//     Each clip with Vocabulary Boosting off and on, rescored exactly as the plugin does.
//     Reports how often boosting changes clips that contain none of the terms.
//
// Audio paths in a suite are resolved against <suite dir>/../audio unless --audio-root is given.
import CoreML
import FluidAudio
import Foundation

// MARK: - Input

struct Suite: Decodable {
    let id: String
    let language: String?
    let tests: [Clip]
}

struct Clip: Decodable {
    let id: String
    let audioFile: String
    let groundTruth: String
    let tags: [String]?
}

struct LoadedClip {
    let suite: String
    let language: String?
    let clip: Clip
    let samples: [Float]
}

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(2)
}

func log(_ message: String) {
    FileHandle.standardError.write(Data((message + "\n").utf8))
}

var arguments = Array(CommandLine.arguments.dropFirst())
guard let mode = arguments.first else {
    fail("usage: ParakeetProbe padding|boosting [--terms f] [--similarity auto|x] [--out f] [--audio-root d] suite.json...")
}
arguments.removeFirst()
var options: [String: String] = [:]
var suitePaths: [String] = []
var index = 0
while index < arguments.count {
    let argument = arguments[index]
    if argument.hasPrefix("--") {
        guard index + 1 < arguments.count else { fail("\(argument) needs a value") }
        options[String(argument.dropFirst(2))] = arguments[index + 1]
        index += 2
    } else {
        suitePaths.append(argument)
        index += 1
    }
}
guard !suitePaths.isEmpty else { fail("no suite given") }

let sampleRate = 16_000
let converter = AudioConverter()

@MainActor
func loadClips() throws -> [LoadedClip] {
    var clips: [LoadedClip] = []
    for path in suitePaths {
        let url = URL(fileURLWithPath: path)
        let suite = try JSONDecoder().decode(Suite.self, from: Data(contentsOf: url))
        let audioRoot = options["audio-root"].map { URL(fileURLWithPath: $0) }
            ?? url.deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("audio")
        for clip in suite.tests {
            let file = audioRoot.appendingPathComponent(clip.audioFile)
            guard FileManager.default.fileExists(atPath: file.path) else {
                log("skip \(clip.id): missing \(file.path)")
                continue
            }
            clips.append(LoadedClip(suite: suite.id, language: suite.language, clip: clip, samples: try converter.resampleAudioFile(file)))
        }
    }
    return clips
}

// MARK: - Text

/// Lowercased letters and digits only, so case, punctuation and token splits do not count as changes.
func comparable(_ text: String) -> String {
    text.lowercased().filter { $0.isLetter || $0.isNumber }
}

func words(_ text: String) -> [String] {
    text.split(whereSeparator: { $0.isWhitespace }).map { comparable(String($0)) }.filter { !$0.isEmpty }
}

func editDistance(_ a: [String], _ b: [String]) -> Int {
    if a.isEmpty { return b.count }
    if b.isEmpty { return a.count }
    var previous = Array(0...b.count)
    for i in 1...a.count {
        var current = [i] + Array(repeating: 0, count: b.count)
        for j in 1...b.count {
            current[j] = min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] == b[j - 1] ? 0 : 1))
        }
        previous = current
    }
    return previous[b.count]
}

/// Word errors against the ground truth.
func errors(_ hypothesis: String, _ reference: String) -> Int {
    editDistance(words(reference), words(hypothesis))
}

/// True when every word of `short` appears in `long`, in order.
func isSubsequence(_ short: [String], of long: [String]) -> Bool {
    var position = long.startIndex
    for word in short {
        guard let found = long[position...].firstIndex(of: word) else { return false }
        position = long.index(after: found)
    }
    return true
}

func milliseconds(_ duration: Duration) -> Double {
    Double(duration.components.seconds) * 1000 + Double(duration.components.attoseconds) / 1e15
}

func median(_ values: [Double]) -> Double {
    guard !values.isEmpty else { return 0 }
    let sorted = values.sorted()
    return sorted[sorted.count / 2]
}

func percentile(_ values: [Double], _ p: Double) -> Double {
    guard !values.isEmpty else { return 0 }
    let sorted = values.sorted()
    return sorted[min(sorted.count - 1, Int(Double(sorted.count) * p))]
}

var outputLines: [String] = []
@MainActor
func record(_ object: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]),
          let line = String(data: data, encoding: .utf8) else { return }
    outputLines.append(line)
}

@MainActor
func writeRecords() throws {
    guard let path = options["out"] else { return }
    let url = URL(fileURLWithPath: path)
    try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    try (outputLines.joined(separator: "\n") + "\n").write(to: url, atomically: true, encoding: .utf8)
    log("wrote \(outputLines.count) records to \(path)")
}

// MARK: - ASR

let asrConfig = ASRConfig(melChunkContext: true)

func makeManager(_ models: AsrModels) async throws -> AsrManager {
    let manager = AsrManager(config: asrConfig)
    try await manager.loadModels(models)
    var state = TdtDecoderState.make(decoderLayers: await manager.decoderLayerCount)
    let warm = [Float](repeating: 0, count: ASRConstants.maxModelSamples * max(2, asrConfig.parallelChunkConcurrency))
    _ = try await manager.transcribe(warm, decoderState: &state, language: nil)
    return manager
}

func transcribe(_ manager: AsrManager, _ samples: [Float]) async throws -> ASRResult {
    var state = TdtDecoderState.make(decoderLayers: await manager.decoderLayerCount)
    return try await manager.transcribe(samples, decoderState: &state, language: nil)
}

/// PluginAudioUtils.paddedSamples(minimumDuration: 1.0)
func pluginPadded(_ samples: [Float]) -> [Float] {
    samples.count < sampleRate ? samples + [Float](repeating: 0, count: sampleRate - samples.count) : samples
}

func surrounded(_ samples: [Float], seconds: Double) -> [Float] {
    let silence = [Float](repeating: 0, count: Int(seconds * Double(sampleRate)))
    return silence + samples + silence
}

let models = try await AsrModels.downloadAndLoad(version: .v3)

// MARK: - Padding

struct PaddingTotals {
    var clips = 0
    var eligible = 0
    var changed = 0
    var improved = 0
    var worsened = 0
    var errorsBefore = 0
    var errorsAfter = 0
}

@MainActor
func runPadding() async throws {
    let pads = [0.5, 1.0]
    let base = try await makeManager(models)
    var arms: [AsrManager] = []
    for _ in pads { arms.append(try await makeManager(models)) }
    let clips = try loadClips()
    log("padding: \(clips.count) clips")

    var referenceWords = 0
    var baseErrors = 0
    var tail = PaddingTotals()
    var subsequence = PaddingTotals()
    var oracleBetter = 0
    var armAddsWords = 0
    var baseMs: [Double] = []
    var allMs: [Double] = []

    for (n, item) in clips.enumerated() {
        let reference = item.clip.groundTruth
        let normal = pluginPadded(item.samples)

        let soloStart = ContinuousClock.now
        let first = try await transcribe(base, normal)
        baseMs.append(milliseconds(ContinuousClock.now - soloStart))

        // Clips that need more than one encoder window get no extra decodes, as in ParrotFlow.
        let longestPad = surrounded(item.samples, seconds: pads.max()!)
        let eligible = longestPad.count <= ASRConstants.maxModelSamples

        var armResults: [ASRResult] = []
        if eligible {
            let start = ContinuousClock.now
            async let a0 = transcribe(base, normal)
            async let a1 = transcribe(arms[0], surrounded(item.samples, seconds: pads[0]))
            async let a2 = transcribe(arms[1], surrounded(item.samples, seconds: pads[1]))
            let all = try await [a0, a1, a2]
            allMs.append(milliseconds(ContinuousClock.now - start))
            armResults = Array(all.dropFirst())
        }

        let firstWords = words(first.text)
        let firstErrors = errors(first.text, reference)
        referenceWords += words(reference).count
        baseErrors += firstErrors

        // ParrotFlow's rule: the arm repeats everything the first decode said and adds to the end.
        let tailPick = armResults
            .filter { comparable($0.text).hasPrefix(comparable(first.text)) && !comparable(first.text).isEmpty }
            .filter { comparable($0.text).count > comparable(first.text).count }
            .max { comparable($0.text).count < comparable($1.text).count }
        // Looser rule: every first-decode word survives in order, extra words may sit anywhere.
        let subsequencePick = armResults
            .filter { words($0.text).count > firstWords.count && isSubsequence(firstWords, of: words($0.text)) }
            .max { words($0.text).count < words($1.text).count }

        func tally(_ totals: inout PaddingTotals, _ pick: ASRResult?) -> Int {
            totals.clips += 1
            if eligible { totals.eligible += 1 }
            let after = pick.map { errors($0.text, reference) } ?? firstErrors
            if pick != nil {
                totals.changed += 1
                if after < firstErrors { totals.improved += 1 }
                if after > firstErrors { totals.worsened += 1 }
            }
            totals.errorsBefore += firstErrors
            totals.errorsAfter += after
            return after
        }
        let tailErrors = tally(&tail, tailPick)
        let subsequenceErrors = tally(&subsequence, subsequencePick)
        if armResults.contains(where: { errors($0.text, reference) < firstErrors }) { oracleBetter += 1 }
        if armResults.contains(where: { words($0.text).count > firstWords.count }) { armAddsWords += 1 }

        record([
            "suite": item.suite, "id": item.clip.id, "seconds": Double(item.samples.count) / Double(sampleRate),
            "reference": reference, "first": first.text, "arms": armResults.map(\.text),
            "eligible": eligible, "firstErrors": firstErrors,
            "tail": tailPick?.text ?? NSNull(), "tailErrors": tailErrors,
            "subsequence": subsequencePick?.text ?? NSNull(), "subsequenceErrors": subsequenceErrors,
            "armErrors": armResults.map { errors($0.text, reference) },
            "firstMs": baseMs.last!, "allMs": eligible ? allMs.last! : NSNull(),
        ])
        if (n + 1) % 100 == 0 { log("  \(n + 1)/\(clips.count)") }
    }

    func describe(_ name: String, _ t: PaddingTotals) -> String {
        let before = Double(t.errorsBefore) / Double(max(referenceWords, 1)) * 100
        let after = Double(t.errorsAfter) / Double(max(referenceWords, 1)) * 100
        return "\(name): changed \(t.changed)/\(t.clips) clips, better \(t.improved), worse \(t.worsened), "
            + "word errors \(t.errorsBefore) -> \(t.errorsAfter) (WER \(String(format: "%.2f", before))% -> \(String(format: "%.2f", after))%)"
    }
    print("clips: \(clips.count), eligible for extra decodes: \(tail.eligible), reference words: \(referenceWords)")
    print(describe("tail rule (ParrotFlow)", tail))
    print(describe("subsequence rule", subsequence))
    print("an arm has fewer errors than the first decode: \(oracleBetter) clips; an arm has more words: \(armAddsWords) clips")
    print(String(format: "latency ms, first decode alone: median %.0f p90 %.0f; all three in parallel: median %.0f p90 %.0f",
                 median(baseMs), percentile(baseMs, 0.9), median(allMs), percentile(allMs, 0.9)))
}

// MARK: - Boosting

/// ParakeetPlugin.removesTextAroundExistingTerm
func removesTextAroundExistingTerm(original: String, replacement: String) -> Bool {
    func lettersAndNumbers(_ text: String) -> String {
        String(text.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: Locale(identifier: "en_US_POSIX"))
            .filter { $0.isLetter || $0.isNumber })
    }
    let source = lettersAndNumbers(original)
    let term = lettersAndNumbers(replacement)
    return !term.isEmpty && source != term && source.contains(term)
}

@MainActor
func runBoosting() async throws {
    guard let termsPath = options["terms"] else { fail("boosting needs --terms") }
    let similarityOption = options["similarity"] ?? "auto"
    let similarity: Float? = similarityOption == "auto" ? nil : Float(similarityOption)
    if similarityOption != "auto" && similarity == nil { fail("bad --similarity \(similarityOption)") }
    var seen = Set<String>()
    let termTexts = try String(contentsOfFile: termsPath, encoding: .utf8)
        .split(whereSeparator: \.isNewline)
        .map { $0.trimmingCharacters(in: .whitespaces) }
        .filter { !$0.isEmpty && !$0.hasPrefix("#") }
        .filter { seen.insert($0.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: .current)).inserted }

    let ctcDirectory = CtcModels.defaultCacheDirectory(for: .ctc110m)
    guard CtcModels.modelsExist(at: ctcDirectory) else { fail("CTC 110M model missing at \(ctcDirectory.path)") }
    let ctcModels = try await CtcModels.loadDirect(from: ctcDirectory, variant: .ctc110m)
    let tokenizer = try await CtcTokenizer.load(from: ctcDirectory)
    let terms = termTexts.compactMap { text -> CustomVocabularyTerm? in
        let ids = tokenizer.encode(text)
        guard !ids.isEmpty else { return nil }
        return CustomVocabularyTerm(text: text, weight: 10.0, ctcTokenIds: ids, minSimilarity: similarity)
    }
    let capped = Array(terms.prefix(256))
    let vocabulary = CustomVocabularyContext(terms: capped)
    let spotter = CtcKeywordSpotter(models: ctcModels, blankId: ctcModels.vocabulary.count)
    let rescorer = try await VocabularyRescorer.create(
        spotter: spotter, vocabulary: vocabulary,
        config: VocabularyRescorer.Config(spotterRescueEnabled: false), ctcModelDirectory: ctcDirectory)
    let sizeConfig = ContextBiasingConstants.rescorerConfig(forVocabSize: capped.count)

    func boosted(_ result: ASRResult, _ samples: [Float]) async throws -> (String, [String]) {
        guard let timings = result.tokenTimings, !timings.isEmpty else { return (result.text, []) }
        let spot = try await spotter.spotKeywordsWithLogProbs(audioSamples: samples, customVocabulary: vocabulary, minScore: nil)
        guard !spot.logProbs.isEmpty else { return (result.text, []) }
        let output = rescorer.ctcTokenRescore(
            transcript: result.text, tokenTimings: timings, logProbs: spot.logProbs,
            frameDuration: spot.frameDuration, cbw: sizeConfig.cbw, marginSeconds: 0.5,
            minSimilarity: max(sizeConfig.minSimilarity, vocabulary.minSimilarity))
        guard output.wasModified else { return (result.text, []) }
        let applied = output.replacements.filter(\.shouldReplace)
        guard !applied.contains(where: { r in
            r.replacementWord.map { removesTextAroundExistingTerm(original: r.originalWord, replacement: $0) } == true
        }) else { return (result.text, []) }
        return (output.text, applied.compactMap(\.replacementWord))
    }

    let manager = try await makeManager(models)
    let clips = try loadClips()
    log("boosting: \(capped.count) terms, similarity \(similarity.map { String($0) } ?? "auto"), \(clips.count) clips")
    // Case-insensitive and with the term's own spacing, so "ray cast" is not read as Raycast.
    // Only at the term's outer edges, so "Rust" does not match "trust".
    func mentions(_ text: String, _ term: String) -> Bool {
        var searchStart = text.startIndex
        while let found = text.range(of: term, options: [.caseInsensitive, .diacriticInsensitive],
                                     range: searchStart..<text.endIndex) {
            let before = found.lowerBound == text.startIndex ? nil : text[text.index(before: found.lowerBound)]
            let after = found.upperBound == text.endIndex ? nil : text[found.upperBound]
            if !(before?.isLetter ?? false || before?.isNumber ?? false),
               !(after?.isLetter ?? false || after?.isNumber ?? false) {
                return true
            }
            searchStart = text.index(after: found.lowerBound)
        }
        return false
    }
    let termKeys = capped.map(\.text)

    struct Group { var clips = 0; var changed = 0; var better = 0; var worse = 0; var errors = 0; var terms = 0 }
    struct Bucket { var wanted = 0; var errorsOff = 0; var termsOff = 0; var clips = 0; var variants: [String: Group] = [:] }
    var buckets: [String: Bucket] = [:]
    let variantNames = ["boosting"] + VocabularyGuard.Rule.allCases.map { "guard \($0.rawValue)" }
    var rescoreMs: [Double] = []
    var guardMs: [Double] = []

    for (n, item) in clips.enumerated() {
        let samples = pluginPadded(item.samples)
        let result = try await transcribe(manager, samples)
        let start = ContinuousClock.now
        let (onText, applied) = try await boosted(result, samples)
        rescoreMs.append(milliseconds(ContinuousClock.now - start))

        // Dictation language plus English, which TypeWhisper users mix into every language.
        let languages = Array(Set([item.language ?? "en", "en"].filter { $0 != "auto" }))
        var texts = ["boosting": onText]
        for rule in VocabularyGuard.Rule.allCases {
            let guardStart = ContinuousClock.now
            texts["guard \(rule.rawValue)"] = VocabularyGuard.filter(
                original: result.text, rescored: onText, rule: rule,
                isKnownWord: { spellCheckerKnows($0, languages: languages) })
            if rule == .strict { guardMs.append(milliseconds(ContinuousClock.now - guardStart)) }
        }

        let reference = item.clip.groundTruth
        let wanted = termKeys.filter { mentions(reference, $0) }
        let key = wanted.isEmpty ? "without a term" : "with a term"
        let off = errors(result.text, reference)
        var bucket = buckets[key, default: Bucket()]
        bucket.clips += 1
        bucket.wanted += wanted.count
        bucket.errorsOff += off
        bucket.termsOff += wanted.filter { mentions(result.text, $0) }.count
        for name in variantNames {
            let text = texts[name]!
            let e = errors(text, reference)
            var g = bucket.variants[name, default: Group()]
            g.clips += 1
            if text != result.text { g.changed += 1 }
            if e < off { g.better += 1 }
            if e > off { g.worse += 1 }
            g.errors += e
            g.terms += wanted.filter { mentions(text, $0) }.count
            bucket.variants[name] = g
        }
        buckets[key] = bucket

        var line: [String: Any] = [
            "suite": item.suite, "id": item.clip.id, "tags": item.clip.tags ?? [],
            "reference": reference, "off": result.text, "applied": applied,
            "termsInReference": wanted, "errorsOff": off,
        ]
        for name in variantNames { line[name] = texts[name]!; line["errors " + name] = errors(texts[name]!, reference) }
        record(line)
        if (n + 1) % 100 == 0 { log("  \(n + 1)/\(clips.count)") }
    }

    print("terms: \(capped.count), similarity: \(similarity.map { String($0) } ?? "auto"), clips: \(clips.count)")
    for key in buckets.keys.sorted() {
        let b = buckets[key]!
        print("\(key): \(b.clips) clips, word errors without boosting \(b.errorsOff)"
              + (b.wanted > 0 ? ", terms written \(b.termsOff)/\(b.wanted)" : ""))
        for name in variantNames {
            let g = b.variants[name]!
            print("  \(name): changed \(g.changed), better \(g.better), worse \(g.worse), word errors \(g.errors)"
                  + (b.wanted > 0 ? ", terms written \(g.terms)/\(b.wanted)" : ""))
        }
    }
    print(String(format: "guard ms: median %.2f p90 %.2f", median(guardMs), percentile(guardMs, 0.9)))
    print(String(format: "rescoring ms: median %.0f p90 %.0f", median(rescoreMs), percentile(rescoreMs, 0.9)))
}

switch mode {
case "padding": try await runPadding()
case "boosting": try await runBoosting()
default: fail("unknown mode \(mode)")
}
try writeRecords()
