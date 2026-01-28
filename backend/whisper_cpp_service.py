# backend/whisper_cpp_service.py
import os
import subprocess
import tempfile
import time
from fastapi import APIRouter, FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware

# Configuration via env vars:
WHISPER_CPP_BINARY = os.environ.get("WHISPER_CPP_BINARY", "/usr/local/bin/whisper.cpp/main")
WHISPER_MODEL_PATH = os.environ.get("WHISPER_MODEL_PATH", os.path.expanduser("~/whisper.cpp/models/ggml-medium.bin"))
# optional language, set to "en" for English
WHISPER_LANG = os.environ.get("WHISPER_LANG", "en")
# timeout for subprocess calls
SUBPROCESS_TIMEOUT = int(os.environ.get("WHISPER_SUBPROCESS_TIMEOUT", "120"))

app = FastAPI(title="STT - whisper.cpp")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# Basic check
if not os.path.isfile(WHISPER_CPP_BINARY):
    # warn but let server start; route will return helpful error
    print(f"[whisper_cpp_service] WARNING: WHISPER_CPP_BINARY not found at {WHISPER_CPP_BINARY}")

if not os.path.isfile(WHISPER_MODEL_PATH):
    print(f"[whisper_cpp_service] WARNING: WHISPER_MODEL_PATH not found at {WHISPER_MODEL_PATH}")

def convert_to_wav_16k_mono(input_path: str, out_wav: str):
    """
    Convert arbitrary input (webm/mp4/ogg) to 16 kHz mono WAV using ffmpeg.
    """
    cmd = [
        "ffmpeg",
        "-y",
        "-hide_banner",
        "-loglevel", "error",
        "-fflags", "+genpts",
        "-i", input_path,
        "-ar", "16000",
        "-ac", "1",
        "-vn",
        "-f", "wav",
        out_wav
    ]
    subprocess.run(cmd, check=True)

def run_whisper_cpp(model_path: str, wav_path: str, lang: str = None, no_timestamps: bool = True):
    """
    Run whisper.cpp CLI and return transcript string.
    Uses -otxt to print plain text to stdout.
    """
    if not os.path.isfile(model_path):
        raise FileNotFoundError(f"Model not found at {model_path}")
    if not os.path.isfile(WHISPER_CPP_BINARY):
        raise FileNotFoundError(f"whisper.cpp binary not found at {WHISPER_CPP_BINARY}")

    cmd = [WHISPER_CPP_BINARY, "-m", model_path, "-f", wav_path, "-otxt"]
    # add language if provided
    if lang:
        cmd += ["-l", lang]
    # if you want no timestamps, some builds use '--no-timestamps'; keep CLI flexible
    if no_timestamps:
        # many builds accept --no-timestamps; but if not, it's fine to not pass
        cmd += ["--no-timestamps"]

    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=SUBPROCESS_TIMEOUT)
    # whisper.cpp prints transcript in stdout or to file; capture stdout first
    out = (proc.stdout or "").strip()
    if not out:
        # some builds write to stderr
        out = (proc.stderr or "").strip()
    return out

@app.post("/session/{session_id}/audio")
async def transcribe_for_session(session_id: str, file: UploadFile = File(...)):
    """
    Matches your previous Vosk route '/session/{session_id}/audio'.
    Returns JSON: { ok: True, transcript: "..." } or { ok: False, error: "..." }
    """
    # save upload to temp
    tmp_in = None
    tmp_wav = None
    start_ts = time.time()
    try:
        suffix = os.path.splitext(file.filename or "upload")[1] or ".bin"
        fd, tmp_in = tempfile.mkstemp(suffix=suffix)
        os.close(fd)
        with open(tmp_in, "wb") as f:
            f.write(await file.read())

        # convert to wav
        fd2, tmp_wav = tempfile.mkstemp(suffix=".wav")
        os.close(fd2)
        try:
            convert_to_wav_16k_mono(tmp_in, tmp_wav)
        except subprocess.CalledProcessError as e:
            raise HTTPException(status_code=400, detail=f"ffmpeg conversion failed: {e}")

        # run whisper.cpp
        try:
            transcript = run_whisper_cpp(WHISPER_MODEL_PATH, tmp_wav, lang=WHISPER_LANG, no_timestamps=True)
        except subprocess.TimeoutExpired:
            raise HTTPException(status_code=504, detail="Transcription timed out")
        except FileNotFoundError as e:
            raise HTTPException(status_code=500, detail=str(e))
        except subprocess.CalledProcessError as e:
            # return stderr for debugging
            raise HTTPException(status_code=500, detail=f"whisper.cpp failed: {e.stderr or e}")

        # some post-cleaning
        transcript = transcript.strip()
        elapsed = time.time() - start_ts
        return {"ok": True, "transcript": transcript, "meta": {"session_id": session_id, "duration_s": round(elapsed, 2)}}

    finally:
        try:
            if tmp_in and os.path.exists(tmp_in):
                os.remove(tmp_in)
            if tmp_wav and os.path.exists(tmp_wav):
                os.remove(tmp_wav)
        except Exception:
            pass

# optional health check
@app.get("/stt/whisper-cpp/health")
def health():
    ok_bin = os.path.isfile(WHISPER_CPP_BINARY)
    ok_model = os.path.isfile(WHISPER_MODEL_PATH)
    return {"ok": True, "binary_found": ok_bin, "model_found": ok_model}
