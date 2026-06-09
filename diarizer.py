"""
Diarizer module — speaker diarization using pyannote.audio.
Determines who speaks when in an audio file.
Gracefully handles the case when pyannote is not installed.
"""

import traceback

PYANNOTE_AVAILABLE = False
try:
    from pyannote.audio import Pipeline
    import torch
    PYANNOTE_AVAILABLE = True
except ImportError:
    pass


def is_available():
    """Check if pyannote.audio is installed and usable."""
    return PYANNOTE_AVAILABLE


def diarize_audio(filepath, hf_token=None, on_progress=None):
    """
    Perform speaker diarization using pyannote.audio.
    
    Args:
        filepath: Path to the audio file
        hf_token: HuggingFace authentication token
        on_progress: Callback function(progress: float, message: str)
    
    Returns:
        List of segments: [{'speaker': str, 'start': float, 'end': float}]
    
    Raises:
        RuntimeError: If pyannote.audio is not installed
    """
    if not PYANNOTE_AVAILABLE:
        raise RuntimeError(
            "pyannote.audio не установлен. "
            "Установите: pip install pyannote.audio torch torchaudio"
        )

    if on_progress:
        on_progress(0.1, "Загрузка модели диаризации...")

    # Load the pretrained speaker diarization pipeline
    pipeline = Pipeline.from_pretrained(
        "pyannote/speaker-diarization-3.1",
        use_auth_token=hf_token,
    )

    # Use Apple Silicon MPS if available, otherwise CPU
    if torch.backends.mps.is_available():
        device = torch.device("mps")
    elif torch.cuda.is_available():
        device = torch.device("cuda")
    else:
        device = torch.device("cpu")

    pipeline.to(device)

    if on_progress:
        on_progress(0.3, "Анализ спикеров... (это может занять несколько минут)")

    # Run the diarization pipeline
    diarization = pipeline(filepath)

    if on_progress:
        on_progress(0.9, "Обработка результатов диаризации...")

    # Extract speaker segments
    segments = []
    for turn, _, speaker in diarization.itertracks(yield_label=True):
        segments.append({
            "speaker": speaker,
            "start": turn.start,
            "end": turn.end,
        })

    if on_progress:
        on_progress(1.0, "Диаризация завершена")

    return segments
