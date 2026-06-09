/**
 * Audio Player module — custom waveform player with transcript sync.
 * Designed to be instantiated multiple times per page.
 */

class AudioPlayer {
  constructor(container) {
    this.container = container;
    
    // Create DOM structure
    this._renderHTML();
    
    // Bind elements
    this.audioEl = this.container.querySelector('.audio-element');
    this.canvas = this.container.querySelector('.waveform-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.progressEl = this.container.querySelector('.waveform-progress');
    this.cursorEl = this.container.querySelector('.waveform-cursor');
    this.playBtn = this.container.querySelector('.btn-play');
    this.timeDisplay = this.container.querySelector('.player-time');
    this.waveformContainer = this.container.querySelector('.waveform-container');

    this.peaks = [];
    this.duration = 0;
    this.isPlaying = false;
    this.currentSpeed = 1;
    this.animFrameId = null;

    this._bindEvents();
  }

  _renderHTML() {
    this.container.innerHTML = `
      <div class="player-controls-wrapper">
          <div class="waveform-container">
              <canvas class="waveform-canvas"></canvas>
              <div class="waveform-progress"></div>
              <div class="waveform-cursor"></div>
          </div>

          <div class="player-controls">
              <button class="btn-play" title="Play / Pause">▶</button>
              <div class="player-time">0:00 / 0:00</div>
              
              <div class="player-speed">
                  <button class="speed-btn" data-speed="0.75">0.75x</button>
                  <button class="speed-btn active" data-speed="1">1x</button>
                  <button class="speed-btn" data-speed="1.25">1.25x</button>
                  <button class="speed-btn" data-speed="1.5">1.5x</button>
                  <button class="speed-btn" data-speed="2">2x</button>
              </div>
          </div>
          
          <audio class="audio-element hidden"></audio>
      </div>
    `;
  }

  /* ── Public API ── */

  async loadFile(file) {
    const url = URL.createObjectURL(file);
    this.audioEl.src = url;

    await new Promise((resolve) => {
      this.audioEl.addEventListener('loadedmetadata', resolve, { once: true });
    });

    this.duration = this.audioEl.duration;
    this._updateTime();
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
    if (this.isPlaying) this.pause();
    else this.play();
  }

  seekTo(seconds) {
    this.audioEl.currentTime = Math.max(0, Math.min(seconds, this.duration));
    this._updateProgress();
    this._updateTime();
  }

  setSpeed(speed) {
    this.currentSpeed = speed;
    this.audioEl.playbackRate = speed;
    
    this.container.querySelectorAll('.speed-btn').forEach((btn) => {
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
    this.playBtn.addEventListener('click', () => this.toggle());

    this.container.querySelectorAll('.speed-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.setSpeed(parseFloat(btn.dataset.speed));
      });
    });

    this.waveformContainer.addEventListener('click', (e) => {
      const rect = this.waveformContainer.getBoundingClientRect();
      const ratio = (e.clientX - rect.left) / rect.width;
      this.seekTo(ratio * this.duration);
    });

    this.audioEl.addEventListener('ended', () => {
      this.isPlaying = false;
      this.playBtn.innerHTML = '▶';
      this._stopAnimLoop();
    });
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
    this.progressEl.style.width = pct + '%';
    this.cursorEl.style.left = pct + '%';
  }

  _updateTime() {
    const cur = this._formatTime(this.audioEl.currentTime);
    const tot = this._formatTime(this.duration);
    this.timeDisplay.textContent = `${cur} / ${tot}`;
  }

  _formatTime(s) {
    if (!s || isNaN(s)) return '0:00';
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = Math.floor(s % 60);
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    return `${m}:${String(sec).padStart(2, '0')}`;
  }

  async _renderWaveform(file) {
    if (!this.canvas || !this.ctx) return;

    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const arrayBuf = await file.arrayBuffer();
      const audioBuf = await audioCtx.decodeAudioData(arrayBuf);

      const raw = audioBuf.getChannelData(0);
      const dpr = window.devicePixelRatio || 1;
      const displayWidth = this.canvas.parentElement.clientWidth;
      const displayHeight = this.canvas.parentElement.clientHeight || 60; // default height

      this.canvas.width = displayWidth * dpr;
      this.canvas.height = displayHeight * dpr;
      this.canvas.style.width = displayWidth + 'px';
      this.canvas.style.height = displayHeight + 'px';
      this.ctx.scale(dpr, dpr);

      const numBars = Math.floor(displayWidth / 3);
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

window.AudioPlayer = AudioPlayer;
