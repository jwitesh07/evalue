// src/components/ResumeUpload.jsx
import React, { useState } from "react";
import { uploadResume } from "../services/api";

export default function ResumeUpload({ onUploaded }) {
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState(null); // short preview

  const handleFile = (e) => {
    setFile(e.target.files[0]);
    setError("");
  };

  const handleUpload = async () => {
    if (!file) {
      setError("Please select a file first.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await uploadResume(file);
      if (res?.ok) {
        // res.resume_text, res.skills, res.projects
        setPreview(res.resume_text?.slice(0, 200) || "");
        onUploaded({
          resumeText: res.resume_text || "",
          skills: res.skills || [],
          projects: res.projects || [],
        });
      } else {
        setError(res.error || "Upload failed");
      }
    } catch (err) {
      setError(err.message || "Upload error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4 bg-white rounded shadow">
      <h3 className="font-semibold mb-2">Upload Resume (PDF / DOCX / TXT)</h3>
      <input type="file" accept=".pdf,.docx,.txt" onChange={handleFile} />
      <div className="mt-3 flex gap-2">
        <button
          onClick={handleUpload}
          disabled={loading}
          className="bg-indigo-600 text-white px-3 py-1 rounded"
        >
          {loading ? "Uploading..." : "Upload & Extract"}
        </button>
      </div>

      {error && <div className="text-sm text-red-500 mt-2">{error}</div>}

      {preview && (
        <div className="mt-3 text-sm text-gray-700">
          <strong>Resume preview:</strong>
          <div className="mt-1 whitespace-pre-wrap bg-gray-50 p-2 rounded text-xs">{preview}...</div>
        </div>
      )}
    </div>
  );
}
