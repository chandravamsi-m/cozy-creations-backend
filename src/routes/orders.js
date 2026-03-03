// src/routes/orders.js
const express = require("express");
const router = express.Router();
const orderController = require("../controllers/orderController");
const { maybeAuth } = require("../middleware/auth");

router.post("/create-payment", maybeAuth, orderController.createPayment);
router.post("/verify-payment", maybeAuth, orderController.verifyPayment);
router.post("/place-cod", maybeAuth, orderController.placeCod);
router.get("/my-orders", maybeAuth, orderController.getUserOrders);

// Shiprocket actions (Admin only - middleware in index.js or here?)
// The frontend calls /api/orders/... for these
const shippingController = require("../controllers/shippingController");
const { authenticateToken, isAdminUid } = require("../middleware/auth");

const adminAuth = [authenticateToken, async (req, res, next) => {
  if (await isAdminUid(req.user.uid)) return next();
  res.status(403).json({ error: "Access Denied" });
}];

router.post("/create-shipment", adminAuth, shippingController.createShipment);
router.get("/generate-label/:id", adminAuth, shippingController.generateLabel);

module.exports = router;
