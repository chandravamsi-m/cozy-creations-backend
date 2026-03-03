// src/routes/settings.js
const express = require("express");
const router = express.Router();
const settingsController = require("../controllers/settingsController");

router.get("/delivery", settingsController.getDeliverySettings);
router.get("/payment", settingsController.getPaymentSettings);
router.get("/packaging", settingsController.getPackagingSettings);

module.exports = router;
