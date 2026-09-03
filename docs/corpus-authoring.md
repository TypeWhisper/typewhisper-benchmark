# Corpus Authoring

Every benchmark item uses a frozen local audio file. The manifest records the
actual input format, sample rate, channel count, duration, and SHA-256 digest.
Source audio should not be silently replaced or transcoded after admission.

## Self-recorded example

```json
{
  "id": "de-self-office-001",
  "audio": {
    "path": "audio/de-self-office-001.wav",
    "sha256": "<64 lowercase hex characters>",
    "format": "wav",
    "sampleRateHz": 48000,
    "channels": 1,
    "durationMs": 8200
  },
  "language": "de",
  "tags": ["dictation", "numbers", "proper-nouns"],
  "references": {
    "verbatim": "Überweise bitte zwölf Euro an Max Mustermann",
    "formatted": "Überweise bitte 12 Euro an Max Mustermann."
  },
  "expectations": {
    "numbers": [
      { "id": "amount", "expected": "12", "alternatives": [] }
    ],
    "properNouns": [
      { "id": "recipient", "expected": "Max Mustermann", "alternatives": [] }
    ]
  },
  "source": {
    "kind": "self-recorded",
    "name": "TypeWhisper benchmark recording",
    "rights": {
      "license": "Project-owned",
      "redistributable": false
    }
  },
  "recording": {
    "device": "Document the actual microphone",
    "environment": "Document the room and relevant noise",
    "speakerId": "speaker-001"
  },
  "review": {
    "status": "verified",
    "reviewedBy": "reviewer-id",
    "reviewedAt": "2026-09-03T00:00:00.000Z"
  }
}
```

## Web-reference example

Only use web audio whose benchmark use is permitted. Redistribution permission
is recorded independently because a clip may be usable for local evaluation
without being publishable alongside the results.

```json
{
  "id": "en-web-interview-001",
  "audio": {
    "path": "audio/en-web-interview-001.flac",
    "sha256": "<64 lowercase hex characters>",
    "format": "flac",
    "sampleRateHz": 16000,
    "channels": 1,
    "durationMs": 12500
  },
  "language": "en",
  "tags": ["natural-speech", "web-reference"],
  "references": {
    "verbatim": "A human-verified transcription of the frozen clip",
    "alternatives": []
  },
  "source": {
    "kind": "web-reference",
    "name": "Stable source title",
    "url": "https://example.com/source",
    "retrievedAt": "2026-09-03T00:00:00.000Z",
    "segment": {
      "startMs": 125000,
      "endMs": 137500
    },
    "rights": {
      "license": "Exact license identifier or terms description",
      "redistributable": true,
      "attribution": "Required attribution, when applicable",
      "termsUrl": "https://example.com/license"
    }
  },
  "review": {
    "status": "verified",
    "reviewedBy": "reviewer-id",
    "reviewedAt": "2026-09-03T00:00:00.000Z"
  }
}
```

## Admission checklist

1. Freeze the exact audio input locally.
2. Record technical media metadata without guessing it.
3. Calculate the SHA-256 digest.
4. Transcribe and review the clip manually.
5. Add formatted, number, proper-noun, and code expectations only where they
   genuinely apply.
6. Record source and rights information.
7. Run `npm run validate` before admitting the item to a profile.

For dataset-backed samples, also record the immutable dataset version, subset,
split, and sample ID. See `docs/web-audio-policy.md` for the complete admission
rules and initial source allocation.
