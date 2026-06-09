/**
 * Audio Player module — custom waveform player with transcript sync.
 * Uses the Web Audio API to decode audio and render a waveform on canvas.
 */

class AudioPlayer {
  constructor() {
    this.audioEl = document.getElementById('audioPlayer');
    this.canvas = document.getElementById('waveformCanvas');
    this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
    this.progressEl = document.getElementById('waveformProgress');
    this.cursorEl = document.getElementById('waveformCursor');
    this.playBtn = document.getElementById('playBtn');
    this.timeDisplay = document.getElementById('timeDisplay');
    this.waveformContainer = document.getElementById('waveformContainer');

    this.peaks = [];
    this.duration = 0;
    this.isPlaying = false;
    this.currentSpeed = 1;
    this.animFrameId = null;

    this._bindEvents();
  }

  /* ── Public API ── */

  async loadFile(file) {
    // Create object URL for the audio element
    const url = URL.createObjectURL(file);
    this.audioEl.src = url;

    // Wait for metadata to load
    await new Promise((resolve) => {
      this.audioEl.addEventListener('loadedmetadata', resolve, { once: true });
    });

    this.duration = this.audioEl.duration;
    this._updateTime();

    // Decode audio for waveform
    await this._renderWaveform(file);
  }

  play() {
    this.audioEl.play();
    this.isPlaying = true;
    this.playBtn.innerHTML = '⏸';
    this._startAnimLoop();
  }

  pause() {
    this.audioEl.pause();
    this.isPlaying = false;
    this.playBtn.innerHTML = '▶';
    this._stopAnimLoop();
  }

  toggle() {
    if (this.isPlaying) {
      this.pause();
    } else {
      this.play();
    }
  }

  seekTo(seconds) {
    this.audioEl.currentTime = Math.max(0, Math.min(seconds, this.duration));
    this._updateProgress();
    this._updateTime();
  }

  setSpeed(speed) {
    this.currentSpeed = speed;
    this.audioEl.playbackRate = speed;

    // Update speed buttons
    document.querySelectorAll('.speed-btn').forEach((btn) => {
      btn.classList.toggle('active', parseFloat(btn.dataset.speed) === speed);
    });
  }

  getCurrentTime() {
    return this.audioEl.currentTime;
  }

  getDuration() {
    return this.duration;
  }

  onTimeUpdate(callback) {
    this._timeUpdateCallback = callback;
  }

  /* ── Private ── */

  _bindEvents() {
    if (this.playBtn) {
      this.playBtn.addEventListener('click', () => this.toggle());
    }

    // Speed buttons
    document.querySelectorAll('.speed-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.setSpeed(parseFloat(btn.dataset.speed));
      });
    });

    // Click on waveform to seek
    if (this.waveformContainer) {
      this.waveformContainer.addEventListener('click', (e) => {
        const rect = this.waveformContainer.getBoundingClientRect();
        const ratio = (e.clientX - rect.left) / rect.width;
        this.seekTo(ratio * this.duration);
      });
    }

    // Audio ended
    if (this.audioEl) {
      this.audioEl.addEventListener('ended', () => {
        this.isPlaying = false;
        this.playBtn.innerHTML = '▶';
        this._stopAnimLoop();
      });
    }
  }

  _startAnimLoop() {
    const loop = () => {
      this._updateProgress();
      this._updateTime();

      if (this._timeUpdateCallback) {
        this._timeUpdateCallback(this.audioEl.currentTime);
      }

      this.animFrameId = requestAnimationFrame(loop);
    };
    loop();
  }

  _stopAnimLoop() {
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
  }

  _updateProgress() {
    if (!this.duration) return;
    const pct = (this.audioEl.currentTime / this.duration) * 100;
    if (this.progressEl) this.progressEl.style.width = pct + '%';
    if (this.cursorEl) this.cursorEl.style.left = pct + '%';
  }

  _updateTime() {
    if (!this.timeDisplay) return;
    const cur = this._formatTime(this.audioEl.currentTime);
    const tot = this._formatTime(this.duration);
    this.timeDisplay.textContent = `${cur} / ${tot}`;
  }

  _formatTime(s) {
    if (!s || isNaN(s)) return '0:00';
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = Math.floor(s % 60);
    if (h > 0) {
      return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    }
    return `${m}:${String(sec).padStart(2, '0')}`;
  }

  async _renderWaveform(file) {
    if (!this.canvas || !this.ctx) return;

    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const arrayBuf = await file.arrayBuffer();
      const audioBuf = await audioCtx.decodeAudioData(arrayBuf);

      // Get channel data (mono mix)
      const raw = audioBuf.getChannelData(0);

      // Compute the number of bars for the canvas width
      const dpr = window.devicePixelRatio || 1;
      const displayWidth = this.canvas.parentElement.clientWidth;
      const displayHeight = this.canvas.parentElement.clientHeight;

      this.canvas.width = displayWidth * dpr;
      this.canvas.height = displayHeight * dpr;
      this.canvas.style.width = displayWidth + 'px';
      this.canvas.style.height = displayHeight + 'px';
      this.ctx.scale(dpr, dpr);

      const numBars = Math.floor(displayWidth / 3); // ~3px per bar
      const samplesPerBar = Math.floor(raw.length / numBars);
      this.peaks = [];

      for (let i = 0; i < numBars; i++) {
        let sum = 0;
        const start = i * samplesPerBar;
        for (let j = start; j < start + samplesPerBar && j < raw.length; j++) {
          sum += Math.abs(raw[j]);
        }
        this.peaks.push(sum / samplesPerBar);
      }

      // Normalize peaks
      const maxPeak = Math.max(...this.peaks, 0.01);
      this.peaks = this.peaks.map((p) => p / maxPeak);

      this._drawWaveform(displayWidth, displayHeight);

      audioCtx.close();
    } catch (err) {
      console.warn('Could not render waveform:', err);
    }
  }

  _drawWaveform(width, height) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, width, height);

    const barWidth = 2;
    const gap = 1;
    const step = barWidth + gap;
    const centerY = height / 2;
    const maxBarH = height * 0.8;

    for (let i = 0; i < this.peaks.length; i++) {
      const x = i * step;
      const barH = Math.max(2, this.peaks[i] * maxBarH);

      // Gradient color: idle bars
      const gradient = ctx.createLinearGradient(x, centerY - barH / 2, x, centerY + barH / 2);
      gradient.addColorStop(0, 'rgba(124, 92, 252, 0.6)');
      gradient.addColorStop(0.5, 'rgba(96, 165, 250, 0.4)');
      gradient.addColorStop(1, 'rgba(124, 92, 252, 0.6)');

      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.roundRect(x, centerY - barH / 2, barWidth, barH, 1);
      ctx.fill();
    }
  }
}

// Export to global scope
window.AudioPlayer = AudioPlayer;
