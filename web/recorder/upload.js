const elements = {
  clearFileButton: document.querySelector("#clearFileButton"),
  dropZone: document.querySelector("#dropZone"),
  fileInput: document.querySelector("#fileInput"),
  fileName: document.querySelector("#fileName"),
  fileSize: document.querySelector("#fileSize"),
  fileSummary: document.querySelector("#fileSummary"),
  resultCountValue: document.querySelector("#resultCountValue"),
  runIdValue: document.querySelector("#runIdValue"),
  systemValue: document.querySelector("#systemValue"),
  uploadButton: document.querySelector("#uploadButton"),
  uploadStatus: document.querySelector("#uploadStatus"),
  uploadsBody: document.querySelector("#uploadsBody"),
};

let selectedFile = null;
let selectedBundle = null;

function setStatus(message, isError = false) {
  elements.uploadStatus.textContent = message;
  elements.uploadStatus.classList.toggle("is-error", isError);
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function environmentLabel(environment) {
  const parts = [environment?.os, environment?.architecture, environment?.accelerator]
    .filter(Boolean);
  return parts.join(" · ") || "Nicht angegeben";
}

function clearSelection() {
  selectedFile = null;
  selectedBundle = null;
  elements.fileInput.value = "";
  elements.fileSummary.hidden = true;
  elements.uploadButton.disabled = true;
  elements.clearFileButton.disabled = true;
  setStatus("Noch keine Datei ausgewählt.");
}

async function selectFile(file) {
  if (!file) return;
  if (file.size > 50 * 1024 * 1024) {
    clearSelection();
    setStatus("Die Datei überschreitet das Limit von 50 MB.", true);
    return;
  }

  try {
    const bundle = JSON.parse(await file.text());
    if (
      bundle?.schemaVersion !== 1 ||
      typeof bundle?.manifest?.runId !== "string" ||
      !Array.isArray(bundle?.results)
    ) {
      throw new Error("Die Datei ist kein Run-Bundle der Schema-Version 1.");
    }
    selectedFile = file;
    selectedBundle = bundle;
    elements.fileName.textContent = file.name;
    elements.fileSize.textContent = formatBytes(file.size);
    elements.runIdValue.textContent = bundle.manifest.runId;
    elements.systemValue.textContent = environmentLabel(bundle.manifest.environment);
    elements.resultCountValue.textContent = String(bundle.results.length);
    elements.fileSummary.hidden = false;
    elements.uploadButton.disabled = false;
    elements.clearFileButton.disabled = false;
    setStatus("Plausibilitätsprüfung bestanden. Der Server validiert beim Upload vollständig.");
  } catch (error) {
    clearSelection();
    setStatus(error instanceof Error ? error.message : String(error), true);
  }
}

function renderUploads(uploads) {
  elements.uploadsBody.replaceChildren();
  if (uploads.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 5;
    cell.className = "table-empty";
    cell.textContent = "Noch keine externen Runs in der Prüfwarteschlange.";
    row.append(cell);
    elements.uploadsBody.append(row);
    return;
  }

  uploads.forEach((upload) => {
    const row = document.createElement("tr");
    const received = document.createElement("td");
    const run = document.createElement("td");
    const environment = document.createElement("td");
    const results = document.createElement("td");
    const digest = document.createElement("td");
    received.textContent = new Intl.DateTimeFormat("de-DE", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date(upload.receivedAt));
    run.textContent = upload.runId;
    environment.textContent = environmentLabel(upload.environment);
    results.textContent = String(upload.resultCount);
    digest.className = "digest-cell";
    digest.textContent = upload.digest.slice(0, 12);
    digest.title = upload.digest;
    row.append(received, run, environment, results, digest);
    elements.uploadsBody.append(row);
  });
}

async function loadUploads() {
  try {
    const response = await fetch("/api/uploads/runs", { cache: "no-store" });
    if (!response.ok) throw new Error(`Eingänge konnten nicht geladen werden (${response.status})`);
    const payload = await response.json();
    renderUploads(payload.uploads);
  } catch (error) {
    renderUploads([]);
    setStatus(error instanceof Error ? error.message : String(error), true);
  }
}

async function uploadSelected() {
  if (!selectedFile || !selectedBundle) return;
  elements.uploadButton.disabled = true;
  elements.clearFileButton.disabled = true;
  setStatus("Bundle wird validiert und unveränderlich gespeichert …");
  try {
    const response = await fetch("/api/uploads/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: selectedFile,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Upload fehlgeschlagen (${response.status})`);
    const duplicateNote = payload.duplicate ? " Das identische Bundle war bereits vorhanden." : "";
    clearSelection();
    setStatus(`Run ${payload.runId} liegt jetzt in der Prüfwarteschlange.${duplicateNote}`);
    await loadUploads();
  } catch (error) {
    elements.uploadButton.disabled = false;
    elements.clearFileButton.disabled = false;
    setStatus(error instanceof Error ? error.message : String(error), true);
  }
}

elements.dropZone.addEventListener("click", () => elements.fileInput.click());
elements.fileInput.addEventListener("change", () => selectFile(elements.fileInput.files?.[0]));
elements.clearFileButton.addEventListener("click", clearSelection);
elements.uploadButton.addEventListener("click", uploadSelected);

for (const eventName of ["dragenter", "dragover"]) {
  elements.dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.dropZone.classList.add("is-dragging");
  });
}
for (const eventName of ["dragleave", "drop"]) {
  elements.dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.dropZone.classList.remove("is-dragging");
  });
}
elements.dropZone.addEventListener("drop", (event) => {
  selectFile(event.dataTransfer?.files?.[0]);
});

loadUploads();
