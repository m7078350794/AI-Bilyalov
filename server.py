"""
Flask server — API backend for the Расшифровщик audio transcription app.
Serves the frontend static files and provides REST endpoints for
audio upload, transcription, diarization, and result retrieval.
"""

import os
import uuid
import threading
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from transcriber import transcribe_audio
from diarizer import diarize_audio, is_available as diarizer_available
from merger import merge_results

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

app = Flask(__name__, static_folder=BASE_DIR, static_url_path="")
CORS(app)

UPLOAD_DIR = os.path.join(BASE_DIR, "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

# In-memory task storage: task_id -> task dict
tasks = {}


# ── Static file routes ────────────────────────────────────────────

@app.route("/")
def index():
    return send_from_directory(BASE_DIR, "index.html")


@app.route("/css/<path:path>")
def serve_css(path):
    return send_from_directory(os.path.join(BASE_DIR, "css"), path)


@app.route("/js/<path:path>")
def serve_js(path):
    return send_from_directory(os.path.join(BASE_DIR, "js"), path)


# ── API routes ──────────────────────────────────────────────────────

@app.route("/api/check-diarization")
def check_diarization():
    """Check whether pyannote.audio speaker diarization is available."""
    return jsonify({"available": diarizer_available()})


@app.route("/api/transcribe", methods=["POST"])
def start_transcription():
    """
    Upload an audio file and start background transcription.
    Form fields:
        file          – the audio file
        openai_key    – OpenAI API key
        hf_token      – HuggingFace token (optional, for diarization)
        use_diarization – 'true' / 'false'
    Returns:
        {'task_id': str}
    """
    if "file" not in request.files:
        return jsonify({"error": "Файл не найден"}), 400

    file = request.files["file"]
    if file.filename == "":
        return jsonify({"error": "Файл не выбран"}), 400

    openai_key = request.form.get("openai_key", "")
    hf_token = request.form.get("hf_token", "")
    use_diarization = request.form.get("use_diarization", "true") == "true"

    if not openai_key:
        return jsonify({"error": "OpenAI API ключ не указан"}), 400

    # Save uploaded file
    task_id = str(uuid.uuid4())
    safe_name = f"{task_id}_{file.filename}"
    filepath = os.path.join(UPLOAD_DIR, safe_name)
    file.save(filepath)

    # Initialise task
    tasks[task_id] = {
        "status": "processing",
        "progress": 0.0,
        "message": "Начало обработки...",
        "result": None,
        "error": None,
        "filename": file.filename,
    }

    # Run in background thread
    thread = threading.Thread(
        target=_process_audio,
        args=(task_id, filepath, openai_key, hf_token, use_diarization),
        daemon=True,
    )
    thread.start()

    return jsonify({"task_id": task_id})


@app.route("/api/status/<task_id>")
def get_status(task_id):
    """Return the current processing status of a task."""
    if task_id not in tasks:
        return jsonify({"error": "Задача не найдена"}), 404

    task = tasks[task_id]
    return jsonify({
        "status": task["status"],
        "progress": task["progress"],
        "message": task["message"],
        "error": task["error"],
    })


@app.route("/api/result/<task_id>")
def get_result(task_id):
    """Return the completed transcription result."""
    if task_id not in tasks:
        return jsonify({"error": "Задача не найдена"}), 404

    task = tasks[task_id]
    if task["status"] != "completed":
        return jsonify({"error": "Задача ещё не завершена"}), 400

    return jsonify(task["result"])


# ── Background processing ───────────────────────────────────────────

def _process_audio(task_id, filepath, openai_key, hf_token, use_diarization):
    """Run transcription (and optionally diarization) in a background thread."""
    try:
        diarization_segments = []

        # ── Step 1: Speaker diarization (optional) ──
        if use_diarization and diarizer_available() and hf_token:
            def diar_progress(p, msg):
                tasks[task_id]["progress"] = p * 0.4
                tasks[task_id]["message"] = msg

            try:
                diarization_segments = diarize_audio(
                    filepath, hf_token, on_progress=diar_progress
                )
            except Exception as e:
                tasks[task_id]["message"] = (
                    f"Диаризация недоступна: {e}. Продолжаем без неё..."
                )
                diarization_segments = []

        # ── Step 2: Transcription via Whisper API ──
        def trans_progress(p, msg):
            base = 0.4 if diarization_segments else 0.0
            tasks[task_id]["progress"] = base + p * (0.9 - base)
            tasks[task_id]["message"] = msg

        transcription = transcribe_audio(
            filepath, openai_key, on_progress=trans_progress
        )

        # ── Step 3: Merge transcription + diarization ──
        tasks[task_id]["progress"] = 0.95
        tasks[task_id]["message"] = "Совмещение результатов..."

        merged = merge_results(transcription, diarization_segments)

        # ── Done ──
        tasks[task_id]["status"] = "completed"
        tasks[task_id]["progress"] = 1.0
        tasks[task_id]["message"] = "Готово!"
        tasks[task_id]["result"] = {
            "blocks": merged,
            "language": transcription.get("language", "unknown"),
            "has_diarization": len(diarization_segments) > 0,
        }

    except Exception as e:
        tasks[task_id]["status"] = "error"
        tasks[task_id]["error"] = str(e)
        tasks[task_id]["message"] = f"Ошибка: {e}"

    finally:
        # Clean up the uploaded file
        try:
            os.remove(filepath)
        except OSError:
            pass


# ── Entry point ──────────────────────────────────────────────────────

if __name__ == "__main__":
    print("╔══════════════════════════════════════════╗")
    print("║       Расшифровщик — Audio Transcriber   ║")
    print("║   Откройте http://127.0.0.1:5000         ║")
    print("╚═════════════════════════════════════════╝")
    app.run(host="127.0.0.1", port=5000, debug=True)
