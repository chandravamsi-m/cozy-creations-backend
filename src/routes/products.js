// src/routes/products.js
const express = require("express");
const router = express.Router();
const productController = require("../controllers/productController");

router.get("/", productController.getPublicProducts);
router.post("/calculate-discount", productController.calculateDiscount);

module.exports = router;
