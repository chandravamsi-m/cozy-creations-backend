// src/routes/perfumes.js
const express = require("express");
const router = express.Router();
const productController = require("../controllers/productController");
const adminController = require("../controllers/adminController");
const { authenticateToken, isAdminUid } = require("../middleware/auth");

// Public
router.get("/", productController.getPublicPerfumes);

// Admin middleware
const adminOnly = [
  authenticateToken,
  async (req, res, next) => {
    if (await isAdminUid(req.user.uid)) return next();
    res.status(403).json({ error: "Access Denied" });
  },
];

// Admin CRUD
router.get("/admin", adminOnly, adminController.getPerfumes);
router.post("/admin", adminOnly, adminController.createPerfume);
router.patch("/admin/:id", adminOnly, adminController.updatePerfume);
router.delete("/admin/:id", adminOnly, adminController.softDeletePerfume);
router.delete("/admin/:id/permanent", adminOnly, adminController.permanentDeletePerfume);

module.exports = router;
