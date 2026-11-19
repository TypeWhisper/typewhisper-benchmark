# /// script
# requires-python = ">=3.10"
# dependencies = ["pyarrow"]
# ///
"""Build the legal suites, each clip with the legal terms it must transcribe (keyTerms).

  bundestag  German real speech from the test split of ASR Bundestag (plenary sessions and
             committee meetings of the German Bundestag). Only clips with at least one legal term
             from BUNDESTAG_TERMS are kept. Source: Deutscher Bundestag; the audio is under the
             Bundestag's terms of use for Parlamentsfernsehen material (free for educational use,
             not for advertising), so the WAVs are not committed. The seven test shards must be in
             bench/audio/datasets/bundestag-asr-de/:
               for i in 0 1 2 3 4 5 6; do curl -L -o bench/audio/datasets/bundestag-asr-de/test-0000$i-of-00007.parquet \\
                 https://huggingface.co/datasets/D4ve-R/bundestag-asr/resolve/7eaa313809971719bc290494768cdbc7ba4b3a2e/data/test-0000$i-of-00007.parquet; done
  voxpopuli  English, French, Spanish, Italian and Dutch real speech from the European Parliament
             (VoxPopuli, CC0), test and validation splits. Only clips with at least one legal term
             from VOXPOPULI_TERMS are kept, minus the misaligned segments in VOXPOPULI_MISALIGNED.
             French, Spanish and Italian clips with digits are skipped: the selection predates the
             normalizer's number spellers for these languages, and lifting the filter would add
             clips every model has to run again. Dutch clips with digits are skipped too, because
             spoken years ("negentienhonderdnegentig") do not match their digits. The WAVs are not
             committed. For <lang> in en fr es it nl and <split> in test validation:
               curl -L -o bench/audio/datasets/voxpopuli-<lang>/<split>.parquet \\
                 https://huggingface.co/datasets/facebook/voxpopuli/resolve/42f01879c780b4a2e90ec0b4f616c2ece526e4f1/<lang>/<split>-00000-of-00001.parquet
  dictation  Lawyer's dictation (pleadings, letters, criminal defence) from
             scripts/legal-dictation-<lang>.json, read by a macOS voice (needs macOS `say` and
             ffmpeg). The reference is the written form ("§ 823 Abs. 1 BGB"); the voice reads the
             dictated form from "spoken" ("Paragraf 823 Absatz 1 BGB"). The normalizer treats
             both the same. manifest.json next to the WAVs records what each one was
             recorded from; the script stops when an entry no longer matches its WAV.

Usage: uv run --script bench/scripts/curate-legal.py [bundestag] [voxpopuli] [dictation] [--language de en ...]
"""
import argparse
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
VOXPOPULI_SPLITS = ["test", "validation"]
LANGUAGES = ["de", "en", "fr", "es", "it", "nl"]
LANGUAGE_NAMES = {"de": "German", "en": "English", "fr": "French", "es": "Spanish", "it": "Italian", "nl": "Dutch"}
# The voices the other TTS suites use (Anna, Samantha), and the default voice of each other language
VOICES = {"de": "Anna", "en": "Samantha", "fr": "Thomas", "es": "Mónica", "it": "Alice", "nl": "Xander"}
SPEAKING_RATE = 180
MIN_SECONDS, MAX_SECONDS = 3.0, 20.0
# 16 kHz mono 16-bit PCM
BYTES_PER_SECOND = 32000
UMLAUT_SPELLINGS = [("ae", "ä"), ("oe", "ö"), ("ue", "ü"), ("ss", "ß")]

# German legal terms that occur in the ASR Bundestag test split, picked by hand from its vocabulary:
# courts, procedure, criminal, civil and constitutional law. Words every political speech uses
# (Gesetz, Gesetzentwurf, Recht, Koalitionsvertrag) are left out. The references are lowercase.
BUNDESTAG_TERMS = """
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

# Legal terms that occur in the VoxPopuli test and validation splits, picked by hand from their
# vocabulary. European Parliament speech is about legislation, so the instruments of EU law
# (regulation, directive, treaty) are in. Words that are mostly political in these debates are
# out: "rights"/"droits"/"derechos"/"diritti" alone (human rights), "sanctions" (against
# countries), "responsibility", "mandate", "competence", "process". So are words with an everyday
# reading: "cours" (au cours de), "preuve" (faire preuve de), "trattato" (si è trattato di).
VOXPOPULI_TERMS = {
    "en": """
