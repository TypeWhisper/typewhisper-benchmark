const metricLabels = {
  wer: "WER",
  cer: "CER",
  formatting: "Formatierung",
  numbers: "Zahlen",
  "proper-nouns": "Eigennamen",
  code: "Code",
};

const lowerIsBetter = new Set(["wer", "cer"]);

const elements = {
  caseCount: document.querySelector("#caseCount"),
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

  elements.emptyResults.hidden = true;
  elements.readyResults.hidden = false;
  elements.resultsStatus.textContent = `Snapshot ${snapshot.snapshotId.slice(0, 10)} · ausschließlich freigegebene Runs`;
  renderLeaderboard();
  renderLatency();
  renderMatrix();
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
});
elements.metricSelect.addEventListener("change", renderLeaderboard);

initialize();
