const express = require("express");
const cors = require("cors");
const path = require("path");
require("dotenv").config();

// Configs & Services
const { prefetchCatalogueAssets } = require("./src/services/catalogueService");

// Routes
const adminRoutes = require("./src/routes/admin");
const orderRoutes = require("./src/routes/orders");
const productRoutes = require("./src/routes/products");
const offerRoutes = require("./src/routes/offers");
const settingsRoutes = require("./src/routes/settings");
const emailRoutes = require("./src/routes/emails");
const webhookRoutes = require("./src/routes/webhooks");
const shippingRoutes = require("./src/routes/shipping");
const contactRoutes = require("./src/routes/contact");

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static files (if any)
app.use("/templates", express.static(path.join(__dirname, "templates")));

// Health check
app.get("/health", (req, res) => {
  console.log("✅ /health ping received at", new Date().toISOString());
  res.json({ status: "ok", timestamp: new Date() });
});

// Register Routes
app.use("/api/admin", adminRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/products", productRoutes);
app.use("/api/offers", offerRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/shipping", shippingRoutes);
app.use("/api/contact", contactRoutes);
app.use("/api", emailRoutes); // welcome-email, order-confirmation, etc.
app.use("/api/webhook", webhookRoutes);

// Server Startup
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`🚀 Cozy Creations Backend running on port ${PORT}`);
  
  // Pre-fetch all static catalogue assets at startup
  prefetchCatalogueAssets().catch((err) =>
    console.warn('⚠️ Catalogue asset prefetch failed at startup:', err.message)
  );
});
