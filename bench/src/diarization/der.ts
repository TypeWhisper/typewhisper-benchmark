/**
 * Diarization error rate, scored like pyannote.metrics and NIST md-eval: overlapping speech
 * counts, only the UEM region is scored, and an optional collar removes that many seconds on
 * both sides of every reference turn boundary from scoring.
 *
 * Reference and hypothesis speakers are mapped one to one so that their total co-occurring
 * speech is as large as possible. Then, for every stretch of time with n_ref reference and n_hyp
 * hypothesis speakers, of which n_correct are mapped pairs speaking together:
 *
 *   missed      = max(0, n_ref - n_hyp)
 *   false alarm = max(0, n_hyp - n_ref)
 *   confusion   = min(n_ref, n_hyp) - n_correct
 *   total       = n_ref
 *
 * each times the stretch's duration. DER = (missed + false alarm + confusion) / total.
 */

export interface Turn {
  start: number;
  end: number;
  speaker: string;
}

export interface Region {
  start: number;
  end: number;
}

export interface DerComponents {
  /** Seconds of reference speech, counted once per speaker. */
  total: number;
  missed: number;
  falseAlarm: number;
  confusion: number;
}

export interface DerResult extends DerComponents {
  der: number;
  /** Reference speaker → hypothesis speaker, for mapped pairs that share speech. */
  mapping: Record<string, string>;
}

/** Sorted, merged regions. */
export function mergeRegions(regions: Region[]): Region[] {
  const sorted = regions.filter((r) => r.end > r.start).sort((a, b) => a.start - b.start);
  const merged: Region[] = [];
  for (const region of sorted) {
    const last = merged[merged.length - 1];
    if (last && region.start <= last.end) last.end = Math.max(last.end, region.end);
    else merged.push({ ...region });
  }
  return merged;
}

/** Parts of `regions` outside `remove`; both merged and sorted. */
export function subtractRegions(regions: Region[], remove: Region[]): Region[] {
  const out: Region[] = [];
  let j = 0;
  for (const region of regions) {
    let start = region.start;
    while (j < remove.length && remove[j].end <= start) j++;
    let k = j;
    while (k < remove.length && remove[k].start < region.end) {
      if (remove[k].start > start) out.push({ start, end: remove[k].start });
      start = Math.max(start, remove[k].end);
      k++;
    }
    if (start < region.end) out.push({ start, end: region.end });
  }
  return out;
}

/** The scored region: the UEM (or the extent of all turns) without the collars. */
export function scoredRegions(reference: Turn[], hypothesis: Turn[], uem: Region[] | null, collar: number): Region[] {
  let base: Region[];
  if (uem) base = mergeRegions(uem);
  else {
    const all = [...reference, ...hypothesis];
    base = all.length ? [{ start: Math.min(...all.map((t) => t.start)), end: Math.max(...all.map((t) => t.end)) }] : [];
  }
  if (collar <= 0) return base;
  const boundaries = reference.flatMap((t) => [t.start, t.end]);
  const collars = mergeRegions(boundaries.map((b) => ({ start: b - collar, end: b + collar })));
  return subtractRegions(base, collars);
}

/** Turns cut to the scored regions. */
function clip(turns: Turn[], regions: Region[]): Turn[] {
  const out: Turn[] = [];
  for (const turn of turns) {
    for (const region of regions) {
      if (region.end <= turn.start) continue;
      if (region.start >= turn.end) break;
      const start = Math.max(turn.start, region.start);
      const end = Math.min(turn.end, region.end);
      if (end > start) out.push({ start, end, speaker: turn.speaker });
    }
  }
  return out;
}

/** Elementary stretches with the set of active speakers on each side. */
function stretches(reference: Turn[], hypothesis: Turn[]) {
  type Event = { time: number; delta: 1 | -1; side: 0 | 1; speaker: string };
  const events: Event[] = [];
  for (const [side, turns] of [reference, hypothesis].entries()) {
    for (const t of turns) {
      events.push({ time: t.start, delta: 1, side: side as 0 | 1, speaker: t.speaker });
      events.push({ time: t.end, delta: -1, side: side as 0 | 1, speaker: t.speaker });
    }
  }
  events.sort((a, b) => a.time - b.time);
  const active = [new Map<string, number>(), new Map<string, number>()];
  const out: { duration: number; ref: string[]; hyp: string[] }[] = [];
  let i = 0;
  let previous = events.length ? events[0].time : 0;
  while (i < events.length) {
    const time = events[i].time;
    if (time > previous && (active[0].size || active[1].size)) {
      out.push({ duration: time - previous, ref: [...active[0].keys()], hyp: [...active[1].keys()] });
    }
    while (i < events.length && events[i].time === time) {
      const e = events[i];
      const counts = active[e.side];
      const next = (counts.get(e.speaker) ?? 0) + e.delta;
      if (next > 0) counts.set(e.speaker, next);
      else counts.delete(e.speaker);
      i++;
    }
    previous = time;
  }
  return out;
}

/**
 * Maximum-weight one-to-one assignment (Hungarian method on costs = max - weight).
 * Returns, for every row, the column it got or -1.
 */
