/**
 * Main Application Logic - Расшифровщик
 * Runs transcription locally in the browser with a Transformers.js worker.
 */

(function () {
  'use strict';

  /* ══════════════════════════════════════════════
     Constants & State
     ══════════════════════════════════════════════ */

  const TARGET_SAMPLE_RATE = 16000;
  const WORKER_PATH = 'js/transcriber-worker.js';

  const SPEAKER_COLORS = [
    '#a78bfa', '#60a5fa', '#34d399', '#fbbf24', '#f87171',
    '#f472b6', '#22d3ee', '#a3e635', '#fb923c', '#c084fc',
  ];

  const state = {
    currentFile: null,
    blocks: [],           // [{speaker, text, start, end}]
    speakerNames: {},     // SPEAKER_0 -> 'Спикер 1'
    hasDiarization: false,
    language: '',
    player: null,
    worker: null,
    workerJob: null,
    currentProgress: 0,
  };

  /* ══════════════════════════════════════════════
     DOM References
     ══════════════════════════════════════════════ */

  const $ = (sel) => document.querySelector(sel);

  const dom = {
    // Views
    uploadView: $('#uploadView'),
    processingView: $('#processingView'),
    resultsView: $('#resultsView'),

    // Upload
    dropZone: $('#dropZone'),
    fileInput: $('#fileInput'),

    // Processing
    progressFill: $('#progressFill'),
    progressPct: $('#progressPct'),
    progressMsg: $('#progressMsg'),
    processingFilename: $('#processingFilename'),

    // Results
    speakersList: $('#speakersList'),
    transcript: $('#transcript'),

    // Toast
    toastContainer: $('#toastContainer'),
  };

  /* ══════════════════════════════════════════════
     Initialisation
     ══════════════════════════════════════════════ */

  function init() {
    bindEvents();
    showView('upload');

    state.player = new window.AudioPlayer();
    state.player.onTimeUpdate(onPlayerTimeUpdate);
  }

  /* ══════════════════════════════════════════════
     Event Binding
     ══════════════════════════════════════════════ */

  function bindEvents() {
    // Drag & drop
    dom.dropZone.addEventListener('click', () => dom.fileInput.click());
    dom.fileInput.addEventListener('change', (e) => {
      if (e.target.files.length) handleFile(e.target.files[0]);
    });

    dom.dropZone.addEventListener('dragenter', (e) => {
      e.preventDefault();
      dom.dropZone.classList.add('drag-over');
    });
    dom.dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dom.dropZone.classList.add('drag-over');
    });
    dom.dropZone.addEventListener('dragleave', () => {
      dom.dropZone.classList.remove('drag-over');
    });
    dom.dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dom.dropZone.classList.remove('drag-over');
      if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
    });

    // New transcription button
    document.addEventListener('click', (e) => {
      if (e.target.closest('#newTranscriptionBtn')) {
        resetState();
        showView('upload');
      }
    });

    // Export buttons
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('.btn-export');
      if (btn) exportAs(btn.dataset.format);
    });
  }

  /* ══════════════════════════════════════════════
     File Handling
     ══════════════════════════════════════════════ */

  function handleFile(file) {
    if (!isSupportedMedia(file)) {
      toast('Пожалуйста, загрузите аудио или MP4-файл', 'error');
      return;
    }

    if (state.workerJob) {
      toast('Дождитесь завершения текущей расшифровки', 'info');
      return;
    }

    resetState({ keepFileInput: true });
    state.currentFile = file;
    startTranscription(file);
  }

  function isSupportedMedia(file) {
    return (
      file.type.startsWith('audio/') ||
      file.type === 'video/mp4' ||
      /\.(mp3|wav|m4a|ogg|flac|aac|wma|webm|mp4)$/i.test(file.name)
    );
  }

  /* ══════════════════════════════════════════════
     Local Transcription Flow
     ══════════════════════════════════════════════ */

  async function startTranscription(file) {
    showView('processing');
    dom.processingFilename.textContent = file.name;
    updateProgress(0.03, 'Готовлю аудио...');

    const playerLoadPromise = state.player.loadFile(file).catch((err) => {
      console.warn('Could not load audio player:', err);
    });

    let softProgressTimer = null;

    try {
      updateProgress(0.08, 'Декодирую файл в браузере...');
      const decoded = await decodeAudioFile(file);

      updateProgress(0.18, 'Загружаю локальную модель...');
      softProgressTimer = startSoftProgress('Расшифровываю локально...');

      const result = await transcribeLocally(decoded.samples);

      stopSoftProgress(softProgressTimer);
      updateProgress(0.96, 'Собираю результат...');

      await playerLoadPromise;
      applyResult(normalizeTranscription(result, decoded.duration));

      updateProgress(1, 'Готово!');
      showView('results');
      renderSpeakers();
      renderTranscript();

      toast('Транскрипция готова!', 'success');
    } catch (err) {
      stopSoftProgress(softProgressTimer);
      toast(err.message || 'Не удалось расшифровать файл', 'error');
      showView('upload');
    }
  }

  async function decodeAudioFile(file) {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();

    try {
      const arrayBuffer = await file.arrayBuffer();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      const mono = mixToMono(audioBuffer);
      const samples = resampleAudio(mono, audioBuffer.sampleRate, TARGET_SAMPLE_RATE);

      return {
        samples,
        duration: audioBuffer.duration,
      };
    } finally {
      if (typeof audioContext.close === 'function') {
        audioContext.close();
      }
    }
  }

  function mixToMono(audioBuffer) {
    const { numberOfChannels, length } = audioBuffer;

    if (numberOfChannels === 1) {
      return new Float32Array(audioBuffer.getChannelData(0));
    }

    const mixed = new Float32Array(length);
    for (let channel = 0; channel < numberOfChannels; channel++) {
      const data = audioBuffer.getChannelData(channel);
      for (let i = 0; i < length; i++) {
        mixed[i] += data[i] / numberOfChannels;
      }
    }

    return mixed;
  }

  function resampleAudio(input, sourceRate, targetRate) {
    if (sourceRate === targetRate) {
      return input;
    }

    const ratio = sourceRate / targetRate;
    const outputLength = Math.max(1, Math.round(input.length / ratio));
    const output = new Float32Array(outputLength);

    for (let i = 0; i < outputLength; i++) {
      const sourceIndex = i * ratio;
      const before = Math.floor(sourceIndex);
      const after = Math.min(before + 1, input.length - 1);
      const weight = sourceIndex - before;
      output[i] = input[before] * (1 - weight) + input[after] * weight;
    }

    return output;
  }

  function transcribeLocally(samples) {
    return new Promise((resolve, reject) => {
      if (state.workerJob) {
        reject(new Error('Другая расшифровка уже выполняется'));
        return;
      }

      const worker = getTranscriberWorker();
      state.workerJob = { resolve, reject };
      worker.postMessage({ type: 'transcribe', audio: samples.buffer }, [samples.buffer]);
    });
  }

  function getTranscriberWorker() {
    if (state.worker) {
      return state.worker;
    }

    state.worker = new Worker(WORKER_PATH, { type: 'module' });
    state.worker.addEventListener('message', handleWorkerMessage);
    state.worker.addEventListener('error', handleWorkerError);

    return state.worker;
  }

  function handleWorkerMessage(event) {
    const message = event.data || {};

    if (message.type === 'download') {
      const downloadProgress = clamp(message.progress || 0, 0, 1);
      updateProgress(0.18 + downloadProgress * 0.34, message.message);
      return;
    }

    if (message.type === 'status') {
      updateProgress(message.progress ?? state.currentProgress, message.message);
      return;
    }

    if (message.type === 'ready') {
      updateProgress(0.56, message.message || 'Модель готова...');
      return;
    }

    if (message.type === 'running') {
      updateProgress(0.62, message.message || 'Расшифровываю локально...');
      return;
    }

    if (message.type === 'complete') {
      const job = state.workerJob;
      state.workerJob = null;
      if (job) job.resolve(message.result);
      return;
    }

    if (message.type === 'error') {
      const job = state.workerJob;
      state.workerJob = null;
      if (job) job.reject(new Error(message.error || 'Ошибка локальной модели'));
    }
  }

  function handleWorkerError(error) {
    const job = state.workerJob;
    state.workerJob = null;

    if (job) {
      job.reject(new Error(error.message || 'Worker локальной модели не запустился'));
    }

    if (state.worker) {
      state.worker.terminate();
      state.worker = null;
    }
  }

  function normalizeTranscription(result, duration) {
    const rawChunks = Array.isArray(result?.chunks) ? result.chunks : [];
    const blocks = [];
    let lastEnd = 0;

    rawChunks.forEach((chunk) => {
      const text = (chunk.text || '').trim();
      if (!text) return;

      const [rawStart, rawEnd] = Array.isArray(chunk.timestamp) ? chunk.timestamp : [];
      let start = Number(rawStart);
      let end = Number(rawEnd);

      if (!Number.isFinite(start) || start < 0) start = lastEnd;
      if (!Number.isFinite(end) || end <= start) end = Math.min(duration || start + 2, start + 2);

      blocks.push({
        speaker: 'SPEAKER_0',
        text,
        start,
        end,
      });

      lastEnd = end;
    });

    if (!blocks.length && result?.text?.trim()) {
      blocks.push({
        speaker: 'SPEAKER_0',
        text: result.text.trim(),
        start: 0,
        end: duration || 0,
      });
    }

    return {
      blocks,
      has_diarization: false,
      language: result?.language || 'auto',
    };
  }

  function applyResult(data) {
    state.blocks = data.blocks || [];
    state.hasDiarization = Boolean(data.has_diarization);
    state.language = data.language || '';

    if (!state.blocks.length) {
      throw new Error('Модель не нашла речи в этом файле');
    }

    const speakers = new Set(state.blocks.map((b) => b.speaker));
    state.speakerNames = {};
    speakers.forEach((speakerId) => {
      const idx = parseInt(speakerId.replace('SPEAKER_', ''), 10);
      state.speakerNames[speakerId] = `Спикер ${idx + 1}`;
    });
  }

  /* ══════════════════════════════════════════════
     Progress UI
     ══════════════════════════════════════════════ */

  function updateProgress(progress, message) {
    const value = clamp(Number(progress), 0, 1);
    const pct = Math.round(value * 100);

    state.currentProgress = value;
    dom.progressFill.style.width = pct + '%';
    dom.progressPct.textContent = pct + '%';

    if (message) {
      dom.progressMsg.textContent = message;
    }
  }

  function startSoftProgress(message) {
    return window.setInterval(() => {
      if (state.currentProgress >= 0.9) return;
      const next = state.currentProgress + Math.max(0.002, (0.9 - state.currentProgress) * 0.025);
      updateProgress(Math.min(next, 0.9), message);
    }, 1200);
  }

  function stopSoftProgress(timer) {
    if (timer) {
      window.clearInterval(timer);
    }
  }

  /* ══════════════════════════════════════════════
     View Management
     ══════════════════════════════════════════════ */

  function showView(name) {
    dom.uploadView.classList.toggle('hidden', name !== 'upload');
    dom.processingView.classList.toggle('hidden', name !== 'processing');
    dom.resultsView.classList.toggle('hidden', name !== 'results');
  }

  /* ══════════════════════════════════════════════
     Speakers Panel
     ══════════════════════════════════════════════ */

  function renderSpeakers() {
    const speakers = Object.keys(state.speakerNames);
    const container = dom.speakersList;
    container.innerHTML = '';

    if (!state.hasDiarization) {
      container.innerHTML = `
        <div class="diarization-note">
          Бесплатный локальный режим: разделение по спикерам отключено.
          Можно переименовать общий поток речи вручную.
        </div>
      `;
    }

    speakers.forEach((speakerId) => {
      const idx = parseInt(speakerId.replace('SPEAKER_', ''), 10);
      const color = SPEAKER_COLORS[idx % SPEAKER_COLORS.length];
      const count = state.blocks.filter((b) => b.speaker === speakerId).length;

      const item = document.createElement('div');
      item.className = 'speaker-item';
      item.innerHTML = `
        <span class="speaker-color-dot" style="background: ${color}"></span>
        <input
          type="text"
          class="speaker-name-input"
          value="${state.speakerNames[speakerId]}"
          data-speaker="${speakerId}"
          spellcheck="false"
        />
        <span class="speaker-count">${count}</span>
      `;

      const input = item.querySelector('.speaker-name-input');
      input.addEventListener('change', (e) => {
        renameSpeaker(speakerId, e.target.value.trim());
      });
      input.addEventListener('focus', (e) => e.target.select());

      container.appendChild(item);
    });
  }

  function renameSpeaker(speakerId, newName) {
    if (!newName) return;
    state.speakerNames[speakerId] = newName;

    document.querySelectorAll(`.block-speaker-name[data-speaker="${speakerId}"]`).forEach((el) => {
      el.textContent = newName;
    });
  }

  /* ══════════════════════════════════════════════
     Transcript Rendering
     ══════════════════════════════════════════════ */

  function renderTranscript() {
    const container = dom.transcript;
    container.innerHTML = '';

    state.blocks.forEach((block, i) => {
      const idx = parseInt(block.speaker.replace('SPEAKER_', ''), 10);
      const color = SPEAKER_COLORS[idx % SPEAKER_COLORS.length];
      const name = state.speakerNames[block.speaker] || block.speaker;

      const el = document.createElement('div');
      el.className = 'transcript-block fade-in';
      el.dataset.index = i;
      el.dataset.start = block.start;
      el.dataset.end = block.end;
      el.style.animationDelay = `${Math.min(i * 30, 500)}ms`;

      el.innerHTML = `
        <div class="block-speaker">
          <span class="block-speaker-name" data-speaker="${block.speaker}" style="color: ${color}">
            ${escapeHtml(name)}
          </span>
          <span class="block-timestamp" data-time="${block.start}">
            ${formatTimestamp(block.start)}
          </span>
        </div>
        <div class="block-text">${escapeHtml(block.text)}</div>
      `;

      el.querySelector('.block-timestamp').addEventListener('click', () => {
        state.player.seekTo(block.start);
        state.player.play();
      });

      container.appendChild(el);
    });
  }

  /* ══════════════════════════════════════════════
     Audio ↔ Transcript Sync
     ══════════════════════════════════════════════ */

  function onPlayerTimeUpdate(currentTime) {
    const blocks = dom.transcript.querySelectorAll('.transcript-block');
    let activeEl = null;

    blocks.forEach((el) => {
      const start = parseFloat(el.dataset.start);
      const end = parseFloat(el.dataset.end);
      const isActive = currentTime >= start && currentTime < end;

      el.classList.toggle('active', isActive);
      if (isActive) activeEl = el;
    });

    if (activeEl) {
      const container = dom.transcript;
      const elTop = activeEl.offsetTop - container.offsetTop;
      const elH = activeEl.offsetHeight;
      const scrollTop = container.scrollTop;
      const containerH = container.clientHeight;

      if (elTop < scrollTop || elTop + elH > scrollTop + containerH) {
        container.scrollTo({
          top: elTop - containerH / 3,
          behavior: 'smooth',
        });
      }
    }
  }

  /* ══════════════════════════════════════════════
     Export
     ══════════════════════════════════════════════ */

  function exportAs(format) {
    if (!state.blocks.length) return;

    let content = '';
    let filename = '';
    let mimeType = '';

    switch (format) {
      case 'txt':
        content = exportTXT();
        filename = 'transcript.txt';
        mimeType = 'text/plain;charset=utf-8';
        break;
      case 'srt':
        content = exportSRT();
        filename = 'transcript.srt';
        mimeType = 'text/srt;charset=utf-8';
        break;
      default:
        return;
    }

    downloadFile(content, filename, mimeType);
    toast(`Экспортировано в ${format.toUpperCase()}`, 'success');
  }

  function exportTXT() {
    return state.blocks
      .map((block) => {
        const name = state.speakerNames[block.speaker] || block.speaker;
        const time = formatTimestamp(block.start);
        return `[${time}] ${name}:\n${block.text}\n`;
      })
      .join('\n');
  }

  function exportSRT() {
    return state.blocks
      .map((block, i) => {
        const name = state.speakerNames[block.speaker] || block.speaker;
        const startSrt = formatSrtTime(block.start);
        const endSrt = formatSrtTime(block.end);
        return `${i + 1}\n${startSrt} --> ${endSrt}\n[${name}] ${block.text}\n`;
      })
      .join('\n');
  }

  function downloadFile(content, filename, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /* ══════════════════════════════════════════════
     Utilities
     ══════════════════════════════════════════════ */

  function formatTimestamp(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) {
      return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function formatSrtTime(seconds) {
    const value = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
    const h = Math.floor(value / 3600);
    const m = Math.floor((value % 3600) / 60);
    const s = Math.floor(value % 60);
    const ms = Math.round((value % 1) * 1000);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function clamp(value, min, max) {
    if (!Number.isFinite(value)) return min;
    return Math.min(max, Math.max(min, value));
  }

  function resetState(options = {}) {
    if (state.player?.pause) {
      state.player.pause();
    }

    state.currentFile = null;
    state.blocks = [];
    state.speakerNames = {};
    state.hasDiarization = false;
    state.language = '';
    state.currentProgress = 0;
    dom.transcript.innerHTML = '';
    dom.speakersList.innerHTML = '';

    if (!options.keepFileInput) {
      dom.fileInput.value = '';
    }
  }

  /* ══════════════════════════════════════════════
     Toast Notifications
     ══════════════════════════════════════════════ */

  function toast(message, type = 'info') {
    const el = document.createElement('div');
    el.className = `toast ${type}`;

    const icons = { success: '✓', error: '✕', info: 'ℹ' };
    el.innerHTML = `<span>${icons[type] || 'ℹ'}</span> ${escapeHtml(message)}`;

    dom.toastContainer.appendChild(el);

    requestAnimationFrame(() => el.classList.add('visible'));

    setTimeout(() => {
      el.classList.remove('visible');
      setTimeout(() => el.remove(), 300);
    }, 4000);
  }

  /* ══════════════════════════════════════════════
     Boot
     ══════════════════════════════════════════════ */

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
