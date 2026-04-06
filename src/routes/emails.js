// src/routes/emails.js
const express = require("express");
const router = express.Router();
const emailController = require("../controllers/emailController");
const { authenticateToken, isAdminUid } = require("../middleware/auth");
const { createRateLimiter } = require("../middleware/rateLimit");

const publicEmailLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 5, prefix: "public-email" });
const adminOnly = [
  authenticateToken,
  async (req, res, next) => {
    if (await isAdminUid(req.user.uid)) return next();
    return res.status(403).json({ error: "Access Denied" });
  },
];

router.post("/send-welcome-email", publicEmailLimiter, emailController.sendWelcomeEmail);
router.post("/send-order-confirmation", adminOnly, emailController.sendOrderConfirmation);
router.post("/send-status-update", adminOnly, emailController.sendStatusUpdate);
router.post("/send-password-reset", publicEmailLimiter, emailController.sendPasswordReset);

module.exports = router;
