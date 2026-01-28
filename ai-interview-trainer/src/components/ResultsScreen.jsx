// src/components/ResultsScreen.jsx
import React, { useEffect, useState, useMemo } from "react";
import { evaluateAnswers, saveInterviewResult } from "../services/api";

/**
 * ResultsScreen
 *
 * Props:
 * - setCurrentScreen(fn)
 * - setShowModal(fn)
 * - selectedCategory (string)
 * - questions (array)           // from App initialQuestions
 * - answers (array)             // [{ questionId, question, topic, difficulty, answer }]
 * - fullTranscript (string)     // optional combined transcript for the whole interview
 * - initialMeta (object|null)   // { jobRole, yearsExperience, prevWork }
 * - nonVerbalMetrics (object|null) // { confidence, eye_contact, smile_intensity, focus_score, emotion }
 */

export default function ResultsScreen({
  setCurrentScreen,
  setShowModal,
  selectedCategory,
  questions = [],
  answers = [],
  fullTranscript = "",
  initialMeta = null,
  nonVerbalMetrics = null,
}) {
  const [loading, setLoading] = useState(true);
  const [evaluation, setEvaluation] = useState(null);
  const [error, setError] = useState(null);

  // for saving to DB
  const [hasSaved, setHasSaved] = useState(false);
  const [saveError, setSaveError] = useState(null);

  // Map Qs by ID for easy lookup
  const questionMap = useMemo(() => {
    const map = new Map();
    (questions || []).forEach((q) => {
      if (!q) return;
      map.set(q.id ?? q.questionId ?? q._id, q);
    });
    return map;
  }, [questions]);

  // Normalized answers array to pass to backend / evaluation
  const normalizedAnswers = useMemo(() => {
    return (answers || []).map((a) => {
      const q = questionMap.get(a.questionId) || {};
      return {
        questionId: a.questionId ?? q.id,
        question: a.question ?? q.question ?? "",
        topic: a.topic ?? q.topic ?? "General",
        difficulty: a.difficulty ?? q.difficulty ?? "Intermediate",
        answer: a.answer ?? "",
      };
    });
  }, [answers, questionMap]);

  // ==============================
  // 1) CALL AI EVALUATION BACKEND
  // ==============================
  useEffect(() => {
    let cancelled = false;

    const runEvaluation = async () => {
      // If no answers, don't even call backend
      if (!normalizedAnswers.length) {
        setLoading(false);
        setError("No answers were captured for this interview. Please try again.");
        return;
      }

      setLoading(true);
      setError(null);
      setHasSaved(false);
      setSaveError(null);

      try {
        const payload = {
          category: selectedCategory || "general",
          questions: questions || [],
          answers: normalizedAnswers,
          // backend accepts fullTranscript | full_transcript | transcript
          transcript: fullTranscript || "",
          meta: initialMeta || {},
        };

        const res = await evaluateAnswers(payload);

        if (cancelled) return;

        if (!res || res.ok === false) {
          setError(res?.error || "Evaluation failed. Please try again.");
          setEvaluation(null);
        } else {
          setEvaluation(res);
        }
      } catch (err) {
        if (!cancelled) {
          console.error("evaluateAnswers error:", err);
          setError(err?.message || "Unexpected error while evaluating answers.");
          setEvaluation(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    runEvaluation();

    return () => {
      cancelled = true;
    };
  }, [selectedCategory, questions, normalizedAnswers, fullTranscript, initialMeta]);

  // --- SCORES & FIELDS (normalize snake_case + camelCase) ---
  const verbalScore =
    evaluation?.overall_score ?? // from backend
    evaluation?.overallScore ??
    evaluation?.score ??
    null;

  const nonVerbalScore =
    nonVerbalMetrics && typeof nonVerbalMetrics.confidence === "number"
      ? nonVerbalMetrics.confidence
      : null;

  let confidenceScore = null;
  if (verbalScore != null && nonVerbalScore != null) {
    // Weighted combo: 60% verbal (answers), 40% non-verbal (face metrics)
    confidenceScore = Math.round(0.6 * verbalScore + 0.4 * nonVerbalScore);
  } else if (verbalScore != null) {
    confidenceScore = Math.round(verbalScore);
  } else if (nonVerbalScore != null) {
    confidenceScore = Math.round(nonVerbalScore);
  }

  const summary = evaluation?.summary || evaluation?.overallFeedback || "";
  const strengths = evaluation?.strengths || [];
  const improvements =
    evaluation?.improvements || evaluation?.improvementAreas || [];
  const perQuestion =
    evaluation?.per_question || // backend snake_case
    evaluation?.perQuestion ||
    evaluation?.questions ||
    [];

  // =========================================
  // 2) AUTO-SAVE INTERVIEW TO NODE + MONGODB
  // =========================================
  useEffect(() => {
    // Only try saving when:
    // - evaluation is present
    // - not loading
    // - no evaluation error
    // - not already saved
    // - we actually have answers
    if (!evaluation || loading || error || hasSaved || !normalizedAnswers.length) return;

    const doSave = async () => {
      try {
        // durationSeconds: we don't track exact duration yet, so send 0 for now
        const durationSeconds = 0;

        // Bundle evaluation into one object, as expected by user_admin_Controller
        const evaluationPayload = {
          overall_score: verbalScore ?? null,
          summary,
          strengths,
          improvements,
          per_question: perQuestion,
          modelUsed: evaluation?.modelUsed || evaluation?.model || null,
        };

        const payload = {
          // --- top-level fields expected by saveInterviewResult controller ---
          category: selectedCategory || "general",
          overallScore:
            confidenceScore ??
            (verbalScore != null ? Math.round(verbalScore) : null),
          totalQuestions: Array.isArray(questions) ? questions.length : 0,
          answeredQuestions: Array.isArray(normalizedAnswers)
            ? normalizedAnswers.length
            : 0,
          durationSeconds,
          meta: initialMeta || {},
          nonVerbalMetrics: nonVerbalMetrics || {},
          evaluation: evaluationPayload,
          questions: questions || [],
          answers: normalizedAnswers,
          fullTranscript: fullTranscript || "",
          // extra fields (safe to store in Mixed types if you want them later)
          verbalScore: verbalScore != null ? Math.round(verbalScore) : null,
          nonVerbalScore:
            nonVerbalScore != null ? Math.round(nonVerbalScore) : null,
          confidenceScore: confidenceScore != null ? confidenceScore : null,
        };

        const res = await saveInterviewResult(payload);
        if (!res || res.ok === false) {
          console.error("saveInterviewResult failed:", res);
          setSaveError(res?.error || "Failed to save interview results.");
        } else {
          setHasSaved(true);
        }
      } catch (e) {
        console.error("saveInterviewResult exception:", e);
        setSaveError(
          e?.message || "Unexpected error while saving interview results."
        );
      }
    };

    doSave();
  }, [
    evaluation,
    loading,
    error,
    hasSaved,
    normalizedAnswers,
    selectedCategory,
    questions,
    fullTranscript,
    initialMeta,
    nonVerbalMetrics,
    verbalScore,
    nonVerbalScore,
    confidenceScore,
    summary,
    strengths,
    improvements,
    perQuestion,
  ]);

  // =====================
  // 3) RENDER UI
  // =====================
  return (
    <div className="min-h-screen bg-gray-50 py-10 px-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="text-center mb-10">
          <h1 className="text-4xl font-bold mb-3">Interview Complete! 🎉</h1>
          <p className="text-gray-600">
            Here&apos;s your confidence score and detailed performance analysis.
          </p>
          {saveError && (
            <p className="text-xs text-red-500 mt-2">
              (Note: We couldn&apos;t save this session to your history:{" "}
              {saveError})
            </p>
          )}
          {hasSaved && !saveError && (
            <p className="text-xs text-emerald-600 mt-2">
              This interview has been saved to your dashboard.
            </p>
          )}
        </div>

        {/* Top Section: Confidence Score + Summary */}
        <div className="grid md:grid-cols-3 gap-6 mb-10">
          {/* Confidence card */}
          <div className="bg-white rounded-2xl shadow p-6 flex flex-col items-center justify-center">
            <p className="text-sm text-gray-500 mb-2 uppercase tracking-wide">
              Confidence Score
            </p>
            {loading ? (
              <div className="w-24 h-24 flex items-center justify-center rounded-full border-4 border-indigo-100">
                <div className="w-10 h-10 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : confidenceScore != null ? (
              <div className="w-24 h-24 rounded-full bg-indigo-50 flex flex-col items-center justify-center border-4 border-indigo-400">
                <span className="text-3xl font-bold text-indigo-700">
                  {confidenceScore}
                </span>
                <span className="text-xs text-gray-500 mt-1">/ 100</span>
              </div>
            ) : (
              <div className="text-gray-400 text-sm">No score available</div>
            )}

            {/* Breakdown */}
            <div className="mt-4 text-xs text-gray-500 space-y-1 text-center">
              {verbalScore != null && (
                <div>
                  <span className="font-semibold text-gray-700">
                    Verbal (answers):
                  </span>{" "}
                  {Math.round(verbalScore)}/100
                </div>
              )}
              {nonVerbalScore != null && (
                <div>
                  <span className="font-semibold text-gray-700">
                    Non-verbal (eye contact, focus, smile):
                  </span>{" "}
                  {Math.round(nonVerbalScore)}/100
                </div>
              )}
              {selectedCategory && (
                <div className="pt-1">
                  Category:{" "}
                  <span className="font-semibold text-gray-700">
                    {selectedCategory}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Summary / Error */}
          <div className="md:col-span-2 bg-white rounded-2xl shadow p-6">
            <h2 className="text-lg font-semibold mb-2">Summary</h2>
            {loading && (
              <p className="text-gray-500 text-sm">
                Generating AI feedback based on your answers…
              </p>
            )}
            {!loading && error && (
              <p className="text-sm text-red-600">{error}</p>
            )}
            {!loading && !error && summary && (
              <p className="text-sm text-gray-700 whitespace-pre-wrap">
                {summary}
              </p>
            )}
            {!loading && !error && !summary && (
              <p className="text-sm text-gray-500">
                Evaluation finished, but no detailed summary was returned.
              </p>
            )}
          </div>
        </div>

        {/* Strengths & Improvements */}
        <div className="grid md:grid-cols-2 gap-6 mb-10">
          <div className="bg-white rounded-2xl shadow p-6">
            <h3 className="text-md font-semibold mb-3">Strengths 💪</h3>
            {loading ? (
              <p className="text-sm text-gray-500">Evaluating strengths…</p>
            ) : !error && strengths && strengths.length > 0 ? (
              <ul className="text-sm text-gray-700 list-disc pl-5 space-y-1">
                {strengths.map((s, idx) => (
                  <li key={idx}>{s}</li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-gray-500">
                No specific strengths detected yet.
              </p>
            )}
          </div>

          <div className="bg-white rounded-2xl shadow p-6">
            <h3 className="text-md font-semibold mb-3">Areas to Improve 📌</h3>
            {loading ? (
              <p className="text-sm text-gray-500">
                Analyzing improvement areas…
              </p>
            ) : !error && improvements && improvements.length > 0 ? (
              <ul className="text-sm text-gray-700 list-disc pl-5 space-y-1">
                {improvements.map((s, idx) => (
                  <li key={idx}>{s}</li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-gray-500">
                No specific improvement suggestions returned.
              </p>
            )}
          </div>
        </div>

        {/* Per-question feedback */}
        <div className="bg-white rounded-2xl shadow p-6 mb-10">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-md font-semibold">Per-question Feedback</h3>
            <span className="text-xs text-gray-500">
              Answered: {normalizedAnswers.length} question
              {normalizedAnswers.length === 1 ? "" : "s"}
            </span>
          </div>

          {loading ? (
            <p className="text-sm text-gray-500">Scoring individual answers…</p>
          ) : error ? (
            <p className="text-sm text-red-600">{error}</p>
          ) : normalizedAnswers.length === 0 ? (
            <p className="text-sm text-gray-500">
              No answers available to analyze.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm border-t border-gray-100">
                <thead>
                  <tr className="bg-gray-50 text-left">
                    <th className="py-2 px-3 font-medium text-gray-600">#</th>
                    <th className="py-2 px-3 font-medium text-gray-600">
                      Question
                    </th>
                    <th className="py-2 px-3 font-medium text-gray-600">
                      Your Answer
                    </th>
                    <th className="py-2 px-3 font-medium text-gray-600">
                      Score
                    </th>
                    <th className="py-2 px-3 font-medium text-gray-600">
                      Feedback
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {normalizedAnswers.map((ans, idx) => {
                    const pq =
                      perQuestion.find(
                        (p) =>
                          p.questionId === ans.questionId ||
                          p.id === ans.questionId
                      ) || {};
                    const qScore = pq.score ?? pq.rating ?? null;
                    const qFeedback =
                      pq.feedback || pq.comment || pq.explanation || "";

                    return (
                      <tr
                        key={ans.questionId ?? idx}
                        className={idx % 2 === 0 ? "bg-white" : "bg-gray-50"}
                      >
                        <td className="py-2 px-3 align-top text-gray-500">
                          {idx + 1}
                        </td>
                        <td className="py-2 px-3 align-top text-gray-800 w-1/3">
                          <div className="font-medium mb-1">{ans.question}</div>
                          <div className="text-xs text-gray-500">
                            {ans.topic} · {ans.difficulty}
                          </div>
                        </td>
                        <td className="py-2 px-3 align-top text-gray-700 w-1/3 whitespace-pre-wrap">
                          {ans.answer || (
                            <span className="text-gray-400">No answer</span>
                          )}
                        </td>
                        <td className="py-2 px-3 align-top text-gray-800">
                          {qScore != null ? (
                            <span className="inline-flex items-center px-2 py-1 rounded-full bg-indigo-50 text-indigo-700 text-xs font-semibold">
                              {qScore}/10
                            </span>
                          ) : (
                            <span className="text-xs text-gray-400">—</span>
                          )}
                        </td>
                        <td className="py-2 px-3 align-top text-gray-700 w-1/3 whitespace-pre-wrap">
                          {qFeedback || (
                            <span className="text-xs text-gray-400">
                              No specific feedback for this answer.
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="text-center space-x-4">
          <button
            onClick={() => setShowModal(true)}
            className="bg-gradient-to-r from-indigo-600 to-cyan-400 text-white px-8 py-3 rounded-xl hover:shadow-lg"
          >
            View Recommendations
          </button>
          <button
            onClick={() => setCurrentScreen("home")}
            className="bg-white border border-gray-300 px-8 py-3 rounded-xl text-gray-700 hover:bg-gray-50"
          >
            Back to Home
          </button>
          <button
            onClick={() => setCurrentScreen("interview")}
            className="bg-green-600 text-white px-8 py-3 rounded-xl hover:bg-green-700"
          >
            Practice Again
          </button>
        </div>
      </div>
    </div>
  );
}