law laws legal illegal illegally legally legality legislation legislative legislator legislators
lawmakers regulation regulations directive directives treaty treaties court courts judge judges
judgment judgments ruling rulings jurisdiction jurisdictions criminal criminals crime crimes
offence offences prosecution prosecutions prosecutor prosecutors penalties penalty liability
liable contract contracts statute statutes breach breaches infringement infringements provision
provisions amendment amendments article articles paragraph paragraphs clause clauses constitution
constitutional charter enforcement compliance detention imprisonment prison prisons prisoner
prisoners arrest arrested warrant extradition asylum evidence witness witnesses lawyer lawyers
attorney arbitration appeal appeals ratification ratify ratified copyright patent patents
trademark gdpr immunity proportionality subsidiarity fraud corruption bribery whistleblowers
torture injustice
""".split() + ["Court of Justice", "rule of law", "fundamental rights", "data protection", "money laundering",
               "human rights violations"],
    "fr": """
loi lois légal légale légales illégal illégale illégales légalité illégalité législation législations
législatif législative législatifs législatives législateur législateurs colégislateurs juridique
juridiques juridiquement juridiction juridictions jurisprudence justice juge juges tribunal
tribunaux cour procès procédure procédures pénal pénale pénales criminel criminelle criminels
criminelles criminalité crime crimes délit délits infraction infractions contrat contrats traité
traités règlement règlements directive directives article articles paragraphe alinéa clause
clauses disposition dispositions amendement amendements constitution constitutionnel
constitutionnelle constitutionnels constitutionnelles anticonstitutionnel charte condamnation
condamnations prison prisons prisonniers détention détentions arrestation arrestations
extradition asile témoin témoins avocat avocats notaire arbitrage violation
violations conformité ratification ratifier ratifié annulation nullité brevet brevets immunité
proportionnalité subsidiarité blanchiment fraude corruption injustice
""".split() + ["État de droit", "droits fondamentaux", "droit d'auteur", "protection des données", "lanceurs d'alerte",
               "mandat d'arrêt", "droit d'asile", "Cour de justice"],
    "es": """
ley leyes legal legales ilegal ilegales ilegalmente legalidad ilegalidad legislación legislaciones
legislativo legislativa legislativos legislativas legislador legisladores legislar jurídico jurídica
jurídicos jurídicas jurídicamente jurisdicción jurisprudencia justicia juez jueces tribunal
tribunales procedimiento procedimientos penal penales criminal criminales crimen crímenes delito
delitos infracción infracciones contrato contratos tratado tratados estatuto reglamento reglamentos
directiva directivas artículo artículos apartado párrafo cláusula cláusulas disposición
disposiciones enmienda enmiendas constitución constitucional condena condenas condenado
condenados prisión prisiones cárcel cárceles detención detenciones extradición asilo testigo
testigos abogado abogados notario arbitraje vulneración incumplimiento incumplimientos
ratificación ratificado anulación nulidad patente patentes inmunidad proporcionalidad
subsidiariedad blanqueo fraude corrupción denunciantes injusticia
""".split() + ["Estado de Derecho", "derechos fundamentales", "derechos de autor", "protección de datos",
               "orden de detención", "Tribunal de Justicia"],
    "it": """
