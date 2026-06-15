// src/routes/scentedSticks.js
const express = require("express");
const router = express.Router();
const productController = require("../controllers/productController");
const adminController = require("../controllers/adminController");
const { authenticateToken, isAdminUid } = require("../middleware/auth");

// Public
router.get("/", productController.getPublicScentedSticks);

// Admin middleware
const adminOnly = [
  authenticateToken,
  async (req, res, next) => {
    if (await isAdminUid(req.user.uid)) return next();
    res.status(403).json({ error: "Access Denied" });
  },
];

// Admin CRUD
router.get("/admin", adminOnly, adminController.getScentedSticks);
router.post("/admin", adminOnly, adminController.createScentedStick);
router.patch("/admin/:id", adminOnly, adminController.updateScentedStick);
router.delete("/admin/:id", adminOnly, adminController.softDeleteScentedStick);
router.delete("/admin/:id/permanent", adminOnly, adminController.permanentDeleteScentedStick);

module.exports = router;
