/**
 * Main Application Logic — Расшифровщик (Multi-file Serverless via Deepgram)
 * Handles multiple file uploads, direct API communication, dynamic result cards,
 * speaker management, and DOCX/TXT/SRT export functionality.
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
    deepgramKey: HARDCODED_KEY,
    
    // Array of file objects
    // { id, file, status, progress, message, blocks, speakerNames, language, player }
    files: [], 
  };

  /* ══════════════════════════════════════════════
     DOM References
     ══════════════════════════════════════════════ */

  const $ = (sel) => document.querySelector(sel);

  const dom = {
    uploadView: $('#uploadView'),
    processingView: $('#processingView'),
    resultsView: $('#resultsView'),

    dropZone: $('#dropZone'),
    fileInput: $('#fileInput'),

    processingList: $('#processingList'),
    resultsList: $('#resultsList'),

    settingsBtn: $('#settingsBtn'),
    settingsOverlay: $('#settingsOverlay'),
    settingsForm: $('#settingsForm'),
    cancelSettings: $('#cancelSettings'),
    assemblyKeyInput: $('#assemblyKeyInput'),

    toastContainer: $('#toastContainer'),

    // Templates
    progressTemplate: $('#progressItemTemplate'),
    cardTemplate: $('#resultCardTemplate'),
  };

  /* ══════════════════════════════════════════════
     Initialisation
     ══════════════════════════════════════════════ */

  function init() {
    loadSettings();
    bindEvents();
    updateView();
  }

  function loadSettings() {
    const saved = localStorage.getItem('rash_deepgram_key');
    if (saved) state.deepgramKey = saved;
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
      if (e.target.files.length) handleFiles(e.target.files);
    });

    dom.dropZone.addEventListener('dragenter', (e) => { e.preventDefault(); dom.dropZone.classList.add('drag-over'); });
    dom.dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dom.dropZone.classList.add('drag-over'); });
    dom.dropZone.addEventListener('dragleave', () => { dom.dropZone.classList.remove('drag-over'); });
    dom.dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dom.dropZone.classList.remove('drag-over');
      if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
    });

    // ── Settings Modal ──
    dom.settingsBtn.addEventListener('click', () => {
      dom.assemblyKeyInput.value = state.deepgramKey;
      dom.settingsOverlay.classList.add('visible');
    });
    dom.cancelSettings.addEventListener('click', () => dom.settingsOverlay.classList.remove('visible'));
    dom.settingsOverlay.addEventListener('click', (e) => { if (e.target === dom.settingsOverlay) dom.settingsOverlay.classList.remove('visible'); });
    dom.settingsForm.addEventListener('submit', (e) => {
      e.preventDefault();
      saveSettings();
      dom.settingsOverlay.classList.remove('visible');
      toast('Настройки сохранены', 'success');
    });

    // ── Add More Button ──
    document.addEventListener('click', (e) => {
      if (e.target.closest('#newTranscriptionBtn')) {
        dom.fileInput.value = '';
        dom.fileInput.click();
      }
    });

    // ── Export Buttons ──
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('.btn-export');
      if (btn) {
        const fileId = btn.closest('.result-card').dataset.fileId;
        exportAs(fileId, btn.dataset.format);
      }
    });

    // ── Speaker Rename ──
    document.addEventListener('change', (e) => {
      if (e.target.classList.contains('speaker-name-input')) {
        const card = e.target.closest('.result-card');
        const fileId = card.dataset.fileId;
        const speakerId = e.target.dataset.speaker;
        renameSpeaker(fileId, speakerId, e.target.value.trim(), card);
      }
    });
    document.addEventListener('focusin', (e) => {
      if (e.target.classList.contains('speaker-name-input')) e.target.select();
    });
  }

  /* ══════════════════════════════════════════════
     File Handling & View Logic
     ══════════════════════════════════════════════ */

  function handleFiles(fileList) {
    const validFiles = Array.from(fileList).filter(f => 
      f.type.startsWith('audio/') || f.type.startsWith('video/') || f.name.match(/\.(mp3|wav|m4a|ogg|flac|aac|wma|webm|mp4)$/i)
    );

    if (validFiles.length === 0) {
      toast('Пожалуйста, загрузите аудио или видеофайлы', 'error');
      return;
    }

    // Add to state
    validFiles.forEach(file => {
      const fObj = {
        id: 'file_' + Math.random().toString(36).substring(2, 9),
        file: file,
        status: 'processing',
        progress: 0,
        message: 'Подготовка...',
        blocks: [],
        speakerNames: {},
        player: null
      };
      state.files.push(fObj);
      startTranscription(fObj);
    });

    updateView();
  }

  function updateView() {
    const hasFiles = state.files.length > 0;
    const isProcessing = state.files.some(f => f.status === 'processing');

    if (!hasFiles) {
      dom.uploadView.classList.remove('hidden');
      dom.processingView.classList.add('hidden');
      dom.resultsView.classList.add('hidden');
      return;
    }

    dom.uploadView.classList.add('hidden');
    
    // We show processing view if there are ANY processing files
    dom.processingView.classList.toggle('hidden', !isProcessing);
    
    // We show results view if there are ANY done files
    const hasDone = state.files.some(f => f.status === 'done');
    dom.resultsView.classList.toggle('hidden', !hasDone);

    renderProcessingList();
  }

  /* ══════════════════════════════════════════════
     Processing & Deepgram Logic
     ══════════════════════════════════════════════ */

  function renderProcessingList() {
    dom.processingList.innerHTML = '';
    const processingFiles = state.files.filter(f => f.status === 'processing');

    processingFiles.forEach(f => {
      const clone = dom.progressTemplate.content.cloneNode(true);
      const el = clone.querySelector('.progress-item');
      el.id = `progress_${f.id}`;
      el.querySelector('.progress-filename').textContent = f.file.name;
      el.querySelector('.progress-pct').textContent = Math.round(f.progress * 100) + '%';
      el.querySelector('.progress-bar-fill').style.width = Math.round(f.progress * 100) + '%';
      el.querySelector('.progress-message').textContent = f.message;
      dom.processingList.appendChild(clone);
    });
  }

  function updateFileProgress(fObj, progress, message) {
    fObj.progress = progress;
    fObj.message = message;
    
    const el = document.getElementById(`progress_${fObj.id}`);
    if (el) {
      el.querySelector('.progress-pct').textContent = Math.round(progress * 100) + '%';
      el.querySelector('.progress-bar-fill').style.width = Math.round(progress * 100) + '%';
      el.querySelector('.progress-message').textContent = message || '';
    }
  }

  function startTranscription(fObj) {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', DEEPGRAM_API_BASE, true);
    xhr.setRequestHeader('Authorization', `Token ${state.deepgramKey}`);
    xhr.setRequestHeader('Content-Type', fObj.file.type || 'audio/mpeg');

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const percent = e.loaded / e.total;
        updateFileProgress(fObj, percent * 0.8, `Загрузка файла: ${Math.round(percent * 100)}%...`);
      }
    };

    let fakeProgressInterval;

    xhr.upload.onload = () => {
      updateFileProgress(fObj, 0.85, 'Аудио загружено. Deepgram анализирует голоса...');
      let simProgress = 0.85;
      fakeProgressInterval = setInterval(() => {
        simProgress = Math.min(simProgress + 0.01, 0.99);
        updateFileProgress(fObj, simProgress, 'Расшифровка и диаризация... (подождите)');
      }, 1500);
    };

    xhr.onload = () => {
      clearInterval(fakeProgressInterval);
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText);
          processResult(fObj, data);
        } catch (e) {
          handleFileError(fObj, 'Ошибка обработки данных от сервера');
        }
      } else {
        handleFileError(fObj, `Ошибка API (${xhr.status}): ${xhr.responseText}`);
      }
    };

    xhr.onerror = () => {
      clearInterval(fakeProgressInterval);
      handleFileError(fObj, 'Сетевая ошибка при обращении к API.');
    };

    xhr.send(fObj.file);
  }

  function handleFileError(fObj, errMessage) {
    fObj.status = 'error';
    toast(`Ошибка файла ${fObj.file.name}: ${errMessage}`, 'error');
    
    // Remove from files array
    state.files = state.files.filter(f => f.id !== fObj.id);
    updateView();
  }

  function processResult(fObj, data) {
    fObj.status = 'done';
    
    const results = data.results;
    if (!results || !results.utterances) {
       const text = results?.channels?.[0]?.alternatives?.[0]?.transcript || 'Не удалось распознать текст';
       fObj.blocks = [{ speaker: 'SPEAKER_0', text: text, start: 0, end: 0 }];
    } else {
        fObj.blocks = results.utterances.map((u) => ({
            speaker: `SPEAKER_${u.speaker}`, 
            text: u.transcript,
            start: u.start,
            end: u.end,
        }));
    }

    // Set speakers
    const speakers = new Set(fObj.blocks.map(b => b.speaker));
    fObj.speakerNames = {};
    let index = 1;
    speakers.forEach(s => {
      fObj.speakerNames[s] = `Спикер ${index++}`;
    });

    updateView();
    renderResultCard(fObj);
    toast(`Файл ${fObj.file.name} успешно обработан!`, 'success');
  }

  /* ══════════════════════════════════════════════
     Result Cards & DOM Rendering
     ══════════════════════════════════════════════ */

  function renderResultCard(fObj) {
    const clone = dom.cardTemplate.content.cloneNode(true);
    const card = clone.querySelector('.result-card');
    card.dataset.fileId = fObj.id;
    
    card.querySelector('.file-name').textContent = fObj.file.name;

    // 1. Initialize Player
    const playerWrapper = card.querySelector('.player-wrapper');
    fObj.player = new window.AudioPlayer(playerWrapper);
    fObj.player.loadFile(fObj.file);
    fObj.player.onTimeUpdate((time) => syncTranscriptScroll(card, time));

    // 2. Render Speakers
    renderCardSpeakers(fObj, card);

    // 3. Render Transcript
    renderCardTranscript(fObj, card);

    dom.resultsList.prepend(clone); // Prepend to show newest at top
  }

  function renderCardSpeakers(fObj, card) {
    const container = card.querySelector('.speakers-list');
    container.innerHTML = '';
    const speakers = Object.keys(fObj.speakerNames);

    speakers.forEach((speakerId, i) => {
      const color = SPEAKER_COLORS[i % SPEAKER_COLORS.length];
      const count = fObj.blocks.filter((b) => b.speaker === speakerId).length;

      const item = document.createElement('div');
      item.className = 'speaker-item';
      item.innerHTML = `
        <span class="speaker-color-dot" style="background: ${color}"></span>
        <input type="text" class="speaker-name-input" value="${fObj.speakerNames[speakerId]}" data-speaker="${speakerId}" spellcheck="false" />
        <span class="speaker-count">${count}</span>
      `;
      container.appendChild(item);
    });
  }

  function renameSpeaker(fileId, speakerId, newName, card) {
    if (!newName) return;
    const fObj = state.files.find(f => f.id === fileId);
    if (!fObj) return;

    fObj.speakerNames[speakerId] = newName;

    // Update in DOM
    card.querySelectorAll(`.block-speaker-name[data-speaker="${speakerId}"]`).forEach((el) => {
      el.textContent = newName;
    });
  }

  function renderCardTranscript(fObj, card) {
    const container = card.querySelector('.transcript-section');
    container.innerHTML = '';
    const speakerKeys = Object.keys(fObj.speakerNames);

    fObj.blocks.forEach((block, i) => {
      const colorIndex = speakerKeys.indexOf(block.speaker);
      const color = SPEAKER_COLORS[colorIndex % SPEAKER_COLORS.length];
      const name = fObj.speakerNames[block.speaker] || block.speaker;

      const el = document.createElement('div');
      el.className = 'transcript-block fade-in';
      el.dataset.start = block.start;
      el.dataset.end = block.end;

      el.innerHTML = `
        <div class="block-speaker">
          <span class="block-speaker-name" data-speaker="${block.speaker}" style="color: ${color}">${escapeHtml(name)}</span>
          <span class="block-timestamp" data-time="${block.start}">${formatTimestamp(block.start)}</span>
        </div>
        <div class="block-text">${escapeHtml(block.text)}</div>
      `;

      el.querySelector('.block-timestamp').addEventListener('click', () => {
        fObj.player.seekTo(block.start);
        fObj.player.play();
      });

      container.appendChild(el);
    });
  }

  function syncTranscriptScroll(card, currentTime) {
    const blocks = card.querySelectorAll('.transcript-block');
    let activeEl = null;

    blocks.forEach((el) => {
      const start = parseFloat(el.dataset.start);
      const end = parseFloat(el.dataset.end);
      const isActive = currentTime >= start && currentTime < end;
      el.classList.toggle('active', isActive);
      if (isActive) activeEl = el;
    });

    if (activeEl) {
      const container = card.querySelector('.transcript-section');
      const elTop = activeEl.offsetTop - container.offsetTop;
      const elH = activeEl.offsetHeight;
      const scrollTop = container.scrollTop;
      const containerH = container.clientHeight;

      if (elTop < scrollTop || elTop + elH > scrollTop + containerH) {
        container.scrollTo({ top: elTop - containerH / 3, behavior: 'smooth' });
      }
    }
  }

  /* ══════════════════════════════════════════════
     Export logic
     ══════════════════════════════════════════════ */

  async function exportAs(fileId, format) {
    const fObj = state.files.find(f => f.id === fileId);
    if (!fObj || !fObj.blocks.length) return;

    const baseName = fObj.file.name.replace(/\.[^/.]+$/, "");

    if (format === 'txt') {
      const content = fObj.blocks.map(b => `[${formatTimestamp(b.start)}] ${fObj.speakerNames[b.speaker]}:\n${b.text}\n`).join('\n');
      downloadFile(content, `${baseName}.txt`, 'text/plain;charset=utf-8');
      toast('Экспортировано в TXT', 'success');
    } 
    else if (format === 'srt') {
      const content = fObj.blocks.map((b, i) => `${i + 1}\n${formatSrtTime(b.start)} --> ${formatSrtTime(b.end)}\n[${fObj.speakerNames[b.speaker]}] ${b.text}\n`).join('\n');
      downloadFile(content, `${baseName}.srt`, 'text/srt;charset=utf-8');
      toast('Экспортировано в SRT', 'success');
    }
    else if (format === 'docx') {
      await exportWordDocx(fObj, baseName);
    }
  }

  async function exportWordDocx(fObj, baseName) {
    if (typeof docx === 'undefined') {
      toast('Библиотека DOCX не загрузилась. Проверьте интернет.', 'error');
      return;
    }

    toast('Генерация Word документа...', 'info');

    const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } = docx;

    const docChildren = [
      new Paragraph({
        text: `Расшифровка: ${fObj.file.name}`,
        heading: HeadingLevel.HEADING_1,
        alignment: AlignmentType.CENTER,
      }),
      new Paragraph({ text: "" }), // spacer
    ];

    fObj.blocks.forEach(b => {
      const name = fObj.speakerNames[b.speaker];
      const time = formatTimestamp(b.start);
      
      docChildren.push(
        new Paragraph({
          children: [
            new TextRun({ text: `[${time}] ${name}: `, bold: true, color: "444444" }),
            new TextRun({ text: b.text })
          ],
          spacing: { after: 200 }
        })
      );
    });

    const doc = new Document({
      sections: [{
        properties: {},
        children: docChildren,
      }]
    });

    try {
      const blob = await Packer.toBlob(doc);
      saveAs(blob, `${baseName}.docx`);
      toast('Экспортировано в Word', 'success');
    } catch (e) {
      console.error(e);
      toast('Ошибка при генерации Word документа', 'error');
    }
  }

  function downloadFile(content, filename, mime) {
    const blob = new Blob([content], { type: mime });
    saveAs(blob, filename); // Uses FileSaver.js included in head
  }

  /* ══════════════════════════════════════════════
     Utilities
     ══════════════════════════════════════════════ */

  function formatTimestamp(seconds) {
    if (!seconds || isNaN(seconds)) return '0:00';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