legge leggi legale legali illegale illegali illegalmente legalmente legalità illegalità
legislazione legislazioni legislativo legislativa legislativi legislative legislatore legislatori
colegislatori giuridico giuridica giuridici giuridiche giuridicamente giurisdizione giurisprudenza
giustizia giudice giudici tribunale tribunali corte procedura procedure penale penali criminale
criminali criminalità crimine crimini reato reati infrazione infrazioni contratto contratti
contrattuale statuto regolamento regolamenti direttiva direttive articolo articoli
paragrafo comma clausola clausole disposizione disposizioni emendamento emendamenti costituzione
costituzionale condanna condanne carcere carceri detenzione detenzioni arresto estradizione asilo
testimoni avvocato avvocati notaio arbitrato violazione violazioni conformità ratifica ratificare
annullamento nullità brevetto brevetti immunità proporzionalità sussidiarietà riciclaggio frode
corruzione whistleblowing ingiustizia
""".split() + ["Stato di diritto", "diritti fondamentali", "diritto d'autore", "protezione dei dati",
               "mandato d'arresto", "Corte di giustizia"],
    # Dutch joins compounds into one word, so the list names the compounds the splits contain.
    # "Rechten" and "mensenrechten" are out like "rights"; so are "vervolgen" and "vervolgd" (also
    # "to continue"), "schuld" (debt) and "asielzoekers" (migration policy).
    "nl": """
