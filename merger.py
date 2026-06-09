"""
Merger module — combines Whisper transcription results with pyannote diarization.
Aligns text to speakers using timestamp overlap.
"""


def merge_results(transcription, diarization_segments):
    """
    Merge transcription results with speaker diarization.
    
    Args:
        transcription: dict with 'segments' and 'words' from Whisper API
        diarization_segments: list of {'speaker', 'start', 'end'} from pyannote
    
    Returns:
        List of merged blocks: [{'speaker': str, 'text': str, 'start': float, 'end': float}]
    """
    if not diarization_segments:
        # No diarization — return transcription with default speaker label
        return [
            {
                "speaker": "SPEAKER_0",
                "text": seg["text"],
                "start": seg["start"],
                "end": seg["end"],
            }
            for seg in transcription.get("segments", [])
        ]

    words = transcription.get("words", [])

    if words:
        return _merge_by_words(words, diarization_segments)
    else:
        return _merge_by_segments(
            transcription.get("segments", []), diarization_segments
        )


def _find_speaker_at(time_point, diarization_segments):
    """Find which speaker is active at a given time point."""
    for seg in diarization_segments:
        if seg["start"] <= time_point <= seg["end"]:
            return seg["speaker"]

    # Fallback: find closest segment
    min_dist = float("inf")
    closest = diarization_segments[0]["speaker"] if diarization_segments else "UNKNOWN"

    for seg in diarization_segments:
        mid = (seg["start"] + seg["end"]) / 2
        dist = abs(time_point - mid)
        if dist < min_dist:
            min_dist = dist
            closest = seg["speaker"]

    return closest


def _find_speaker_by_overlap(start, end, diarization_segments):
    """Find the speaker with the most overlap for a given time range."""
    max_overlap = 0
    best = diarization_segments[0]["speaker"] if diarization_segments else "UNKNOWN"

    for seg in diarization_segments:
        overlap_start = max(start, seg["start"])
        overlap_end = min(end, seg["end"])
        overlap = max(0, overlap_end - overlap_start)

        if overlap > max_overlap:
            max_overlap = overlap
            best = seg["speaker"]

    return best


def _normalize_speakers(blocks):
    """Rename raw speaker IDs to consistent SPEAKER_0, SPEAKER_1, … labels."""
    speaker_map = {}
    counter = 0

    for block in blocks:
        raw = block["speaker"]
        if raw not in speaker_map:
            speaker_map[raw] = f"SPEAKER_{counter}"
            counter += 1
        block["speaker"] = speaker_map[raw]

    return blocks


def _merge_by_words(words, diarization_segments):
    """Merge at word level — most accurate when word timestamps are available."""
    if not words:
        return []

    # Label every word with its speaker
    labeled = []
    for w in words:
        mid = (w["start"] + w["end"]) / 2
        speaker = _find_speaker_at(mid, diarization_segments)
        labeled.append({
            "word": w["word"],
            "start": w["start"],
            "end": w["end"],
            "speaker": speaker,
        })

    # Group consecutive same-speaker words into blocks
    blocks = []
    current = None

    for lw in labeled:
        if current is None or current["speaker"] != lw["speaker"]:
            if current:
                blocks.append(current)
            current = {
                "speaker": lw["speaker"],
                "text": lw["word"],
                "start": lw["start"],
                "end": lw["end"],
            }
        else:
            current["text"] += " " + lw["word"]
            current["end"] = lw["end"]

    if current:
        blocks.append(current)

    return _normalize_speakers(blocks)


def _merge_by_segments(segments, diarization_segments):
    """Merge at segment level — used when word timestamps are unavailable."""
    blocks = []
    speaker_map = {}
    counter = 0

    for seg in segments:
        raw_speaker = _find_speaker_by_overlap(
            seg["start"], seg["end"], diarization_segments
        )

        if raw_speaker not in speaker_map:
            speaker_map[raw_speaker] = f"SPEAKER_{counter}"
            counter += 1

        speaker = speaker_map[raw_speaker]

        # Merge with previous block if same speaker
        if blocks and blocks[-1]["speaker"] == speaker:
            blocks[-1]["text"] += " " + seg["text"]
            blocks[-1]["end"] = seg["end"]
        else:
            blocks.append({
                "speaker": speaker,
                "text": seg["text"],
                "start": seg["start"],
                "end": seg["end"],
            })

    return blocks
