const metricLabels = {
  wer: "WER",
  cer: "CER",
  formatting: "Formatierung",
  numbers: "Zahlen",
  "proper-nouns": "Eigennamen",
  code: "Code",
};

const lowerIsBetter = new Set(["wer", "cer"]);

const categoryLabels = {
  "everyday-dictation": "Alltag",
  formatting: "Formatierung",
  numbers: "Zahlen",
  "proper-nouns": "Eigennamen",
  code: "Code",
  "mixed-hard": "Gemischt",
};

const elements = {
  caseCount: document.querySelector("#caseCount"),
  caseList: document.querySelector("#caseList"),
  caseTagSelect: document.querySelector("#caseTagSelect"),
  corpusValue: document.querySelector("#corpusValue"),
  directionNote: document.querySelector("#directionNote"),
  emptyResults: document.querySelector("#emptyResults"),
  generatedValue: document.querySelector("#generatedValue"),
  languageCount: document.querySelector("#languageCount"),
  languageSelect: document.querySelector("#languageSelect"),
  latencyList: document.querySelector("#latencyList"),
  leaderboardBody: document.querySelector("#leaderboardBody"),
  leaderboardTitle: document.querySelector("#leaderboardTitle"),
  matrixBody: document.querySelector("#matrixBody"),
  matrixHead: document.querySelector("#matrixHead"),
  metricSelect: document.querySelector("#metricSelect"),
  plannedLanguages: document.querySelector("#plannedLanguages"),
  plannedMetrics: document.querySelector("#plannedMetrics"),
  profileValue: document.querySelector("#profileValue"),
  readyResults: document.querySelector("#readyResults"),
  resultsStatus: document.querySelector("#resultsStatus"),
  runCount: document.querySelector("#runCount"),
  snapshotMeta: document.querySelector("#snapshotMeta"),
  snapshotStatus: document.querySelector("#snapshotStatus"),
  targetCount: document.querySelector("#targetCount"),
};

let snapshot = null;

function addChip(container, text, tone) {
  const chip = document.createElement("span");
  chip.className = `data-chip${tone ? ` ${tone}` : ""}`;
  chip.textContent = text;
  container.append(chip);
}

function formatMetric(metricId, value) {
  if (metricId === "wer" || metricId === "cer") return `${(value * 100).toFixed(1)} %`;
  return `${(value * 100).toFixed(1)} %`;
}

function formatLatency(value) {
  if (value < 1000) return `${Math.round(value)} ms`;
  return `${(value / 1000).toFixed(2)} s`;
}

function targetById(id) {
  return snapshot.targets.find((target) => target.id === id);
}

function selectedAggregates(metricId, language) {
  return snapshot.aggregates.filter(
    (aggregate) => aggregate.metricId === metricId && aggregate.language === language
  );
}

function renderLeaderboard() {
  const metricId = elements.metricSelect.value;
  const language = elements.languageSelect.value;
  const direction = lowerIsBetter.has(metricId) ? 1 : -1;
  const rows = selectedAggregates(metricId, language).sort(
    (left, right) => (left.value - right.value) * direction
  );

  elements.leaderboardTitle.textContent = `${metricLabels[metricId] ?? metricId} · ${language}`;
  elements.directionNote.textContent = lowerIsBetter.has(metricId)
    ? "Niedriger ist besser"
    : "Höher ist besser";
  elements.leaderboardBody.replaceChildren();

  if (rows.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 4;
    cell.className = "table-empty";
    cell.textContent = "Für diese Auswahl liegen keine freigegebenen Werte vor.";
    row.append(cell);
    elements.leaderboardBody.append(row);
    return;
  }

  rows.forEach((aggregate, index) => {
    const target = targetById(aggregate.targetId);
    const row = document.createElement("tr");
    const rank = document.createElement("td");
    const model = document.createElement("td");
    const value = document.createElement("td");
    const coverage = document.createElement("td");
    const rankNumber = document.createElement("span");
    rankNumber.className = "rank-number";
    rankNumber.textContent = String(index + 1);
    rank.append(rankNumber);
    const name = document.createElement("strong");
    const detail = document.createElement("span");
    name.textContent = target?.displayName ?? aggregate.targetId;
    detail.textContent = target ? `${target.provider} · ${target.revision}` : aggregate.targetId;
    model.className = "model-cell";
    model.append(name, detail);
    value.className = "metric-value";
    value.textContent = formatMetric(metricId, aggregate.value);
    coverage.textContent = `${aggregate.eligibleCases}/${aggregate.totalCases}`;
    row.append(rank, model, value, coverage);
    elements.leaderboardBody.append(row);
  });
}

