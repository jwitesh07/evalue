// middleware/authMiddleware.js

const jwt = require("jsonwebtoken");
const AppError = require("../utils/appError");

// Middleware to check if the user is authenticated
module.exports = (req, res, next) => {
  const token =
    req.headers.authorization && req.headers.authorization.split(" ")[1];
  if (!token) {
    return next(
      new AppError("You are not logged in! Please log in to get access.", 401)
    );
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      return next(new AppError("Invalid token. Please log in again.", 401));
    }
    req.user = decoded; // Attaching user info to the request object
    next();
  });
};
