// src/components/UserDashboard.jsx
import React, { useMemo, useEffect, useState } from "react";
import { getDashboardData } from "../services/api";

/**
 * UserDashboard (updated)
 * - robustly reads backend response shapes
 * - seeds five categories (technical, hr, communication, scenario, resume)
 */

const KNOWN_CATEGORIES = [
  "technical",
  "hr",
  "communication",
  "scenario",
  "resume",
];

export default function UserDashboard({ user, interviews: propInterviews = [] }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [interviews, setInterviews] = useState(propInterviews || []);

  // optional server-provided summary & categoryStats
  const [summary, setSummary] = useState(null);
  const [categoryStatsFromApi, setCategoryStatsFromApi] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchDashboard() {
      setLoading(true);
      setError(null);

      try {
        const res = await getDashboardData();
        if (cancelled) return;

        if (!res || res.ok === false) {
          console.error("getDashboardData failed:", res);
          setError(res?.error || "Failed to load dashboard data.");
          setLoading(false);
          return;
        }

        // backend may return shape: { status, count, interviews: [...] }
        // or wrapped as { ok:true, data: { ... } } (our api.js returns that)
        const payload = res.data ?? res; // prefer res.data, else top-level response

        // try all plausible locations for interviews
        let raw = [];
        if (Array.isArray(payload.interviews)) raw = payload.interviews;
        else if (Array.isArray(payload.recentInterviews)) raw = payload.recentInterviews;
        else if (Array.isArray(payload.data?.interviews)) raw = payload.data.interviews;
        else if (Array.isArray(payload.interviewHistory)) raw = payload.interviewHistory;
        else if (Array.isArray(res.interviews)) raw = res.interviews; // fallback

        const normalized = raw.map((item, idx) => normalizeInterview(item, idx));
        setInterviews(normalized);
        setSummary(payload.summary ?? null);

        // If backend provided categoryStats use it (flexible shapes)
        if (Array.isArray(payload.categoryStats)) {
          setCategoryStatsFromApi(payload.categoryStats);
        } else if (Array.isArray(payload.category_stats)) {
          // snake_case
          setCategoryStatsFromApi(payload.category_stats);
        } else {
          setCategoryStatsFromApi(null);
        }

        setLoading(false);
      } catch (e) {
        if (cancelled) return;
        console.error("getDashboardData exception:", e);
        setError(e?.message || "Unexpected error loading dashboard.");
        setLoading(false);
      }
    }

    fetchDashboard();
    return () => {
      cancelled = true;
    };
  }, []);

  const hasRealInterviews = Array.isArray(interviews) && interviews.length > 0;

  // fallback sample data if none present
  const sampleData = [
    {
      id: 1,
      date: "2025-12-02",
      category: "technical",
      overallScore: 78,
      verbalScore: 82,
      nonVerbalScore: 72,
      confidenceScore: 75,
      durationMinutes: 18,
      notesCount: 4,
    },
    {
      id: 2,
      date: "2025-12-01",
      category: "hr",
      overallScore: 71,
      verbalScore: 74,
      nonVerbalScore: 66,
      confidenceScore: 70,
      durationMinutes: 15,
      notesCount: 3,
    },
    {
      id: 3,
      date: "2025-11-29",
      category: "communication",
      overallScore: 84,
      verbalScore: 88,
      nonVerbalScore: 79,
      confidenceScore: 82,
      durationMinutes: 12,
      notesCount: 5,
    },
  ];

  // data that the UI consumes (either real interviews or sample)
  const data = useMemo(() => (hasRealInterviews ? interviews : sampleData), [hasRealInterviews, interviews]);

  // total interviews: prefer server summary if present
  const totalInterviews =
    (summary && typeof summary.totalInterviews === "number" ? summary.totalInterviews : null) ?? data.length;

  const lastInterview = data[0] || null;

  const avgOverall = (summary && typeof summary.averageScore === "number")
    ? Math.round(summary.averageScore)
    : totalInterviews
    ? Math.round(data.reduce((sum, i) => sum + (i.overallScore || 0), 0) / totalInterviews)
    : null;

  const avgVerbal = totalInterviews
    ? Math.round(data.reduce((sum, i) => sum + (i.verbalScore ?? i.overallScore ?? 0), 0) / totalInterviews)
    : null;

  const avgNonVerbal = totalInterviews
    ? Math.round(data.reduce((sum, i) => sum + (i.nonVerbalScore ?? i.confidenceScore ?? 0), 0) / totalInterviews)
    : null;

  // category breakdown — seed expected categories, then populate counts/averages
  const categoryStats = useMemo(() => {
    // start with known categories zeroed
    const map = {};
    for (const c of KNOWN_CATEGORIES) {
      map[c] = { label: c, count: 0, totalScore: 0 };
    }

    // include any other categories present in data as dynamic
    for (const item of data) {
      const cat = (item.category || "general").toLowerCase();
      if (!map[cat]) map[cat] = { label: cat, count: 0, totalScore: 0 };
      map[cat].count += 1;
      map[cat].totalScore += item.overallScore || 0;
    }

    // If API returned its own categoryStats take precedence where possible (keeps server's averages)
    if (Array.isArray(categoryStatsFromApi) && categoryStatsFromApi.length > 0) {
      // normalize server stats shape -> {category, totalInterviews, averageScore}
      const byCat = {};
      for (const s of categoryStatsFromApi) {
        const key = (s.category || s.label || "").toLowerCase();
        const avg = s.averageScore ?? s.avgScore ?? s.average ?? null;
        const cnt = s.totalInterviews ?? s.count ?? s.total ?? 0;
        if (!key) continue;
        byCat[key] = { label: key, count: cnt, avgScore: Math.round(avg ?? 0) };
      }
      // merge server-provided categories into map (preserve missing known categories)
      for (const [k, v] of Object.entries(map)) {
        if (byCat[k]) {
          map[k].count = byCat[k].count;
          map[k].totalScore = byCat[k].avgScore * byCat[k].count;
        }
      }
      for (const k of Object.keys(byCat)) {
        if (!map[k]) map[k] = { label: k, count: byCat[k].count, totalScore: byCat[k].avgScore * byCat[k].count };
      }
    }

    return Object.values(map).map((c) => {
      const avgScore = c.count ? Math.round(c.totalScore / c.count) : 0;
      return { label: c.label, count: c.count, avgScore };
    });
  }, [data, categoryStatsFromApi]);

  // helpers
  const formatDate = (d) => {
    if (!d) return "-";
    const dt = new Date(d);
    if (Number.isNaN(dt.getTime())) return d;
    return dt.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
  };

  const badgeForCategory = (catRaw) => {
    const cat = (catRaw || "").toLowerCase();
    let color = "bg-gray-100 text-gray-700";
    if (cat === "technical") color = "bg-indigo-100 text-indigo-800";
    else if (cat === "hr") color = "bg-amber-100 text-amber-800";
    else if (cat === "communication") color = "bg-emerald-100 text-emerald-800";
    else if (cat === "scenario") color = "bg-cyan-100 text-cyan-800";
    else if (cat === "resume") color = "bg-purple-100 text-purple-800";

    return (
      <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${color}`}>
        {catRaw || "general"}
      </span>
    );
  };

  const scorePill = (value) => {
    if (value == null) return <span className="text-xs text-gray-400">—</span>;
    let color = "bg-gray-100 text-gray-800";
    if (value >= 80) color = "bg-green-100 text-green-800";
    else if (value >= 60) color = "bg-yellow-100 text-yellow-800";
    else color = "bg-red-100 text-red-800";
    return <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-semibold ${color}`}>{value}</span>;
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-7xl mx-auto">
        {/* HEADER */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-4 gap-4">
          <div>
            <p className="text-sm text-gray-500 uppercase tracking-wide">Dashboard</p>
            <h1 className="text-3xl md:text-4xl font-bold text-gray-900 mt-1">
              Welcome back{user?.name ? `, ${user.name.split(" ")[0]}` : ""} 👋
            </h1>
            <p className="text-gray-600 mt-2 text-sm md:text-base">
              Track your interview practice, see how your confidence evolves, and plan your next move.
            </p>
            {loading && <div className="mt-2 text-xs text-gray-500">Syncing your latest sessions from the server…</div>}
            {!loading && error && <div className="mt-2 text-xs text-red-500">Couldn't load data from server: {error}. Showing sample data.</div>}
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 px-4 py-3 text-sm">
            <p className="text-gray-500">Total interviews</p>
            <p className="text-2xl font-bold text-indigo-600">{totalInterviews}</p>
            {lastInterview && (
              <p className="text-xs text-gray-400 mt-1">
                Last: {formatDate(lastInterview.date)} · {badgeForCategory(lastInterview.category)}
              </p>
            )}
          </div>
        </div>

        {/* METRICS */}
        <div className="grid md:grid-cols-4 gap-4 mb-8">
          <MetricCard label="Average Overall Score" value={avgOverall} suffix="/100" highlight />
          <MetricCard label="Verbal Performance" value={avgVerbal} suffix="/100" />
          <MetricCard label="Non-verbal / Confidence" value={avgNonVerbal} suffix="/100" />
          <MetricCard label="Practice Sessions" value={totalInterviews} badge={totalInterviews >= 5 ? "Great consistency" : totalInterviews >= 2 ? "Good start" : "Just beginning"} />
        </div>

        {/* TREND + CATEGORY */}
        <div className="grid lg:grid-cols-3 gap-6 mb-8">
          <div className="lg:col-span-2 bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-gray-900">Progress over time</h2>
              <span className="text-xs text-gray-400">Overall scores from your last {data.length} interviews</span>
            </div>

            {data.length === 0 ? (
              <p className="text-sm text-gray-500">No interviews yet. Start a session to see your progression here.</p>
            ) : (
              <div className="space-y-4">
                <div className="flex items-end gap-2 h-40">
                  {data.slice().reverse().map((item, idx) => {
                    const h = Math.max(8, (item.overallScore || 0) * 1.2);
                    return (
                      <div key={item.id ?? idx} className="flex-1 flex flex-col items-center">
                        <div className="w-full rounded-t-xl bg-gradient-to-t from-indigo-500 to-cyan-400" style={{ height: `${h}px` }} />
                        <span className="mt-2 text-[10px] text-gray-500 truncate">{formatDate(item.date)}</span>
                      </div>
                    );
                  })}
                </div>

                <div className="flex justify-between text-xs text-gray-500">
                  <span>Lower scores</span>
                  <span>Higher scores</span>
                </div>
              </div>
            )}
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
            <h2 className="text-base font-semibold text-gray-900 mb-3">Category performance</h2>
            {categoryStats.length === 0 ? (
              <p className="text-sm text-gray-500">Once you complete interviews, you'll see category-wise insights here.</p>
            ) : (
              <ul className="space-y-3 text-sm">
                {categoryStats.map((cat) => (
                  <li key={cat.label} className="flex items-center justify-between">
                    <div>
                      <p className="capitalize font-medium text-gray-800">{cat.label}</p>
                      <p className="text-xs text-gray-500">{cat.count} interview{cat.count === 1 ? "" : "s"}</p>
                    </div>
                    <div className="flex flex-col items-end">
                      {scorePill(cat.avgScore)}
                      <div className="w-20 h-1.5 bg-gray-100 rounded-full mt-2 overflow-hidden">
                        <div className="h-1.5 rounded-full bg-indigo-500" style={{ width: `${cat.avgScore}%` }} />
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* RECENT INTERVIEWS */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-gray-900">Recent interviews</h2>
            <span className="text-xs text-gray-400">Showing {data.length} most recent sessions</span>
          </div>

          {data.length === 0 ? (
            <p className="text-sm text-gray-500">You don't have any interview history yet. Start an interview from the home screen to see it here.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-left">
                    <th className="py-2 px-3 font-medium text-gray-500">Date</th>
                    <th className="py-2 px-3 font-medium text-gray-500">Category</th>
                    <th className="py-2 px-3 font-medium text-gray-500">Overall</th>
                    <th className="py-2 px-3 font-medium text-gray-500">Verbal</th>
                    <th className="py-2 px-3 font-medium text-gray-500">Non-verbal</th>
                    <th className="py-2 px-3 font-medium text-gray-500">Duration</th>
                    <th className="py-2 px-3 font-medium text-gray-500">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((item, idx) => (
                    <tr key={item.id ?? idx} className={idx % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                      <td className="py-2 px-3 text-gray-700">{formatDate(item.date)}</td>
                      <td className="py-2 px-3">{badgeForCategory(item.category)}</td>
                      <td className="py-2 px-3">{scorePill(item.overallScore)}</td>
                      <td className="py-2 px-3">{scorePill(item.verbalScore ?? item.overallScore)}</td>
                      <td className="py-2 px-3">{scorePill(item.nonVerbalScore ?? item.confidenceScore)}</td>
                      <td className="py-2 px-3 text-gray-600">{item.durationMinutes != null ? `${item.durationMinutes} min` : "—"}</td>
                      <td className="py-2 px-3 text-gray-600">{item.notesCount != null ? `${item.notesCount}` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ACTION STRIP */}
        <div className="flex flex-wrap justify-between items-center gap-3">
          <div className="text-sm text-gray-600">Use your analytics to <span className="font-semibold text-indigo-600">focus on one weak area at a time.</span></div>
          <div className="flex gap-3">
            <button className="px-4 py-2 rounded-xl bg-white border border-gray-300 text-sm text-gray-700 hover:bg-gray-50">Back to Home</button>
            <button className="px-4 py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-cyan-400 text-sm text-white shadow hover:shadow-md">Start new interview</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* Normalizes interview object */
function normalizeInterview(item, idx) {
  if (!item || typeof item !== "object") {
    return {
      id: idx + 1,
      date: new Date().toISOString(),
      category: "general",
      overallScore: 0,
      verbalScore: null,
      nonVerbalScore: null,
      confidenceScore: null,
      durationMinutes: null,
      notesCount: null,
    };
  }

  const id = item.id ?? item._id ?? idx + 1;
  const date = item.date || item.createdAt || item.updatedAt || new Date().toISOString();
  const category = (item.category || item.type || "general").toLowerCase();

  const overallScore = item.overallScore ?? item.overall_score ?? item.score ?? item.confidenceScore ?? 0;
  const verbalScore = item.verbalScore ?? item.verbal_score ?? null;
  const nonVerbalScore = item.nonVerbalScore ?? item.non_verbal_score ?? (item.nonVerbalMetrics?.confidence ?? null);
  const confidenceScore = item.confidenceScore ?? item.confidence_score ?? null;

  const durationMinutes = item.durationMinutes ?? item.duration_minutes ?? item.duration ?? null;
  const notesCount = item.notesCount ?? item.notes_count ?? (Array.isArray(item.notes) ? item.notes.length : null);

  return {
    id,
    date,
    category,
    overallScore,
    verbalScore,
    nonVerbalScore,
    confidenceScore,
    durationMinutes,
    notesCount,
  };
}

/* MetricCard - unchanged */
function MetricCard({ label, value, suffix, highlight = false, badge }) {
  return (
    <div className={`rounded-2xl p-4 shadow-sm border ${highlight ? "border-indigo-100 bg-gradient-to-br from-indigo-50 via-white to-cyan-50" : "border-gray-100 bg-white"}`}>
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</p>
      <div className="mt-2 flex items-baseline gap-1">
        <span className="text-2xl font-bold text-gray-900">{value != null ? value : "—"}</span>
        {suffix && <span className="text-xs text-gray-500">{value != null && suffix}</span>}
      </div>
      {badge && <p className="mt-2 text-xs text-indigo-600 bg-indigo-50 inline-block px-2 py-1 rounded-full">{badge}</p>}
    </div>
  );
}
