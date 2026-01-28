# backend/main_whisper.py
import cv2
import numpy as np
import mediapipe as mp
from fastapi import FastAPI, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
import uuid, time, logging, os, shutil, tempfile, subprocess

# -----------------------------------------------------------
# Configuration
# -----------------------------------------------------------
WHISPER_CPP_BINARY = os.environ.get(
    "WHISPER_CPP_BINARY",
    "/usr/local/bin/whisper.cpp/main"
)
WHISPER_MODEL_PATH = os.environ.get(
    "WHISPER_MODEL_PATH",
    os.path.expanduser("~/whisper.cpp/models/ggml-small.bin")
)
WHISPER_LANG = os.environ.get("WHISPER_LANG", "en")
WHISPER_TIMEOUT = int(os.environ.get("WHISPER_SUBPROCESS_TIMEOUT", "120"))
FFMPEG_PATH = shutil.which("ffmpeg") or "ffmpeg"

# -----------------------------------------------------------
# App setup
# -----------------------------------------------------------
app = FastAPI(title="Evalue AI Backend (Stable Metrics v3)", version="3.1")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("evalue-backend")

sessions = {}

# -----------------------------------------------------------
# MediaPipe FaceMesh
# -----------------------------------------------------------
mp_face_mesh = mp.solutions.face_mesh
face_mesh = mp_face_mesh.FaceMesh(
    static_image_mode=False,
    max_num_faces=1,
    min_detection_confidence=0.5,
    min_tracking_confidence=0.5,
)

# -----------------------------------------------------------
# Utility helpers
# -----------------------------------------------------------
def clamp(v, lo=0.0, hi=100.0):
    return max(lo, min(hi, v))


def smooth(prev, curr, up_rate=0.12, down_rate=0.35):
    """Increase slowly, decrease faster (human-like)"""
    if curr > prev:
        return prev + (curr - prev) * up_rate
    else:
        return prev + (curr - prev) * down_rate


# -----------------------------------------------------------
# Audio helpers
# -----------------------------------------------------------
def convert_to_wav_16k_mono(input_path: str, out_wav: str):
    cmd = [
        FFMPEG_PATH,
        "-y",
        "-err_detect", "ignore_err",     # 🔥 ignore broken opus frames
        "-fflags", "+genpts",
        "-i", input_path,
        "-ac", "1",
        "-ar", "16000",
        "-vn",
        "-acodec", "pcm_s16le",
        out_wav,
    ]

    subprocess.run(
        cmd,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=True
    )

    subprocess.run(cmd, check=True)


def run_whisper_cpp_on_wav(wav_path: str):
    cmd = [
        WHISPER_CPP_BINARY,
        "-m", WHISPER_MODEL_PATH,
        "-f", wav_path,
        "-otxt",
        "--no-timestamps",
        "-l", WHISPER_LANG,
    ]
    proc = subprocess.run(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        timeout=WHISPER_TIMEOUT,
    )
    return (proc.stdout or proc.stderr).strip()


# -----------------------------------------------------------
# Routes
# -----------------------------------------------------------
@app.post("/api/session/start")
def start_session(category: str = Form("general")):
    sid = str(uuid.uuid4())
    sessions[sid] = {
        "start": time.time(),
        "metrics": {
            "eye_contact": 40.0,
            "smile": 20.0,
            "focus": 55.0,
            "confidence": 45.0,
        },
        "prev_nose": None,
    }
    return {"sessionId": sid, "category": category}


