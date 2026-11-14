# /// script
# requires-python = ">=3.10"
# dependencies = ["pyarrow"]
# ///
"""Build the two German medical suites, each clip with the medical terms it must transcribe (keyTerms).

  multimed   Real medical speech from the MultiMed German test split (MIT; ACL 2025): doctor-patient
             talks, ward handovers and lectures. Only clips with at least one medical term from
             TERMS below or the German Medicine term pack are kept.
             bench/audio/datasets/multimed-de/test.parquet must exist:
               curl -L -o bench/audio/datasets/multimed-de/test.parquet \
                 https://huggingface.co/datasets/leduckhai/MultiMed/resolve/459d0ab6db332904f9d7b76a8baabf3333958fa8/German/test-00000-of-00001.parquet
  dictation  Discharge-letter dictation from scripts/medical-dictation-de.json, read by the macOS
             voice Anna (needs macOS `say` and ffmpeg).

Usage: uv run --script bench/scripts/curate-medical-de.py [multimed] [dictation]
"""
import json
import re
import subprocess
import sys
from pathlib import Path

import pyarrow.parquet as pq

BENCH_ROOT = Path(__file__).resolve().parent.parent
MULTIMED_PARQUET = BENCH_ROOT / "audio" / "datasets" / "multimed-de" / "test.parquet"
TERM_PACK = BENCH_ROOT / "probe" / "terms-german-medicine.txt"
DICTATION_SCRIPT = BENCH_ROOT / "scripts" / "medical-dictation-de.json"
MIN_SECONDS, MAX_SECONDS = 3.0, 20.0
# Clips with sound annotations ("* Musik *") or bracketed remarks have references nobody says.
ANNOTATION = re.compile(r"[*\[\]()]")

# Medical terms that occur in the MultiMed German test split, picked by hand from its vocabulary:
# drugs, diagnoses, findings, procedures and clinical words a general model is likely to miss.
# Everyday words that happen to be medical (Arzt, Patient, Krankenhaus, Schmerzen) are left out.
TERMS = """
Alkoholabusus Allgemeinmedizin Ambulanz Ampullen Analgesie Analgetika Anamnese Anamnesebogen
Antibiotikum Antidepressivum Antikoagulation Anästhesie Anästhesist Aspiration Assistenzarzt
Ataxien Atemfrequenz Atemgeräusch Atemgeräusche Bauchschmerzen Beatmungsfrequenz Beckenfraktur
Befund Befunde Beinvenenthrombose Beipackzettel Betablocker Blasenkatheter Blinddarmentzündung
Blutbild Blutdruckabfall Blutentnahme Blutentnahmen Blutfettwerte Bluthochdruck Blutzuckermessen
Bülau-Drainage Chefarzt Chirurgie Computertomografie Darmspiegelung Dehydration Depression
Depressionen Diagnose Diagnostik Dislokation Diurese Drainage Dyspnoe Echokardiografie
Eigenblutspende Elektrolyte Endoskopie Endoskopie-Befund Erbrechen Erreger Exsikkose
Fettstoffwechselstörung Frakturversorgung Gastroenteritis Gefühlsstörung Gewebeuntersuchung
Geriatrie Giemen Globusgefühl Grunderkrankung HIV-Infektion Halswirbelsäule Hautausschlag
Hautturgor Hb-Wert Heparin Herzfrequenz Herzinfarkte Herzrhythmusstörungen Herzschrittmacher
Immobilisation Impfung Inappetenz Indolenz Infekt Infusion Infusionstherapie Intensivstation
Intubation Kanüle Kardiologen Knie-TEP Knieprothese Klopfschall Kopfschmerzen Kreuzprobe
Krepitationen L-Dopa Labordiagnostik Laborwerte Leberpunktion Leberwerte Lokalanästhetikasalbe
Luftnot Lungenfunktion Lymphknoten Lähmung Lähmungen Midazolam Narkose Neuralgie Nikotinabusus
Nitrospray Notaufnahme Novamin NSAR-Medikation Oligurie Onkologen Orthopäden Penizillinallergie
Perkussorisch Physiotherapie Pollenallergie Postexpositionsprophylaxe Prophylaxe Prostata
Psychotherapie Pulsoxymeter Punktionskanüle Pupillenreaktion Pädiatrie Radiusfraktur Reanimation
Rechtsherzbelastung Reizhusten Rippenserienfraktur Röntgen Röntgenuntersuchungen Sauerstoff
Scharlach Schilddrüsentablette Schluckbeschwerden Schrittmacherimplantation Sensibilitätsstörungen
Sinustachykardie Skabies Skelettszintigrafie Sodbrennen Sonografie Stethoskop Stuhlprobe
Symptomatik Tetanus Thorax Thorax-CT Thoraxdrainage Thrombophilie Thrombose Trauma
Tumordiagnostik Ultraschalluntersuchung Unfallchirurgie Unterarmfraktur Unterschenkelfraktur
Unterschenkelödem Urinstatus Verdachtsdiagnose Visite Volumenmangel Vorerkrankungen Zoster
ZVK-Anlage Übelkeit
""".split()


