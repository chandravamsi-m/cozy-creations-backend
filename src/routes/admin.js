// src/routes/admin.js
const express = require("express");
const router = express.Router();
const adminController = require("../controllers/adminController");
const settingsController = require("../controllers/settingsController");
const offerController = require("../controllers/offerController");
const { authenticateToken, isAdminUid } = require("../middleware/auth");

// Middleware to ensure all /api/admin/* routes are admin-only
router.use(authenticateToken);
router.use(async (req, res, next) => {
  if (await isAdminUid(req.user.uid)) return next();
  res.status(403).json({ error: "Access Denied" });
});

// Dashboard
router.get("/dashboard-stats", adminController.getDashboardStats);

// Products (Candles)
router.get("/products", adminController.getProducts);
router.post("/products", adminController.createProduct);
router.patch("/products/:id", adminController.updateProduct);
router.delete("/products/:id", adminController.softDeleteProduct);
router.delete("/products/:id/permanent", adminController.permanentDeleteProduct);

// Scented Sticks (Agarbatti)
router.get("/scented-sticks", adminController.getScentedSticks);
router.post("/scented-sticks", adminController.createScentedStick);
router.patch("/scented-sticks/:id", adminController.updateScentedStick);
router.delete("/scented-sticks/:id", adminController.softDeleteScentedStick);
router.delete("/scented-sticks/:id/permanent", adminController.permanentDeleteScentedStick);

// Perfumes / Attar
router.get("/perfumes", adminController.getPerfumes);
router.post("/perfumes", adminController.createPerfume);
router.patch("/perfumes/:id", adminController.updatePerfume);
router.delete("/perfumes/:id", adminController.softDeletePerfume);
router.delete("/perfumes/:id/permanent", adminController.permanentDeletePerfume);

// Offers — full CRUD
router.get("/offers", offerController.listAllOffers);
router.post("/offers", offerController.createOffer);
router.put("/offers/:offerId", offerController.updateOffer);
router.delete("/offers/:offerId", offerController.deleteOffer);

// Settings
router.put("/settings/delivery", adminController.updateDeliverySettings);
router.put("/settings/payment", adminController.updatePaymentSettings);
router.put("/settings/packaging", settingsController.updatePackagingSettings);
router.put("/settings/announcement-strip", settingsController.updateAnnouncementStrip);

// Orders
router.get("/orders", adminController.getOrders);
router.patch("/orders/:id", adminController.updateOrder);
router.post("/orders/:id/cancel", adminController.cancelOrder);
router.delete("/orders/:id", adminController.deleteOrder);

// Shiprocket Sync
const shippingController = require("../controllers/shippingController");
router.post("/orders/:id/sync", shippingController.syncStatus);

// Users
router.post("/users", adminController.createUser);
router.patch("/users/:uid", adminController.updateUser);
router.delete("/users/:uid", adminController.deleteUser);

// Catalogue
router.get("/catalogue-status", adminController.getCatalogueStatus);
router.get("/generate-catalogue", adminController.generateCatalogue);
router.get("/generate-bulk-catalogue", adminController.generateBulkCatalogue);

module.exports = router;
