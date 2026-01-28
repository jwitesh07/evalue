// src/services/api.js
// Robust client helpers for Evalue frontend with automatic token refresh.

// -----------------------------------------------------
// 🌐 Backend URLs (adjust if needed)
// -----------------------------------------------------
const NODE_API = "http://127.0.0.1:8002/api/v1/user_admins";
const BASE_URL = "http://127.0.0.1:8000/api";
const AI_URL = "http://127.0.0.1:8001/api";

/* ===========================
   Low-level helpers
   =========================== */

async function safeJson(res) {
  try {
    return await res.json();
  } catch (err) {
    try {
      const txt = await res.text();
      return { ok: false, error: "Invalid JSON response", rawText: txt };
    } catch (e) {
      return { ok: false, error: "Invalid JSON response and text parse failed" };
    }
  }
}

function blobExtensionFromType(blob) {
  if (!blob || !blob.type) return "webm";
  const t = blob.type.toLowerCase();
  if (t.includes("webm")) return "webm";
  if (t.includes("mp4") || t.includes("mp4;")) return "mp4";
  if (t.includes("wav")) return "wav";
  if (t.includes("ogg")) return "ogg";
  if (t.includes("mpeg") || t.includes("mp3")) return "mp3";
  return "webm";
}

/* ===========================
   token storage helpers
   =========================== */

function _readStorage() {
  try {
    if (typeof window === "undefined") return {};
    const token = localStorage.getItem("token");
    const refreshToken = localStorage.getItem("refreshToken");
    const user = localStorage.getItem("user");
    return { token, refreshToken, user: user ? JSON.parse(user) : null };
  } catch (e) {
    return {};
  }
}

function _saveTokens({ token, refreshToken, user }) {
  try {
    if (typeof window === "undefined") return;
    if (token) localStorage.setItem("token", token);
    if (refreshToken) localStorage.setItem("refreshToken", refreshToken);
    if (user) localStorage.setItem("user", JSON.stringify(user));
  } catch (e) {
    // ignore localstorage errors
  }
}

function _clearAuth() {
  try {
    if (typeof window === "undefined") return;
    localStorage.removeItem("token");
    localStorage.removeItem("refreshToken");
    localStorage.removeItem("user");
  } catch (e) {}
}

/* ===========================
   Auth header builder
   =========================== */
function getAuthHeaders(extra = {}) {
  const headers = { ...extra };
  const { token } = _readStorage();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

/* ===========================
   Refresh token flow
   =========================== */

/**
 * Attempt to refresh access token using stored refreshToken.
 * On success updates localStorage and returns { ok: true, token, refreshToken, user }
 * On fail returns { ok: false, status, ... } (the backend response)
 */
export async function refreshAccessToken() {
  try {
    const { refreshToken } = _readStorage();
    if (!refreshToken) {
      return { ok: false, error: "no_refresh_token" };
    }

    const res = await fetch(`${NODE_API}/refresh-token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });

    const data = await safeJson(res);
    if (!res.ok) {
      // clear stored auth if refresh fails (to avoid infinite loops)
      _clearAuth();
      return { ok: false, status: res.status, ...data };
    }

    const token = data.token ?? data.accessToken ?? null;
    const newRefreshToken = data.refreshToken ?? data.refresh_token ?? null;
    const user = data.data?.user ?? data.user ?? null;

    if (token) _saveTokens({ token, refreshToken: newRefreshToken, user });

    return { ok: true, token, refreshToken: newRefreshToken, user };
  } catch (err) {
    return { ok: false, error: err?.message ?? String(err) };
  }
}

/* ===========================
   Auth-aware fetch wrapper
   - will try once to refresh token on 401/token_expired
   - returns same shape as safeJson wrappers (adds ok flag where appropriate)
   =========================== */
// replace your existing authFetch(...) with this function
async function authFetch(url, opts = {}, { retryOnExpired = true } = {}) {
  opts.headers = opts.headers || {};
  const headers = { ...opts.headers, ...getAuthHeaders({}) };
  opts.headers = headers;

  let res;
  try {
    res = await fetch(url, opts);
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }

  // If request succeeded
  if (res.ok) {
    const data = await safeJson(res);
    return { ok: true, status: res.status, ...data };
  }

  // Parse body if possible (safeJson returns {ok:false, error:...} on invalid JSON)
  const body = await safeJson(res);

  // Try refresh on any 401 (server might not send a JSON body)
  if (res.status === 401 && retryOnExpired) {
    const refreshed = await refreshAccessToken();
    if (refreshed?.ok) {
      // retry original request once with new token
      const newHeaders = { ...opts.headers, Authorization: `Bearer ${refreshed.token}` };
      opts.headers = newHeaders;
      try {
        const res2 = await fetch(url, opts);
        const data2 = await safeJson(res2);
        if (!res2.ok) return { ok: false, status: res2.status, ...data2 };
        return { ok: true, status: res2.status, ...data2 };
      } catch (err2) {
        return { ok: false, error: err2?.message || String(err2) };
      }
    } else {
      // refresh failed -> clear auth and return original 401 body (if any)
      _clearAuth();
      return { ok: false, status: res.status, ...body };
    }
  }

  // not 401 or retry disabled
  return { ok: false, status: res.status, ...body };
}


/* ===========================
   AUTH API: register / login / logout
   - these store tokens in localStorage
   =========================== */

export async function registerUser({ name, email, password }) {
  try {
    const res = await fetch(`${NODE_API}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password }),
    });

    const data = await safeJson(res);
    if (!res.ok) return { ok: false, status: res.status, ...data };

    // save tokens if returned
    const token = data.token ?? data.accessToken ?? null;
    const refreshToken = data.refreshToken ?? data.refresh_token ?? null;
    const user = (data.data && data.data.user) || data.user || null;
    if (token) _saveTokens({ token, refreshToken, user });

    return { ok: true, status: res.status, ...data };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}

