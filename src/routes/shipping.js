// src/routes/shipping.js
const express = require("express");
const router = express.Router();
const shippingController = require("../controllers/shippingController");
const { authenticateToken, isAdminUid } = require("../middleware/auth");

// Public (user-facing)
router.get("/check-serviceability", authenticateToken, shippingController.checkServiceability);

// User-facing auto-sync (silently heals missing AWB — non-admin users can call this)
router.post("/auto-sync-awb/:id", authenticateToken, shippingController.autoSyncAwb);

// Admin only (shipment actions)
router.use(authenticateToken);
router.use(async (req, res, next) => {
  if (await isAdminUid(req.user.uid)) return next();
  res.status(403).json({ error: "Access Denied" });
});

router.post("/create-shipment", shippingController.createShipment);
router.get("/generate-label/:id", shippingController.generateLabel);
router.post("/sync/:id", shippingController.syncStatus);

module.exports = router;
