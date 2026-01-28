// routes/user_adminRouter.js
const express = require("express");
const router = express.Router();

const authController = require("../controllers/user/authController");
const userController = require("../controllers/user/user_admin_Controller");

/* =====================================================
   PUBLIC AUTH ROUTES (NO JWT REQUIRED)
   ===================================================== */

// Register new user
router.post("/register", authController.register);

// Login user
router.post("/login", authController.login);

// Refresh access token using refresh token
router.post("/refresh-token", authController.refreshToken);

/* =====================================================
   PROTECTED ROUTES (JWT REQUIRED)
   ===================================================== */

router.use(authController.protectUser);

/* -------------------------
   User profile
   ------------------------- */

// Get logged-in user profile
router.get("/me", userController.getMe);

/* -------------------------
   Interview routes (MAIN FLOW)
   ------------------------- */

// Canonical interview routes
router
  .route("/me/interviews")
  .get(userController.getMyInterviews)   // dashboard list
  .post(userController.addInterview);    // save interview

/* -------------------------
   Aliases (frontend / backward compatibility)
   ------------------------- */

// Save interview (alias)
router.post("/interviews", userController.saveInterviewResult);

// Get dashboard data (alias)
router.get("/dashboard", userController.getDashboard);

module.exports = router;
