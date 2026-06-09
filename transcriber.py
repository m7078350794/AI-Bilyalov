"""
Transcriber module — handles audio transcription using OpenAI Whisper API.
Supports large files by splitting into chunks under the 25MB API limit.
"""

import os
import math
import tempfile
from pydub import AudioSegment
from openai import OpenAI

MAX_FILE_SIZE = 24 * 1024 * 1024  # 24MB to stay safely under the 25MB API limit


def transcribe_audio(filepath, api_key, on_progress=None):
    """
    Transcribe audio using OpenAI Whisper API.
    Handles large files by splitting into chunks.
    
    Args:
        filepath: Path to the audio file
        api_key: OpenAI API key
        on_progress: Callback function(progress: float, message: str)
    
    Returns:
        dict with 'segments', 'words', and 'language'
    """
    if api_key.startswith("gsk_"):
        # Auto-detect Groq API key
        client = OpenAI(api_key=api_key, base_url="https://api.groq.com/openai/v1")
        model = "whisper-large-v3-turbo" # Or whisper-large-v3
    else:
        # Default to OpenAI
        client = OpenAI(api_key=api_key)
        model = "whisper-1"

    file_size = os.path.getsize(filepath)

    if file_size <= MAX_FILE_SIZE:
        if on_progress:
        if on_progress:
            on_progress(0.1, f"Отправка аудио в {model}...")

        result = _transcribe_chunk(client, filepath, model, offset=0)

        if on_progress:
            on_progress(1.0, "Транскрипция завершена")

        return result
    else:
        return _transcribe_large_file(client, filepath, model, on_progress)


def _transcribe_chunk(client, filepath, model="whisper-1", offset=0):
    """Transcribe a single audio chunk via the API."""
    with open(filepath, "rb") as f:
        response = client.audio.transcriptions.create(
            model=model,
            file=f,
            response_format="verbose_json",
            timestamp_granularities=["segment", "word"],
        )

    segments = []
    if hasattr(response, "segments") and response.segments:
        for seg in response.segments:
            start = seg.start if hasattr(seg, "start") else seg.get("start", 0)
            end = seg.end if hasattr(seg, "end") else seg.get("end", 0)
            text = seg.text if hasattr(seg, "text") else seg.get("text", "")
            segments.append({
                "text": text.strip(),
                "start": start + offset,
                "end": end + offset,
            })

    words = []
    if hasattr(response, "words") and response.words:
        for w in response.words:
            word = w.word if hasattr(w, "word") else w.get("word", "")
            start = w.start if hasattr(w, "start") else w.get("start", 0)
            end = w.end if hasattr(w, "end") else w.get("end", 0)
            words.append({
                "word": word.strip(),
                "start": start + offset,
                "end": end + offset,
            })

    language = getattr(response, "language", "unknown")

    return {"segments": segments, "words": words, "language": language}


def _transcribe_large_file(client, filepath, model="whisper-1", on_progress=None):
    """Split large audio file into chunks and transcribe each sequentially."""
    audio = AudioSegment.from_file(filepath)

    duration_ms = len(audio)
    file_size = os.path.getsize(filepath)
    bytes_per_ms = file_size / duration_ms if duration_ms > 0 else 1

    # Calculate chunk duration aiming for ~20MB chunks
    chunk_duration_ms = int(20 * 1024 * 1024 / bytes_per_ms)
    chunk_duration_ms = max(chunk_duration_ms, 30_000)  # Minimum 30 seconds

    num_chunks = math.ceil(duration_ms / chunk_duration_ms)

    all_segments = []
    all_words = []
    language = "unknown"

    for i in range(num_chunks):
        start_ms = i * chunk_duration_ms
        end_ms = min((i + 1) * chunk_duration_ms, duration_ms)

        chunk = audio[start_ms:end_ms]

        with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as tmp:
            chunk.export(tmp.name, format="mp3")
            tmp_path = tmp.name

        try:
            if on_progress:
                progress = (i + 0.5) / num_chunks
                on_progress(progress, f"Транскрипция фрагмента {i + 1}/{num_chunks}...")

            offset = start_ms / 1000.0
            result = _transcribe_chunk(client, tmp_path, model, offset=offset)

            all_segments.extend(result["segments"])
            all_words.extend(result["words"])
            if result["language"] != "unknown":
                language = result["language"]
        finally:
            os.unlink(tmp_path)

    if on_progress:
        on_progress(1.0, "Транскрипция завершена")

    return {"segments": all_segments, "words": all_words, "language": language}
