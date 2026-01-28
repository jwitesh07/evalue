// src/components/ResumeInterview.jsx
import React, { useRef, useState } from "react";
import { uploadResume, generateQuestions } from "../services/api";

/**
 * ResumeInterview.jsx (UPDATED FOR NEW APP FLOW)
 *
 * Props:
 * - setCurrentScreen(fn) → navigation back to App.jsx
 * - setSelectedCategory(fn)
 * - setInitialQuestions(fn) → send generated questions to App.jsx
 */

export default function ResumeInterview({
  setCurrentScreen,
  setSelectedCategory,
  setInitialQuestions,
  setShowModal,
}) {
  const fileRef = useRef(null);
  const [fileName, setFileName] = useState("");
  const [resumeText, setResumeText] = useState("");
  const [skills, setSkills] = useState([]);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [questions, setQuestions] = useState([]);

  const onFileChange = (e) => {
    setError("");
    const f = e.target.files?.[0];
    if (f) setFileName(f.name);
    else setFileName("");
  };

  const handleUpload = async () => {
    setError("");
    if (!fileRef.current?.files?.[0]) {
      setError("Please choose a resume file first.");
      return;
    }

    setLoading(true);
    try {
      const file = fileRef.current.files[0];
      const res = await uploadResume(file);
      console.log("uploadResume response:", res);

      if (!res || res.ok === false) {
        throw new Error(res?.error || "Resume upload failed.");
      }

      const text = res.resume_text || res.text || "";
      const s = res.skills || [];
      const p = res.projects || [];

      setResumeText(text);
      setSkills(Array.isArray(s) ? s : [s]);
      setProjects(Array.isArray(p) ? p : [p]);
    } catch (err) {
      console.error("Upload error:", err);
      setError(err.message);
      setResumeText("");
      setSkills([]);
      setProjects([]);
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateQuestions = async () => {
    setError("");

    if (!resumeText || resumeText.trim().length < 5) {
      setError("Upload and extract resume text first.");
      return;
    }

    setGenerating(true);
    try {
      const arr = await generateQuestions("resume", resumeText);
      console.log("generateQuestions result:", arr);

      let qList = arr?.questions || arr;

      if (!Array.isArray(qList) || qList.length === 0) {
        throw new Error("Empty question list from AI generator.");
      }

      const normalized = qList.map((q, i) => ({
        id: i + 1,
        question: typeof q === "string" ? q : q.question,
        topic: q.topic || q.category || "Resume",
      }));

      setQuestions(normalized);
    } catch (err) {
      console.error("Generate questions error:", err);
      setError(err.message || "Failed to generate questions.");
      setQuestions([]);
    } finally {
      setGenerating(false);
    }
  };

  const handleStartInterview = () => {
    if (!questions.length) {
      setError("Generate questions first.");
      return;
    }

    // Pass questions up to App.jsx
    if (typeof setInitialQuestions === "function") {
      setInitialQuestions(questions);
    }

    // Ensure App knows we're doing resume interview
    if (typeof setSelectedCategory === "function") {
      setSelectedCategory("resume");
    }

    // Navigate to InterviewScreen (App decides based on initialQuestions)
    setCurrentScreen("interview");
  };

  return (
    <div className="max-w-4xl mx-auto p-6">
      <h2 className="text-3xl font-semibold mb-6">Resume Interview</h2>

      {/* Upload section */}
      <div className="mb-6">
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.docx,.txt"
          onChange={onFileChange}
          className="mb-3"
        />

        <div className="flex flex-wrap gap-3">
          <button
            onClick={handleUpload}
            disabled={loading}
            className="bg-indigo-600 text-white px-4 py-2 rounded shadow"
          >
            {loading ? "Uploading..." : "Upload & Extract"}
          </button>

          <button
            onClick={handleGenerateQuestions}
            disabled={generating || !resumeText}
            className="bg-green-600 text-white px-4 py-2 rounded shadow"
          >
            {generating ? "Generating..." : "Generate Resume Questions"}
          </button>

          <button
            onClick={() => {
              setFileName("");
              setResumeText("");
              setSkills([]);
              setProjects([]);
              setQuestions([]);
              setError("");
              if (fileRef.current) fileRef.current.value = "";
            }}
            className="bg-gray-200 px-4 py-2 rounded"
          >
            Reset
          </button>
        </div>

        {error && <div className="text-red-600 mt-3">{error}</div>}
      </div>

      {/* Preview Section */}
      <div className="mb-6">
        <h3 className="font-semibold mb-2">Resume Preview:</h3>
        <div className="bg-gray-50 p-4 rounded h-40 overflow-auto text-sm whitespace-pre-wrap">
          {resumeText || "No extracted text yet."}
        </div>
      </div>

      {/* Skills & Projects */}
      <div className="grid grid-cols-2 gap-6 mb-6">
        <div>
          <h4 className="font-semibold mb-2">Skills</h4>
          <ul className="list-disc ml-5">
            {skills.length ? skills.map((s, i) => <li key={i}>{s}</li>) : <li>None detected</li>}
          </ul>
        </div>

        <div>
          <h4 className="font-semibold mb-2">Projects</h4>
          <ul className="list-disc ml-5">
            {projects.length ? projects.map((p, i) => <li key={i}>{p}</li>) : <li>None detected</li>}
          </ul>
        </div>
      </div>

      {/* Questions */}
      <div className="mb-6">
        <h3 className="font-semibold mb-2">AI Generated Questions</h3>
        <div className="bg-white p-4 rounded shadow max-h-64 overflow-auto">
          {questions.length ? (
            <ol className="list-decimal ml-5">
              {questions.map((q) => (
                <li key={q.id} className="mb-3">
                  <div className="font-medium">{q.question}</div>
                  <div className="text-xs text-gray-500">{q.topic}</div>
                </li>
              ))}
            </ol>
          ) : (
            <div className="text-sm text-gray-600">No questions generated yet.</div>
          )}
        </div>
      </div>

      {/* Start Interview */}
      <div className="flex gap-3">
        <button
          onClick={handleStartInterview}
          disabled={!questions.length}
          className="bg-indigo-600 text-white px-6 py-3 rounded shadow"
        >
          Start Resume Interview
        </button>

        <button
          onClick={() => setCurrentScreen("home")}
          className="bg-gray-200 px-4 py-2 rounded"
        >
          Back
        </button>
      </div>
    </div>
  );
}
