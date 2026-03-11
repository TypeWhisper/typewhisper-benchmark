import Foundation
import Speech

guard CommandLine.arguments.count >= 3 else {
    fputs("Usage: apple-speech.swift <audio-file> <language>\n", stderr)
    exit(1)
}

let audioPath = CommandLine.arguments[1]
let language = CommandLine.arguments[2]

let locale = Locale(identifier: language)
guard let recognizer = SFSpeechRecognizer(locale: locale) else {
    fputs("Speech recognizer not available for locale: \(language)\n", stderr)
    exit(1)
}

let url = URL(fileURLWithPath: audioPath)
let request = SFSpeechURLRecognitionRequest(url: url)
request.shouldReportPartialResults = false

let semaphore = DispatchSemaphore(value: 0)
var resultText = ""
var errorText: String?

recognizer.recognitionTask(with: request) { result, error in
    if let error = error {
        errorText = error.localizedDescription
        semaphore.signal()
        return
    }
    if let result = result, result.isFinal {
        resultText = result.bestTranscription.formattedString
        semaphore.signal()
    }
}

semaphore.wait()

if let error = errorText {
    fputs("Error: \(error)\n", stderr)
    exit(1)
}

print(resultText)