function renderLatency() {
  const language = elements.languageSelect.value;
  const entries = snapshot.latency
    .filter((entry) => entry.language === language)
    .sort((left, right) => left.medianMs - right.medianMs);
  elements.latencyList.replaceChildren();

  if (entries.length === 0) {
    const empty = document.createElement("p");
    empty.className = "table-empty";
    empty.textContent = "Für diese Sprache wurde noch keine Latenz veröffentlicht.";
    elements.latencyList.append(empty);
    return;
  }

  const maximum = Math.max(...entries.map((entry) => entry.medianMs));
  entries.forEach((entry) => {
    const target = targetById(entry.targetId);
    const row = document.createElement("div");
    const label = document.createElement("div");
    const track = document.createElement("div");
    const fill = document.createElement("span");
    const value = document.createElement("strong");
    row.className = "latency-row";
    label.className = "latency-label";
    label.textContent = target?.displayName ?? entry.targetId;
    track.className = "latency-track";
    fill.style.width = `${Math.max(4, (entry.medianMs / maximum) * 100)}%`;
    track.append(fill);
    value.textContent = formatLatency(entry.medianMs);
    row.append(label, track, value);
    elements.latencyList.append(row);
  });
}

function renderMatrix() {
  const language = elements.languageSelect.value;
  const metrics = [...new Set(snapshot.aggregates.map((aggregate) => aggregate.metricId))];
  const headerRow = document.createElement("tr");
  const modelHeader = document.createElement("th");
  modelHeader.textContent = "Modell";
  headerRow.append(modelHeader);
  metrics.forEach((metric) => {
    const cell = document.createElement("th");
    cell.textContent = metricLabels[metric] ?? metric;
    headerRow.append(cell);
  });
  elements.matrixHead.replaceChildren(headerRow);
  elements.matrixBody.replaceChildren();

  const perMetricRange = new Map(
    metrics.map((metric) => {
      const values = selectedAggregates(metric, language).map((entry) => entry.value);
      return [
        metric,
        values.length > 0
          ? { minimum: Math.min(...values), maximum: Math.max(...values) }
          : null,
      ];
    })
  );

  snapshot.targets.forEach((target) => {
    const row = document.createElement("tr");
    const model = document.createElement("th");
    model.scope = "row";
    model.textContent = target.displayName;
    row.append(model);

    metrics.forEach((metric) => {
      const cell = document.createElement("td");
      const aggregate = snapshot.aggregates.find(
        (entry) =>
          entry.targetId === target.id &&
          entry.language === language &&
          entry.metricId === metric
      );
      if (!aggregate) {
        cell.textContent = "—";
        cell.className = "matrix-missing";
      } else {
        const range = perMetricRange.get(metric);
        const span = range.maximum - range.minimum;
        let quality = span === 0 ? 0.7 : (aggregate.value - range.minimum) / span;
        if (lowerIsBetter.has(metric)) quality = 1 - quality;
        cell.textContent = formatMetric(metric, aggregate.value);
        cell.style.setProperty("--quality", String(0.1 + quality * 0.56));
      }
      row.append(cell);
    });
    elements.matrixBody.append(row);
  });
}

function categoryForCase(testCase) {
  return testCase.tags.find((tag) => categoryLabels[tag]) ?? testCase.tags[0] ?? "test";
}

function diffTokens(value) {
  return value.match(/\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu) ?? [];
}

function comparableToken(value) {
  return value.normalize("NFKC").toLocaleLowerCase("und");
}

function alignTranscript(reference, transcript) {
  const referenceTokens = diffTokens(reference).filter((token) => !/^\s+$/u.test(token));
  const transcriptTokens = diffTokens(transcript).filter((token) => !/^\s+$/u.test(token));
  const rows = Array.from({ length: referenceTokens.length + 1 }, () =>
    Array(transcriptTokens.length + 1).fill(0)
  );

  for (let left = referenceTokens.length - 1; left >= 0; left -= 1) {
    for (let right = transcriptTokens.length - 1; right >= 0; right -= 1) {
      rows[left][right] =
        comparableToken(referenceTokens[left]) === comparableToken(transcriptTokens[right])
          ? rows[left + 1][right + 1] + 1
          : Math.max(rows[left + 1][right], rows[left][right + 1]);
    }
  }

  const matchedTranscript = new Set();
  const matchedReference = new Set();
  let left = 0;
  let right = 0;
  while (left < referenceTokens.length && right < transcriptTokens.length) {
    if (comparableToken(referenceTokens[left]) === comparableToken(transcriptTokens[right])) {
      matchedReference.add(left);
      matchedTranscript.add(right);
      left += 1;
      right += 1;
    } else if (rows[left + 1][right] >= rows[left][right + 1]) {
      left += 1;
    } else {
      right += 1;
    }
  }

  return {
    transcriptTokens,
    matchedTranscript,
    missing: referenceTokens.filter((_, index) => !matchedReference.has(index)),
  };
}