export function maxWeightAssignment(weights: number[][]): number[] {
  const rows = weights.length;
  const cols = rows ? weights[0].length : 0;
  if (!rows || !cols) return new Array(rows).fill(-1);
  const n = Math.max(rows, cols);
  let max = 0;
  for (const row of weights) for (const w of row) max = Math.max(max, w);
  const cost = (i: number, j: number) => (i < rows && j < cols ? max - weights[i][j] : max);
  // Jonker-Volgenant style O(n^3) Hungarian algorithm with potentials, 1-indexed.
  const u = new Array(n + 1).fill(0);
  const v = new Array(n + 1).fill(0);
  const p = new Array(n + 1).fill(0);
  const way = new Array(n + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array(n + 1).fill(Infinity);
    const used = new Array(n + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = Infinity;
      let j1 = 0;
      for (let j = 1; j <= n; j++) {
        if (used[j]) continue;
        const cur = cost(i0 - 1, j - 1) - u[i0] - v[j];
        if (cur < minv[j]) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }
      for (let j = 0; j <= n; j++) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else minv[j] -= delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0);
  }
  const result = new Array(rows).fill(-1);
  for (let j = 1; j <= n; j++) {
    const i = p[j] - 1;
    if (i >= 0 && i < rows && j - 1 < cols) result[i] = j - 1;
  }
  return result;
}

export function computeDer(
  reference: Turn[],
  hypothesis: Turn[],
  options: { uem?: Region[] | null; collar?: number } = {}
): DerResult {
  const regions = scoredRegions(reference, hypothesis, options.uem ?? null, options.collar ?? 0);
  const ref = clip(reference, regions);
  const hyp = clip(hypothesis, regions);
  const parts = stretches(ref, hyp);

  const refSpeakers = [...new Set(ref.map((t) => t.speaker))];
  const hypSpeakers = [...new Set(hyp.map((t) => t.speaker))];
  const refIndex = new Map(refSpeakers.map((s, i) => [s, i]));
  const hypIndex = new Map(hypSpeakers.map((s, i) => [s, i]));
  const cooccurrence = refSpeakers.map(() => new Array(hypSpeakers.length).fill(0));
  for (const part of parts) {
    for (const r of part.ref) for (const h of part.hyp) cooccurrence[refIndex.get(r)!][hypIndex.get(h)!] += part.duration;
  }
  const assignment = maxWeightAssignment(cooccurrence);
  const mapping: Record<string, string> = {};
  assignment.forEach((j, i) => {
    if (j >= 0 && cooccurrence[i][j] > 0) mapping[refSpeakers[i]] = hypSpeakers[j];
  });

  const result: DerComponents = { total: 0, missed: 0, falseAlarm: 0, confusion: 0 };
  for (const part of parts) {
    const nRef = part.ref.length;
    const nHyp = part.hyp.length;
    const hypSet = new Set(part.hyp);
    const nCorrect = part.ref.filter((r) => mapping[r] !== undefined && hypSet.has(mapping[r])).length;
    result.total += nRef * part.duration;
    result.missed += Math.max(0, nRef - nHyp) * part.duration;
    result.falseAlarm += Math.max(0, nHyp - nRef) * part.duration;
    result.confusion += (Math.min(nRef, nHyp) - nCorrect) * part.duration;
  }
  const errors = result.missed + result.falseAlarm + result.confusion;
  return { ...result, der: result.total > 0 ? errors / result.total : errors > 0 ? 1 : 0, mapping };
}

/** Pooled DER over several files: summed errors over summed reference speech. */
export function poolDer(parts: DerComponents[]): DerComponents & { der: number } {
  const sum = { total: 0, missed: 0, falseAlarm: 0, confusion: 0 };
  for (const p of parts) {
    sum.total += p.total;
    sum.missed += p.missed;
    sum.falseAlarm += p.falseAlarm;
    sum.confusion += p.confusion;
  }
  const errors = sum.missed + sum.falseAlarm + sum.confusion;
  return { ...sum, der: sum.total > 0 ? errors / sum.total : 0 };
}

/** RTTM `SPEAKER` lines as turns. */
export function parseRttm(text: string): Turn[] {
  const turns: Turn[] = [];
  for (const line of text.split(/\r?\n/)) {
    const f = line.trim().split(/\s+/);
    if (f[0] !== "SPEAKER" || f.length < 8) continue;
    const start = Number(f[3]);
    const duration = Number(f[4]);
    if (!Number.isFinite(start) || !Number.isFinite(duration) || duration <= 0) continue;
    turns.push({ start, end: start + duration, speaker: f[7] });
  }
  return turns;
}

/** UEM lines (`<file> <channel> <start> <end>`) as regions. */
export function parseUem(text: string): Region[] {
  const regions: Region[] = [];
  for (const line of text.split(/\r?\n/)) {
    const f = line.trim().split(/\s+/);
    if (f.length < 4) continue;
    const start = Number(f[2]);
    const end = Number(f[3]);
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) regions.push({ start, end });
  }
  return regions;
}
