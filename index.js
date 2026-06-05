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
const scentedSticksRoutes = require("./src/routes/scentedSticks");
const perfumesRoutes = require("./src/routes/perfumes");
const offerRoutes = require("./src/routes/offers");
const settingsRoutes = require("./src/routes/settings");
const emailRoutes = require("./src/routes/emails");
const webhookRoutes = require("./src/routes/webhooks");
const shippingRoutes = require("./src/routes/shipping");
const contactRoutes = require("./src/routes/contact");

const app = express();

// Middleware
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (e.g. curl, Postman, server-to-server)
    if (!origin) return callback(null, true);
    // Allow any localhost port for local development
    if (/^http:\/\/localhost(:\d+)?$/.test(origin)) return callback(null, true);
    // Allow production domains and default Firebase hosting domains
    const allowed = [
      "https://cozycreations.in", 
      "https://www.cozycreations.in",
      "https://cozy-creations-32109.web.app",
      "https://cozy-creations-32109.firebaseapp.com",
      "https://test-cozycreations.web.app",
      "https://test-cozycreations.firebaseapp.com"
    ];
    if (allowed.includes(origin)) return callback(null, true);
    callback(new Error(`CORS blocked: ${origin}`));
  },
  credentials: true,
}));

app.use(express.json({
  verify: (req, _res, buf) => {
    req.rawBody = buf ? buf.toString("utf8") : "";
  },
}));
app.use(express.urlencoded({ extended: true }));

// Static files (if any)
app.use("/templates", express.static(path.join(__dirname, "templates")));

// Health check (Silent pings are handled here)
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date() });
});

// Register Routes
app.use("/api/admin", adminRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/products", productRoutes);
app.use("/api/scented-sticks", scentedSticksRoutes);
app.use("/api/perfumes", perfumesRoutes);
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
