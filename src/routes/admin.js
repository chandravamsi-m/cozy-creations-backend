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

// Products
router.get("/products", adminController.getProducts);
router.post("/products", adminController.createProduct);
router.patch("/products/:id", adminController.updateProduct);
router.delete("/products/:id", adminController.softDeleteProduct);
router.delete("/products/:id/permanent", adminController.permanentDeleteProduct);

// Offers — full CRUD
router.get("/offers", offerController.listAllOffers);
router.post("/offers", offerController.createOffer);
router.put("/offers/:offerId", offerController.updateOffer);
router.delete("/offers/:offerId", offerController.deleteOffer);

// Settings
router.put("/settings/delivery", adminController.updateDeliverySettings);
router.put("/settings/payment", adminController.updatePaymentSettings);
router.put("/settings/packaging", settingsController.updatePackagingSettings);

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
