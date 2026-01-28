// models/userModel.js
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const validator = require("validator");
const crypto = require("crypto");

/* ============================
   Interview Subdocument
   ============================ */
const interviewSchema = new mongoose.Schema(
  {
    category: {
      type: String,
      required: true,
      index: true,
    },

    // Scores
    overallScore: { type: Number, default: 0 },
    verbalScore: { type: Number, default: 0 },
    nonVerbalScore: { type: Number, default: 0 },
    confidenceScore: { type: Number, default: 0 },

    // Meta
    totalQuestions: { type: Number, default: 0 },
    answeredQuestions: { type: Number, default: 0 },
    durationSeconds: { type: Number, default: 0 },

    meta: {
      type: mongoose.Schema.Types.Mixed, // jobRole, yearsExperience, etc
      default: {},
    },

    nonVerbalMetrics: {
      type: mongoose.Schema.Types.Mixed, // avg eye contact, smile, focus
      default: {},
    },

    evaluation: {
      type: mongoose.Schema.Types.Mixed, // AI evaluation payload
      default: {},
    },

    // Full context
    questions: {
      type: [mongoose.Schema.Types.Mixed],
      default: [],
    },

    answers: {
      type: [mongoose.Schema.Types.Mixed],
      default: [],
    },

    fullTranscript: {
      type: String,
      default: "",
    },

    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    _id: true, // IMPORTANT: keep _id for dashboard detail pages
  }
);

/* ============================
   User Schema
   ============================ */
const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Please provide your name"],
      trim: true,
    },

    email: {
      type: String,
      required: [true, "Please provide your email"],
      unique: true,
      lowercase: true,
      validate: [validator.isEmail, "Please provide a valid email"],
      index: true,
    },

    password: {
      type: String,
      required: [true, "Please provide a password"],
      minlength: 6,
      select: false,
    },

    /* ============================
       Interview History
       ============================ */
    interviewHistory: {
      type: [interviewSchema],
      default: [],
    },

    /* ============================
       Dashboard Stats (denormalized)
       ============================ */
    totalInterviews: {
      type: Number,
      default: 0,
    },

    averageScore: {
      type: Number,
      default: 0,
    },

    lastInterviewAt: Date,
    lastInterviewCategory: String,
    lastInterviewScore: Number,

    /* ============================
       Refresh Token (hashed)
       ============================ */
    refreshTokenHash: {
      type: String,
      select: false,
    },

    refreshTokenExpires: Date,
  },
  {
    timestamps: true,
  }
);

/* ============================
   Password Hashing
   ============================ */
userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

userSchema.methods.correctPassword = async function (
  candidatePassword,
  userPassword
) {
  return await bcrypt.compare(candidatePassword, userPassword);
};

/* ============================
   Refresh Token Helpers
   ============================ */
userSchema.methods.setRefreshToken = async function (
  plainToken,
  ttlSeconds = 60 * 60 * 24 * 30 // 30 days
) {
  const hash = crypto.createHash("sha256").update(plainToken).digest("hex");
  this.refreshTokenHash = hash;
  this.refreshTokenExpires = new Date(Date.now() + ttlSeconds * 1000);
  await this.save({ validateBeforeSave: false });
};

userSchema.methods.verifyRefreshToken = function (plainToken) {
  if (!this.refreshTokenHash || !this.refreshTokenExpires) return false;
  const hash = crypto.createHash("sha256").update(plainToken).digest("hex");
  if (hash !== this.refreshTokenHash) return false;
  if (new Date() > this.refreshTokenExpires) return false;
  return true;
};

module.exports = mongoose.model("User", userSchema);
