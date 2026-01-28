// src/App.jsx
import React, { useState, useEffect, useCallback } from "react";
import Navbar from "./components/Navbar";
import HomeScreen from "./components/HomeScreen";
import ResumeInterview from "./components/ResumeInterview";
import InterviewScreen from "./components/InterviewScreen";
import ResultsScreen from "./components/ResultsScreen";
import RecommendationsModal from "./components/RecommendationsModal";
import { LoginForm } from "./components/LoginForm";
import { SignupForm } from "./components/SignupForm";
import { generateQuestions } from "./services/api";
import UserDashboard from "./components/UserDashboard"; // ✅ NEW

/**
 * App.jsx - centralized app router + auth + navigation helpers
 *
 * Screens (currentScreen):
 * - "home"
 * - "interview"
 * - "results"
 * - "dashboard"  ✅ NEW
 */

export default function App() {
  // Auth & Navigation States
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authView, setAuthView] = useState("login"); // "login" | "signup"
  const [user, setUser] = useState(null);

  // App flow states
  const [currentScreen, setCurrentScreen] = useState("home"); // "home" | "interview" | "results" | "dashboard"
  const [selectedCategory, setSelectedCategory] = useState(null); // "resume" | "communication" | "scenario" | "technical" | "hr"
  const [showModal, setShowModal] = useState(false);

  // Store generated questions (lifted from ResumeInterview or generated here)
  const [initialQuestions, setInitialQuestions] = useState([]);
  // Store optional meta provided when starting interview (job role, experience, prevWork)
  const [initialMeta, setInitialMeta] = useState(null);
  // Loading state for question generation
  const [generatingQuestions, setGeneratingQuestions] = useState(false);

  // Answer & evaluation related state
  const [answers, setAnswers] = useState([]); // [{ questionId, question, topic, difficulty, answer }]
  const [fullTranscript, setFullTranscript] = useState(""); // combined transcript text (optional)

  // Non-verbal metrics from OpenCV backend (FaceMesh)
  // Shape: { confidence, eye_contact, smile_intensity, focus_score, emotion }
  const [nonVerbalMetrics, setNonVerbalMetrics] = useState(null);

  // Restore auth from localStorage (if present)
  useEffect(() => {
    const token = localStorage.getItem("token");
    const userData = localStorage.getItem("user");
    if (token && userData) {
      setIsAuthenticated(true);
      try {
        setUser(JSON.parse(userData));
      } catch {
        setUser(null);
      }
    }
  }, []);

  // Central entrypoint to start an interview.
  // `meta` is an object: { jobRole, yearsExperience, prevWork }
  const handleStartInterview = useCallback(
    async (category, meta = null) => {
      if (!category) return;

      // reset previous state
      setInitialQuestions([]);
      setInitialMeta(null);
      setSelectedCategory(category);
      setAnswers([]);
      setFullTranscript("");
      setNonVerbalMetrics(null);

      // if meta provided, store it so InterviewScreen and backend can use
      if (meta && typeof meta === "object") {
        setInitialMeta(meta);
      }

      // Resume flow -> keep existing behavior: land on ResumeInterview UI
      if (category === "resume") {
        setCurrentScreen("interview");
        return;
      }

      // For other categories (scenario, communication, technical, hr) generate first
      setGeneratingQuestions(true);
      setCurrentScreen("interview"); // show interview screen early (InterviewScreen may show spinner)
      try {
        const generated = await generateQuestions(category, "", meta || {});

        let qs = [];

        if (Array.isArray(generated) && generated.length > 0) {
          qs = generated;
        } else if (generated && Array.isArray(generated.questions) && generated.questions.length > 0) {
          qs = generated.questions;
        } else if (generated && generated.ok === true && Array.isArray(generated.questions)) {
          qs = generated.questions;
        } else {
          // fallback default minimal set (safe)
          qs = [
            { id: 1, question: "Tell me about yourself." },
            { id: 2, question: "Describe a recent project you worked on." },
            { id: 3, question: "How do you approach problem solving?" },
            { id: 4, question: "How do you handle tight deadlines?" },
            { id: 5, question: "How do you collaborate with others?" },
          ];
        }

        // ensure id keys exist and are sequential
        const normalized = qs.map((q, i) => ({
          id: q.id ?? i + 1,
          question: q.question ?? q.text ?? String(q),
          topic: q.topic ?? q.category ?? "General",
        }));

        setInitialQuestions(normalized);
      } catch (err) {
        console.error("generateQuestions error in App:", err);
        setInitialQuestions([{ id: 1, question: "Tell me about yourself." }]);
      } finally {
        setGeneratingQuestions(false);
      }

      setCurrentScreen("interview");
    },
    []
  );

  // Called when one answer is submitted in InterviewScreen
  const handleAnswerSubmit = useCallback((answerPayload) => {
    if (!answerPayload || typeof answerPayload !== "object") return;

    setAnswers((prev) => {
      const idx = prev.findIndex((a) => a.questionId === answerPayload.questionId);
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = answerPayload;
        return copy;
      }
      return [...prev, answerPayload];
    });
  }, []);

  // Called when interview is finished in InterviewScreen
