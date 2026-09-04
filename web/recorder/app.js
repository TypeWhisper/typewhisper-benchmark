const categoryLabels = {
  "everyday-dictation": "Alltag",
  formatting: "Formatierung",
  numbers: "Zahlen",
  "proper-nouns": "Eigennamen",
  code: "Code",
  "mixed-hard": "Gemischt",
};

const elements = {
  batchTitle: document.querySelector("#batchTitle"),
  categoryBadge: document.querySelector("#categoryBadge"),
  closeCompleteButton: document.querySelector("#closeCompleteButton"),
  completeDialog: document.querySelector("#completeDialog"),
  discardButton: document.querySelector("#discardButton"),
  localeBadge: document.querySelector("#localeBadge"),
  meterFill: document.querySelector("#meterFill"),
  nextButton: document.querySelector("#nextButton"),
  previousButton: document.querySelector("#previousButton"),
  progressBar: document.querySelector("#progressBar"),
  progressLabel: document.querySelector("#progressLabel"),
  progressSteps: document.querySelector("#progressSteps"),
  prompt: document.querySelector("#prompt"),
  promptCounter: document.querySelector("#promptCounter"),
  promptText: document.querySelector("#promptText"),
  recordButton: document.querySelector("#recordButton"),
  recordLabel: document.querySelector("#recordLabel"),
  reviewAudio: document.querySelector("#reviewAudio"),
  reviewPanel: document.querySelector("#reviewPanel"),
  saveButton: document.querySelector("#saveButton"),
  savedAudio: document.querySelector("#savedAudio"),
  savedFileName: document.querySelector("#savedFileName"),
  savedPanel: document.querySelector("#savedPanel"),
  systemStatus: document.querySelector("#systemStatus"),
  timer: document.querySelector("#timer"),
  transport: document.querySelector(".transport"),
};

const state = {
  analyser: null,
  audioContext: null,
  batch: null,
  chunks: [],
  currentIndex: 0,
  meterFrame: null,
  pendingBlob: null,
  pendingUrl: null,
  recorder: null,
  startedAt: 0,
  stream: null,
  timerFrame: null,
};

function currentItem() {
  return state.batch?.items[state.currentIndex];
}

function setStatus(message, isError = false) {
  elements.systemStatus.textContent = message;
  elements.systemStatus.classList.toggle("is-error", isError);
}