# -----------------------------------------------------------
# 📸 Frame Upload (STABLE & STRICT)
# -----------------------------------------------------------
@app.post("/api/session/{session_id}/frame")
async def upload_frame(session_id: str, file: UploadFile = File(...)):
    if session_id not in sessions:
        return {"ok": False, "error": "Invalid session"}

    contents = await file.read()
    frame = cv2.imdecode(np.frombuffer(contents, np.uint8), cv2.IMREAD_COLOR)
    if frame is None:
        return {"ok": False, "error": "Invalid image"}

    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    results = face_mesh.process(rgb)

    state = sessions[session_id]
    m = state["metrics"]

    # ---------------- NO FACE → DECAY ----------------
    if not results.multi_face_landmarks:
        m["eye_contact"] *= 0.90
        m["smile"] *= 0.94
        m["focus"] *= 0.88
    else:
        h, w, _ = frame.shape
        lm = results.multi_face_landmarks[0].landmark

        def pt(i):
            return np.array([lm[i].x * w, lm[i].y * h])

        inter_ocular = np.linalg.norm(pt(33) - pt(263)) + 1e-6

        # -------- Eye Contact (Yaw) --------
        nose = pt(1)
        left_eye = pt(33)
        right_eye = pt(263)
        face_center = (left_eye + right_eye) / 2

        yaw = abs((nose[0] - face_center[0]) / inter_ocular)
        eye_raw = 90 if yaw < 0.15 else 15
        m["eye_contact"] = smooth(m["eye_contact"], eye_raw)

        # -------- Smile --------
        mouth = np.linalg.norm(pt(61) - pt(291)) / inter_ocular
        smile_raw = clamp((mouth - 0.38) / 0.25 * 100)
        m["smile"] = smooth(m["smile"], smile_raw)

        # -------- Focus (Distance + Stability) --------
        face_size = inter_ocular / w  # normalized distance
        dist_score = clamp((face_size - 0.10) / 0.15 * 100)

        prev_nose = state["prev_nose"]
        state["prev_nose"] = nose
        if prev_nose is not None:
            jitter = np.linalg.norm(nose - prev_nose)
            stability = clamp(100 - (jitter / inter_ocular) * 180)
        else:
            stability = 70

        focus_raw = 0.6 * dist_score + 0.4 * stability
        m["focus"] = smooth(m["focus"], focus_raw, 0.10, 0.45)

    # -------- Confidence --------
    confidence_raw = (
        0.45 * m["focus"] +
        0.35 * m["eye_contact"] +
        0.20 * m["smile"]
    )
    m["confidence"] = smooth(m["confidence"], confidence_raw)

    # -------- Emotion --------
    emotion = (
        "happy" if m["smile"] > 65 and m["eye_contact"] > 60
        else "distracted" if m["eye_contact"] < 30 or m["focus"] < 40
        else "neutral"
    )

    return {
        "ok": True,
        "eye_contact": round(m["eye_contact"], 2),
        "smile_intensity": round(m["smile"], 2),
        "focus_score": round(m["focus"], 2),
        "confidence": round(m["confidence"], 2),
        "emotion": emotion,
    }


# -----------------------------------------------------------
# 🎤 Audio Upload + whisper.cpp
# -----------------------------------------------------------
@app.post("/api/session/{session_id}/audio")
async def process_audio(session_id: str, file: UploadFile = File(...)):
    if session_id not in sessions:
        return {"ok": False, "error": "Invalid session"}

    data = await file.read()
    if not data:
        return {"ok": False, "error": "Empty audio"}

    fd, tmp_in = tempfile.mkstemp()
    fd2, tmp_wav = tempfile.mkstemp(suffix=".wav")
    os.write(fd, data)
    os.close(fd)

    try:
        convert_to_wav_16k_mono(tmp_in, tmp_wav)
        transcript = run_whisper_cpp_on_wav(tmp_wav)
        return {"ok": True, "sessionId": session_id, "transcript": transcript}
    finally:
        try:
            os.remove(tmp_in)
            os.remove(tmp_wav)
        except Exception:
            pass


# -----------------------------------------------------------
# 🧹 End Session
# -----------------------------------------------------------
@app.post("/api/session/{session_id}/end")
def end_session(session_id: str):
    sessions.pop(session_id, None)
    return {"ok": True}
