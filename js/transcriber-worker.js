import {
  pipeline,
  env,
} from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';

env.allowLocalModels = false;
env.allowRemoteModels = true;

const MODEL_ID = 'onnx-community/whisper-tiny';

let transcriberPromise = null;

self.addEventListener('message', async (event) => {
  const message = event.data || {};

  if (message.type !== 'transcribe') return;

  try {
    const audio = new Float32Array(message.audio);

    postStatus('Готовлю локальную модель...', 0.2);
    const transcriber = await getTranscriber();

    self.postMessage({
      type: 'running',
      message: 'Расшифровываю локально...',
    });

    const result = await transcriber(audio, {
      chunk_length_s: 30,
      stride_length_s: 5,
      return_timestamps: true,
      task: 'transcribe',
    });

    self.postMessage({
      type: 'complete',
      result,
    });
  } catch (error) {
    transcriberPromise = null;
    self.postMessage({
      type: 'error',
      error: readableError(error),
    });
  }
});

function getTranscriber() {
  if (!transcriberPromise) {
    transcriberPromise = loadTranscriber();
  }

  return transcriberPromise;
}

async function loadTranscriber() {
  const baseOptions = {
    progress_callback: handleModelProgress,
  };

  if (self.navigator?.gpu) {
    try {
      const webGpuTranscriber = await pipeline(
        'automatic-speech-recognition',
        MODEL_ID,
        {
          ...baseOptions,
          device: 'webgpu',
        },
      );

      self.postMessage({
        type: 'ready',
        message: 'Модель готова: WebGPU',
      });

      return webGpuTranscriber;
    } catch (error) {
      self.postMessage({
        type: 'status',
        progress: 0.5,
        message: 'WebGPU недоступен, переключаюсь на обычный режим...',
      });
    }
  }

  const wasmTranscriber = await pipeline(
    'automatic-speech-recognition',
    MODEL_ID,
    baseOptions,
  );

  self.postMessage({
    type: 'ready',
    message: 'Модель готова',
  });

  return wasmTranscriber;
}

function handleModelProgress(progress) {
  if (!progress) return;

  if (progress.status === 'progress' && Number.isFinite(progress.progress)) {
    const file = readableFileName(progress.file || progress.name || 'модель');
    self.postMessage({
      type: 'download',
      progress: progress.progress / 100,
      message: `Скачиваю ${file}: ${Math.round(progress.progress)}%`,
    });
    return;
  }

  if (progress.status === 'done') {
    const file = readableFileName(progress.file || progress.name || 'файл модели');
    self.postMessage({
      type: 'status',
      progress: 0.52,
      message: `${file} загружен`,
    });
    return;
  }

  if (progress.status === 'ready') {
    self.postMessage({
      type: 'status',
      progress: 0.54,
      message: 'Модель почти готова...',
    });
  }
}

function postStatus(message, progress) {
  self.postMessage({
    type: 'status',
    message,
    progress,
  });
}

function readableFileName(file) {
  return String(file).split('/').pop();
}

function readableError(error) {
  const message = error?.message || String(error);

  if (/fetch|network|Failed to fetch/i.test(message)) {
    return 'Не удалось скачать локальную модель. Проверьте интернет и попробуйте ещё раз.';
  }

  if (/memory|allocation|out of bounds/i.test(message)) {
    return 'Браузеру не хватило памяти для этого файла. Попробуйте файл короче или закройте лишние вкладки.';
  }

  return message;
}
