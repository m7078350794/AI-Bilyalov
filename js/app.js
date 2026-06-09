/**
 * Main Application Logic — Расшифровщик (Serverless via Deepgram)
 * Handles file upload, direct API communication, transcript rendering,
 * speaker management, and export functionality without a backend.
 */

(function () {
  'use strict';

  /* ══════════════════════════════════════════════
     Constants & State
     ══════════════════════════════════════════════ */

  const SPEAKER_COLORS = [
    '#a78bfa', '#60a5fa', '#34d399', '#fbbf24', '#f87171',
    '#f472b6', '#22d3ee', '#a3e635', '#fb923c', '#c084fc',
  ];

  const DEEPGRAM_API_BASE = 'https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&diarize=true&detect_language=true';
  const HARDCODED_KEY = '8494995b5bbe658937f0b88928870ab6e5a4b460';

  const state = {
    // API key
    deepgramKey: HARDCODED_KEY,

    // Current file
    currentFile: null,

    // Result
    blocks: [],           // [{speaker, text, start, end}]
    speakerNames: {},     // SPEAKER_0 -> 'Спикер 1'
    language: '',

    // Audio player
    player: null,
  };

  /* ══════════════════════════════════════════════
     DOM References
     ══════════════════════════════════════════════ */

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

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

    // Settings
    settingsBtn: $('#settingsBtn'),
    settingsOverlay: $('#settingsOverlay'),
    settingsForm: $('#settingsForm'),
    cancelSettings: $('#cancelSettings'),
    assemblyKeyInput: $('#assemblyKeyInput'), // We reuse the ID but change the label

    // Toast
    toastContainer: $('#toastContainer'),
  };

  /* ══════════════════════════════════════════════
     Initialisation
     ══════════════════════════════════════════════ */

  function init() {
    loadSettings();
    bindEvents();
    showView('upload');

    // Instantiate audio player
    state.player = new window.AudioPlayer();
    state.player.onTimeUpdate(onPlayerTimeUpdate);
  }

  function loadSettings() {
    const saved = localStorage.getItem('rash_deepgram_key');
    if (saved) {
        state.deepgramKey = saved;
    }
  }

  function saveSettings() {
    state.deepgramKey = dom.assemblyKeyInput.value.trim() || HARDCODED_KEY;
    localStorage.setItem('rash_deepgram_key', state.deepgramKey);
  }

  /* ══════════════════════════════════════════════
     Event Binding
     ══════════════════════════════════════════════ */

  function bindEvents() {
    // ── Drag & Drop ──
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

    // ── Settings Modal ──
    dom.settingsBtn.addEventListener('click', openSettings);
    dom.cancelSettings.addEventListener('click', closeSettings);
    dom.settingsOverlay.addEventListener('click', (e) => {
      if (e.target === dom.settingsOverlay) closeSettings();
    });
    dom.settingsForm.addEventListener('submit', (e) => {
      e.preventDefault();
      saveSettings();
      closeSettings();
      toast('Настройки сохранены', 'success');
    });

    // ── New transcription button ──
    document.addEventListener('click', (e) => {
      if (e.target.closest('#newTranscriptionBtn')) {
        resetState();
        showView('upload');
      }
    });

    // ── Export buttons ──
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('.btn-export');
      if (btn) exportAs(btn.dataset.format);
    });
  }

  /* ══════════════════════════════════════════════
     Settings Modal
     ══════════════════════════════════════════════ */

  function openSettings() {
    dom.assemblyKeyInput.value = state.deepgramKey;
    dom.settingsOverlay.classList.add('visible');
  }

  function closeSettings() {
    dom.settingsOverlay.classList.remove('visible');
  }

  /* ══════════════════════════════════════════════
     File Handling
     ══════════════════════════════════════════════ */

  function handleFile(file) {
    // Validate
    if (!file.type.startsWith('audio/') && !file.type.startsWith('video/') && !file.name.match(/\.(mp3|wav|m4a|ogg|flac|aac|wma|webm|mp4)$/i)) {
      toast('Пожалуйста, загрузите аудио или видеофайл', 'error');
      return;
    }

    state.currentFile = file;

    // Load audio into player
    state.player.loadFile(file);

    // Start upload & transcription
    startTranscription(file);
  }

  /* ══════════════════════════════════════════════
     Transcription Flow (Deepgram Direct Integration)
     ══════════════════════════════════════════════ */

  async function startTranscription(file) {
    showView('processing');
    dom.processingFilename.textContent = file.name;
    updateProgress(0.2, 'Отправка аудио в Deepgram...');

    try {
      // Create a simulated progress for the synchronous fetch request
      let simProgress = 0.2;
      const interval = setInterval(() => {
        simProgress = Math.min(simProgress + 0.05, 0.95);
        updateProgress(simProgress, 'Анализ аудио и разделение по спикерам... (Deepgram работает быстро!)');
      }, 1000);

      const response = await fetch(DEEPGRAM_API_BASE, {
        method: 'POST',
        headers: {
          'Authorization': `Token ${state.deepgramKey}`,
          'Content-Type': file.type || 'audio/mpeg'
        },
        body: file,
      });

      clearInterval(interval);

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Ошибка API (${response.status}): ${errText}`);
      }

      const data = await response.json();
      processResult(data);

    } catch (err) {
      toast(err.message, 'error');
      showView('upload');
    }
  }

  function processResult(data) {
    updateProgress(1.0, 'Готово!');
    
    const results = data.results;
    if (!results || !results.utterances) {
       // Fallback if utterances are missing for some reason
       const text = results?.channels?.[0]?.alternatives?.[0]?.transcript || 'Не удалось распознать текст';
       state.blocks = [{
         speaker: 'SPEAKER_0',
         text: text,
         start: 0,
         end: state.player.getDuration() || 0,
       }];
    } else {
        // Map Deepgram utterances to our blocks format
        state.blocks = results.utterances.map((u) => ({
            speaker: `SPEAKER_${u.speaker}`, 
            text: u.transcript,
            start: u.start,
            end: u.end,
        }));
    }

    // Initialize speaker names
    const speakers = new Set(state.blocks.map((b) => b.speaker));
    state.speakerNames = {};
    
    let index = 1;
    speakers.forEach((s) => {
      state.speakerNames[s] = `Спикер ${index++}`;
    });

    showView('results');
    renderSpeakers();
    renderTranscript();

    toast('Транскрипция успешно завершена!', 'success');
  }

  /* ══════════════════════════════════════════════
     Progress UI
     ══════════════════════════════════════════════ */

  function updateProgress(progress, message) {
    const pct = Math.round(progress * 100);
    dom.progressFill.style.width = pct + '%';
    dom.progressPct.textContent = pct + '%';
    dom.progressMsg.textContent = message || '';
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

    speakers.forEach((speakerId, i) => {
      const color = SPEAKER_COLORS[i % SPEAKER_COLORS.length];
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

    // Update all speaker labels in the transcript
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

    // Get ordered keys to assign colors consistently
    const speakerKeys = Object.keys(state.speakerNames);

    state.blocks.forEach((block, i) => {
      const colorIndex = speakerKeys.indexOf(block.speaker);
      const color = SPEAKER_COLORS[colorIndex % SPEAKER_COLORS.length];
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

      // Click timestamp to seek
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

    // Auto-scroll to active block
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
    if (!seconds || isNaN(seconds)) return '0:00';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) {
      return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function formatSrtTime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.round((seconds % 1) * 1000);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function resetState() {
    state.currentFile = null;
    state.blocks = [];
    state.speakerNames = {};
    dom.transcript.innerHTML = '';
    dom.speakersList.innerHTML = '';
    dom.fileInput.value = '';
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

    // Trigger animation
    requestAnimationFrame(() => el.classList.add('visible'));

    // Auto-dismiss
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
