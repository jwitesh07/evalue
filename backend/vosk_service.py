# # backend/vosk_service.py
# """
# Robust Vosk transcription helper (updated).

# Features:
# - Converts input -> 16k mono WAV using ffmpeg (subprocess)
# - Tolerant ffmpeg flags for fragmented inputs (-fflags +genpts)
# - Loads and caches Vosk model once
# - Deduplicates and collapses repeated words/chunks
# - Defensive JSON parsing and optional debug logging
# - Raises informative exceptions (FileNotFoundError, CalledProcessError)
# """

# import os
# import json
# import tempfile
# import subprocess
# import wave
# import time
# import logging
# from typing import Optional, List

# try:
#     from vosk import Model, KaldiRecognizer
# except Exception as e:
#     raise RuntimeError("Vosk package not found. Install with: python -m pip install vosk") from e

# logger = logging.getLogger("vosk_service")
# if not logger.handlers:
#     logging.basicConfig(level=logging.INFO)

# # === CONFIG ===
# VOSK_MODEL_PATH = os.environ.get("VOSK_MODEL_PATH", "models/vosk-model-small-en-us-0.15")
# WAVE_READ_FRAMES = 4000


# # === Model loader (cached) ===
# _model_instance: Optional[Model] = None


# def _ensure_model_loaded(path: str) -> Model:
#     if not os.path.isdir(path):
#         raise FileNotFoundError(
#             f"Vosk model directory not found at: {path}\n"
#             "Download a model from https://alphacephei.com/vosk/models and unzip into the backend/models folder,\n"
#             "or set VOSK_MODEL_PATH env var to the correct directory."
#         )
#     logger.info("Loading Vosk model from %s", path)
#     return Model(path)


# def _get_model() -> Model:
#     global _model_instance
#     if _model_instance is None:
#         _model_instance = _ensure_model_loaded(VOSK_MODEL_PATH)
#     return _model_instance


# # === Audio conversion (ffmpeg) ===
# def _convert_to_wav_16k_mono(input_path: str, output_path: str, debug: bool = False) -> None:
#     """
#     Convert input audio/video file to 16kHz mono WAV using ffmpeg.
#     Uses flags to be more tolerant of fragmented inputs.
#     Raises subprocess.CalledProcessError on failure with stderr included.
#     """
#     cmd = [
#         "ffmpeg",
#         "-y",
#         "-hide_banner",
#         "-loglevel",
#         "error",
#         "-fflags",
#         "+genpts",  # help with fragmented inputs (mp4/webm chunks)
#         "-i",
#         input_path,
#         "-ar",
#         "16000",
#         "-ac",
#         "1",
#         "-vn",
#         "-f",
#         "wav",
#         output_path,
#     ]
#     if debug:
#         logger.debug("Running ffmpeg conversion command: %s", " ".join(cmd))

#     proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
#     if proc.returncode != 0:
#         stderr_text = (proc.stderr or "").strip()
#         logger.error("ffmpeg conversion failed (rc=%s): %s", proc.returncode, stderr_text[:2000])
#         # Raise with stderr so caller can return a helpful message
#         raise subprocess.CalledProcessError(proc.returncode, cmd, output=proc.stdout, stderr=proc.stderr)


# # === Deduplication helpers ===
# def _collapse_adjacent_duplicate_words(s: str) -> str:
#     """
#     Collapse immediate repeated words: "hi hi there there" -> "hi there"
#     """
#     if not s:
#         return s
#     parts = s.split()
#     out = []
#     prev = None
#     for p in parts:
#         if p == prev:
#             continue
#         out.append(p)
#         prev = p
#     return " ".join(out)


# def _is_redundant(new_text: str, existing_parts: List[str]) -> bool:
#     """
#     Heuristic to decide if new_text is redundant given existing_parts.
#     """
#     if not new_text:
#         return True
#     if not existing_parts:
#         return False
#     last = existing_parts[-1].strip()
#     n = new_text.strip()
#     if not n:
#         return True
#     if last == n:
#         return True
#     try:
#         if n in last or last in n:
#             return True
#     except Exception:
#         pass
#     return False