function renderTranscriptDiff(reference, transcript) {
  const wrapper = document.createElement("div");
  const transcriptLine = document.createElement("p");
  const { matchedTranscript, missing } = alignTranscript(reference, transcript);
  const transcriptChunks = diffTokens(transcript);
  transcriptLine.className = "transcript-copy";
  let tokenIndex = 0;
  transcriptChunks.forEach((token) => {
    if (/^\s+$/u.test(token)) {
      transcriptLine.append(document.createTextNode(token));
      return;
    }
    const span = document.createElement("span");
    span.className = matchedTranscript.has(tokenIndex) ? "diff-exact" : "diff-changed";
    span.textContent = token;
    transcriptLine.append(span);
    tokenIndex += 1;
  });
  wrapper.append(transcriptLine);

  if (missing.length > 0) {
    const missingLine = document.createElement("p");
    const label = document.createElement("span");
    const deleted = document.createElement("del");
    missingLine.className = "missing-copy";
    label.textContent = "Fehlt im Ergebnis";
    deleted.textContent = missing.join(" ");
    missingLine.append(label, deleted);
    wrapper.append(missingLine);
  }
  return wrapper;
}

function metricById(result, metricId) {
  return result.metrics.find((metric) => metric.metricId === metricId);
}

function renderCaseResult(testCase, result, bestWer) {
  const target = targetById(result.targetId);
  const card = document.createElement("article");
  const heading = document.createElement("header");
  const title = document.createElement("div");
  const name = document.createElement("h4");
  const runtime = document.createElement("span");
  const wer = metricById(result, "wer");
  card.className = "case-result";
  name.textContent = target?.displayName ?? result.targetId;
  runtime.textContent =
    result.durationMs === undefined
      ? `Durchlauf ${result.trial}`
      : `${formatLatency(result.durationMs)} · Durchlauf ${result.trial}`;
  title.append(name, runtime);
  heading.append(title);
  if (wer && wer.value === bestWer) {
    const best = document.createElement("span");
    best.className = "best-result";
    best.textContent = "Niedrigste WER";
    heading.append(best);
  }
  card.append(heading, renderTranscriptDiff(testCase.reference.verbatim, result.transcript));

  const metrics = document.createElement("dl");
  metrics.className = "case-metrics";
  result.metrics.forEach((metric) => {
    const group = document.createElement("div");
    const label = document.createElement("dt");
    const value = document.createElement("dd");
    label.textContent = metricLabels[metric.metricId] ?? metric.metricId;
    value.textContent = formatMetric(metric.metricId, metric.value);
    group.append(label, value);
    metrics.append(group);
  });
  card.append(metrics);
  return card;
}

function renderCases() {
  const language = elements.languageSelect.value;
  const selectedTag = elements.caseTagSelect.value;
  const cases = (snapshot.cases ?? []).filter(
    (testCase) =>
      testCase.language === language &&
      (selectedTag === "all" || testCase.tags.includes(selectedTag))
  );
  elements.caseList.replaceChildren();

  if (cases.length === 0) {
    const empty = document.createElement("p");
    empty.className = "table-empty";
    empty.textContent =
      snapshot.cases?.length > 0
        ? "Für diesen Filter gibt es keine Einzeltests."
        : "Dieser Snapshot enthält noch keine freigegebenen Einzeltest-Details.";
    elements.caseList.append(empty);
    return;
  }

  cases.forEach((testCase, index) => {
    const details = document.createElement("details");
    const summary = document.createElement("summary");
    const number = document.createElement("span");
    const copy = document.createElement("span");
    const label = document.createElement("span");
    const reference = document.createElement("strong");
    const werValues = testCase.results
      .map((result) => metricById(result, "wer")?.value)
      .filter((value) => value !== undefined);
    const range = document.createElement("span");
    details.className = "case-item";
    details.open = index === 0;
    number.className = "case-number";
    number.textContent = String(index + 1).padStart(2, "0");
    copy.className = "case-summary-copy";
    label.className = "case-category";
    label.textContent = `${categoryLabels[categoryForCase(testCase)] ?? categoryForCase(testCase)} · ${testCase.id}`;
    reference.textContent = testCase.reference.verbatim;
    copy.append(label, reference);
    range.className = "case-range";
    if (werValues.length > 0) {
      const minimum = Math.min(...werValues);
      const maximum = Math.max(...werValues);
      range.textContent =
        minimum === maximum
          ? `${formatMetric("wer", minimum)} WER`
          : `${formatMetric("wer", minimum)}–${formatMetric("wer", maximum)} WER`;
    } else {
      range.textContent = "Keine WER";
    }
    summary.append(number, copy, range);

    const body = document.createElement("div");
    const references = document.createElement("div");
    const raw = document.createElement("div");
    const rawLabel = document.createElement("span");
    const rawText = document.createElement("p");
    body.className = "case-body";
    references.className = "case-references";
    rawLabel.textContent = "Gesprochen · Rohtext";
    rawText.textContent = testCase.reference.verbatim;
    raw.append(rawLabel, rawText);
    references.append(raw);
    if (
      testCase.reference.formatted &&
      testCase.reference.formatted !== testCase.reference.verbatim
    ) {
      const formatted = document.createElement("div");
      const formattedLabel = document.createElement("span");
      const formattedText = document.createElement("p");
      formattedLabel.textContent = "Erwartetes Zielformat";
      formattedText.textContent = testCase.reference.formatted;
      formatted.append(formattedLabel, formattedText);
      references.append(formatted);
    }
    body.append(references);

    const resultGrid = document.createElement("div");
    const bestWer = werValues.length > 0 ? Math.min(...werValues) : undefined;
    resultGrid.className = "case-results-grid";
    testCase.results.forEach((result) =>
      resultGrid.append(renderCaseResult(testCase, result, bestWer))
    );
    body.append(resultGrid);
    details.append(summary, body);
    elements.caseList.append(details);
  });
}

