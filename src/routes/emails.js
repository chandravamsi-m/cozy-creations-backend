// src/routes/emails.js
const express = require("express");
const router = express.Router();
const emailController = require("../controllers/emailController");

router.post("/send-welcome-email", emailController.sendWelcomeEmail);
router.post("/send-order-confirmation", emailController.sendOrderConfirmation);
router.post("/send-status-update", emailController.sendStatusUpdate);
router.post("/send-password-reset", emailController.sendPasswordReset);

module.exports = router;
