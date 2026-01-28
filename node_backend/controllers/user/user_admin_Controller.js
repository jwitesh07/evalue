// controllers/user/user_admin_Controller.js
const AppError = require("../../utils/appError");
const catchAsyncError = require("../../utils/catchAsyncError");
const User = require("../../models/userModel");

/* ============================
   Helpers
   ============================ */

// Get logged-in user id (set by protectUser middleware)
function getUserId(req) {
  if (!req.user) return null;
  return req.user.id || req.user._id || req.user.userId || null;
}

// Normalize and sanitize interview payload
function buildInterviewPayload(body = {}) {
  return {
    category: body.category || "general",

    // scores
    overallScore: typeof body.overallScore === "number" ? body.overallScore : 0,
    verbalScore: typeof body.verbalScore === "number" ? body.verbalScore : 0,
    nonVerbalScore:
      typeof body.nonVerbalScore === "number" ? body.nonVerbalScore : 0,
    confidenceScore:
      typeof body.confidenceScore === "number" ? body.confidenceScore : 0,

    // counts
    totalQuestions:
      typeof body.totalQuestions === "number" ? body.totalQuestions : 0,
    answeredQuestions:
      typeof body.answeredQuestions === "number"
        ? body.answeredQuestions
        : 0,

    durationSeconds:
      typeof body.durationSeconds === "number" ? body.durationSeconds : 0,

    // full payloads
    meta: body.meta || {},
    nonVerbalMetrics: body.nonVerbalMetrics || {},
    evaluation: body.evaluation || {},

    questions: Array.isArray(body.questions) ? body.questions : [],
    answers: Array.isArray(body.answers) ? body.answers : [],
    fullTranscript: body.fullTranscript || "",

    createdAt: new Date(),
  };
}

/* ============================
   GET /me
   ============================ */
exports.getMe = catchAsyncError(async (req, res, next) => {
  const userId = getUserId(req);
  if (!userId) {
    return next(new AppError("Not authenticated. Please log in again.", 401));
  }

  const user = await User.findById(userId).select("-password");
  if (!user) {
    return next(new AppError("User not found", 404));
  }

  res.status(200).json({
    status: "success",
    user,
  });
});

/* ============================
   POST /me/interviews
   Save completed interview
   ============================ */
exports.addInterview = catchAsyncError(async (req, res, next) => {
  const userId = getUserId(req);
  if (!userId) {
    return next(new AppError("Not authenticated. Please log in again.", 401));
  }

  const user = await User.findById(userId);
  if (!user) {
    return next(new AppError("User not found", 404));
  }

  // ensure array exists
  if (!Array.isArray(user.interviewHistory)) {
    user.interviewHistory = [];
  }

  const interview = buildInterviewPayload(req.body);

  // add newest first
  user.interviewHistory.unshift(interview);

  // update dashboard stats
  user.totalInterviews = user.interviewHistory.length;
  user.lastInterviewAt = interview.createdAt;
  user.lastInterviewCategory = interview.category;
  user.lastInterviewScore = interview.overallScore;

  // recompute average score
  const totalScore = user.interviewHistory.reduce(
    (sum, i) => sum + (i.overallScore || 0),
    0
  );
  user.averageScore =
    user.totalInterviews > 0
      ? Math.round(totalScore / user.totalInterviews)
      : 0;

  await user.save();

  res.status(201).json({
    status: "success",
    message: "Interview saved successfully",
    interview,
    stats: {
      totalInterviews: user.totalInterviews,
      averageScore: user.averageScore,
    },
  });
});

/* ============================
   GET /me/interviews
   Dashboard data
   ============================ */
exports.getMyInterviews = catchAsyncError(async (req, res, next) => {
  const userId = getUserId(req);
  if (!userId) {
    return next(new AppError("Not authenticated. Please log in again.", 401));
  }

  const user = await User.findById(userId).select(
    "name email interviewHistory totalInterviews averageScore lastInterviewAt lastInterviewCategory lastInterviewScore"
  );

  if (!user) {
    return next(new AppError("User not found", 404));
  }

  const interviews = Array.isArray(user.interviewHistory)
    ? user.interviewHistory
    : [];

  res.status(200).json({
    status: "success",
    count: interviews.length,
    stats: {
      totalInterviews: user.totalInterviews,
      averageScore: user.averageScore,
      lastInterviewAt: user.lastInterviewAt,
      lastInterviewCategory: user.lastInterviewCategory,
      lastInterviewScore: user.lastInterviewScore,
    },
    interviews,
  });
});

/* ============================
   Aliases (frontend compatibility)
   ============================ */
exports.saveInterviewResult = exports.addInterview;
exports.getDashboard = exports.getMyInterviews;
