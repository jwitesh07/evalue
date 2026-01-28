// app.js
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const AppError = require("./utils/appError.js");
const db = require("./database/db.js");
const useradminRouter = require("./routers/user_adminRouter.js");

const app = express();

// ================================
// 🧩 Connect to Database
// ================================
db(); // Make sure this function connects to MongoDB

// ================================
// 🧱 Middleware
// ================================
app.use(cors());
app.use(helmet());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ================================
// 🛣 Routes
// ================================
app.use("/api/v1/user_admins", useradminRouter);

// Health check
app.get("/health", (req, res) => {
  res.status(200).send("✅ API server running fine");
});

// Global error handler (optional)
// app.use(globalErrorHandler);

module.exports = app;