const handleInterviewComplete = useCallback(
  (payload) => {
    if (!payload) return;

    const {
      answers: finalAnswers,
      transcript,
      nonVerbalMetrics,
      meta,
      category,
    } = payload;

    if (Array.isArray(finalAnswers)) {
      setAnswers(finalAnswers);
    }

    if (typeof transcript === "string") {
      setFullTranscript(transcript);
    }

    if (nonVerbalMetrics) {
      setNonVerbalMetrics(nonVerbalMetrics);
    }

    if (meta) {
      setInitialMeta(meta);
    }

    if (category) {
      setSelectedCategory(category);
    }

    setCurrentScreen("results");
  },
  []
);


  // Logout: clear tokens + reset navigation
  const handleLogout = useCallback(() => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    setIsAuthenticated(false);
    setUser(null);
    setCurrentScreen("home");
    setSelectedCategory(null);
    setShowModal(false);
    setInitialQuestions([]);
    setInitialMeta(null);
    setAnswers([]);
    setFullTranscript("");
    setNonVerbalMetrics(null);
  }, []);

  // Called after a successful login (persist token/user)
  const handleLoginSuccess = useCallback((data) => {
    if (!data) return;
    if (data.token) localStorage.setItem("token", data.token);
    if (data.user) {
      localStorage.setItem("user", JSON.stringify(data.user));
      setUser(data.user);
    }
    setIsAuthenticated(true);
    setAuthView("login");
    setCurrentScreen("home");
  }, []);

  // Called after successful signup (optionally auto-login)
  const handleSignupSuccess = useCallback(
    (data) => {
      if (data?.token && data?.user) {
        handleLoginSuccess(data);
      } else {
        setAuthView("login");
      }
    },
    [handleLoginSuccess]
  );

  // If the user isn't authenticated show login/signup
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <h1 className="text-4xl text-indigo-600 mb-2 font-bold">evalue</h1>
            <p className="text-gray-600">Be interview ready with evalue</p>
          </div>

          <div className="bg-white rounded-2xl shadow-xl p-8">
            <div className="flex gap-2 mb-6 p-1 bg-gray-100 rounded-lg">
              <button
                onClick={() => setAuthView("login")}
                className={`flex-1 py-2 rounded-md transition-all ${
                  authView === "login"
                    ? "bg-white text-indigo-600 shadow-sm"
                    : "text-gray-600 hover:text-gray-900"
                }`}
              >
                Login
              </button>
              <button
                onClick={() => setAuthView("signup")}
                className={`flex-1 py-2 rounded-md transition-all ${
                  authView === "signup"
                    ? "bg-white text-indigo-600 shadow-sm"
                    : "text-gray-600 hover:text-gray-900"
                }`}
              >
                Sign Up
              </button>
            </div>

            {authView === "login" ? (
              <LoginForm onLoginSuccess={handleLoginSuccess} />
            ) : (
              <SignupForm onSignupSuccess={handleSignupSuccess} />
            )}
          </div>

          <p className="text-center mt-6 text-gray-600">
            {authView === "login" ? "Don't have an account? " : "Already have an account? "}
            <button
              onClick={() => setAuthView(authView === "login" ? "signup" : "login")}
              className="text-indigo-600 hover:text-indigo-700 underline"
            >
              {authView === "login" ? "Sign up" : "Login"}
            </button>
          </p>
        </div>
      </div>
    );
  }

  // Main application UI (post-login)
  return (
    <div className="bg-gray-50 min-h-screen font-inter">
      <Navbar
        currentScreen={currentScreen}
        setCurrentScreen={(screen) => {
          setCurrentScreen(screen);
          // When going back home, reset flow state
          if (screen === "home") {
            setSelectedCategory(null);
            setInitialQuestions([]);
            setInitialMeta(null);
            setAnswers([]);
            setFullTranscript("");
            setNonVerbalMetrics(null);
          }
        }}
        user={user}
        onLogout={handleLogout}
        // you can still pass handleStartInterview if you add quick-start buttons in Navbar later
        onStartInterview={handleStartInterview}
      />

      {/* HOME */}
      {currentScreen === "home" && (
        <HomeScreen
          onStartInterview={handleStartInterview}
          setCurrentScreen={setCurrentScreen}
          setSelectedCategory={setSelectedCategory}
        />
      )}

      {/* DASHBOARD ✅ */}
      {currentScreen === "dashboard" && (
        <UserDashboard
          user={user}
          // later replace with real interview history from backend
          interviews={[]}
        />
      )}

      {/* INTERVIEWS */}
      {currentScreen === "interview" && selectedCategory === "scenario" && (
        <InterviewScreen
          setCurrentScreen={setCurrentScreen}
          selectedCategory={selectedCategory}
          initialQuestions={initialQuestions}
          initialMeta={initialMeta}
          setInitialQuestions={setInitialQuestions}
          generatingQuestions={generatingQuestions}
          onAnswerSubmit={handleAnswerSubmit}
          onInterviewComplete={handleInterviewComplete}
          onNonVerbalUpdate={setNonVerbalMetrics}
        />
      )}

      {currentScreen === "interview" && selectedCategory === "communication" && (
        <InterviewScreen
          setCurrentScreen={setCurrentScreen}
          selectedCategory={selectedCategory}
          initialQuestions={initialQuestions}
          initialMeta={initialMeta}
          setInitialQuestions={setInitialQuestions}
          generatingQuestions={generatingQuestions}
          onAnswerSubmit={handleAnswerSubmit}
          onInterviewComplete={handleInterviewComplete}
          onNonVerbalUpdate={setNonVerbalMetrics}
        />
      )}

      {currentScreen === "interview" && selectedCategory === "technical" && (
        <InterviewScreen
          setCurrentScreen={setCurrentScreen}
          selectedCategory={selectedCategory}
          initialQuestions={initialQuestions}
          initialMeta={initialMeta}
          setInitialQuestions={setInitialQuestions}
          generatingQuestions={generatingQuestions}
          onAnswerSubmit={handleAnswerSubmit}
          onInterviewComplete={handleInterviewComplete}
          onNonVerbalUpdate={setNonVerbalMetrics}
        />
      )}

      {currentScreen === "interview" && selectedCategory === "hr" && (
        <InterviewScreen
          setCurrentScreen={setCurrentScreen}
          selectedCategory={selectedCategory}
          initialQuestions={initialQuestions}
          initialMeta={initialMeta}
          setInitialQuestions={setInitialQuestions}
          generatingQuestions={generatingQuestions}
          onAnswerSubmit={handleAnswerSubmit}
          onInterviewComplete={handleInterviewComplete}
          onNonVerbalUpdate={setNonVerbalMetrics}
        />
      )}

      {currentScreen === "interview" && selectedCategory === "resume" && (
        initialQuestions && initialQuestions.length > 0 ? (
          <InterviewScreen
            setCurrentScreen={setCurrentScreen}
            selectedCategory={selectedCategory}
            initialQuestions={initialQuestions}
            initialMeta={initialMeta}
            setInitialQuestions={setInitialQuestions}
            onAnswerSubmit={handleAnswerSubmit}
            onInterviewComplete={handleInterviewComplete}
            onNonVerbalUpdate={setNonVerbalMetrics}
          />
        ) : (
          <ResumeInterview
            setCurrentScreen={setCurrentScreen}
            selectedCategory={selectedCategory}
            setShowModal={setShowModal}
            setInitialQuestions={setInitialQuestions}
            startResumeInterview={(qs) => {
              setInitialQuestions(qs);
              setAnswers([]);
              setFullTranscript("");
              setNonVerbalMetrics(null);
              setCurrentScreen("interview");
            }}
          />
        )
      )}

      {/* RESULTS */}
      {currentScreen === "results" && (
        <ResultsScreen
          setCurrentScreen={setCurrentScreen}
          setShowModal={setShowModal}
          selectedCategory={selectedCategory}
          questions={initialQuestions}
          answers={answers}
          fullTranscript={fullTranscript}
          initialMeta={initialMeta}
          nonVerbalMetrics={nonVerbalMetrics}
        />
      )}

      {/* RECOMMENDATIONS MODAL */}
      {showModal && (
        <RecommendationsModal
          onClose={() => setShowModal(false)}
          user={user}
        />
      )}
    </div>
  );
}
