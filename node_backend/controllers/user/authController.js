// controllers/user/authController.js
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const catchAsyncError = require("../../utils/catchAsyncError");
const AppError = require("../../utils/appError");
const User = require("../../models/userModel");

// defaults (safe dev defaults; override via env)
const JWT_SECRET = process.env.JWT_SECRET || "a_very_secret_dev_key_change_me";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "1h"; // access token lifetime
const REFRESH_TOKEN_TTL_SECONDS = parseInt(process.env.REFRESH_TOKEN_TTL_SECONDS || String(60 * 60 * 24 * 30)); // 30 days

// sign access token
function signToken(userId) {
  return jwt.sign({ id: userId }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

// helper to send token (and optionally refresh token)
async function createSendTokens(user, res) {
  const token = signToken(user._id);

  // create a random refresh token (opaque)
  const refreshToken = crypto.randomBytes(40).toString("hex");
  // store hashed refresh token in DB with expiry
  await user.setRefreshToken(refreshToken, REFRESH_TOKEN_TTL_SECONDS);

  // optionally: set tokens as httpOnly cookies (safer) — here we send back in JSON
  res.status(200).json({
    status: "success",
    token,
    refreshToken, // frontend should store refresh token securely (e.g. httpOnly cookie ideally)
    data: {
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
      },
    },
  });
}

// register
exports.register = catchAsyncError(async (req, res, next) => {
  const { name, email, password } = req.body || {};
  if (!name || !email || !password) {
    return next(new AppError("name, email and password are required", 400));
  }

  const existing = await User.findOne({ email });
  if (existing) {
    return next(new AppError("Email already registered", 400));
  }

  const user = await User.create({ name, email, password });
  await createSendTokens(user, res);
});

// login
exports.login = catchAsyncError(async (req, res, next) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return next(new AppError("Please provide email and password", 400));
  }

  const user = await User.findOne({ email }).select("+password +refreshTokenHash +refreshTokenExpires");
  if (!user || !(await user.correctPassword(password, user.password))) {
    return next(new AppError("Incorrect email or password", 401));
  }

  // issue tokens
  await createSendTokens(user, res);
});

// refresh token endpoint
// POST /api/v1/user_admins/refresh-token  { refreshToken: "..." }
exports.refreshToken = catchAsyncError(async (req, res, next) => {
  const { refreshToken } = req.body || {};
  if (!refreshToken) return next(new AppError("refreshToken required", 400));

  // find user with matching hashed refresh token
  // we can't query by hash easily because we need to hash the incoming token:
  const hashed = crypto.createHash("sha256").update(refreshToken).digest("hex");

  // find user having that hash and where refreshToken not expired
  const user = await User.findOne({
    refreshTokenHash: hashed,
    refreshTokenExpires: { $gt: new Date() },
  }).select("+refreshTokenHash +refreshTokenExpires");

  if (!user) {
    return next(new AppError("Invalid or expired refresh token", 401));
  }

  // rotate refresh token: issue a new refresh token and set it
  const newAccessToken = signToken(user._id);
  const newRefreshToken = crypto.randomBytes(40).toString("hex");
  await user.setRefreshToken(newRefreshToken, REFRESH_TOKEN_TTL_SECONDS);

  res.status(200).json({
    status: "success",
    token: newAccessToken,
    refreshToken: newRefreshToken,
    data: {
      user: { id: user._id, name: user.name, email: user.email },
    },
  });
});

// protect middleware
exports.protectUser = catchAsyncError(async (req, res, next) => {
  // get token from header
  let token;
  const auth = req.headers.authorization || req.get("Authorization");
  if (auth && auth.startsWith("Bearer ")) token = auth.split(" ")[1];

  // optionally: also accept token in cookies
  if (!token && req.cookies && req.cookies.jwt) token = req.cookies.jwt;

  if (!token) return next(new AppError("You are not logged in", 401));

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    // attach user to request
    const user = await User.findById(decoded.id).select("-password");
    if (!user) return next(new AppError("User not found", 401));
    req.user = { id: user._id, name: user.name, email: user.email };
    return next();
  } catch (err) {
    // Handle token expired separately so frontend can detect and call /refresh-token
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({
        status: "fail",
        message: "token_expired",
        error: "JWT expired",
      });
    }
    // other jwt errors
    return next(new AppError("Invalid token", 401));
  }
});

// optional revoke refresh token on logout
exports.logout = catchAsyncError(async (req, res, next) => {
  const userId = req.user?.id;
  if (userId) {
    const user = await User.findById(userId).select("+refreshTokenHash +refreshTokenExpires");
    if (user) {
      user.refreshTokenHash = undefined;
      user.refreshTokenExpires = undefined;
      await user.save({ validateBeforeSave: false });
    }
  }
  res.status(200).json({ status: "success", message: "Logged out" });
});