def term_pack():
    return [line.strip() for line in TERM_PACK.read_text().splitlines() if line.strip() and not line.startswith("#")]


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


def curate_multimed():
    if not MULTIMED_PARQUET.exists():
        sys.exit(f"MultiMed German test split not found: {MULTIMED_PARQUET}")
    terms = sorted(set(TERMS) | set(term_pack()), key=str.lower)
    rows = pq.read_table(MULTIMED_PARQUET, columns=["text", "duration"]).to_pylist()
    selected = []
    for index, row in enumerate(rows):
        text = " ".join(row["text"].split())
        if not MIN_SECONDS <= row["duration"] <= MAX_SECONDS or ANNOTATION.search(text):
            continue
        found = key_terms(text, terms)
        if found:
            selected.append((index, text, found))

    audio = pq.read_table(MULTIMED_PARQUET, columns=["audio"]).column("audio")
    out_dir = BENCH_ROOT / "audio" / "samples-multimed-de"
    out_dir.mkdir(parents=True, exist_ok=True)
    tests = []
    for index, text, found in selected:
        name = f"multimed-de-test-{index:04d}"
        wav = out_dir / f"{name}.wav"
        if not wav.exists():
            ffmpeg_to_wav(wav, data=audio[index].as_py()["bytes"])
        tests.append({
            "id": name,
            "audioFile": f"samples-multimed-de/{wav.name}",
            "groundTruth": text,
            "keyTerms": found,
            "tags": ["medical", "real-speech"],
            "source": "multimed",
        })
    write_suite({
        "id": "medical-multimed-de",
        "name": "Medical Speech: MultiMed (German)",
        "description": "Real German medical speech (doctor-patient talks, handovers, lectures) from the MultiMed test split (MIT), clips with at least one medical term",
        "language": "de",
        "category": "medical-speech",
        "benchmarkTier": "diagnostic",
        "tests": tests,
    })


def render_dictation():
    entries = json.loads(DICTATION_SCRIPT.read_text())
    out_dir = BENCH_ROOT / "audio" / "samples-medical-dictation-de"
    out_dir.mkdir(parents=True, exist_ok=True)
    tests = []
    for entry in entries:
        wav = out_dir / f"{entry['id']}.wav"
        if not wav.exists():
            aiff = wav.with_suffix(".aiff")
            subprocess.run(["say", "-v", "Anna", "-r", "180", "-o", str(aiff), entry["text"]], check=True)
            ffmpeg_to_wav(wav, src_path=str(aiff))
            aiff.unlink()
        missing = [term for term in entry["keyTerms"] if term not in key_terms(entry["text"], entry["keyTerms"])]
        if missing:
            sys.exit(f"{entry['id']}: key terms not in the text: {missing}")
        tests.append({
            "id": entry["id"],
            "audioFile": f"samples-medical-dictation-de/{wav.name}",
            "groundTruth": entry["text"],
            "keyTerms": entry["keyTerms"],
            "tags": ["medical", "dictation", "tts", *entry["tags"]],
            "source": "custom",
        })
    write_suite({
        "id": "medical-dictation-de",
        "name": "Medical Dictation (German)",
        "description": "Discharge-letter dictation with drug names, diagnoses, lab values and procedures (macOS TTS, voice Anna)",
        "language": "de",
        "category": "medical-speech",
        "benchmarkTier": "diagnostic",
        "tests": tests,
    })


if __name__ == "__main__":
    parts = sys.argv[1:] or ["multimed", "dictation"]
    if "multimed" in parts:
        curate_multimed()
    if "dictation" in parts:
        render_dictation()