# # === Main transcription function ===
# def transcribe_audio(input_file_path: str, debug: bool = False) -> str:
#     """
#     Convert input file -> 16k mono WAV and transcribe with Vosk.
#     Returns a cleaned transcript string (deduplicated).

#     Raises:
#         FileNotFoundError: if input file missing (caller should handle)
#         subprocess.CalledProcessError: if ffmpeg conversion fails (stderr included)
#         RuntimeError: for unexpected recognizer errors
#     """
#     if not os.path.isfile(input_file_path):
#         raise FileNotFoundError(f"Input audio file not found: {input_file_path}")

#     model = _get_model()

#     tmp_wav_path: Optional[str] = None
#     start_ts = time.time()
#     transcript_parts: List[str] = []

#     try:
#         # create temp wav file path
#         with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp_wav:
#             tmp_wav_path = tmp_wav.name

#         # Convert input to wav (may raise CalledProcessError)
#         _convert_to_wav_16k_mono(input_file_path, tmp_wav_path, debug=debug)

#         # Open wav and feed into model
#         wf = wave.open(tmp_wav_path, "rb")
#         try:
#             rec = KaldiRecognizer(model, wf.getframerate())
#         except Exception as e:
#             # if recognizer fails to initialize, raise a runtime error
#             logger.exception("Failed to initialize KaldiRecognizer: %s", e)
#             raise RuntimeError(f"Failed to initialize recognizer: {e}") from e

#         # optional: include word-level timing
#         try:
#             rec.SetWords(True)
#         except Exception:
#             # older vosk builds may not have SetWords; ignore if fails
#             if debug:
#                 logger.debug("rec.SetWords(True) failed or not supported.")

#         while True:
#             data = wf.readframes(WAVE_READ_FRAMES)
#             if len(data) == 0:
#                 break

#             try:
#                 accepted = rec.AcceptWaveform(data)
#             except Exception as e:
#                 logger.exception("Vosk AcceptWaveform error: %s", e)
#                 # skip this chunk and continue
#                 continue

#             if accepted:
#                 try:
#                     res_json = rec.Result()
#                     if res_json:
#                         j = json.loads(res_json)
#                         res_text = j.get("text", "").strip()
#                         if res_text:
#                             # collapse duplicated words inside chunk
#                             res_text = _collapse_adjacent_duplicate_words(res_text)
#                             if not _is_redundant(res_text, transcript_parts):
#                                 transcript_parts.append(res_text)
#                                 if debug:
#                                     logger.debug("Appended chunk: %r", res_text)
#                 except Exception:
#                     if debug:
#                         logger.exception("Failed to parse rec.Result() JSON")
#                     # ignore JSON parse errors and continue

#             else:
#                 # ignore partials to avoid repeats when combined with final
#                 pass

#         # Final result
#         try:
#             final_json_str = rec.FinalResult()
#             if final_json_str:
#                 final_j = json.loads(final_json_str)
#                 final_txt = final_j.get("text", "").strip()
#                 if final_txt:
#                     final_txt = _collapse_adjacent_duplicate_words(final_txt)
#                     if not _is_redundant(final_txt, transcript_parts):
#                         transcript_parts.append(final_txt)
#                         if debug:
#                             logger.debug("Appended final chunk: %r", final_txt)
#         except Exception:
#             if debug:
#                 logger.exception("Failed to parse rec.FinalResult() JSON")

#         # Join parts and collapse any adjacent duplicate words across boundaries
#         joined = " ".join(p for p in transcript_parts if p)
#         joined = _collapse_adjacent_duplicate_words(joined).strip()

#         if debug:
#             logger.info("Transcription finished in %.3fs, parts=%d, joined=%r", time.time() - start_ts, len(transcript_parts), joined)

#         return joined

#     finally:
#         # cleanup temp wav
#         try:
#             if tmp_wav_path and os.path.exists(tmp_wav_path):
#                 os.remove(tmp_wav_path)
#         except Exception:
#             logger.warning("Could not remove temp wav: %s", tmp_wav_path)