wet wetten wetgeving wetgevingen wetgevend wetgevende wetgevingsproces wetgevingsprocedure
wetgevingsresolutie wetgevingspakket wetsvoorstel wetsvoorstellen wetswijzigingen wettelijk
wettelijke wettige arbeidswetgeving vennootschapswetgeving gelijkebehandelingswetgeving
antidiscriminatiewet verdrag verdragen associatieverdrag raamverdrag handelsverdragen
vrijhandelsverdrag vrijhandelsverdragen richtlijn richtlijnen antiwitwasrichtlijn
terugkeerrichtlijn erkenningsrichtlijn verordening verordeningen passagiersbeschermingsverordening
amendement amendementen grondwet grondwettelijke grondrechten rechtsstaat rechtsstatelijkheid
rechtssysteem rechtspraak rechter rechters rechterlijke rechtsgang rechtsgrondslag rechtszekerheid
rechtsbescherming rechtspersoonlijkheid rechtmatige juridisch juridische strafrecht strafrechtelijk
strafrechtelijke civielrechtelijk civielrechtelijke internationaalrechtelijk hof strafhof strafbaar
gevangenisstraf doodstraf gevangenis gevangenissen procedure procedures procedurele
asielprocedures veroordeeld aanklagen corruptie corrupt corrupte anticorruptie fraude
belastingfraude identiteitsfraude fraudebestrijding fraudeurs illegaal illegale illegalen
illegaliteit legale criminaliteit crimineel criminele criminelen asiel asielrecht getuigen
advocaat advocaten arbitrage immuniteit subsidiariteit clausule bepalingen vonnis octrooirecht
kwekersrecht kwekersrechten gegevensbescherming gegevensbeschermingsregels
gegevensbeschermingsovereenkomst inbreuken schending schendingen
""".split() + ["Hof van Justitie"],
}
# VoxPopuli segments whose reference covers more or less speech than the audio: Parakeet TDT v3,
# Whisper large-v3-turbo and Apple SpeechTranscriber all score above 40% WER on them (Dutch: Parakeet
# TDT v3 and Ultra, Whisper large-v3-turbo, Cohere Transcribe and Rumble-2-Flash, as SpeechTranscriber
# has no Dutch).
VOXPOPULI_MISALIGNED = {
    "voxpopuli-fr-20091214-0900-PLENARY-13-fr-20091214-21-42-49-0",
    "voxpopuli-fr-20111130-0900-PLENARY-11-fr-20111130-16-35-45-16",
    "voxpopuli-fr-20170706-0900-PLENARY-3-fr-20170706-09-27-52-0",
    "voxpopuli-it-20130521-0900-PLENARY-4-it-20130521-10-44-59-4",
    "voxpopuli-it-20130521-0900-PLENARY-4-it-20130521-10-44-59-8",
    "voxpopuli-it-20131008-0900-PLENARY-8-it-20131008-13-48-41-2",
    "voxpopuli-it-20131009-0900-PLENARY-17-it-20131009-19-54-43-1",
    "voxpopuli-it-20140115-0900-PLENARY-9-it-20140115-13-25-13-0",
    "voxpopuli-it-20140226-0900-PLENARY-3-it-20140226-09-26-22-5",
    "voxpopuli-it-20140226-0900-PLENARY-3-it-20140226-09-26-22-9",
    "voxpopuli-it-20140414-0900-PLENARY-16-it-20140414-19-56-25-7",
    "voxpopuli-it-20150128-0900-PLENARY-7-it-20150128-16-42-42-6",
    "voxpopuli-it-20160607-0900-PLENARY-15-it-20160607-18-14-40-1",
    "voxpopuli-it-20180313-0900-PLENARY-8-it-20180313-13-21-44-3",
    "voxpopuli-it-20180529-0900-PLENARY-23-it-20180529-21-25-31-2",
    "voxpopuli-nl-20090310-0900-PLENARY-6-nl-20090310-10-25-00-0",
    "voxpopuli-nl-20141022-0900-PLENARY-13-nl-20141022-18-13-10-0",
    "voxpopuli-nl-20170118-0900-PLENARY-15-nl-20170118-15-44-47-0",
    "voxpopuli-nl-20171212-0900-PLENARY-5-nl-20171212-10-14-54-0",
    "voxpopuli-nl-20180315-0900-PLENARY-3-nl-20180315-09-28-48-0",
}

DICTATION_DESCRIPTIONS = {
    "de": "Lawyer's dictation with norm citations (§ 823 Abs. 1 BGB), procedural terms, Latin maxims and long compounds",
    "en": "Lawyer's dictation with citations (42 U.S.C. § 1983, Rule 12(b)(6)), procedural terms, Latin maxims and case names",
    "fr": "Lawyer's dictation with citations (art. 1240 du Code civil), procedural terms and Latin maxims",
    "es": "Lawyer's dictation with citations (art. 1902 del Código Civil), procedural terms and Latin maxims",
    "it": "Lawyer's dictation with citations (art. 2043 del codice civile), procedural terms and Latin maxims",
    "nl": "Lawyer's dictation with citations (art. 6:162 BW), procedural terms and Latin maxims",
}


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
        found = key_terms(text, BUNDESTAG_TERMS)
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


def wav_seconds(data):
    """Length of a RIFF WAV in memory, from its fmt and data chunks (VoxPopuli stores float32)."""
    position, rate, frame_bytes = 12, None, None
    while position + 8 <= len(data):
        chunk, size = data[position:position + 4], int.from_bytes(data[position + 4:position + 8], "little")
        if chunk == b"fmt ":
            channels = int.from_bytes(data[position + 10:position + 12], "little")
            rate = int.from_bytes(data[position + 12:position + 16], "little")
            frame_bytes = channels * int.from_bytes(data[position + 22:position + 24], "little") // 8
        elif chunk == b"data":
            return size / (rate * frame_bytes)
        position += 8 + size + (size & 1)
    raise ValueError("WAV without a data chunk")


def curate_voxpopuli(language):
    paths = [BENCH_ROOT / "audio" / "datasets" / f"voxpopuli-{language}" / f"{split}.parquet" for split in VOXPOPULI_SPLITS]
    missing = [str(path) for path in paths if not path.exists()]
    if missing:
        sys.exit(f"VoxPopuli {language} splits not found: {', '.join(missing)}")
    out_dir = BENCH_ROOT / "audio" / f"samples-voxpopuli-legal-{language}"
    out_dir.mkdir(parents=True, exist_ok=True)
    tests = []
    # VoxPopuli sometimes has one utterance twice, cut from two session recordings under different
    # ids (English: 18 pairs, Spanish: 14, Dutch: 5); only the first one counts
    seen_texts = set()
    for path in paths:
        table = pq.read_table(path, columns=["audio_id", "raw_text", "is_gold_transcript"])
        selected = []
        for index, row in enumerate(table.to_pylist()):
            text = " ".join(row["raw_text"].split())
            if not row["is_gold_transcript"] or (language != "en" and re.search(r"\d", text)):
                continue
            found = key_terms(text, VOXPOPULI_TERMS[language])
            if found:
                selected.append((index, row["audio_id"], text, found))
        audio = pq.read_table(path, columns=["audio"]).column("audio")
        for index, audio_id, text, found in selected:
            data = audio[index].as_py()["bytes"]
            if not MIN_SECONDS <= wav_seconds(data) <= MAX_SECONDS:
                continue
            name = f"voxpopuli-{language}-{re.sub(r'[^0-9A-Za-z]+', '-', audio_id).strip('-')}"
            if name in VOXPOPULI_MISALIGNED:
                continue
            if text in seen_texts:
                continue
            seen_texts.add(text)
            wav = out_dir / f"{name}.wav"
            if not wav.exists():
                ffmpeg_to_wav(wav, data=data)
            tests.append({
                "id": name,
                "audioFile": f"{out_dir.name}/{wav.name}",
                "groundTruth": text,
                "keyTerms": found,
                "tags": ["legal", "real-speech", "parliament"],
                "source": "voxpopuli",
            })
    write_suite({
        "id": f"legal-voxpopuli-{language}",
        "name": f"Legal Speech: European Parliament ({LANGUAGE_NAMES[language]})",
        "description": f"Real {LANGUAGE_NAMES[language]} speech from the European Parliament (VoxPopuli test and validation splits, CC0), clips with at least one legal term",
        "language": language,
        "category": "legal-speech",
        "benchmarkTier": "diagnostic",
        "tests": tests,
    })


def render_dictation(language):
    entries = json.loads((BENCH_ROOT / "scripts" / f"legal-dictation-{language}.json").read_text())
    voice = VOICES[language]
    out_dir = BENCH_ROOT / "audio" / f"samples-legal-dictation-{language}"
    out_dir.mkdir(parents=True, exist_ok=True)
    # What each WAV was recorded from, so a changed entry cannot pair new text with old audio
    manifest_path = out_dir / "manifest.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    tests = []
    for entry in entries:
        missing = [term for term in entry["keyTerms"] if term not in key_terms(entry["text"], entry["keyTerms"])]
        if missing:
            sys.exit(f"{entry['id']}: key terms not in the text: {missing}")
        wav = out_dir / f"{entry['id']}.wav"
        recording = {"voice": voice, "rate": SPEAKING_RATE, "spoken": entry.get("spoken", entry["text"])}
        if not wav.exists():
            aiff = wav.with_suffix(".aiff")
            subprocess.run(["say", "-v", voice, "-r", str(SPEAKING_RATE), "-o", str(aiff), recording["spoken"]], check=True)
            ffmpeg_to_wav(wav, src_path=str(aiff))
            aiff.unlink()
            # Saved per recording, so an interrupted run leaves no WAV without its entry
            manifest[entry["id"]] = recording
            manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
        elif manifest.get(entry["id"]) != recording:
            # Re-recording silently would leave the stored results scored against the old audio
            sys.exit(f"{entry['id']}: {wav.name} has no manifest entry, or its spoken text, voice or rate "
                     "changed since it was recorded; delete the WAV to record it again, then rerun the models on this suite")
        tests.append({
            "id": entry["id"],
            "audioFile": f"{out_dir.name}/{wav.name}",
            "groundTruth": entry["text"],
            "keyTerms": entry["keyTerms"],
            "tags": ["legal", "dictation", "tts", *entry["tags"]],
            "source": "custom",
        })
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    write_suite({
        "id": f"legal-dictation-{language}",
        "name": f"Legal Dictation ({LANGUAGE_NAMES[language]})",
        "description": f"{DICTATION_DESCRIPTIONS[language]} (macOS TTS, voice {voice})",
        "language": language,
        "category": "legal-speech",
        "benchmarkTier": "diagnostic",
        "tests": tests,
    })


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Build the legal suites")
    parser.add_argument("parts", nargs="*", help="bundestag, voxpopuli and/or dictation (default: all three)")
    parser.add_argument("--language", nargs="+", choices=LANGUAGES, default=LANGUAGES)
    args = parser.parse_args()
    parts = args.parts or ["bundestag", "voxpopuli", "dictation"]
    unknown = set(parts) - {"bundestag", "voxpopuli", "dictation"}
    if unknown:
        parser.error(f"unknown parts: {', '.join(sorted(unknown))}")
    if "bundestag" in parts and "de" in args.language:
        curate_bundestag()
    for language in args.language:
        if "voxpopuli" in parts and language in VOXPOPULI_TERMS:
            curate_voxpopuli(language)
        if "dictation" in parts:
            render_dictation(language)
