// src/components/HomeScreen.jsx
import React, { useState } from "react";

export default function HomeScreen({ onStartInterview }) {
  const [selected, setSelected] = useState(null);

  // additional metadata for technical / hr categories
  const [jobRole, setJobRole] = useState("");
  const [yearsExperience, setYearsExperience] = useState("");
  const [prevWork, setPrevWork] = useState("");

  const handleStart = () => {
    if (!selected) {
      alert("Please select a category before starting!");
      return;
    }

    // if technical or hr, require jobRole & yearsExperience (and optionally prevWork)
    if (selected === "technical" || selected === "hr") {
      if (!jobRole.trim()) {
        alert("Please enter the Job Role you are applying for.");
        return;
      }
      if (!yearsExperience) {
        alert("Please select your years of experience.");
        return;
      }
      if (!prevWork.trim()) {
        const ok = window.confirm(
          "You haven't added previous work details. Continue without it?"
        );
        if (!ok) return;
      }
    }

    // Pass additional metadata as second arg (backwards compatible)
    const meta = {
      jobRole: jobRole.trim(),
      yearsExperience,
      prevWork: prevWork.trim(),
    };

    try {
      // call App's handler; many implementations accept only (category)
      // passing meta is optional and will be ignored by older handlers.
      onStartInterview(selected, meta);
    } catch (e) {
      // fallback: try single-arg call for safety
      try {
        onStartInterview(selected);
      } catch (err) {
        console.error("onStartInterview failed:", err);
      }
    }
  };

  const categories = [
    {
      id: "scenario",
      title: "Scenario-Based Questions",
      desc: "Practice real-life behavioral and problem-solving questions.",
      icon: "💼",
    },
    {
      id: "communication",
      title: "Communication-Based Questions",
      desc: "Enhance clarity, confidence, and soft skills in communication.",
      icon: "💬",
    },
    {
      id: "resume",
      title: "Resume-Based Questions",
      desc: "Upload your resume to get personalized interview questions.",
      icon: "📄",
    },
    {
      id: "technical",
      title: "Technical Interview",
      desc: "Get in-depth technical questions based on job role & experience.",
      icon: "🧠",
    },
    {
      id: "hr",
      title: "HR Interview",
      desc: "Prepare for HR rounds focusing on culture fit & personality.",
      icon: "🧑‍💼",
    },
  ];

  const features = [
    {
      title: "Real-time Feedback",
      desc: "Get instant AI-powered insights on your performance.",
      icon: (
        <svg
          className="w-8 h-8 text-indigo-500"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      ),
    },
    {
      title: "Performance Analytics",
      desc: "Track your progress with detailed metrics and trends.",
      icon: (
        <svg
          className="w-8 h-8 text-indigo-500"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M11 17V9m4 8V5m-8 8v4m-2 2h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v14a2 2 0 002 2z"
          />
        </svg>
      ),
    },
    {
      title: "Custom Questions",
      desc: "Practice with industry-specific and role-based questions.",
      icon: (
        <svg
          className="w-8 h-8 text-indigo-500"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M8 7h8m-8 4h8m-8 4h8M5 7h.01M5 11h.01M5 15h.01M3 5h18v14H3z"
          />
        </svg>
      ),
    },
  ];

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center text-center pt-20 px-6">
      {/* HERO */}
      <div className="max-w-4xl mb-12">
        <h1 className="text-5xl md:text-6xl font-extrabold text-gray-900 mb-6">
          Be Interview Ready with{" "}
          <span className="bg-gradient-to-r from-indigo-600 to-cyan-500 bg-clip-text text-transparent">
            Evalue
          </span>
        </h1>
        <p className="text-gray-600 text-lg md:text-xl mb-10 leading-relaxed">
          Master your interview skills with AI-powered feedback. Practice with
          confidence, improve your performance, and land your dream job.
        </p>
      </div>

      {/* CATEGORY SELECTION */}
      <div className="max-w-5xl w-full mb-6">
        <h2 className="text-2xl font-semibold text-gray-800 mb-8">
          Choose Your Interview Category
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-8 justify-center items-center place-items-center">
          {categories.map((cat) => (
            <div
              key={cat.id}
              onClick={() => setSelected(cat.id)}
              className={`cursor-pointer bg-white rounded-2xl shadow-md hover:shadow-2xl transition-all p-6 border-2 w-full max-w-xs ${
                selected === cat.id
                  ? "border-indigo-500 ring-4 ring-indigo-200"
                  : "border-transparent"
              }`}
            >
              <div className="text-5xl mb-4">{cat.icon}</div>
              <h3 className="text-lg font-semibold text-gray-800 mb-2">
                {cat.title}
              </h3>
              <p className="text-gray-600 text-sm">{cat.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Conditional metadata inputs for technical & hr */}
      {(selected === "technical" || selected === "hr") && (
        <div className="max-w-3xl w-full bg-white rounded-2xl shadow p-6 mb-8">
          <h3 className="text-xl font-semibold mb-4">Tell us about your role & experience</h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Job role you're applying for
              </label>
              <input
                type="text"
                value={jobRole}
                onChange={(e) => setJobRole(e.target.value)}
                placeholder="e.g., Backend Engineer, Data Scientist"
                className="w-full border rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-200"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Years of experience
              </label>
              <select
                value={yearsExperience}
                onChange={(e) => setYearsExperience(e.target.value)}
                className="w-full border rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-200"
              >
                <option value="">Select years</option>
                <option value="0">0 - Internship / Fresher</option>
                <option value="1">1</option>
                <option value="2">2</option>
                <option value="3">3</option>
                <option value="4">4</option>
                <option value="5">5</option>
                <option value="6-9">6 - 9</option>
                <option value="10+">10+</option>
              </select>
            </div>
          </div>

          <div className="mt-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Short summary of previous work (optional but helpful)
            </label>
            <textarea
              rows={4}
              value={prevWork}
              onChange={(e) => setPrevWork(e.target.value)}
              placeholder="Briefly describe your past role, responsibilities or notable projects (max 300 chars)"
              maxLength={1000}
              className="w-full border rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-200"
            />
            <div className="text-xs text-gray-500 mt-1">
              {prevWork.length}/1000
            </div>
          </div>
        </div>
      )}

      {/* START BUTTON */}
      <button
        onClick={handleStart}
        className="bg-gradient-to-r from-indigo-600 to-cyan-500 text-white px-10 py-3 rounded-xl font-semibold text-lg shadow-lg hover:shadow-2xl transition-transform transform hover:scale-105 duration-300 mb-20"
      >
        Start Interview
      </button>

      {/* FEATURES */}
      <div className="grid md:grid-cols-3 gap-8 max-w-5xl w-full mb-20">
        {features.map((item, i) => (
          <div
            key={i}
            className="bg-white rounded-2xl shadow-md p-8 text-left hover:shadow-xl transition-all"
          >
            <div className="mb-4 flex items-center justify-center">{item.icon}</div>
            <h3 className="text-gray-900 font-semibold text-lg mb-2 text-center">
              {item.title}
            </h3>
            <p className="text-gray-600 text-sm text-center">{item.desc}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