function formatTime(milliseconds) {
  const totalTenths = Math.floor(milliseconds / 100);
  const minutes = Math.floor(totalTenths / 600);
  const seconds = Math.floor((totalTenths % 600) / 10);
  const tenths = totalTenths % 10;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${tenths}`;
}

function updateTimer() {
  if (!state.recorder || state.recorder.state !== "recording") return;
  const elapsed = performance.now() - state.startedAt;
  elements.timer.textContent = formatTime(elapsed);
  if (elapsed >= 45_000) {
    stopRecording();
    return;
  }
  state.timerFrame = requestAnimationFrame(updateTimer);
}

function updateMeter() {
  if (!state.analyser || !state.recorder || state.recorder.state !== "recording") {
    elements.meterFill.style.width = "2%";
    return;
  }

  const samples = new Uint8Array(state.analyser.fftSize);
  state.analyser.getByteTimeDomainData(samples);
  let sum = 0;
  for (const sample of samples) {
    const normalized = (sample - 128) / 128;
    sum += normalized * normalized;
  }
  const rms = Math.sqrt(sum / samples.length);
  const level = Math.min(100, Math.max(2, rms * 360));
  elements.meterFill.style.width = `${level}%`;
  state.meterFrame = requestAnimationFrame(updateMeter);
}

function preferredMimeType() {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/ogg;codecs=opus",
    "audio/mp4",
    "audio/webm",
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

async function ensureMicrophone() {
  if (state.stream?.active) return state.stream;
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    throw new Error("Dieser Browser unterstützt keine Mikrofonaufnahme.");
  }

  state.stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      autoGainControl: false,
      channelCount: 1,
      echoCancellation: false,
      noiseSuppression: false,
    },
  });

  state.audioContext = new AudioContext();
  const source = state.audioContext.createMediaStreamSource(state.stream);
  state.analyser = state.audioContext.createAnalyser();
  state.analyser.fftSize = 1024;
  source.connect(state.analyser);
  return state.stream;
}

async function startRecording() {
  if (state.pendingBlob || !currentItem()) return;
  try {
    const stream = await ensureMicrophone();
    const mimeType = preferredMimeType();
    state.chunks = [];
    state.recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    state.recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) state.chunks.push(event.data);
    });
    state.recorder.addEventListener("stop", finishRecording, { once: true });
    state.recorder.start(250);
    state.startedAt = performance.now();
    elements.timer.textContent = "00:00.0";
    elements.transport.classList.add("is-recording");
    elements.recordButton.setAttribute("aria-pressed", "true");
    elements.recordLabel.textContent = "Aufnahme stoppen";
    setNavigationDisabled(true);
    setStatus("Aufnahme läuft …");
    updateTimer();
    updateMeter();
  } catch (error) {
    const denied = error?.name === "NotAllowedError";
    setStatus(
      denied
        ? "Mikrofonzugriff verweigert. Bitte im Browser erlauben und erneut versuchen."
        : error instanceof Error
          ? error.message
          : String(error),
      true
    );
  }
}

function stopRecording() {
  if (state.recorder?.state !== "recording") return;
  elements.recordButton.disabled = true;
  state.recorder.stop();
  cancelAnimationFrame(state.timerFrame);
  cancelAnimationFrame(state.meterFrame);
  elements.transport.classList.remove("is-recording");
  elements.recordButton.setAttribute("aria-pressed", "false");
  elements.recordLabel.textContent = "Aufnahme starten";
  elements.meterFill.style.width = "2%";
}

function finishRecording() {
  const mimeType = state.recorder?.mimeType || state.chunks[0]?.type || "audio/webm";
  state.pendingBlob = new Blob(state.chunks, { type: mimeType });
  state.pendingUrl = URL.createObjectURL(state.pendingBlob);
  elements.reviewAudio.src = state.pendingUrl;
  elements.reviewPanel.hidden = false;
  elements.savedPanel.hidden = true;
  elements.recordButton.disabled = true;
  setStatus("Take bereit. Bitte kurz prüfen und speichern oder verwerfen.");
}

function discardRecording() {
  if (state.pendingUrl) URL.revokeObjectURL(state.pendingUrl);
  state.pendingBlob = null;
  state.pendingUrl = null;
  elements.reviewAudio.removeAttribute("src");
  elements.reviewAudio.load();
  elements.reviewPanel.hidden = true;
  elements.recordButton.disabled = false;
  setNavigationDisabled(false);
  renderSavedTake();
  setStatus("Take verworfen. Bereit für eine neue Aufnahme.");
}

async function saveRecording() {
  const item = currentItem();
  if (!state.pendingBlob || !item) return;
  elements.saveButton.disabled = true;
  elements.discardButton.disabled = true;
  setStatus("Take wird lokal gespeichert …");

  try {
    const response = await fetch(
      `/api/batches/${encodeURIComponent(state.batch.id)}/recordings/${encodeURIComponent(item.promptId)}`,
      {
        method: "POST",
        headers: { "Content-Type": state.pendingBlob.type },
        body: state.pendingBlob,
      }
    );
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || `Speichern fehlgeschlagen (${response.status})`);
    }

    if (state.pendingUrl) URL.revokeObjectURL(state.pendingUrl);
    state.pendingBlob = null;
    state.pendingUrl = null;
    elements.reviewAudio.removeAttribute("src");
    elements.reviewPanel.hidden = true;
    await reloadBatch();
    const allComplete = state.batch.items.every((entry) => entry.takes.length > 0);
    if (allComplete) {
      render();
      elements.completeDialog.showModal();
      return;
    }

    const nextUnrecorded = state.batch.items.findIndex(
      (entry, index) => index > state.currentIndex && entry.takes.length === 0
    );
    if (nextUnrecorded >= 0) state.currentIndex = nextUnrecorded;
    else {
      const firstUnrecorded = state.batch.items.findIndex((entry) => entry.takes.length === 0);
      if (firstUnrecorded >= 0) state.currentIndex = firstUnrecorded;
    }
    render();
    setStatus("Gespeichert. Bereit für den nächsten Satz.");
    elements.prompt.focus({ preventScroll: true });
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), true);
  } finally {
    elements.saveButton.disabled = false;
    elements.discardButton.disabled = false;
  }
}

function setNavigationDisabled(disabled) {
  const lastIndex = (state.batch?.items.length ?? 1) - 1;
  elements.previousButton.disabled = disabled || state.currentIndex === 0;
  elements.nextButton.disabled = disabled || state.currentIndex === lastIndex;
  elements.progressSteps.querySelectorAll("button").forEach((button) => {
    button.disabled = disabled;
  });
}

function renderProgress() {
  const completed = state.batch.items.filter((item) => item.takes.length > 0).length;
  elements.progressLabel.textContent = `${completed} / ${state.batch.items.length}`;
  elements.progressBar.style.width = `${(completed / state.batch.items.length) * 100}%`;
  elements.progressSteps.replaceChildren();

  state.batch.items.forEach((item, index) => {
    const entry = document.createElement("li");
    const button = document.createElement("button");
    entry.className = "progress-step";
    entry.classList.toggle("is-complete", item.takes.length > 0);
    button.type = "button";
    button.textContent = item.takes.length > 0 ? "✓" : String(index + 1);
    button.setAttribute(
      "aria-label",
      `Satz ${index + 1}${item.takes.length > 0 ? ", aufgenommen" : ""}`
    );
    if (index === state.currentIndex) button.setAttribute("aria-current", "step");
    button.addEventListener("click", () => goTo(index));
    entry.append(button);
    elements.progressSteps.append(entry);
  });
}

function renderSavedTake() {
  const latest = currentItem()?.takes.at(-1);
  if (!latest || state.pendingBlob) {
    elements.savedPanel.hidden = true;
    elements.savedAudio.removeAttribute("src");
    return;
  }
  elements.savedPanel.hidden = false;
  elements.savedFileName.textContent = latest.fileName;
  elements.savedAudio.src = `${latest.url}?v=${encodeURIComponent(latest.createdAt)}`;
}

function render() {
  if (!state.batch) return;
  const item = currentItem();
  elements.batchTitle.textContent = state.batch.title;
  elements.localeBadge.textContent = state.batch.language.split("-")[0].toUpperCase();
  elements.promptCounter.textContent = `Satz ${state.currentIndex + 1} von ${state.batch.items.length}`;
  elements.categoryBadge.textContent = categoryLabels[item.category] ?? item.category;
  elements.promptText.textContent = item.spokenText;
  elements.timer.textContent = "00:00.0";
  elements.recordButton.disabled = Boolean(state.pendingBlob);
  elements.reviewPanel.hidden = !state.pendingBlob;
  renderProgress();
  renderSavedTake();
  setNavigationDisabled(Boolean(state.pendingBlob));
}

function goTo(index) {
  if (state.pendingBlob || state.recorder?.state === "recording") return;
  if (index < 0 || index >= state.batch.items.length) return;
  state.currentIndex = index;
  render();
  setStatus(
    currentItem().takes.length > 0
      ? "Für diesen Satz ist bereits ein Take gespeichert. Eine neue Aufnahme wird als weiterer Take abgelegt."
      : "Bereit. Beim ersten Start fragt der Browser nach Mikrofonzugriff."
  );
  elements.prompt.focus({ preventScroll: true });
}

async function reloadBatch() {
  const batchId = new URLSearchParams(location.search).get("batch") || "de-de-pilot-01";
  const response = await fetch(`/api/batches/${encodeURIComponent(batchId)}`, {
    cache: "no-store",
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `Batch konnte nicht geladen werden (${response.status})`);
  }
  state.batch = await response.json();
}

async function initialize() {
  try {
    await reloadBatch();
    const firstUnrecorded = state.batch.items.findIndex((item) => item.takes.length === 0);
    state.currentIndex = firstUnrecorded >= 0 ? firstUnrecorded : 0;
    render();
    elements.recordButton.disabled = false;
    setStatus("Bereit. Beim ersten Start fragt der Browser nach Mikrofonzugriff.");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), true);
    elements.promptText.textContent = "Der Aufnahme-Batch konnte nicht geladen werden.";
  }
}

elements.recordButton.addEventListener("click", () => {
  if (state.recorder?.state === "recording") stopRecording();
  else startRecording();
});
elements.discardButton.addEventListener("click", discardRecording);
elements.saveButton.addEventListener("click", saveRecording);
elements.previousButton.addEventListener("click", () => goTo(state.currentIndex - 1));
elements.nextButton.addEventListener("click", () => goTo(state.currentIndex + 1));
elements.closeCompleteButton.addEventListener("click", () => elements.completeDialog.close());

document.addEventListener("keydown", (event) => {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
  if (event.code === "Space" && !(event.target instanceof HTMLButtonElement)) {
    event.preventDefault();
    elements.recordButton.click();
  }
  if (event.key.toLowerCase() === "s" && state.pendingBlob) {
    event.preventDefault();
    saveRecording();
  }
  if (event.key === "ArrowLeft") goTo(state.currentIndex - 1);
  if (event.key === "ArrowRight") goTo(state.currentIndex + 1);
});

window.addEventListener("beforeunload", (event) => {
  if (state.pendingBlob || state.recorder?.state === "recording") event.preventDefault();
});

window.addEventListener("pagehide", () => {
  state.stream?.getTracks().forEach((track) => track.stop());
  state.audioContext?.close();
  if (state.pendingUrl) URL.revokeObjectURL(state.pendingUrl);
});

initialize();
