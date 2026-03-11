import Foundation
import Speech

guard CommandLine.arguments.count >= 3 else {
    fputs("Usage: apple-speech.swift <audio-file> <language>\n", stderr)
    exit(1)
}

let audioPath = CommandLine.arguments[1]
let language = CommandLine.arguments[2]

// Request authorization
var authStatus: SFSpeechRecognizerAuthorizationStatus = SFSpeechRecognizer.authorizationStatus()

if authStatus == .notDetermined {
    let authSemaphore = DispatchSemaphore(value: 0)
    SFSpeechRecognizer.requestAuthorization { status in
        authStatus = status
        authSemaphore.signal()
    }
    authSemaphore.wait()
}

guard authStatus == .authorized else {
    switch authStatus {
    case .denied:
        fputs("Error: Speech recognition denied. Grant permission in System Settings > Privacy > Speech Recognition\n", stderr)
    case .restricted:
        fputs("Error: Speech recognition restricted on this device\n", stderr)
    default:
        fputs("Error: Speech recognition not authorized (status: \(authStatus.rawValue))\n", stderr)
    }
    exit(1)
}

let locale = Locale(identifier: language)
guard let recognizer = SFSpeechRecognizer(locale: locale) else {
    fputs("Error: Speech recognizer not available for locale: \(language)\n", stderr)
    exit(1)
}

guard recognizer.isAvailable else {
    fputs("Error: Speech recognizer not currently available\n", stderr)
    exit(1)
}

let url = URL(fileURLWithPath: audioPath)
let request = SFSpeechURLRecognitionRequest(url: url)
request.shouldReportPartialResults = false
// On-device recognition if available, otherwise use server
if recognizer.supportsOnDeviceRecognition {
    request.requiresOnDeviceRecognition = true
}

var resultText: String?
var errorText: String?
var isDone = false

recognizer.recognitionTask(with: request) { result, error in
    if let error = error {
        errorText = error.localizedDescription
        isDone = true
        return
    }
    if let result = result, result.isFinal {
        resultText = result.bestTranscription.formattedString
        isDone = true
    }
}

// Run the RunLoop so callbacks fire
let deadline = Date(timeIntervalSinceNow: 60)
while !isDone && Date() < deadline {
    RunLoop.current.run(mode: .default, before: Date(timeIntervalSinceNow: 0.1))
}

if !isDone {
    fputs("Error: Transcription timed out after 60 seconds\n", stderr)
    exit(1)
}

if let error = errorText {
    fputs("Error: \(error)\n", stderr)
    exit(1)
}

print(resultText ?? "")