export async function loginUser({ email, password }) {
  try {
    const res = await fetch(`${NODE_API}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    const data = await safeJson(res);
    if (!res.ok) return { ok: false, status: res.status, ...data };

    // save tokens & user
    const token = data.token ?? data.accessToken ?? null;
    const refreshToken = data.refreshToken ?? data.refresh_token ?? null;
    const user = (data.data && data.data.user) || data.user || null;
    if (token) _saveTokens({ token, refreshToken, user });

    return { ok: true, status: res.status, ...data };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}

export function logoutUser() {
  // clear locally; also call backend logout optionally
  _clearAuth();
}

/* ===========================
   USER PROFILE + DASHBOARD (Node backend)
   Use authFetch() so refresh tokens are handled automatically
   =========================== */

export async function getCurrentUser() {
  try {
    const url = `${NODE_API}/me`;
    const r = await authFetch(url, { method: "GET", headers: { "Content-Type": "application/json" } });
    if (!r.ok) return r;
    // ensure consistent shape
    return { ok: true, status: r.status, data: r.user ?? r.data ?? r };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}

// Save interview result — endpoint: POST /me/interviews
export async function saveInterviewResult(interviewPayload) {
  try {
    const url = `${NODE_API}/me/interviews`;
    const r = await authFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(interviewPayload || {}),
    });

    if (!r.ok) {
      console.error("❌ saveInterviewResult failed:", r);
      return r;
    }

    return { ok: true, status: r.status, ...r };
  } catch (err) {
    console.error("saveInterviewResult exception:", err);
    return { ok: false, error: err?.message || String(err) };
  }
}

// Dashboard: get user's interviews (GET /me/interviews)
export async function getDashboardData() {
  try {
    const url = `${NODE_API}/me/interviews`;
    const r = await authFetch(url, { method: "GET", headers: { "Content-Type": "application/json" } });
    if (!r.ok) return r;
    // backend returns { status: "success", count, interviews } usually
    return { ok: true, status: r.status, data: r };
  } catch (err) {
    console.error("getDashboardData exception:", err);
    return { ok: false, error: err?.message || String(err) };
  }
}

/* ===========================
   FastAPI session / frames / audio & AI service helpers
   (these are public: not authenticated against Node; unchanged)
   =========================== */

export async function startSession(category = "general") {
  try {
    const fd = new FormData();
    fd.append("category", category);
    const res = await fetch(`${BASE_URL}/session/start`, { method: "POST", body: fd });
    const data = await safeJson(res);
    if (!res.ok) return { ok: false, status: res.status, ...data };
    const sessionId = data.sessionId ?? data.session_id ?? data.id ?? null;
    return { ok: true, sessionId, ...data };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}

export async function uploadFrame(sessionId, blob) {
  if (!sessionId) return { ok: false, error: "Missing sessionId" };
  try {
    const fd = new FormData();
    fd.append("file", blob, "frame.jpg");
    const res = await fetch(`${BASE_URL}/session/${sessionId}/frame`, { method: "POST", body: fd });
    const data = await safeJson(res);
    if (!res.ok) return { ok: false, status: res.status, ...data };
    return { ok: true, ...data };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}

export async function transcribeAudio(sessionId, audioBlob) {
  if (!sessionId) return { ok: false, error: "Missing sessionId" };
  if (!audioBlob) return { ok: false, error: "No audio blob provided" };
  try {
    const ext = blobExtensionFromType(audioBlob);
    const filename = `chunk.${ext}`;
    const fd = new FormData();
    fd.append("file", audioBlob, filename);
    fd.append("session_id", sessionId);

    const doFetch = async () => {
      const res = await fetch(`${BASE_URL}/session/${sessionId}/audio`, { method: "POST", body: fd });
      const data = await safeJson(res);
      if (!res.ok) return { ok: false, status: res.status, ...data };
      return { ok: true, ...data };
    };

    return await doFetch();
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}

/* AI helpers (unchanged, but keep consistent returns) */
export async function generateQuestions(category = "general", resumeText = "", opts = {}) {
  try {
    const payload = {
      category,
      resume_text: resumeText || "",
      ...(opts.jobRole ? { job_role: opts.jobRole } : {}),
      ...(typeof opts.yearsExperience !== "undefined" ? { years_experience: opts.yearsExperience } : {}),
      ...(opts.prevWork ? { prev_work: opts.prevWork } : {}),
      ...(opts.jobRole ? { jobRole: opts.jobRole } : {}),
      ...(typeof opts.yearsExperience !== "undefined" ? { yearsExperience: opts.yearsExperience } : {}),
      ...(opts.prevWork ? { prevWork: opts.prevWork } : {}),
    };

    const res = await fetch(`${AI_URL}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error("❌ generateQuestions failed:", res.status, text || "(no body)");
      return [];
    }

    const data = await safeJson(res);

    // normalization like before (return array)
    let rawQuestions = [];
    if (Array.isArray(data)) rawQuestions = data;
    else if (Array.isArray(data.questions)) rawQuestions = data.questions;
    else if (data?.data && Array.isArray(data.data.questions)) rawQuestions = data.data.questions;
    else {
      const textish = (data.text || data.output || data.raw || data.result || data.answer || "").toString();
      if (textish) {
        rawQuestions = textish
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean)
          .slice(0, 15)
          .map((l, i) => ({ id: i + 1, question: l }));
      }
    }

    const normalized = (rawQuestions || []).slice(0, 15).map((q, i) => {
      if (typeof q === "string") return { id: i + 1, question: q, topic: category, difficulty: "Intermediate" };
      const id = q.id ?? q._id ?? i + 1;
      const question = (q.question || q.text || q.q || q.prompt || "").toString().trim() || String(q).slice(0, 500);
      const topic = q.topic || q.category || category;
      const difficulty = q.difficulty || q.level || "Intermediate";
      return { id: Number(id) || i + 1, question, topic, difficulty };
    });

    if (!normalized || normalized.length === 0) {
      return [
        { id: 1, question: "Tell me about yourself.", topic: category, difficulty: "Intermediate" },
        { id: 2, question: "Walk me through a recent project.", topic: category, difficulty: "Intermediate" },
        { id: 3, question: "How do you handle tight deadlines?", topic: category, difficulty: "Intermediate" },
      ];
    }
    return normalized;
  } catch (err) {
    console.error("generateQuestions exception:", err);
    return [{ id: 1, question: "Tell me about yourself.", topic: category, difficulty: "Intermediate" }];
  }
}

