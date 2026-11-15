# /// script
# requires-python = ">=3.10"
# dependencies = ["pyarrow"]
# ///
"""Build the two German legal suites, each clip with the legal terms it must transcribe (keyTerms).

  bundestag  Real speech from the test split of ASR Bundestag (plenary sessions and committee
             meetings of the German Bundestag). Only clips with at least one legal term from TERMS
             below are kept. Source: Deutscher Bundestag; the audio is under the Bundestag's terms
             of use for Parlamentsfernsehen material (free for educational use, not for
             advertising), so the WAVs are not committed. The seven test shards must be in
             bench/audio/datasets/bundestag-asr-de/:
               for i in 0 1 2 3 4 5 6; do curl -L -o bench/audio/datasets/bundestag-asr-de/test-0000$i-of-00007.parquet \\
                 https://huggingface.co/datasets/D4ve-R/bundestag-asr/resolve/7eaa313809971719bc290494768cdbc7ba4b3a2e/data/test-0000$i-of-00007.parquet; done
  dictation  Lawyer's dictation (pleadings, letters, criminal defence) from
             scripts/legal-dictation-de.json, read by the macOS voice Anna (needs macOS `say` and
             ffmpeg). The reference is the written form ("§ 823 Abs. 1 BGB"), the voice reads the
             dictated form ("Paragraf 823 Absatz 1 BGB"); the normalizer treats both the same.

Usage: uv run --script bench/scripts/curate-legal-de.py [bundestag] [dictation]
"""
import json
import re
import subprocess
import sys
from collections import Counter
from pathlib import Path

import pyarrow.parquet as pq

BENCH_ROOT = Path(__file__).resolve().parent.parent
BUNDESTAG_DIR = BENCH_ROOT / "audio" / "datasets" / "bundestag-asr-de"
BUNDESTAG_SHARDS = [f"test-0000{i}-of-00007.parquet" for i in range(7)]
DICTATION_SCRIPT = BENCH_ROOT / "scripts" / "legal-dictation-de.json"
MIN_SECONDS, MAX_SECONDS = 3.0, 20.0
# 16 kHz mono 16-bit PCM
BYTES_PER_SECOND = 32000
UMLAUT_SPELLINGS = [("ae", "ä"), ("oe", "ö"), ("ue", "ü"), ("ss", "ß")]

