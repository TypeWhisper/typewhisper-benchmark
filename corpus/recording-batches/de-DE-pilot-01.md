# German Recording Pilot 01

This batch is a quick end-to-end validation of recording intake and all six
evaluation dimensions. It is not yet a publishable speaker-balanced corpus.

## Recording setup

- Record in a normal speaking voice at a comfortable pace.
- Use one file per row when possible. Preferred format is mono PCM WAV at
  48 kHz, but the recorder's original supported format is accepted.
- Keep roughly one second of silence before and after each sentence.
- Read the sentence naturally. Do not say punctuation marks aloud unless the
  sentence explicitly contains spoken code punctuation such as “Doppelpunkt.”
- If you stumble, replace that file with one clean new take. Do not edit words
  together from multiple takes and do not apply denoising or enhancement.
- Keep the same microphone and distance for the whole pilot, then document the
  device and room when handing it off.

Upload directory:

`corpus/inbox/self-recorded/speaker-001/de-DE/pilot-01/`

## Script

| File | Capability | Sentence to speak |
| --- | --- | --- |
| `01-de-own-dictation-001.wav` | everyday dictation | Bitte schick mir den Entwurf, sobald du mit der Überarbeitung fertig bist. |
| `02-de-own-dictation-003.wav` | everyday dictation | Kannst du bitte prüfen, ob die Datei vollständig hochgeladen wurde? |
| `03-de-own-formatting-001.wav` | formatting | Hast du den Bericht schon abgeschickt? Ich warte seit gestern darauf. |
| `04-de-own-formatting-002.wav` | formatting | Wichtig sind drei Dinge: Tempo, Zuverlässigkeit und eine klare Dokumentation. |
| `05-de-own-numbers-001.wav` | numbers | Der Termin ist am zwölften September zweitausendsechsundzwanzig um neun Uhr dreißig. |
| `06-de-own-numbers-004.wav` | numbers | Die Erfolgsquote stieg von siebenundachtzig Komma fünf auf dreiundneunzig Komma zwei Prozent. |
| `07-de-own-proper-nouns-001.wav` | proper nouns | TypeWhisper nutzt für diesen Test ein Modell von OpenAI. |
| `08-de-own-proper-nouns-002.wav` | proper nouns | Die Anwendung verbindet PostgreSQL mit einem Cluster in Kubernetes. |
| `09-de-own-code-001.wav` | code | Erstelle eine Konstante retry count mit dem Wert drei. |
| `10-de-own-code-003.wav` | code | Die SQL-Abfrage lautet select name from users where active equals true. |
| `11-de-own-mixed-001.wav` | mixed hard | Der TypeScript-Build für Version vier Punkt zwei schlug auf GitHub Actions zweimal fehl. |
| `12-de-own-mixed-004.wav` | mixed hard | Öffne https Doppelpunkt Schrägstrich Schrägstrich docs Punkt example Punkt com Schrägstrich api minus v zwei. |

If the recorder only produces M4A or another supported format, keep the exact
basename and replace only `.wav` with the real extension. Do not rename an M4A
file to `.wav`.

## Continuous-take fallback

If separate files are impractical, record one file named
`de-DE-pilot-01-continuous.<extension>`. Leave about three seconds of silence
between sentences and do not speak row numbers, filenames, or capability names.
