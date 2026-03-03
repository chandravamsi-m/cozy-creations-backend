// src/routes/offers.js
const express = require("express");
const router = express.Router();
const offerController = require("../controllers/offerController");
const productController = require("../controllers/productController");

router.get("/active", offerController.getActiveOffer);
router.post("/calculate-discount", productController.calculateDiscount);

module.exports = router;