# Legal terms that occur in the ASR Bundestag test split, picked by hand from its vocabulary:
# courts, procedure, criminal, civil and constitutional law. Words every political speech uses
# (Gesetz, Gesetzentwurf, Recht, Koalitionsvertrag) are left out. The references are lowercase.
TERMS = """
absatz paragraph paragraf paragrafen paragraphen
grundgesetz grundgesetzes grundgesetzlich grundgesetzänderung bundesverfassungsgericht
bundesverfassungsgerichts bundesverfassungsgerichtes verfassungsgericht verfassungsrechtlich
verfassungsrechtlichen verfassungsrechtliche verfassungswidrig verfassungswidrige verfassungswidrigen
verfassungswidrigkeit verfassungskonform verfassungsgemäß verfassungsmäßig verfassungsbeschwerde
verfassungsänderung grundrechte grundrecht grundrechtseingriff grundrechtseingriffe
grundrechtseinschränkungen rechtsstaat rechtsstaatlichkeit rechtsstaatlichen rechtsprechung
rechtsgrundlage rechtsgrundlagen rechtssicherheit rechtsanspruch rechtslage rechtsordnung rechtsschutz
rechtsweg rechtsverordnung rechtsverordnungen rechtsausschuss rechtsausschusses rechtswidrig
rechtswidrige rechtskräftig rechtswirksam rechtsanwalt rechtsanwälte rechtsanwälten rechtsanwältin
rechtsanwaltskanzlei rechtsberatung rechtsdienstleistung rechtsdienstleistungen rechtsdienstleister
rechtsbehelfsfrist rechtsbehelfsbelehrung rechtsbeugung rechtsgüter gesetzgebungskompetenz
bundesgesetzblatt inkrafttreten verhältnismäßigkeit verhältnismäßigkeitsgrundsatz
strafrecht strafrechtlich strafrechtliche strafgesetzbuch strafgesetzbuches stgb strafprozessordnung
strafprozess strafverfahren strafverfahrens strafverfolgung strafverfolgungsbehörden strafbar
strafbarkeit strafbarkeitslücken straftatbestand straftatbestände tatbestand tatbestandsmerkmal
tatbestandsvoraussetzungen straftat straftaten straftäter freiheitsstrafe geldstrafe geldstrafen
ersatzfreiheitsstrafe bewährungsstrafen haftstrafe untersuchungshaft haftbefehl haftbefehls strafmaß
strafrahmen mindeststrafe strafandrohung strafanzeige anklagesatz angeklagten staatsanwalt
staatsanwältin generalbundesanwalt bundesanwalt beweislast beweislastumkehr beweismittel beweismitteln
beweissicherung zeugnisverweigerungsrecht vorsatz fahrlässigkeit verjährungsfrist rückwirkungsverbot
völkerstrafgesetzbuch völkerstrafrecht strafgerichtshof bundesgerichtshof bundesgerichtshofs
bundesverwaltungsgericht verwaltungsgericht sozialgerichten schiedsgericht schiedsgerichtsbarkeit
gerichtsbarkeit gerichtsverhandlungen instanz instanzen tatsacheninstanz revision klagebefugnis kläger
verklagt konkurrentenklage normenkontrollklage verbotsverfahren vertragsverletzungsverfahren
beschwerdeführerin prozessbevollmächtigte prozessbevollmächtigten prozessfähigkeit prozessunfähigen
prozesskostenhilfe zivilrecht zivilrechtlichen zivilrechtliche zpo bgb produkthaftung
gewährleistungsfrist kaufrecht widerrufsrecht vertragsverletzung insolvenzrechts erbrecht familienrecht
unterhaltsvorschuss mindestunterhalt barunterhaltspflichtigen vorsorgevollmacht betreuungsrecht
ehegattennotvertretungsrecht adoptionsrecht mietrecht vorkaufsrecht milieuschutzsatzung
kündigungsschutz tarifvertrag arbeitsrechtlichen urheberrecht urheberrechtsgesetz
datenschutzgrundverordnung dsgvo datenschutzrecht aufenthaltsrecht staatsangehörigkeitsrecht
verwaltungsakt verwaltungsverfahrensgesetz verwaltungsvorschrift planfeststellungsverfahren
bußgeldvorschriften völkerrecht völkerrechtswidrig völkerrechtswidrigen völkerrechtswidrige
menschenrechtskonvention immunität nichtigkeit nichtig unwirksam verurteilt verurteilung
""".split()


def key_terms(text, terms):
    """Terms the reference contains as a whole word (a hyphen joins words), in reading order."""
    found = []
    for term in terms:
        match = re.search(r"(?<![\w-])" + re.escape(term) + r"(?![\w-])", text, re.IGNORECASE)
        if match:
            found.append((match.start(), match.group(0)))
    return [surface for _, surface in sorted(found)]


def ffmpeg_to_wav(out_path, data=None, src_path=None):
    """Write 16 kHz mono PCM through a temporary file, so an interrupted run leaves no partial WAV."""
    tmp = out_path.with_suffix(".tmp.wav")
    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-i", src_path or "pipe:0",
           "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", str(tmp)]
    subprocess.run(cmd, input=data, check=True)
    tmp.rename(out_path)


def write_suite(suite):
    out = BENCH_ROOT / "tests" / f"{suite['id']}.json"
    out.write_text(json.dumps(suite, indent=2, ensure_ascii=False) + "\n")
    terms = sum(len(t["keyTerms"]) for t in suite["tests"])
    print(f"Written {len(suite['tests'])} tests with {terms} key terms to {out}")


def transliterated_words(vocabulary):
    """Words spelled with ae/oe/ue/ss where the corpus mostly writes ä/ö/ü/ß ("realitaeten").

    Some ASR Bundestag references come from protocols without umlauts; a model that writes
    "Realitäten" would be marked wrong for them.
    """
    flagged = set()
    for word, count in vocabulary.items():
        variants = {word.replace(plain, umlaut) for plain, umlaut in UMLAUT_SPELLINGS}
        all_umlauts = word
        for plain, umlaut in UMLAUT_SPELLINGS:
            all_umlauts = all_umlauts.replace(plain, umlaut)
        variants.add(all_umlauts)
        variants.discard(word)
        if any(vocabulary.get(variant, 0) >= count for variant in variants):
            flagged.add(word)
    return flagged


