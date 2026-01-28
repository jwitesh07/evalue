// src/components/InterviewScreen.jsx
import React, { useEffect, useRef, useState } from "react";
import {
  uploadFrame,
  startSession,
  generateQuestions,
  transcribeAudio,
} from "../services/api";

/**
 * InterviewScreen
 *
 * - Uploads frames every 2.5s and collects non-verbal metric snapshots
 * - Sends audio chunks to STT and appends transcript
 * - On endInterview: computes simple scores, saves interview to backend via saveInterviewResult
 * - If backend returns 401 (expired JWT) it logs out and redirects to /login
 */

const FRAME_INTERVAL_MS = 2500;
const AUDIO_REQUEST_MS = 3000;

export default function InterviewScreen({
  setCurrentScreen,
  selectedCategory = "general",
  initialQuestions = [],
  initialMeta = null,
  setInitialQuestions,
  generatingQuestions = false,
  onInterviewComplete,
  onAnswerSubmit,
  onNonVerbalUpdate,
}) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const frameIntervalRef = useRef(null);
  const recordRequestIntervalRef = useRef(null);

  // store every metrics snapshot so we can compute averages at end
  const collectedMetricsRef = useRef([]);

  const didLocalGenerateRef = useRef(false);
  const lastTranscriptChunkRef = useRef("");
  const serverWarnedRef = useRef(false);

  const [sessionId, setSessionId] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [loadingQuestions, setLoadingQuestions] = useState(true);
  const [generationError, setGenerationError] = useState(null);

  const [isRecording, setIsRecording] = useState(false);
  const [transcribingStatus, setTranscribingStatus] = useState(null);
  const [transcript, setTranscript] = useState("");

  // metrics: normalized shape
  const [metrics, setMetrics] = useState({
    confidence: null,
    eye_contact: 0,
    smile_intensity: 0,
    focus_score: 0,
    emotion: "neutral",
    raw: null,
  });

  const [answers, setAnswers] = useState([]);

  /* -------------------------
     Helpers
  ------------------------- */
  const inferDifficulty = (years) => {
    if (typeof years !== "number") return "Intermediate";
    if (years < 2) return "Beginner";
    if (years < 5) return "Intermediate";
    return "Advanced";
  };

  const normalizeQuestionList = (rawList = []) =>
    (rawList || []).map((q, idx) => {
      if (!q) return { id: idx + 1, question: "—", topic: "General", difficulty: inferDifficulty(initialMeta?.yearsExperience) };
      if (typeof q === "string") return { id: idx + 1, question: q.trim(), topic: "General", difficulty: inferDifficulty(initialMeta?.yearsExperience) };

      const id = q.id ?? q._id ?? idx + 1;
      const questionText = (q.question || q.text || q.q || q.prompt || "").toString().trim() || String(q).slice(0, 400);
      const topic = q.topic || q.category || "General";
      const difficulty = q.difficulty || q.level || inferDifficulty(initialMeta?.yearsExperience);
      return { id: Number(id) || idx + 1, question: questionText, topic, difficulty };
    });

  // extract metrics from many possible payload shapes
  const extractMetrics = (payload) => {
    if (!payload) return null;
    const obj = payload.data ?? payload;

    const candidates = [
      obj.metrics,
      obj.nonVerbalMetrics,
      obj.non_verbal_metrics,
      obj.face,
      (Array.isArray(obj.faces) && obj.faces[0]) || null,
      obj,
    ];

    for (const cand of candidates) {
      if (!cand || typeof cand !== "object") continue;
      const confidence = cand.confidence ?? cand.confidence_score ?? cand.confidenceScore ?? null;
      const eye_contact = cand.eye_contact ?? cand.eyeContact ?? cand.eye_contact_score ?? cand.eye ?? null;
      const smile_intensity = cand.smile_intensity ?? cand.smile ?? cand.smileScore ?? null;
      const focus_score = cand.focus_score ?? cand.focus ?? cand.focusScore ?? null;
      const emotion = cand.emotion ?? cand.predominantEmotion ?? cand.mood ?? null;

      // return numeric values as numbers when possible
      return {
        confidence: confidence == null ? null : Number(confidence),
        eye_contact: eye_contact == null ? 0 : Number(eye_contact),
        smile_intensity: smile_intensity == null ? 0 : Number(smile_intensity),
        focus_score: focus_score == null ? 0 : Number(focus_score),
        emotion: emotion ?? "neutral",
        raw: cand,
      };
    }

    return null;
  };

  const appendTranscript = (text) => {
    if (!text) return;
    const cleaned = text.trim();
    if (!cleaned) return;
    if (cleaned === lastTranscriptChunkRef.current) return;
    lastTranscriptChunkRef.current = cleaned;
    setTranscript((prev) => (prev ? `${prev} ${cleaned}` : cleaned));
  };

  /* -------------------------
     Media init
  ------------------------- */
  useEffect(() => {
    let cancelled = false;
    const initMedia = async () => {
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480 },
          audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
        });
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = s;
        if (videoRef.current) videoRef.current.srcObject = s;
      } catch (err) {
        console.error("Media init error:", err);
      }
    };
    initMedia();

    return () => {
      cancelled = true;
      try {
        frameIntervalRef.current && clearInterval(frameIntervalRef.current);
        recordRequestIntervalRef.current && clearInterval(recordRequestIntervalRef.current);
        streamRef.current?.getTracks()?.forEach((t) => t.stop());
      } catch (e) {}
    };
  }, []);

  /* -------------------------
     Start session
  ------------------------- */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await startSession(selectedCategory || "general");
        const sid = res?.sessionId ?? res?.data?.sessionId ?? res?.data?.session_id ?? null;
        if (!cancelled && sid) setSessionId(sid);
      } catch (err) {
        console.error("startSession failed:", err);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedCategory]);

  /* -------------------------
     Questions generation
  ------------------------- */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingQuestions(true);
      setGenerationError(null);
      try {
        if (Array.isArray(initialQuestions) && initialQuestions.length > 0) {
          setQuestions(normalizeQuestionList(initialQuestions));
          setCurrentQuestionIndex(0);
          setLoadingQuestions(false);
          return;
        }

        if (generatingQuestions) {
          const start = Date.now();
          while (Date.now() - start < 6000) {
            if (cancelled) return;
            if (Array.isArray(initialQuestions) && initialQuestions.length > 0) {
              setQuestions(normalizeQuestionList(initialQuestions));
              setCurrentQuestionIndex(0);
              setLoadingQuestions(false);
              return;
            }
            // eslint-disable-next-line no-await-in-loop
            await new Promise((r) => setTimeout(r, 300));
          }
        }

        if (!didLocalGenerateRef.current) {
          didLocalGenerateRef.current = true;
          const opts = initialMeta ? {
            jobRole: initialMeta.jobRole,
            yearsExperience: initialMeta.yearsExperience,
            prevWork: initialMeta.prevWork,
          } : {};
          const g = await generateQuestions(selectedCategory || "general", "", opts);
          let raw = [];
          if (Array.isArray(g)) raw = g;
          else if (g?.questions && Array.isArray(g.questions)) raw = g.questions;
          else if (g?.data?.questions && Array.isArray(g.data.questions)) raw = g.data.questions;

          if (!raw || raw.length === 0) {
            raw = [
              { id: 1, question: "Tell me about yourself." },
              { id: 2, question: "Describe a recent project." },
              { id: 3, question: "How do you approach problem solving?" },
            ];
          }

          const normalized = normalizeQuestionList(raw);
          if (typeof setInitialQuestions === "function") {
            try { setInitialQuestions(normalized); } catch (e) {}
          }
          if (!cancelled) {
            setQuestions(normalized);
            setCurrentQuestionIndex(0);
            setLoadingQuestions(false);
          }
          return;
        }

        if (!cancelled) {
          setQuestions([{ id: 1, question: "Tell me about yourself.", topic: "General", difficulty: inferDifficulty(initialMeta?.yearsExperience) }]);
          setCurrentQuestionIndex(0);
        }
      } catch (err) {
        console.error("generateQuestions error:", err);
        if (!cancelled) {
          setGenerationError("Failed to generate questions. Showing fallback.");
          setQuestions([{ id: 1, question: "Tell me about yourself.", topic: "General", difficulty: inferDifficulty(initialMeta?.yearsExperience) }]);
          setCurrentQuestionIndex(0);
        }
      } finally {
        if (!cancelled) setLoadingQuestions(false);
      }
    })();

    return () => { cancelled = true; };
  }, [selectedCategory, initialQuestions, generatingQuestions, initialMeta, setInitialQuestions]);

  /* -------------------------
     Frame capture loop
  ------------------------- */
  useEffect(() => {
    if (!sessionId || !videoRef.current) return;
    let cancelled = false;

    const sendFrameOnce = async () => {
      try {
        const video = videoRef.current;
        if (!video || !video.videoWidth || !video.videoHeight) return;

        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        await new Promise((resolve) =>
          canvas.toBlob(async (blob) => {
            if (!blob || cancelled) return resolve();
            try {
              const res = await uploadFrame(sessionId, blob);
              if (!res) return resolve();
              const payload = res.data ?? res;
              const newMetrics = extractMetrics(payload);
              if (newMetrics) {
                // update state and collect
                setMetrics((prev) => ({ ...prev, ...newMetrics }));
                collectedMetricsRef.current.push(newMetrics);
                if (typeof onNonVerbalUpdate === "function") {
                  try { onNonVerbalUpdate(newMetrics); } catch (e) {}
                }
              } else if (!serverWarnedRef.current) {
                console.warn("uploadFrame returned no metrics:", payload);
                serverWarnedRef.current = true;
              }
            } catch (err) {
              if (!serverWarnedRef.current) {
                console.error("uploadFrame failed:", err);
                serverWarnedRef.current = true;
              }
            } finally {
              resolve();
            }
          }, "image/jpeg", 0.7)
        );
      } catch (e) {
        if (!serverWarnedRef.current) {
          console.error("sendFrame error:", e);
          serverWarnedRef.current = true;
        }
      }
    };

    // immediate and periodic
    sendFrameOnce();
    frameIntervalRef.current = setInterval(sendFrameOnce, FRAME_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(frameIntervalRef.current);
    };
  }, [sessionId, onNonVerbalUpdate]);

  /* -------------------------
     STT: recording and chunking
  ------------------------- */
  const chooseMime = () => {
    if (typeof MediaRecorder === "undefined") return "";
    if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) return "audio/webm;codecs=opus";
    if (MediaRecorder.isTypeSupported("audio/webm")) return "audio/webm";
    if (MediaRecorder.isTypeSupported("audio/mp4;codecs=opus")) return "audio/mp4;codecs=opus";
    if (MediaRecorder.isTypeSupported("audio/mp4")) return "audio/mp4";
    return "";
  };

  const handleSttResponse = (res) => {
    if (!res) {
      setTranscribingStatus("error");
      return;
    }
    if (res.ok === false) {
      const err = (res.error || "").toString().toLowerCase();
      if (err.includes("whisper")) {
        setTranscribingStatus("error");
      } else {
        setTranscribingStatus("error");
      }
      return;
    }
    const txt = (res.transcript ?? res.text ?? res.data?.transcript ?? res.data?.text ?? "").toString();
    if (txt && txt.trim()) {
      appendTranscript(txt);
      setTranscribingStatus("done");
    } else {
      setTranscribingStatus("done");
    }
  };

  const toggleRecording = async () => {
    if (!streamRef.current) {
      alert("Microphone not available");
      return;
    }

    if (!isRecording) {
      audioChunksRef.current = [];
      const audioTrack = streamRef.current.getAudioTracks()[0];
      if (!audioTrack) {
        alert("No audio track found");
        return;
      }
      const audioStream = new MediaStream([audioTrack]);

      let mime = chooseMime();
      let recorder;
      try {
        recorder = new MediaRecorder(audioStream, mime ? { mimeType: mime } : undefined);
      } catch (e) {
        try {
          recorder = new MediaRecorder(audioStream);
          mime = recorder.mimeType || mime;
        } catch (err) {
          alert("Recording not supported in this browser");
          return;
        }
      }

      mediaRecorderRef.current = recorder;
      lastTranscriptChunkRef.current = "";

      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) audioChunksRef.current.push(ev.data);
      };

      recorder.onerror = (e) => { console.error("MediaRecorder error:", e); };

      recorder.onstart = () => {
        recordRequestIntervalRef.current = setInterval(() => {
          try {
            if (recorder && recorder.state === "recording" && typeof recorder.requestData === "function") {
              recorder.requestData();
            }
          } catch (e) {}
        }, AUDIO_REQUEST_MS);
        setTranscribingStatus("recording");
      };

      recorder.onstop = async () => {
        clearInterval(recordRequestIntervalRef.current);
        try {
          const chunks = audioChunksRef.current.slice();
          audioChunksRef.current = [];
          if (chunks.length === 0) {
            setTranscribingStatus(null);
            return;
          }
          setTranscribingStatus("sending");
          const blob = new Blob(chunks, { type: mime || "audio/webm" });
          if (!sessionId) {
            setTranscribingStatus("error");
            return;
          }
          const res = await transcribeAudio(sessionId, blob);
          handleSttResponse(res);
        } catch (err) {
          console.error("Final STT error:", err);
          setTranscribingStatus("error");
        } finally {
          setTranscribingStatus(null);
        }
      };

      try {
        recorder.start();
      } catch (err) {
        console.error("recorder.start failed:", err);
        alert("Unable to start recording");
        return;
      }
      setIsRecording(true);
      return;
    }

    // stop
    try {
      const r = mediaRecorderRef.current;
      if (r && r.state !== "inactive") r.stop();
    } catch (e) {
      console.error("error stopping recorder:", e);
    } finally {
      clearInterval(recordRequestIntervalRef.current);
      setIsRecording(false);
    }
  };

  /* -------------------------
     Answers helpers
  ------------------------- */
  const saveAnswerFromTranscript = () => {
    const q = questions[currentQuestionIndex];
    if (!q) return null;
    const text = (transcript || "").trim();
    if (!text) return null;
    const answerObj = {
      questionId: q.id,
      question: q.question,
      topic: q.topic,
      difficulty: q.difficulty,
      answer: text,
    };
    setAnswers((prev) => {
      const filtered = prev.filter((a) => a.questionId !== q.id);
      return [...filtered, answerObj];
    });

    if (typeof onAnswerSubmit === "function") {
      try { onAnswerSubmit(answerObj); } catch (e) {}
    }

    return answerObj;
  };

  const handleSubmitAnswer = () => {
    const saved = saveAnswerFromTranscript();
    if (!saved) return;
    const more = currentQuestionIndex < questions.length - 1;
    if (more) setCurrentQuestionIndex((i) => i + 1);
    setTranscript("");
    lastTranscriptChunkRef.current = "";
    setTranscribingStatus(null);
  };

  /* -------------------------
     End interview:
       - finalize answers
       - compute simple non-verbal averages
       - call saveInterviewResult(payload)
  ------------------------- */
  const computeAverage = (arr, key) => {
    const val = arr.map((m) => Number(m?.[key] ?? 0)).filter((n) => !Number.isNaN(n));
    if (!val.length) return 0;
    return Math.round(val.reduce((s, v) => s + v, 0) / val.length);
  };

  const endInterview = async () => {
  // capture last answer
  const q = questions[currentQuestionIndex];
  let finalAnswers = answers;

  if (q && transcript.trim()) {
    const a = {
      questionId: q.id,
      question: q.question,
      topic: q.topic,
      difficulty: q.difficulty,
      answer: transcript.trim(),
    };
    finalAnswers = [...answers.filter(x => x.questionId !== q.id), a];
    setAnswers(finalAnswers);
  }

  // stop camera & mic
  try {
    streamRef.current?.getTracks()?.forEach(t => t.stop());
    if (mediaRecorderRef.current?.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
  } catch {}

  // compute non-verbal averages
  const snapshots = collectedMetricsRef.current || [];
  const avgEye = computeAverage(snapshots, "eye_contact");
  const avgSmile = computeAverage(snapshots, "smile_intensity");
  const avgFocus = computeAverage(snapshots, "focus_score");
  const avgConfidence = computeAverage(snapshots, "confidence");

  const nonVerbalAvg = Math.round((avgEye + avgSmile + avgFocus) / 3);

  // build payload for ResultsScreen
  const payload = {
    answers: finalAnswers,
    transcript: finalAnswers
    .map(a => a.answer)
    .join(" ")
    .slice(0, 3500), // ⛔ prevents LLM overload

    nonVerbalMetrics: {
      eye_contact: avgEye,
      smile_intensity: avgSmile,
      focus_score: avgFocus,
      confidence: avgConfidence || nonVerbalAvg,
    },
    meta: initialMeta || {},
    category: selectedCategory,
  };

  if (typeof onInterviewComplete === "function") {
    onInterviewComplete(payload);
  }

  setCurrentScreen("results");
};


  /* -------------------------
     Render JSX
  ------------------------- */
  const currentQuestion = questions[currentQuestionIndex] || {};
return (
  <div className="min-h-screen bg-gray-50 py-10 px-6">
    <div className="max-w-7xl mx-auto grid md:grid-cols-4 gap-8">

      {/* LEFT COLUMN : CAMERA + LIVE FEEDBACK */}
      <div className="md:col-span-1 space-y-6">

        {/* CAMERA */}
        <div className="bg-black rounded-xl shadow-lg relative overflow-hidden">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="w-full aspect-video object-cover"
          />

          <div className="absolute top-4 left-4 flex items-center gap-2">
            <div
              className={`w-3 h-3 rounded-full ${
                isRecording ? "bg-red-500 animate-pulse" : "bg-gray-400"
              }`}
            />
            <span className="text-white text-sm">
              {isRecording ? "Recording..." : "Mic Off"}
            </span>
          </div>

          <button
            onClick={toggleRecording}
            className={`absolute bottom-4 right-4 p-3 rounded-full shadow-lg ${
              isRecording
                ? "bg-red-600 text-white"
                : "bg-white text-gray-800"
            }`}
          >
            🎤
          </button>
        </div>

        {/* LIVE FEEDBACK (CAMERA KINDHA ✅) */}
        <div className="bg-white p-6 rounded-xl shadow">
          <h3 className="font-semibold mb-4">Live Feedback</h3>

          <FeedbackMetric
            label="Eye Contact"
            value={metrics.eye_contact}
          />
          <FeedbackMetric
            label="Smile"
            value={metrics.smile_intensity}
          />
          <FeedbackMetric
            label="Focus"
            value={metrics.focus_score}
          />

          <div className="mt-4">
            <p className="text-sm text-gray-600">Emotion</p>
            <p className="text-lg font-bold text-indigo-600 capitalize">
              {metrics.emotion}
            </p>
          </div>
        </div>

      </div>

      {/* RIGHT COLUMN : QUESTIONS + TRANSCRIPT */}
      <div className="md:col-span-3 space-y-6">

        {/* QUESTION */}
        <div className="bg-white p-6 rounded-xl shadow">
          <div className="flex justify-between">
            <div className="flex-1">
              <h3 className="font-semibold mb-2">Current Question</h3>
              <div className="bg-blue-50 p-4 rounded min-h-[72px]">
                {loadingQuestions
                  ? "Loading questions…"
                  : currentQuestion.question || "—"}
              </div>

              {generationError && (
                <div className="text-sm text-red-600 mt-2">
                  {generationError}
                </div>
              )}
            </div>

            <div className="ml-4 text-right">
              <div className="text-sm text-gray-500 mb-2">
                {currentQuestion.topic || "General"}
              </div>
              <span className="px-2 py-1 text-xs font-semibold rounded bg-yellow-100 text-yellow-800">
                {currentQuestion.difficulty}
              </span>
            </div>
          </div>
        </div>

        {/* TRANSCRIPT */}
        <div className="bg-white p-6 rounded-xl shadow">
          <h3 className="font-semibold mb-3">Your Response</h3>

          <div className="bg-gray-50 p-4 rounded min-h-[160px] whitespace-pre-wrap text-sm">
            {transcript ||
              (isRecording
                ? "Listening..."
                : "Press mic to start speaking")}
          </div>

          <div className="mt-4 flex justify-end gap-3">
            <button
              onClick={handleSubmitAnswer}
              className="bg-indigo-600 text-white px-4 py-2 rounded"
            >
              Submit Answer
            </button>

            <button
              onClick={endInterview}
              className="bg-red-500 text-white px-4 py-2 rounded"
            >
              End Interview
            </button>
          </div>
        </div>

      </div>

    </div>
  </div>
);

}
/* small UI metric row */
function FeedbackMetric({ label, value = 0 }) {
  const v = Math.min(100, Math.max(0, Math.round(Number(value) || 0)));
  const color =
    v > 80 ? "bg-green-500" : v > 60 ? "bg-yellow-400" : "bg-red-500";

  return (
    <div className="mb-3">
      <div className="flex justify-between text-sm mb-1">
        <span>{label}</span>
        <span className="font-semibold">{v}%</span>
      </div>

      <div className="w-full h-2 bg-gray-200 rounded overflow-hidden">
        <div
          className={`${color} h-2`}
          style={{ width: `${v}%` }}
        />
      </div>
    </div>
  );
}
