/**
 * Builds bench/diarization/diarization-set.json from the downloaded audio and the references in
 * the repository. Run once when the set changes; the file is committed.
 */
import { existsSync } from "fs";
import { open, readFile, readdir, stat, writeFile } from "fs/promises";
import { basename, join } from "path";
import { parseRttm } from "./der.js";
import {
  DIARIZATION_AUDIO_DIR,
  DIARIZATION_REFERENCES_DIR,
  DIARIZATION_SET_PATH,
  sha256File,
} from "./score.js";
import { DIARIZATION_SET_SCHEMA, type DiarizationSet, type DiarizationSetItem } from "./types.js";

export const DIARIZATION_SET_ID = "diarization-v1";
const AMI_BASE = "https://groups.inf.ed.ac.uk/ami/AMICorpusMirror/amicorpus";
const SYNTHETIC_ASSET =
  "https://github.com/TypeWhisper/typewhisper-benchmark/releases/download/diarization-set-v1/diarization-synthetic-v1.zip";
const AMI_MICS = [
  { group: "ami-array", suffix: "Array1-01", name: "array" },
  { group: "ami-headset", suffix: "Mix-Headset", name: "headset" },
] as const;

/** Duration of a 16 kHz mono 16-bit PCM WAV, read from its header. */
export async function wavSeconds(path: string): Promise<number> {
  const handle = await open(path, "r");
  try {
    const header = Buffer.alloc(4096);
    await handle.read(header, 0, header.length, 0);
    if (header.toString("ascii", 0, 4) !== "RIFF" || header.toString("ascii", 8, 12) !== "WAVE") throw new Error(`${path} is not a WAV file`);
    let offset = 12;
    let sampleRate = 0;
    let channels = 0;
    let bits = 0;
    while (offset + 8 <= header.length) {
      const id = header.toString("ascii", offset, offset + 4);
      const size = header.readUInt32LE(offset + 4);
      if (id === "fmt ") {
        channels = header.readUInt16LE(offset + 10);
        sampleRate = header.readUInt32LE(offset + 12);
        bits = header.readUInt16LE(offset + 22);
      } else if (id === "data") {
        if (sampleRate !== 16_000 || channels !== 1 || bits !== 16) {
          throw new Error(`${path}: ${sampleRate} Hz, ${channels} channel(s), ${bits} bit; expected 16 kHz mono 16-bit`);
        }
        // Some AMI files declare a data size larger than the file; trust the file size.
        const fileSize = (await stat(path)).size;
        const dataBytes = Math.min(size, fileSize - (offset + 8));
        return dataBytes / (sampleRate * channels * (bits / 8));
      }
      offset += 8 + size + (size % 2);
    }
    throw new Error(`${path}: no data chunk in the first 4 KB`);
  } finally {
    await handle.close();
  }
}

async function item(fields: Omit<DiarizationSetItem, "sha256" | "bytes" | "seconds" | "speakers">): Promise<DiarizationSetItem | null> {
  const path = join(DIARIZATION_AUDIO_DIR, fields.audio);
  if (allowMissing && !existsSync(path)) {
    console.warn(`diarization-set: ${fields.audio} is missing and left out`);
    return null;
  }
  const primary = Object.values(fields.references)[0]!;
  const turns = parseRttm(await readFile(join(DIARIZATION_REFERENCES_DIR, primary), "utf8"));
  return {
    ...fields,
    sha256: await sha256File(path),
    bytes: (await stat(path)).size,
    seconds: Math.round((await wavSeconds(path)) * 1000) / 1000,
    speakers: new Set(turns.map((t) => t.speaker)).size,
  };
}

let allowMissing = false;

/** `allowMissingAudio` leaves out files that are not downloaded yet, for a run to start early. */
export async function buildDiarizationSet(options: { allowMissingAudio?: boolean } = {}): Promise<DiarizationSet> {
  allowMissing = Boolean(options.allowMissingAudio);
  const found: (DiarizationSetItem | null)[] = [];
  const amiMeetings = (await readdir(join(DIARIZATION_REFERENCES_DIR, "ami", "only-words")))
    .filter((n) => n.endsWith(".rttm"))
    .map((n) => basename(n, ".rttm"))
    .sort();
  for (const mic of AMI_MICS) {
    for (const meeting of amiMeetings) {
      found.push(
        await item({
          id: `ami/${meeting}/${mic.name}`,
          group: mic.group,
          language: "en",
          audio: `ami/${meeting}.${mic.suffix}.wav`,
          url: `${AMI_BASE}/${meeting}/audio/${meeting}.${mic.suffix}.wav`,
          references: {
            "only-words": `ami/only-words/${meeting}.rttm`,
            "forced-alignment": `ami/forced-alignment/${meeting}.rttm`,
          },
          uem: `ami/${meeting}.uem`,
        })
      );
    }
  }
  const synthetic = (await readdir(join(DIARIZATION_REFERENCES_DIR, "synthetic")))
    .filter((n) => n.endsWith(".rttm"))
    .map((n) => basename(n, ".rttm"))
    .sort();
  for (const name of synthetic) {
    found.push(
      await item({
        id: `synthetic/${name}`,
        group: "synthetic",
        language: name.startsWith("de-en") ? "de-en" : name.slice(0, 2),
        audio: `synthetic/${name}.wav`,
        url: `${SYNTHETIC_ASSET}#${name}.wav`,
        references: { exact: `synthetic/${name}.rttm` },
        uem: null,
      })
    );
  }
  const items = found.filter((i): i is DiarizationSetItem => i !== null);
  return {
    schema: DIARIZATION_SET_SCHEMA,
    id: DIARIZATION_SET_ID,
    description:
      "AMI test split (16 meetings; table array Array1-01 and headset mix; pyannote only_words and NTT forced-alignment " +
      "references, pyannote UEMs) " +
      "and 22 synthetic VoxPopuli conversations in de, en, fr, es, it and de-en with 2 to 6 speakers.",
    items,
  };
}

export async function writeDiarizationSet(options: { allowMissingAudio?: boolean } = {}): Promise<DiarizationSet> {
  const set = await buildDiarizationSet(options);
  await writeFile(DIARIZATION_SET_PATH, JSON.stringify(set, null, 2) + "\n");
  return set;
}

/** Files of the set that are missing or differ from the manifest. */
export async function checkDiarizationAudio(set: DiarizationSet): Promise<string[]> {
  const problems: string[] = [];
  for (const entry of set.items) {
    const path = join(DIARIZATION_AUDIO_DIR, entry.audio);
    try {
      if ((await stat(path)).size !== entry.bytes) problems.push(`${entry.audio}: size differs`);
      else if ((await sha256File(path)) !== entry.sha256) problems.push(`${entry.audio}: checksum differs`);
    } catch {
      problems.push(`${entry.audio}: missing`);
    }
  }
  return problems;
}
