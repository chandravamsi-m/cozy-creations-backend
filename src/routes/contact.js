// src/routes/contact.js
const express = require("express");
const router = express.Router();
const contactController = require("../controllers/contactController");
const { createRateLimiter } = require("../middleware/rateLimit");

router.post("/", createRateLimiter({ windowMs: 10 * 60 * 1000, max: 8, prefix: "contact" }), contactController.submitInquiry);

module.exports = router;