function renderReady() {
  elements.snapshotStatus.textContent = "Veröffentlicht";
  elements.snapshotStatus.classList.add("is-ready");
  elements.snapshotMeta.hidden = false;
  elements.profileValue.textContent = snapshot.profileId;
  elements.corpusValue.textContent = snapshot.corpusVersion;
  elements.generatedValue.textContent = new Intl.DateTimeFormat("de-DE", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(snapshot.generatedAt));
  elements.targetCount.textContent = snapshot.targets.length;
  elements.languageCount.textContent = snapshot.languages.length;
  elements.caseCount.textContent = snapshot.caseCount;
  elements.runCount.textContent = snapshot.runIds.length;

  elements.languageSelect.replaceChildren();
  snapshot.languages.forEach((language) => {
    const option = document.createElement("option");
    option.value = language;
    option.textContent = language;
    elements.languageSelect.append(option);
  });

  elements.metricSelect.replaceChildren();
  const metrics = [...new Set(snapshot.aggregates.map((aggregate) => aggregate.metricId))];
  metrics.forEach((metric) => {
    const option = document.createElement("option");
    option.value = metric;
    option.textContent = metricLabels[metric] ?? metric;
    elements.metricSelect.append(option);
  });

  elements.caseTagSelect.replaceChildren();
  const allOption = document.createElement("option");
  allOption.value = "all";
  allOption.textContent = "Alle Tests";
  elements.caseTagSelect.append(allOption);
  const categoryTags = [
    ...new Set((snapshot.cases ?? []).map((testCase) => categoryForCase(testCase))),
  ];
  categoryTags.forEach((tag) => {
    const option = document.createElement("option");
    option.value = tag;
    option.textContent = categoryLabels[tag] ?? tag;
    elements.caseTagSelect.append(option);
  });

  elements.emptyResults.hidden = true;
  elements.readyResults.hidden = false;
  elements.resultsStatus.textContent = `Snapshot ${snapshot.snapshotId.slice(0, 10)} · ausschließlich freigegebene Runs`;
  renderLeaderboard();
  renderLatency();
  renderMatrix();
  renderCases();
}

function renderEmpty(planned) {
  elements.snapshotStatus.textContent = "Noch leer";
  elements.emptyResults.hidden = false;
  elements.readyResults.hidden = true;
  elements.plannedLanguages.replaceChildren();
  planned.languages.forEach((language) =>
    addChip(elements.plannedLanguages, language.id, language.tier)
  );
  elements.plannedMetrics.replaceChildren();
  planned.metrics.forEach((metric) =>
    addChip(elements.plannedMetrics, metricLabels[metric] ?? metric)
  );
  elements.resultsStatus.textContent = "Keine alten Ergebnisse übernommen.";
}

async function initialize() {
  try {
    const response = await fetch("/api/results/latest", { cache: "no-store" });
    if (!response.ok) throw new Error(`Snapshot konnte nicht geladen werden (${response.status})`);
    const payload = await response.json();
    if (payload.status === "empty") renderEmpty(payload.planned);
    else {
      snapshot = payload.snapshot;
      renderReady();
    }
  } catch (error) {
    elements.snapshotStatus.textContent = "Fehler";
    elements.resultsStatus.textContent = error instanceof Error ? error.message : String(error);
    elements.resultsStatus.classList.add("is-error");
  }
}

elements.languageSelect.addEventListener("change", () => {
  renderLeaderboard();
  renderLatency();
  renderMatrix();
  renderCases();
});
elements.metricSelect.addEventListener("change", renderLeaderboard);
elements.caseTagSelect.addEventListener("change", renderCases);

initialize();
