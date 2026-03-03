// src/middleware/auth.js
const { admin, db } = require("../config/firebase");

/**
 * Middleware: Enforces a valid Firebase ID token.
 * Blocks requests that are missing a token or have an invalid one.
 */
async function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization || "";
  if (!authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized: Missing token" });
  }
  try {
    const token = authHeader.split(" ")[1];
    req.user = await admin.auth().verifyIdToken(token);
    next();
  } catch (err) {
    console.error("Auth Error:", err.message);
    res.status(401).json({ error: "Unauthorized: Invalid token" });
  }
}

/**
 * Middleware: Optionally authenticates a Firebase ID token.
 * Doesn't block if token is missing or invalid.
 */
async function maybeAuth(req, res, next) {
  const authHeader = req.headers.authorization || "";
  if (authHeader.startsWith("Bearer ")) {
    try {
      req.user = await admin.auth().verifyIdToken(authHeader.split(" ")[1]);
    } catch (err) {
      console.warn("Auth Warning: Invalid token");
    }
  }
  next();
}

/**
 * Helper: Checks if a UID has admin privileges.
 */
async function isAdminUid(uid) {
  if (!uid) return false;
  try {
    const userDoc = await db.collection("users").doc(uid).get();
    return userDoc.exists && userDoc.data().role === "admin";
  } catch (err) {
    console.error("Admin check failed:", err.message);
    return false;
  }
}

module.exports = {
  authenticateToken,
  maybeAuth,
  isAdminUid,
};