export async function evaluateAnswers(payload) {
  try {
    const res = await fetch(`${AI_URL}/evaluate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await safeJson(res);
    if (!res.ok) {
      console.error("❌ evaluateAnswers failed:", res.status, data);
      return { ok: false, status: res.status, ...data };
    }
    return { ok: true, status: res.status, ...data };
  } catch (err) {
    console.error("evaluateAnswers exception:", err);
    return { ok: false, error: err?.message || String(err) };
  }
}

export async function uploadResume(file) {
  if (!file) return { ok: false, error: "No file provided" };
  try {
    const fd = new FormData();
    fd.append("resume", file, file.name);
    const res = await fetch(`${AI_URL}/upload-resume`, { method: "POST", body: fd });
    const data = await safeJson(res);
    if (!res.ok) return { ok: false, status: res.status, ...data };
    return {
      ok: true,
      resume_text: data.resume_text ?? data.resumeText ?? "",
      skills: Array.isArray(data.skills) ? data.skills : data.skills ? [data.skills] : [],
      projects: Array.isArray(data.projects) ? data.projects : data.projects ? [data.projects] : [],
      meta: data.meta ?? {},
    };
  } catch (err) {
    console.error("uploadResume exception:", err);
    return { ok: false, error: err?.message || String(err) };
  }
}

/* ===========================
   export default (utils)
   =========================== */

export default {
  registerUser,
  loginUser,
  logoutUser,
  getCurrentUser,
  saveInterviewResult,
  getDashboardData,
  startSession,
  uploadFrame,
  transcribeAudio,
  generateQuestions,
  evaluateAnswers,
  uploadResume,
  refreshAccessToken,
};