def curate_bundestag():
    missing = [shard for shard in BUNDESTAG_SHARDS if not (BUNDESTAG_DIR / shard).exists()]
    if missing:
        sys.exit(f"ASR Bundestag test shards not found in {BUNDESTAG_DIR}: {', '.join(missing)}")
    rows = []
    for shard in BUNDESTAG_SHARDS:
        table = pq.read_table(BUNDESTAG_DIR / shard, columns=["text"])
        rows += [(shard, index, " ".join(text.split())) for index, text in enumerate(table.column("text").to_pylist())]
    vocabulary = Counter(word for _, _, text in rows for word in text.split())
    transliterated = transliterated_words(vocabulary)

    candidates = {}
    for shard, index, text in rows:
        if any(word in transliterated for word in text.split()):
            continue
        found = key_terms(text, TERMS)
        if found:
            candidates.setdefault(shard, []).append((index, text, found))

    out_dir = BENCH_ROOT / "audio" / "samples-bundestag-legal-de"
    out_dir.mkdir(parents=True, exist_ok=True)
    tests = []
    for shard in BUNDESTAG_SHARDS:
        audio = pq.read_table(BUNDESTAG_DIR / shard, columns=["audio"]).column("audio")
        for index, text, found in candidates.get(shard, []):
            entry = audio[index].as_py()
            seconds = (len(entry["bytes"]) - 44) / BYTES_PER_SECOND
            if not MIN_SECONDS <= seconds <= MAX_SECONDS:
                continue
            name = f"bundestag-de-{Path(entry['path']).stem.replace('_', '-')}"
            wav = out_dir / f"{name}.wav"
            if not wav.exists():
                ffmpeg_to_wav(wav, data=entry["bytes"])
            tests.append({
                "id": name,
                "audioFile": f"samples-bundestag-legal-de/{wav.name}",
                "groundTruth": text,
                "keyTerms": found,
                "tags": ["legal", "real-speech", "parliament"],
                "source": "bundestag",
            })
    write_suite({
        "id": "legal-bundestag-de",
        "name": "Legal Speech: Bundestag (German)",
        "description": "Real German parliamentary speech from the ASR Bundestag test split (source: Deutscher Bundestag), clips with at least one legal term",
        "language": "de",
        "category": "legal-speech",
        "benchmarkTier": "diagnostic",
        "tests": tests,
    })


def render_dictation():
    entries = json.loads(DICTATION_SCRIPT.read_text())
    out_dir = BENCH_ROOT / "audio" / "samples-legal-dictation-de"
    out_dir.mkdir(parents=True, exist_ok=True)
    tests = []
    for entry in entries:
        missing = [term for term in entry["keyTerms"] if term not in key_terms(entry["text"], entry["keyTerms"])]
        if missing:
            sys.exit(f"{entry['id']}: key terms not in the text: {missing}")
        wav = out_dir / f"{entry['id']}.wav"
        if not wav.exists():
            aiff = wav.with_suffix(".aiff")
            spoken = entry.get("spoken", entry["text"])
            subprocess.run(["say", "-v", "Anna", "-r", "180", "-o", str(aiff), spoken], check=True)
            ffmpeg_to_wav(wav, src_path=str(aiff))
            aiff.unlink()
        tests.append({
            "id": entry["id"],
            "audioFile": f"samples-legal-dictation-de/{wav.name}",
            "groundTruth": entry["text"],
            "keyTerms": entry["keyTerms"],
            "tags": ["legal", "dictation", "tts", *entry["tags"]],
            "source": "custom",
        })
    write_suite({
        "id": "legal-dictation-de",
        "name": "Legal Dictation (German)",
        "description": "Lawyer's dictation with norm citations (§ 823 Abs. 1 BGB), procedural terms, Latin maxims and long compounds (macOS TTS, voice Anna)",
        "language": "de",
        "category": "legal-speech",
        "benchmarkTier": "diagnostic",
        "tests": tests,
    })


if __name__ == "__main__":
    parts = sys.argv[1:] or ["bundestag", "dictation"]
    if "bundestag" in parts:
        curate_bundestag()
    if "dictation" in parts:
        render_dictation()
