const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");
const Razorpay = require("razorpay");
const crypto = require("crypto");
const { Resend } = require("resend");
const cloudinary = require("cloudinary").v2;
const puppeteer = require("puppeteer");
const { PDFDocument } = require("pdf-lib");
const { 
  generateWelcomePage, 
  generateAboutPage, 
  generateTemplate1, 
  generateTemplate2, 
  generateBulkTemplate1,
  generateBulkTemplate2,
  generateCustomizationPage,
  generateContactPage,
  collectionNames 
} = require("./templates/catalogueTemplates");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());

// ------------------------------------------
// INITIALIZATION
// ------------------------------------------

// Firebase Admin
if (process.env.FIREBASE_ADMIN_CRED_JSON) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert(
        JSON.parse(process.env.FIREBASE_ADMIN_CRED_JSON)
      ),
    });
  } catch (err) {
    console.warn("Firebase Admin Init Error:", err.message);
    admin.initializeApp();
  }
} else {
  admin.initializeApp();
}

const db = admin.firestore();

// Razorpay
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// Resend Email
const resend = new Resend(process.env.RESEND_API_KEY);

// Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Global progress tracking for catalogue generation
// key: userId, value: { progress: number, currentAction: string }
const catalogueProgress = new Map();

// ------------------------------------------
// CATALOGUE ASSET PREFETCH (runs once at startup)
// ------------------------------------------

// All static assets used across catalogue/bulk-catalogue templates.
// These never change, so we fetch them ONCE and embed as base64 data URLs.
// This eliminates ~14 Cloudinary round-trips PER PAGE during PDF generation.
const CATALOGUE_STATIC_URLS = [
  // Custom fonts (biggest offenders — ~200-300KB each, fetched per page tab)
  'https://res.cloudinary.com/dumkblp3v/raw/upload/v1770554569/papyrus_cwxj89.ttf',
  'https://res.cloudinary.com/dumkblp3v/raw/upload/v1770554592/NonOphelieDisplay-Regular-BF67107f6e3063a_aqqjn2.ttf',
  // Decorative SVGs (used on every product page)
  'https://res.cloudinary.com/dumkblp3v/image/upload/v1770548513/linesright_hk7t3j.svg',
  'https://res.cloudinary.com/dumkblp3v/image/upload/v1770548513/linesleft_gx8o8w.svg',
  'https://res.cloudinary.com/dumkblp3v/image/upload/v1770548487/candlestick_ljryjs.svg',
  'https://res.cloudinary.com/dumkblp3v/image/upload/v1770548513/lamp_svjx60.svg',
  'https://res.cloudinary.com/dumkblp3v/image/upload/v1770618965/Vector_iajl4o.svg',
  'https://res.cloudinary.com/dumkblp3v/image/upload/v1770800754/Star-badge_ttci0q.svg',
  // Page-specific static images (welcome, about, customization pages)
  'https://res.cloudinary.com/dumkblp3v/image/upload/v1770548599/heroimage_ueotan.jpg',
  'https://res.cloudinary.com/dumkblp3v/image/upload/v1770548514/logo_wq2xws.svg',
  'https://res.cloudinary.com/dumkblp3v/image/upload/v1770548517/topcandle_mduuda.svg',
  'https://res.cloudinary.com/dumkblp3v/image/upload/v1770548487/bottomcandle_y5u5y5.svg',
  'https://res.cloudinary.com/dumkblp3v/image/upload/v1770548486/candlelogo_c3qvmb.svg',
  'https://res.cloudinary.com/dumkblp3v/image/upload/v1767176149/unnamed-7_j6fal6.webp',
];

// Map<originalCloudinaryUrl, base64DataUrl> — populated at startup
let catalogueAssetCache = new Map();

async function _fetchAsBase64(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buffer = await res.arrayBuffer();
    let contentType = (res.headers.get('content-type') || 'application/octet-stream').split(';')[0].trim();
    // Ensure correct MIME types for common cases where CDNs may return text/plain
    if (url.endsWith('.svg') && !contentType.includes('svg')) contentType = 'image/svg+xml';
    if (url.endsWith('.ttf')) contentType = 'font/truetype';
    return `data:${contentType};base64,${Buffer.from(buffer).toString('base64')}`;
  } catch (err) {
    console.warn(`⚠️  Asset prefetch failed for ${url.split('/').pop()}: ${err.message}`);
    return null; // Graceful fallback — Cloudinary URL stays in template
  }
}

async function prefetchCatalogueAssets() {
  console.log(`🖼️  Pre-fetching ${CATALOGUE_STATIC_URLS.length} catalogue assets...`);
  const results = await Promise.all(
    CATALOGUE_STATIC_URLS.map(async (url) => [url, await _fetchAsBase64(url)])
  );
  let successCount = 0;
  for (const [url, dataUrl] of results) {
    if (dataUrl) { catalogueAssetCache.set(url, dataUrl); successCount++; }
  }
  console.log(`✅  Catalogue assets ready: ${successCount}/${CATALOGUE_STATIC_URLS.length} inlined.`);
}

// Replace all known Cloudinary static URLs with in-memory base64 data URLs.
// Product image URLs are dynamic (per-product) and intentionally left as-is.
function inlineCatalogueAssets(html) {
  if (catalogueAssetCache.size === 0) return html;
  let result = html;
  for (const [url, dataUrl] of catalogueAssetCache) {
    // split/join is faster than replaceAll for large strings
    result = result.split(url).join(dataUrl);
  }
  return result;
}

// Helper function to extract Cloudinary public ID from URL
function extractCloudinaryPublicId(imageUrl) {
  if (!imageUrl || !imageUrl.includes('cloudinary.com')) return null;
  
  // Match pattern: .../upload/v<version>/<public_id>.<extension>
  // Handles potential double slashes before version and supports public IDs with folders
  const match = imageUrl.match(/\/*v\d+\/(.+)\.(jpg|jpeg|png|gif|webp|svg)$/);
  return match ? match[1] : null;
}
const EMAIL_FROM = process.env.EMAIL_FROM;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;

// ------------------------------------------
// MIDDLEWARE & HELPERS
// ------------------------------------------

async function maybeAuth(req, res, next) {
  const authHeader = req.headers.authorization || "";
  if (authHeader.startsWith("Bearer ")) {
    try {
      req.user = await admin.auth().verifyIdToken(authHeader.split(" ")[1]);
    } catch (err) {
      console.warn("Auth Warning: Invalid token");
    }
  }
  next();
}

/**
 * Middleware: Enforces a valid Firebase ID token.
 * Blocks requests that are missing a token or have an invalid one.
 */
async function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization || "";
  if (!authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized: Missing token" });
  }
  try {
    const token = authHeader.split(" ")[1];
    req.user = await admin.auth().verifyIdToken(token);
    next();
  } catch (err) {
    console.error("Auth Error:", err.message);
    res.status(401).json({ error: "Unauthorized: Invalid token" });
  }
}

// ------------------------------------------
// CATALOGUE GENERATION STATUS
// ------------------------------------------

app.get("/api/admin/catalogue-status", maybeAuth, async (req, res) => {
  if (!(await isAdminUid(req.user?.uid))) {
    return res.status(403).json({ error: "Access Denied" });
  }
  const status = catalogueProgress.get(req.user.uid) || { progress: 0, currentAction: "idle" };
  res.json(status);
});

async function isAdminUid(uid) {
  if (!uid) return false;
  try {
    const userDoc = await db.collection("users").doc(uid).get();
    return userDoc.exists && userDoc.data().role === "admin";
  } catch (err) {
    console.error("Admin check failed:", err.message);
    return false;
  }
}

// Email Template Helpers
const wrapLayout = (title, content, name) => `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
<body style="margin:0; padding:0; background-color:#FBFAF9; font-family: 'Segoe UI', Arial, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#FBFAF9; padding:40px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff; border-radius:14px; overflow:hidden; border:1px solid #e5e7eb; box-shadow: 0 4px 6px rgba(0,0,0,0.02);">
        <tr>
          <td align="center" style="background:#111827; padding:0;">
           <img src="https://res.cloudinary.com/dumkblp3v/image/upload/v1767161543/cozy-creation-logo_fhljek.webp" alt="Cozy Creations" width="600" style="display:block; width:100%; height:auto;" />
          </td>
        </tr>
        <tr>
          <td style="padding:40px 36px; color:#374151; line-height:1.7;">
            <h2 style="margin:0 0 20px; font-size:24px; color:#111827; font-weight: 700;">${title}</h2>
            <p style="margin:0 0 12px; font-size:16px; color:#111827; font-weight:600;">Hi ${
              name || "Customer"
            },</p>
            ${content}
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:28px; background:#fafafa; color:#9ca3af; font-size:13px;">
            <p style="margin:0;">© 2025 Cozy Creations Corner.<br />Crafted with love in India.</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

const buildItemTable = (items) => {
  const rows = items
    .map((item) => {
      // Ensure image URL is valid and has protocol
      const imageUrl = item.image && item.image.startsWith('http') 
        ? item.image 
        : 'https://via.placeholder.com/60';
      
      return `
    <tr>
      <td style="padding: 16px 0; border-bottom: 1px solid #f1f1f1;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td width="60" valign="top">
              <img src="${imageUrl}" alt="${item.name || 'Product'}" width="60" height="60" style="border-radius: 8px; object-fit: cover; background: #f9f9f9; display: block;" />
            </td>
            <td style="padding-left: 16px;">
              <p style="margin: 0; font-weight: 700; color: #111827; font-size: 15px;">${item.name || 'Product'}</p>
              <p style="margin: 4px 0 0; font-size: 13px; color: #6b7280;">Quantity: ${item.quantity} x ₹${item.price}</p>
            </td>
            <td align="right" valign="top">
              <p style="margin: 0; font-weight: 700; color: #111827; font-size: 15px;">₹${item.quantity * item.price}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>`;
    })
    .join("");
  return `<table width="100%" cellpadding="0" cellspacing="0" style="margin-top: 24px; border-top: 2px solid #111827;">${rows}</table>`;
};

// ------------------------------------------
// CATALOGUE GENERATION HELPER
// ------------------------------------------

function generateMultiPageCatalogue(products) {
  const pages = [];
  
  // Add intro pages first
  console.log("📄 Adding welcome page...");
  pages.push(generateWelcomePage());
  
  console.log("📄 Adding about us page...");
  pages.push(generateAboutPage());
  
  // Group products by category
  const productsByCategory = {};
  products.forEach(p => {
    const cat = p.category || 'other';
    if (!productsByCategory[cat]) {
      productsByCategory[cat] = [];
    }
    productsByCategory[cat].push(p);
  });

  let templateToggle = true; // Start with template 1
  const orphanProducts = []; // Collect orphaned products

  // Generate pages for each category
  Object.keys(productsByCategory).forEach(category => {
    const categoryProducts = productsByCategory[category];
    const collectionTitle = collectionNames[category] || category.charAt(0).toUpperCase() + category.slice(1);

    // Calculate how many full pages we can make (5 products each)
    const fullPages = Math.floor(categoryProducts.length / 5);
    const orphanCount = categoryProducts.length % 5;

    // Add only full pages for this category
    for (let i = 0; i < fullPages; i++) {
      const chunk = categoryProducts.slice(i * 5, (i + 1) * 5);
      
      // Alternate between templates
      const pageHtml = templateToggle 
        ? generateTemplate1(chunk, collectionTitle)
        : generateTemplate2(chunk, collectionTitle);
      
      pages.push(pageHtml);
      templateToggle = !templateToggle;
    }

    // Collect orphan products with their category info
    if (orphanCount > 0) {
      const orphans = categoryProducts.slice(fullPages * 5);
      orphans.forEach(product => {
        orphanProducts.push({ product, category, collectionTitle });
      });
    }
  });

  // Process orphan products at the end
  if (orphanProducts.length > 0) {
    console.log(`📦 Processing ${orphanProducts.length} orphaned products...`);
    
    // Group orphans by category
    const orphansByCategory = {};
    orphanProducts.forEach(({ product, category, collectionTitle }) => {
      if (!orphansByCategory[category]) {
        orphansByCategory[category] = {
          products: [],
          collectionTitle
        };
      }
      orphansByCategory[category].products.push(product);
    });

    // Sort categories by count (descending) to prioritize larger groups
    const sortedOrphanCategories = Object.keys(orphansByCategory).sort((a, b) => {
      return orphansByCategory[b].products.length - orphansByCategory[a].products.length;
    });

    console.log(`   Orphan breakdown by category:`);
    sortedOrphanCategories.forEach(cat => {
      console.log(`     - ${orphansByCategory[cat].collectionTitle}: ${orphansByCategory[cat].products.length} products`);
    });

    // Build pages intelligently - group same categories together when possible
    const orphanPages = [];
    const remainingOrphans = { ...orphansByCategory };

    while (Object.keys(remainingOrphans).some(cat => remainingOrphans[cat].products.length > 0)) {
      const currentPage = [];
      const pageCategoryCounts = {};

      // Try to fill page with products from the same category first
      for (const category of sortedOrphanCategories) {
        if (!remainingOrphans[category] || remainingOrphans[category].products.length === 0) continue;

        const available = remainingOrphans[category].products.length;
        const needed = 5 - currentPage.length;
        const toTake = Math.min(available, needed);

        for (let i = 0; i < toTake; i++) {
          const product = remainingOrphans[category].products.shift();
          currentPage.push({
            product,
            category,
            collectionTitle: remainingOrphans[category].collectionTitle
          });
        }

        pageCategoryCounts[category] = (pageCategoryCounts[category] || 0) + toTake;

        if (currentPage.length === 5) break;
      }

      // Determine page label based on dominant category on THIS page
      let pageLabel = currentPage[0].collectionTitle;
      let maxCountOnPage = 0;
      Object.keys(pageCategoryCounts).forEach(cat => {
        if (pageCategoryCounts[cat] > maxCountOnPage) {
          maxCountOnPage = pageCategoryCounts[cat];
          pageLabel = orphansByCategory[cat].collectionTitle;
        }
      });

      orphanPages.push({
        products: currentPage.map(o => o.product),
        label: pageLabel,
        breakdown: pageCategoryCounts
      });
    }

    // Generate HTML for orphan pages
    orphanPages.forEach((pageData, idx) => {
      const pageHtml = templateToggle 
        ? generateTemplate1(pageData.products, pageData.label)
        : generateTemplate2(pageData.products, pageData.label);
      
      pages.push(pageHtml);
      templateToggle = !templateToggle;

      console.log(`   Orphan Page ${idx + 1}: "${pageData.label}" (${pageData.products.length} products)`);
    });
  }
  
  // Add customization page at the end
  console.log("📄 Adding customization page...");
  pages.push(generateCustomizationPage());
  
  // Add contact page as the final page
  console.log("📄 Adding contact page...");
  pages.push(generateContactPage());

  console.log(`📚 Total pages: ${pages.length}`);
  return pages;
}

// ------------------------------------------
// BULK CATALOGUE GENERATION HELPER
// ------------------------------------------

function generateMultiPageBulkCatalogue(products) {
  const pages = [];
  
  // Add intro pages first
  console.log("📄 Adding welcome page...");
  pages.push(generateWelcomePage());
  
  console.log("📄 Adding about us page...");
  pages.push(generateAboutPage());
  
  // For bulk products, just create pages without category grouping
  // since it's all bulk anyway
  let templateToggle = true; // Start with template 1
  const orphanProducts = []; // Collect orphaned products
  
  // Group products by category (if they have one)
  const productsByCategory = {};
  products.forEach(p => {
    const cat = p.category || 'bulk';
    if (!productsByCategory[cat]) {
      productsByCategory[cat] = [];
    }
    productsByCategory[cat].push(p);
  });

  // Generate pages for each category
  Object.keys(productsByCategory).forEach(category => {
    const categoryProducts = productsByCategory[category];
    const collectionTitle = "Bulk";  // Fixed title for bulk catalogue

    // Calculate how many full pages we can make (5 products each)
    const fullPages = Math.floor(categoryProducts.length / 5);
    const orphanCount = categoryProducts.length % 5;

    // Add only full pages for this category
    for (let i = 0; i < fullPages; i++) {
      const chunk = categoryProducts.slice(i * 5, (i + 1) * 5);
      
      // Alternate between bulk templates
      const pageHtml = templateToggle 
        ? generateBulkTemplate1(chunk, collectionTitle)
        : generateBulkTemplate2(chunk, collectionTitle);
      
      pages.push(pageHtml);
      templateToggle = !templateToggle;
    }

    // Collect orphan products with their category info
    if (orphanCount > 0) {
      const orphans = categoryProducts.slice(fullPages * 5);
      orphans.forEach(product => {
        orphanProducts.push({ product, category, collectionTitle });
      });
    }
  });

  // Process orphan products at the end
  if (orphanProducts.length > 0) {
    console.log(`📦 Processing ${orphanProducts.length} orphaned bulk products...`);
    
    // Build pages with orphans
    const orphanPages = [];
    const currentPage = [];
    
    orphanProducts.forEach(({ product }) => {
      currentPage.push(product);
      
      if (currentPage.length === 5) {
        const pageHtml = templateToggle 
          ? generateBulkTemplate1(currentPage, "Bulk")
          : generateBulkTemplate2(currentPage, "Bulk");
        pages.push(pageHtml);
        templateToggle = !templateToggle;
        currentPage.length = 0;
      }
    });
    
    // Handle any remaining orphans
    if (currentPage.length > 0) {
      const pageHtml = templateToggle 
        ? generateBulkTemplate1(currentPage, "Bulk")
        : generateBulkTemplate2(currentPage, "Bulk");
      pages.push(pageHtml);
    }
  }
  
  // Add customization page at the end
  console.log("📄 Adding customization page...");
  pages.push(generateCustomizationPage());
  
  // Add contact page as the final page
  console.log("📄 Adding contact page...");
  pages.push(generateContactPage());

  console.log(`📚 Total bulk pages: ${pages.length}`);
  return pages;
}

// ------------------------------------------
// ADMIN ENDPOINTS (PRODUCTS)
// ------------------------------------------

app.post("/api/admin/products", maybeAuth, async (req, res) => {
  try {
    if (!(await isAdminUid(req.user?.uid)))
      return res.status(403).json({ error: "Access Denied" });
    const { product } = req.body;
    if (!product?.name)
      return res.status(400).json({ error: "Invalid product data" });

    const docRef = await db.collection("products").add({
      ...product,
      isActive: product.isActive !== false,
      inventory:
        typeof product.inventory === "number" ? product.inventory : 100,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.json({ id: docRef.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch("/api/admin/products/:id", maybeAuth, async (req, res) => {
  try {
    if (!(await isAdminUid(req.user?.uid)))
      return res.status(403).json({ error: "Access Denied" });
    await db
      .collection("products")
      .doc(req.params.id)
      .update({
        ...req.body.product,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/admin/products/:id", maybeAuth, async (req, res) => {
  try {
    if (!(await isAdminUid(req.user?.uid)))
      return res.status(403).json({ error: "Access Denied" });
    await db.collection("products").doc(req.params.id).update({
      isActive: false,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/admin/products/:id/permanent", maybeAuth, async (req, res) => {
  try {
    if (!(await isAdminUid(req.user?.uid)))
      return res.status(403).json({ error: "Access Denied" });
    
    // Fetch product to get imageUrl before deletion
    const productDoc = await db.collection("products").doc(req.params.id).get();
    
    if (productDoc.exists) {
      const productData = productDoc.data();
      const imageUrl = productData.imageUrl;
      
      // Try to delete from Cloudinary, but don't block database deletion if it fails
      if (imageUrl) {
        try {
          const publicId = extractCloudinaryPublicId(imageUrl);
          if (publicId) {
            const result = await cloudinary.uploader.destroy(publicId);
            console.log(`🗑️ Cloudinary image deleted: ${publicId}`, result);
          } else {
            console.warn(`⚠️ Could not extract public ID from URL: ${imageUrl}`);
          }
        } catch (cloudinaryError) {
          console.error(`❌ Cloudinary deletion failed for ${imageUrl}:`, cloudinaryError.message);
          // Continue with database deletion even if Cloudinary fails
        }
      }
    }
    
    // Delete from database
    await db.collection("products").doc(req.params.id).delete();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------
// OFFER MANAGEMENT ENDPOINTS
// ------------------------------------------

// GET active offer (public)
app.get("/api/offers/active", async (req, res) => {
  try {
    const offerDoc = await db.collection("settings").doc("offerBanner").get();
    
    if (!offerDoc.exists || !offerDoc.data().isActive) {
      return res.json({ offer: null });
    }
    
    res.json({ offer: offerDoc.data() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET current offer settings (admin only)
app.get("/api/admin/offers", maybeAuth, async (req, res) => {
  try {
    if (!(await isAdminUid(req.user?.uid)))
      return res.status(403).json({ error: "Access Denied" });
    
    const offerDoc = await db.collection("settings").doc("offerBanner").get();
    
    if (!offerDoc.exists) {
      // Return default settings if none exist
      return res.json({
        offer: {
          isActive: false,
          offerText: "Special Offer - Shop Now!",
          email: "cozycreationscorner13@gmail.com",
          phone: "+91 80194 01322"
        }
      });
    }
    
    res.json({ offer: offerDoc.data() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// UPDATE offer settings (admin only)
app.put("/api/admin/offers", maybeAuth, async (req, res) => {
  try {
    if (!(await isAdminUid(req.user?.uid)))
      return res.status(403).json({ error: "Access Denied" });
    
    const { 
      isActive, offerText, offerHeading, email, phone,
      hasDiscount, discountType, discountValue,
      applicableToAll, applicableCategories, applicableProducts,
      minCartValue, bannerImageUrl
    } = req.body;
    
    const offerData = {
      // Banner settings
      isActive: isActive !== undefined ? isActive : false,
      offerText: offerText || "",
      offerHeading: offerHeading || "Special Offer",
      email: email || "cozycreationscorner13@gmail.com",
      phone: phone || "+91 80194 01322",
      bannerImageUrl: bannerImageUrl || "",
      
      // Discount settings
      hasDiscount: hasDiscount !== undefined ? hasDiscount : false,
      discountType: discountType || "percentage",
      discountValue: discountValue !== undefined ? discountValue : 0,
      
      // Targeting
      applicableToAll: applicableToAll !== undefined ? applicableToAll : true,
      applicableCategories: applicableCategories || [],
      applicableProducts: applicableProducts || [],
      
      // Constraints
      minCartValue: minCartValue !== undefined ? minCartValue : 0,
      
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };
    
    await db.collection("settings").doc("offerBanner").set(offerData, { merge: true });
    
    res.json({ success: true, offer: offerData });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------
// DELIVERY SETTINGS ENDPOINTS
// ------------------------------------------

// GET delivery settings (public)
app.get("/api/settings/delivery", async (req, res) => {
  try {
    const doc = await db.collection("settings").doc("delivery").get();
    if (!doc.exists) {
      return res.json({
        delivery: {
          isActive: false,
          amount: 0,
          freeDeliveryThreshold: 0,
          message: ""
        }
      });
    }
    res.json({ delivery: doc.data() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// UPDATE delivery settings (admin)
app.put("/api/admin/settings/delivery", maybeAuth, async (req, res) => {
  try {
    if (!(await isAdminUid(req.user?.uid)))
      return res.status(403).json({ error: "Access Denied" });

    const { isActive, amount, freeDeliveryThreshold, message } = req.body;

    const data = {
      isActive: isActive !== undefined ? isActive : false,
      amount: typeof amount === "number" ? amount : 0,
      freeDeliveryThreshold: typeof freeDeliveryThreshold === "number" ? freeDeliveryThreshold : 0,
      message: message || "",
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    await db.collection("settings").doc("delivery").set(data, { merge: true });
    res.json({ success: true, delivery: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------
// PAYMENT SETTINGS ENDPOINTS
// ------------------------------------------

// GET payment settings (public)
app.get("/api/settings/payment", async (req, res) => {
  try {
    const doc = await db.collection("settings").doc("payment").get();
    if (!doc.exists) {
      return res.json({
        payment: {
          isCodEnabled: true, // Default to true
        }
      });
    }
    res.json({ payment: doc.data() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// UPDATE payment settings (admin)
app.put("/api/admin/settings/payment", maybeAuth, async (req, res) => {
  try {
    if (!(await isAdminUid(req.user?.uid)))
      return res.status(403).json({ error: "Access Denied" });

    const { isCodEnabled } = req.body;

    const data = {
      isCodEnabled: isCodEnabled !== undefined ? isCodEnabled : true,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    await db.collection("settings").doc("payment").set(data, { merge: true });
    res.json({ success: true, payment: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// CALCULATE discount for a product (public)
app.post("/api/offers/calculate-discount", async (req, res) => {
  try {
    const { productId, productPrice, category } = req.body;
    
    // Fetch active offer
    const offerDoc = await db.collection("settings").doc("offerBanner").get();
    
    if (!offerDoc.exists || !offerDoc.data().hasDiscount) {
      return res.json({ 
        hasDiscount: false,
        originalPrice: productPrice,
        discountedPrice: productPrice,
        savedAmount: 0,
        discountPercent: 0
      });
    }
    
    const offer = offerDoc.data();
    
    // Check if product qualifies for discount
    let qualifies = false;
    
    if (offer.applicableToAll) {
      qualifies = true;
    } else {
      // Check category filter
      if (offer.applicableCategories && offer.applicableCategories.length > 0) {
        if (offer.applicableCategories.includes(category)) {
          qualifies = true;
        }
      }
      
      // Check product filter
      if (offer.applicableProducts && offer.applicableProducts.length > 0) {
        if (offer.applicableProducts.includes(productId)) {
          qualifies = true;
        }
      }
    }
    
    if (!qualifies) {
      return res.json({ 
        hasDiscount: false,
        originalPrice: productPrice,
        discountedPrice: productPrice,
        savedAmount: 0,
        discountPercent: 0
      });
    }
    
    // Calculate discount
    let discountAmount = 0;
    let discountPercent = 0;
    
    if (offer.discountType === "percentage") {
      discountPercent = offer.discountValue;
      discountAmount = (productPrice * offer.discountValue) / 100;
    } else if (offer.discountType === "fixed") {
      discountAmount = Math.min(offer.discountValue, productPrice); // Cap at product price
      discountPercent = Math.round((discountAmount / productPrice) * 100);
    }
    
    const discountedPrice = Math.max(0, productPrice - discountAmount);
    
    res.json({
      hasDiscount: true,
      originalPrice: productPrice,
      discountedPrice: Math.round(discountedPrice),
      savedAmount: Math.round(discountAmount),
      discountPercent: discountPercent,
      discountType: offer.discountType
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------
// ORDER & PAYMENT FLOW
// ------------------------------------------

app.post("/api/orders/create-payment", maybeAuth, async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Login required" });
    const razorpayOrder = await razorpay.orders.create({
      amount: Math.round(req.body.total * 100),
      currency: "INR",
      receipt: `order_${Date.now()}`,
    });
    res.json({
      orderId: razorpayOrder.id,
      amount: razorpayOrder.amount,
      currency: razorpayOrder.currency,
      key: process.env.RAZORPAY_KEY_ID,
    });
  } catch (err) {
    res.status(500).json({ error: "Payment initiation failed" });
  }
});

app.post("/api/orders/verify-payment", maybeAuth, async (req, res) => {
  const {
    razorpay_order_id,
    razorpay_payment_id,
    razorpay_signature,
    orderData,
  } = req.body;
  try {
    const hmac = crypto.createHmac("sha256", process.env.RAZORPAY_KEY_SECRET);
    hmac.update(`${razorpay_order_id}|${razorpay_payment_id}`);
    if (hmac.digest("hex") !== razorpay_signature) {
      return res.status(400).json({ error: "Payment verification failed" });
    }

    // Update inventory
    for (const item of orderData.items) {
      const pRef = db.collection("products").doc(item.productId);
      const pSnap = await pRef.get();
      if (pSnap.exists && typeof pSnap.data().inventory === "number") {
        await pRef.update({
          inventory: Math.max(0, pSnap.data().inventory - item.quantity),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
    }

    const orderRef = await db.collection("orders").add({
      ...orderData,
      userId: req.user?.uid || "guest",
      status: "confirmed",
      statusHistory: {
        pending: admin.firestore.FieldValue.serverTimestamp(),
        confirmed: admin.firestore.FieldValue.serverTimestamp()
      },
      paymentId: razorpay_payment_id,
      courierId: orderData.courierId || null,
      courierName: orderData.courierName || null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.json({ success: true, orderId: orderRef.id });
  } catch (err) {
    res.status(500).json({ error: "Order processing failed" });
  }
});

app.post("/api/orders/place-cod", maybeAuth, async (req, res) => {
  try {
    const { items, total, shippingAddress, customerName, userEmail } = req.body;

    // Update inventory
    for (const item of items) {
      const pRef = db.collection("products").doc(item.productId);
      const pSnap = await pRef.get();
      if (pSnap.exists && typeof pSnap.data().inventory === "number") {
        await pRef.update({
          inventory: Math.max(0, pSnap.data().inventory - item.quantity),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
    }

    const orderRef = await db.collection("orders").add({
      userId: req.user?.uid || "guest",
      items,
      total,
      shippingAddress,
      customerName,
      userEmail,
      courierId: req.body.courierId || null,
      courierName: req.body.courierName || null,
      status: "pending",
      statusHistory: {
        pending: admin.firestore.FieldValue.serverTimestamp()
      },
      paymentMethod: "cod",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.json({ success: true, orderId: orderRef.id });
  } catch (err) {
    res.status(500).json({ error: "Order placement failed" });
  }
});

// ------------------------------------------
// ADMIN VIEWS
// ------------------------------------------

app.get("/api/admin/orders", maybeAuth, async (req, res) => {
  try {
    if (!(await isAdminUid(req.user?.uid)))
      return res.status(403).json({ error: "Forbidden" });
    const snap = await db
      .collection("orders")
      .orderBy("createdAt", "desc")
      .limit(100)
      .get();
    res.json({ orders: snap.docs.map((d) => ({ id: d.id, ...d.data() })) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch("/api/admin/orders/:id", maybeAuth, async (req, res) => {
  try {
    if (!(await isAdminUid(req.user?.uid)))
      return res.status(403).json({ error: "Forbidden" });
    const updateData = {
      status: req.body.status,
      [`statusHistory.${req.body.status.toLowerCase()}`]: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (req.body.expectedDeliveryDate) {
      updateData.expectedDeliveryDate = req.body.expectedDeliveryDate;
    }
    await db.collection("orders").doc(req.params.id).update(updateData);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/admin/users/:uid", maybeAuth, async (req, res) => {
  try {
    if (!(await isAdminUid(req.user?.uid)))
      return res.status(403).json({ error: "Forbidden" });
    await admin.auth().deleteUser(req.params.uid);
    await db.collection("users").doc(req.params.uid).delete();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/admin/users", maybeAuth, async (req, res) => {
  try {
    if (!(await isAdminUid(req.user?.uid)))
      return res.status(403).json({ error: "Forbidden" });

    const { email, password, displayName, role } = req.body;

    const userRecord = await admin.auth().createUser({
      email,
      password,
      displayName,
    });

    await db.collection("users").doc(userRecord.uid).set({
      uid: userRecord.uid,
      email,
      displayName,
      role: role || "user",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.json({ success: true, uid: userRecord.uid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/admin/generate-catalogue", maybeAuth, async (req, res) => {
  console.log("📥 Catalogue Generation Request Received");
  try {
    if (!(await isAdminUid(req.user?.uid))) {
      console.warn("🚫 Unauthorized Catalogue Request:", req.user?.uid);
      return res.status(403).json({ error: "Access Denied" });
    }

    console.log("🔍 Fetching active products (excluding bulk)...");
    const snap = await db.collection("products").where("isActive", "!=", false).get();
    const allProducts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    
    // Filter out bulk products (only include normal products)
    const products = allProducts.filter(p => p.isBulk !== true);

    console.log(`📦 Found ${products.length} normal products (${allProducts.length - products.length} bulk products excluded)`);
    if (products.length === 0) {
      return res.status(404).json({ error: "No active products found" });
    }

    console.log("📄 Generating multi-page catalogue...");
    const pages = generateMultiPageCatalogue(products);
    console.log(`📑 Generated ${pages.length} pages`);

    console.log("🌐 Launching Puppeteer...");
    
    // Diagnostic logs for Render debugging
    console.log("📂 Current Directory:", __dirname);
    console.log("📁 Cache Dir ENV:", process.env.PUPPETEER_CACHE_DIR);

    const launchOptions = {
      headless: "new",
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
    };

    // Force exact path if cache dir is set (specifically for Render)
    if (process.env.PUPPETEER_CACHE_DIR) {
      console.log("🎯 Using manual cache path resolution...");
    }

    const browser = await puppeteer.launch(launchOptions);

    const pdfBuffers = new Array(pages.length);
    const userId = req.user.uid;
    const BATCH_SIZE = 3; // Render up to 3 pages concurrently

    for (let batchStart = 0; batchStart < pages.length; batchStart += BATCH_SIZE) {
      const batchEnd = Math.min(batchStart + BATCH_SIZE, pages.length);
      const batchIndices = Array.from({ length: batchEnd - batchStart }, (_, k) => batchStart + k);

      const progressPercent = Math.round((batchStart / pages.length) * 100);
      catalogueProgress.set(userId, {
        progress: progressPercent,
        currentAction: `Rendering pages ${batchStart + 1}-${batchEnd} of ${pages.length}`,
      });
      console.log(`⏳ Rendering pages ${batchStart + 1}-${batchEnd}/${pages.length} (batch of ${batchIndices.length})...`);

      await Promise.all(
        batchIndices.map(async (i) => {
          const page = await browser.newPage();
          page.setDefaultNavigationTimeout(120000);
          page.setDefaultTimeout(120000);

          // Inline all static Cloudinary assets — fonts + decorative images read from memory (no network)
          const inlinedHtml = inlineCatalogueAssets(pages[i]);

          // networkidle2: wait until ≤2 pending connections (only dynamic product images remain)
          await page.setContent(inlinedHtml, { waitUntil: 'networkidle2', timeout: 120000 });

          // Fonts are now embedded as base64 so document.fonts.ready resolves instantly
          try { await page.evaluateHandle(() => document.fonts.ready); } catch (e) {}

          const pdfBuffer = await page.pdf({
            format: 'A4',
            printBackground: true,
            margin: { top: '0px', right: '0px', bottom: '0px', left: '0px' },
            preferCSSPageSize: false,
            tagged: false,
          });

          pdfBuffers[i] = pdfBuffer;
          await page.close();
        })
      );
    }

    catalogueProgress.set(userId, { progress: 95, currentAction: "Finalizing PDF..." });

    console.log("✅ All pages rendered, merging PDFs...");
    await browser.close();

    // Merge all PDF buffers into a single document
    const mergedPdf = await PDFDocument.create();
    
    for (const pdfBuffer of pdfBuffers) {
      const pdf = await PDFDocument.load(pdfBuffer);
      const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
      copiedPages.forEach((page) => mergedPdf.addPage(page));
    }

    const finalPdf = await mergedPdf.save();
    catalogueProgress.delete(userId);

    res.contentType("application/pdf");
    res.setHeader("Content-Disposition", "attachment; filename=cozy-creations-catalogue.pdf");
    res.header('Access-Control-Expose-Headers', 'Content-Disposition');
    res.send(finalPdf);

  } catch (err) {
    catalogueProgress.delete(req.user?.uid);
    console.error("❌ Catalogue Generation Error:", err);
    res.status(500).json({ error: "Failed to generate catalogue", details: err.message });
  }
});

// Bulk Catalogue Generation
app.get("/api/admin/generate-bulk-catalogue", maybeAuth, async (req, res) => {
  console.log("📥 Bulk Catalogue Generation Request Received");
  try {
    if (!(await isAdminUid(req.user?.uid))) {
      console.warn("🚫 Unauthorized Bulk Catalogue Request:", req.user?.uid);
      return res.status(403).json({ error: "Access Denied" });
    }

    console.log("🔍 Fetching active bulk products...");
    const snap = await db.collection("products").where("isActive", "!=", false).get();
    const allProducts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    
    // Filter to include ONLY bulk products (check for bulkPricingTiers as primary indicator)
    const products = allProducts.filter(p => 
      (p.bulkPricingTiers && p.bulkPricingTiers.length > 0) || p.isBulk === true
    );

    console.log(`📦 Found ${products.length} bulk products (${allProducts.length - products.length} normal products excluded)`);
    if (products.length === 0) {
      return res.status(404).json({ error: "No active bulk products found" });
    }

    console.log("📄 Generating multi-page bulk catalogue...");
    const pages = generateMultiPageBulkCatalogue(products);
    console.log(`📑 Generated ${pages.length} pages`);

    console.log("🌐 Launching Puppeteer...");
    
    const launchOptions = {
      headless: "new",
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
    };

    const browser = await puppeteer.launch(launchOptions);

    const pdfBuffers = new Array(pages.length);
    const userId = req.user.uid;
    const BATCH_SIZE = 3;

    for (let batchStart = 0; batchStart < pages.length; batchStart += BATCH_SIZE) {
      const batchEnd = Math.min(batchStart + BATCH_SIZE, pages.length);
      const batchIndices = Array.from({ length: batchEnd - batchStart }, (_, k) => batchStart + k);

      const progressPercent = Math.round((batchStart / pages.length) * 100);
      catalogueProgress.set(userId, {
        progress: progressPercent,
        currentAction: `Rendering pages ${batchStart + 1}-${batchEnd} of ${pages.length}`,
      });
      console.log(`⏳ Rendering bulk pages ${batchStart + 1}-${batchEnd}/${pages.length} (batch of ${batchIndices.length})...`);

      await Promise.all(
        batchIndices.map(async (i) => {
          const page = await browser.newPage();
          page.setDefaultNavigationTimeout(120000);
          page.setDefaultTimeout(120000);

          const inlinedHtml = inlineCatalogueAssets(pages[i]);
          await page.setContent(inlinedHtml, { waitUntil: 'networkidle2', timeout: 120000 });

          try { await page.evaluateHandle(() => document.fonts.ready); } catch (e) {}

          const pdfBuffer = await page.pdf({
            format: 'A4',
            printBackground: true,
            margin: { top: '0px', right: '0px', bottom: '0px', left: '0px' },
            preferCSSPageSize: false,
            tagged: false,
          });

          pdfBuffers[i] = pdfBuffer;
          await page.close();
        })
      );
    }

    catalogueProgress.set(userId, { progress: 95, currentAction: "Finalizing PDF..." });

    console.log("✅ All pages rendered, merging PDFs...");
    await browser.close();

    // Merge all PDF buffers into a single document
    const mergedPdf = await PDFDocument.create();
    
    for (const pdfBuffer of pdfBuffers) {
      const pdf = await PDFDocument.load(pdfBuffer);
      const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
      copiedPages.forEach((page) => mergedPdf.addPage(page));
    }

    const finalPdf = await mergedPdf.save();
    console.log(`📚 Merged ${pdfBuffers.length} pages into final bulk PDF`);

    res.contentType("application/pdf");
    catalogueProgress.delete(userId);

    res.contentType("application/pdf");
    res.setHeader("Content-Disposition", "attachment; filename=cozy-creations-bulk-catalogue.pdf");
    res.header('Access-Control-Expose-Headers', 'Content-Disposition');
    res.send(finalPdf);

  } catch (err) {
    catalogueProgress.delete(req.user?.uid);
    console.error("❌ Bulk Catalogue Generation Error:", err);
    res.status(500).json({ error: "Failed to generate bulk catalogue", details: err.message });
  }
});

// ------------------------------------------
// EMAIL SERVICES
// ------------------------------------------

app.post("/api/send-welcome-email", async (req, res) => {
  try {
    await resend.emails.send({
      from: `Cozy Creations <${EMAIL_FROM}>`,
      to: req.body.email,
      subject: "Welcome to Cozy Creations 🕯️",
      html: wrapLayout(
        "Welcome to Cozy Creations 🕯️",
        "<p>We're thrilled to have you! Explore our handcrafted candles and find your perfect glow.</p>",
        req.body.name
      ),
    });
    res.json({ success: true });
  } catch (err) {
    console.error("❌ Welcome Email Error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/send-order-confirmation", async (req, res) => {
  const { email, orderData } = req.body;
  try {
    const table = buildItemTable(orderData.items);
    const customerHtml = wrapLayout(
      "Order Confirmed 🕯️",
      `<p>Thank you for your order! We're preparing it with care.</p>${table}<p style="margin-top:20px; font-size:18px; font-weight:700;">Grand Total: ₹${orderData.total}</p>`,
      orderData.customerName || "Customer"
    );

    // Send to customer
    await resend.emails.send({
      from: `Cozy Creations <${EMAIL_FROM}>`,
      to: email,
      subject: "Order Confirmed! 🕯️",
      html: customerHtml,
    });

    // Send to admin
    await resend.emails.send({
      from: `Cozy Creations <${EMAIL_FROM}>`,
      to: ADMIN_EMAIL,
      subject: `🚨 New Order - ₹${orderData.total}`,
      html: wrapLayout(
        "New Order Received",
        `<p>From: ${orderData.customerName}</p>${table}<p style="font-weight:700;">Total: ₹${orderData.total}</p>`,
        "Admin"
      ),
    });

    res.json({ success: true });
  } catch (err) {
    console.error("❌ Order Confirmation Error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/send-status-update", async (req, res) => {
  try {
    const { email, status, name, expectedDeliveryDate } = req.body;
    let deliveryNote = "";
    if (expectedDeliveryDate) {
      const dateStr = new Date(expectedDeliveryDate).toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
      deliveryNote = `<p style="margin-top:16px; font-weight:700; color:#166534;">Estimated Arrival: ${dateStr}</p>`;
    }

    await resend.emails.send({
      from: `Cozy Creations <${EMAIL_FROM}>`,
      to: email,
      subject: `Order Update - ${status}`,
      html: wrapLayout(
        "Order Update 📦",
        `<div style="padding:20px; background:#f0fdf4; border-radius:12px; text-align:center;"><h3 style="margin:0; color:#166534;">Status: ${status.toUpperCase()}</h3>${deliveryNote}</div><p style="margin-top:20px;">We'll keep you posted as your order progresses.</p>`,
        name
      ),
    });
    res.json({ success: true });
  } catch (err) {
    console.error("❌ Status Update Error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/send-password-reset", async (req, res) => {
  const { email } = req.body;
  try {
    // 1. Fetch user to check provider
    const userRecord = await admin.auth().getUserByEmail(email);
    const hasPasswordProvider = userRecord.providerData.some(p => p.providerId === "password");

    if (hasPasswordProvider) {
      // 2a. Handle Email/Password User
      const link = await admin.auth().generatePasswordResetLink(email);
      await resend.emails.send({
        from: `Cozy Creations <${EMAIL_FROM}>`,
        to: email,
        subject: "Reset Your Password - Cozy Creations 🕯️",
        html: wrapLayout(
          "Password Reset",
          `<p>We received a request to reset your password. Click the button below to secure your account:</p>
           <div style="text-align: center; margin: 32px 0;">
             <a href="${link}" style="display:inline-block; padding:14px 28px; background:#111827; color:#fff; text-decoration:none; border-radius:8px; font-weight:600; font-size:16px;">Reset My Password</a>
           </div>
           <p style="color:#6b7280; font-size:14px;">If you didn't request this, you can safely ignore this email.</p>`,
          userRecord.displayName || "Customer"
        ),
      });
    } else {
      // 2b. Handle Google-only User (Friendly Reminder)
      await resend.emails.send({
        from: `Cozy Creations <${EMAIL_FROM}>`,
        to: email,
        subject: "Login Verification - Cozy Creations 🕯️",
        html: wrapLayout(
          "Use Google Login",
          `<div style="background:#f0f9ff; padding:24px; border-radius:12px; border:1px solid #bae6fd;">
             <p style="margin:0; color:#0369a1; font-weight:600;">It looks like you use Google Login!</p>
             <p style="margin-top:12px; color:#075985;">Your account is secured via Google, so you don't even need a password for Cozy Creations. Simply click the <strong>'Continue with Google'</strong> button on our login screen to access your account instantly.</p>
           </div>`,
          userRecord.displayName || "Customer"
        ),
      });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("❌ Password Reset Error:", err);
    // If user not found, we don't want to leak that info for security, so we still say "Success"
    if (err.code === 'auth/user-not-found') {
      return res.json({ success: true, message: "If an account exists, a link has been sent." });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/contact", async (req, res) => {
  try {
    const { name, email, phone, collection, product, productName, quantity, customization, location } = req.body;
    
    // Build collection display name
    const collectionNames = {
      flower: "Flower Collection",
      animal: "Animal Collection",
      festive: "Festive Collection",
      glassJar: "Glass Jar Collection",
      special: "Special Collection",
    };
    const collectionDisplay = collectionNames[collection] || collection || "Not specified";
    
    // Build product display (name + ID)
    const productDisplay = productName 
      ? `${productName} (ID: ${product})`
      : product || "Not specified";
    
    // Build inquiry details content
    const inquiryContent = `
      <div style="background: #f9fafb; padding: 20px; border-radius: 12px; margin: 24px 0;">
        <h3 style="margin: 0 0 16px; font-size: 16px; color: #111827; font-weight: 700;">Customer Information</h3>
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="padding: 8px 0; color: #6b7280; font-size: 14px; width: 140px;">Email:</td>
            <td style="padding: 8px 0; color: #111827; font-size: 14px; font-weight: 600;">${email || "Not provided"}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Phone:</td>
            <td style="padding: 8px 0; color: #111827; font-size: 14px; font-weight: 600;">${phone || "Not provided"}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Location:</td>
            <td style="padding: 8px 0; color: #111827; font-size: 14px; font-weight: 600;">${location || "Not provided"}</td>
          </tr>
        </table>
      </div>
      <div style="background: #fef3c7; padding: 20px; border-radius: 12px; border-left: 4px solid #FACC15; margin: 24px 0;">
        <h3 style="margin: 0 0 16px; font-size: 16px; color: #111827; font-weight: 700;">Product Inquiry</h3>
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="padding: 8px 0; color: #6b7280; font-size: 14px; width: 140px;">Collection:</td>
            <td style="padding: 8px 0; color: #111827; font-size: 14px; font-weight: 600;">${collectionDisplay}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Product:</td>
            <td style="padding: 8px 0; color: #111827; font-size: 14px; font-weight: 600;">${productDisplay}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Quantity:</td>
            <td style="padding: 8px 0; color: #111827; font-size: 14px; font-weight: 600;">${quantity || "Not specified"}</td>
          </tr>
          ${customization ? `
          <tr>
            <td style="padding: 8px 0; color: #6b7280; font-size: 14px; vertical-align: top;">Customization:</td>
            <td style="padding: 8px 0; color: #111827; font-size: 14px; font-weight: 600;">${customization}</td>
          </tr>
          ` : ""}
        </table>
      </div>
    `;
    
    // Send email to admin using consistent wrapLayout template
    await resend.emails.send({
      from: `Cozy Creations <${EMAIL_FROM}>`,
      to: ADMIN_EMAIL,
      subject: `🕯️ New Inquiry from ${name}`,
      html: wrapLayout(
        "New Contact Inquiry 📬",
        inquiryContent,
        "Admin"
      ),
    });
    
    res.json({ success: true, message: "Inquiry submitted successfully" });
  } catch (error) {
    console.error("❌ Contact form error:", error);
    res.status(500).json({ success: false, message: "Failed to submit inquiry" });
  }
});

// ------------------------------------------
// PACKAGING SETTINGS ROUTES
// ------------------------------------------

const DEFAULT_PACKAGING = {
  flower:   { l: 12, w: 12, h: 10, actualWeight: 0.4 },
  animal:   { l: 15, w: 15, h: 12, actualWeight: 0.5 },
  festive:  { l: 18, w: 15, h: 12, actualWeight: 0.6 },
  glassjar: { l: 12, w: 12, h: 14, actualWeight: 0.7 },
  special:  { l: 20, w: 20, h: 15, actualWeight: 0.8 },
};

/**
 * GET /api/settings/packaging
 * Public: Returns per-category packaging dimensions used for volumetric weight calculation.
 */
app.get("/api/settings/packaging", async (req, res) => {
  try {
    const snap = await db.collection("settings").doc("packaging").get();
    const saved = snap.exists ? (snap.data().categoryPackaging || {}) : {};
    // Merge saved values over defaults so any category not yet configured uses a safe default
    const merged = Object.keys(DEFAULT_PACKAGING).reduce((acc, cat) => {
      acc[cat] = { ...DEFAULT_PACKAGING[cat], ...(saved[cat] || {}) };
      return acc;
    }, {});
    res.json({ categoryPackaging: merged });
  } catch (err) {
    console.error("❌ Packaging settings fetch error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/admin/settings/packaging
 * Admin-only: Save per-category packaging dimensions.
 * Body: { categoryPackaging: { flower: { l, w, h, actualWeight }, ... } }
 */
app.put("/api/admin/settings/packaging", authenticateToken, async (req, res) => {
  try {
    if (!(await isAdminUid(req.user?.uid)))
      return res.status(403).json({ error: "Access Denied" });
    const { categoryPackaging } = req.body;
    if (!categoryPackaging) return res.status(400).json({ error: "categoryPackaging is required" });
    await db.collection("settings").doc("packaging").set({ categoryPackaging }, { merge: true });
    res.json({ success: true });
  } catch (err) {
    console.error("❌ Packaging settings save error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------
// SHIPROCKET LOGISTICS ROUTES
// ------------------------------------------
const { srFetch } = require("./shiprocket");

/**
 * GET /api/shipping/check-serviceability?pincode=XXXXXX&cod=1
 * Checks if a destination pincode is serviceable by Shiprocket couriers.
 */
app.get("/api/shipping/check-serviceability", authenticateToken, async (req, res) => {
  const { pincode, cod = 0, weight = 0.5 } = req.query;
  if (!pincode) return res.status(400).json({ error: "pincode is required" });

  try {
    const PICKUP_PINCODE = process.env.SHIPROCKET_PICKUP_PINCODE || "110001";
    const data = await srFetch(
      `/courier/serviceability/?pickup_postcode=${PICKUP_PINCODE}&delivery_postcode=${pincode}&cod=${cod}&weight=${weight}`
    );
    res.json({ success: true, data });
  } catch (err) {
    console.error("❌ Shiprocket serviceability error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/orders/create-shipment
 * Admin-triggered. Creates a shipment in Shiprocket for a confirmed order.
 * Body: { orderId }
 */
app.post("/api/orders/create-shipment", authenticateToken, async (req, res) => {
  const { orderId } = req.body;
  if (!orderId) return res.status(400).json({ error: "orderId is required" });

  try {
    // Fetch order from Firestore
    const orderRef = db.collection("orders").doc(orderId);
    const orderSnap = await orderRef.get();
    if (!orderSnap.exists) return res.status(404).json({ error: "Order not found" });
    const order = orderSnap.data();

    const addr = order.shippingAddress || {};
    
    // Validation: Check for mandatory address fields
    const requiredFields = ["fullName", "street", "city", "pincode", "state", "phone"];
    const missing = requiredFields.filter(f => !addr[f]);
    if (missing.length > 0) {
      return res.status(400).json({ 
        error: `Incomplete address. Missing fields: ${missing.join(", ")}. Please update the order's shipping address in Firestore first.` 
      });
    }


    // --- Load per-category packaging config from Firestore ---
    const pkgSnap = await db.collection("settings").doc("packaging").get();
    const savedPkg = pkgSnap.exists ? (pkgSnap.data().categoryPackaging || {}) : {};
    const DEFAULT_PKG = {
      flower:   { l: 12, w: 12, h: 10 },
      animal:   { l: 15, w: 15, h: 12 },
      festive:  { l: 18, w: 15, h: 12 },
      glassjar: { l: 12, w: 12, h: 14 },
      special:  { l: 20, w: 20, h: 15 },
    };
    const getPkg = (category) => {
      const cat = (category || "").toLowerCase();
      return { ...DEFAULT_PKG[cat], ...(savedPkg[cat] || {}) } || { l: 15, w: 15, h: 15 };
    };

    // Calculate chargeable weight:
    // - actualWeight = item.weightGrams (from product, saved on order) / 1000
    // - volumetricWeight = (L × W × H) / 5000  (Shiprocket formula)
    // - chargeableWeight = max(actual, volumetric) per unit × quantity
    const totalWeight = Math.max(0.5, Number(
      (order.items || []).reduce((sum, item) => {
        const pkg = getPkg(item.category);
        const actualWeight = item.weightGrams ? (item.weightGrams / 1000) : 0.3;
        const volumetric = (pkg.l && pkg.w && pkg.h) ? (pkg.l * pkg.w * pkg.h) / 5000 : 0;
        const chargeable = volumetric > 0 ? Math.max(actualWeight, volumetric) : actualWeight;
        return sum + ((item.quantity || 1) * chargeable);
      }, 0).toFixed(2)
    ));

    // Determine dimensions from the dominant category (most units)
    const categoryCounts = {};
    (order.items || []).forEach(item => {
      const cat = (item.category || "special").toLowerCase();
      categoryCounts[cat] = (categoryCounts[cat] || 0) + (item.quantity || 1);
    });
    const dominantCategory = Object.entries(categoryCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "special";
    const dominantPkg = getPkg(dominantCategory);

    // Split name into first and last (some SR accounts require last_name to be non-empty)
    const nameParts = (addr.fullName || "").trim().split(" ");
    const firstName = nameParts[0] || "Customer";
    const lastName = nameParts.slice(1).join(" ") || ".";

    // Shiprocket expects order_date in "YYYY-MM-DD HH:MM" format
    const createdAt = order.createdAt?.toDate ? order.createdAt.toDate() : 
                     (order.createdAt?.seconds ? new Date(order.createdAt.seconds * 1000) : new Date(order.createdAt));
    const formattedDate = createdAt.toISOString().replace('T', ' ').slice(0, 16);

    const payload = {
      order_id: orderId,
      order_date: formattedDate,
      pickup_location: process.env.SHIPROCKET_PICKUP_LOCATION || "Primary",
      channel_id: "",
      comment: "Cozy Creations - Artisanal Order",
      billing_customer_name: firstName,
      billing_last_name: lastName,
      billing_address: String(addr.street),
      billing_address_2: ".",
      billing_city: String(addr.city),
      billing_pincode: String(addr.pincode),
      billing_state: String(addr.state),
      billing_country: "India",
      billing_email: order.userEmail || "customer@example.com",
      billing_phone: String(addr.phone),
      shipping_is_billing: 1,
      shipping_customer_name: firstName,
      shipping_last_name: lastName,
      shipping_address: String(addr.street),
      shipping_address_2: ".",
      shipping_city: String(addr.city),
      shipping_pincode: String(addr.pincode),
      shipping_state: String(addr.state),
      shipping_country: "India",
      shipping_email: order.userEmail || "customer@example.com",
      shipping_phone: String(addr.phone),
      order_items: (order.items || []).map((item) => ({
        name: item.name || "Artisanal Product",
        sku: item.productId || "CUSTOM",
        units: Number(item.quantity) || 1,
        selling_price: Number(item.price) || 0,
        discount: 0,
        tax: 0,
      })),
      payment_method: order.paymentMethod === "cod" ? "COD" : "Prepaid",
      shipping_charges: 0,
      giftwrap_charges: 0,
      transaction_charges: 0,
      total_discount: 0,
      sub_total: Number(order.total) || 0,
      length: dominantPkg.l || 15,
      breadth: dominantPkg.w || 15,
      height: dominantPkg.h || 15,
      weight: totalWeight,
    };

    console.log(`📦 Sending payload to Shiprocket for order ${orderId}:`, JSON.stringify(payload, null, 2));
    
    try {
      const srResponse = await srFetch("/orders/create/adhoc", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      console.log(`✅ Shiprocket Response for ${orderId}:`, JSON.stringify(srResponse, null, 2));

      // --- NEW: Automatically assign the courier if courierId exists ---
      if (srResponse.shipment_id && order.courierId) {
        console.log(`🚚 Assigning courier ${order.courierId} to shipment ${srResponse.shipment_id}...`);
        try {
          const assignResponse = await srFetch("/courier/assign/awb", {
            method: "POST",
            body: JSON.stringify({
              shipment_id: srResponse.shipment_id,
              courier_id: order.courierId,
            }),
          });
          console.log(`✅ Courier assigned:`, JSON.stringify(assignResponse, null, 2));
          srResponse.payload = assignResponse.response?.data || srResponse.payload;
        } catch (assignErr) {
          console.warn(`⚠️ Courier assignment failed (will use SR default):`, assignErr.message);
        }
      }

      // Handle Shiprocket logical errors (e.g., Wrong Pickup Location)
      if (!srResponse.order_id) {
        let errMsg = srResponse.message || "Shiprocket failed to create order.";
        if (errMsg.toLowerCase().includes("pickup location")) {
          const suggested = srResponse.data?.data?.[0]?.pickup_location || "Home";
          errMsg = `Shiprocket Error: The pickup location nickname "${payload.pickup_location}" is incorrect. Try changing SHIPROCKET_PICKUP_LOCATION in your .env to "${suggested}" and restart the server.`;
        }
        throw new Error(errMsg);
      }

      // Save Shiprocket details back to Firestore
      const updateData = {
        shiprocket: {
          orderId: srResponse.order_id,
          shipmentId: srResponse.shipment_id,
          awbCode: srResponse.payload?.awb_code || null,
          courierName: srResponse.payload?.awb_assign_error ? null : (srResponse.payload?.courier_name || null),
          status: "created",
          lastUpdate: new Date().toISOString(),
        },
        status: "packed",
      };
      await orderRef.update(updateData);

      res.json({ success: true, shiprocket: updateData.shiprocket, raw: srResponse });
    } catch (srErr) {
      console.error(`❌ Shiprocket API Error for ${orderId}:`, srErr.message);
      let errorHint = srErr.message;
      if (srErr.message?.includes("billing/shipping address first")) {
        errorHint = "Shiprocket could not find your Pickup Location. Please verify the 'Nickname' in your Shiprocket Dashboard -> Settings -> Pickup Addresses.";
      }
      res.status(srErr.message?.includes("Token") ? 401 : 500).json({ 
        error: errorHint, 
        details: "Check backend terminal for full Shiprocket response." 
      });
    }
  } catch (err) {
    console.error("❌ Internal Backend Error:", err);
    res.status(500).json({ error: "Internal server error. Check logs." });
  }
});

/**
 * GET /api/orders/generate-label/:orderId
 * Admin: Fetches the shipping label PDF URL from Shiprocket.
 */
app.get("/api/orders/generate-label/:orderId", authenticateToken, async (req, res) => {
  const { orderId } = req.params;

  try {
    const orderSnap = await db.collection("orders").doc(orderId).get();
    if (!orderSnap.exists) return res.status(404).json({ error: "Order not found" });

    const order = orderSnap.data();
    const shipmentId = order.shiprocket?.shipmentId;
    if (!shipmentId) return res.status(400).json({ error: "Shipment not yet created for this order. Create shipment first." });

    const data = await srFetch("/courier/generate/label", {
      method: "POST",
      body: JSON.stringify({ shipment_id: [shipmentId] }),
    });

    res.json({ success: true, labelUrl: data.label_url, data });
  } catch (err) {
    console.error("❌ Label generation error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/admin/orders/:id/sync
 * Sync Shiprocket status with local Firestore order
 */
app.post("/api/admin/orders/:id/sync", maybeAuth, async (req, res) => {
  try {
    if (!(await isAdminUid(req.user?.uid)))
      return res.status(403).json({ error: "Forbidden" });

    const { id } = req.params;
    const orderRef = db.collection("orders").doc(id);
    const orderSnap = await orderRef.get();
    
    if (!orderSnap.exists) return res.status(404).json({ error: "Order not found" });
    const order = orderSnap.data();

    const awbCode = order.shiprocket?.awbCode;
    if (!awbCode) return res.status(400).json({ error: "No AWB code found. Create shipment first." });

    const trackData = await srFetch(`/courier/track/awb/${awbCode}`);
    const tracking = trackData?.tracking_data?.shipment_track?.[0];
    const srStatusName = tracking?.current_status || "Created";

    // Re-use logic from webhook for consistency
    const statusMap = {
      "Pickup Scheduled": "confirmed",
      "Pickup Generated": "confirmed",
      "Picked Up": "shipped",
      "In Transit": "shipped",
      "Out For Delivery": "shipped",
      "Delivered": "delivered",
      "Undelivered": "shipped",
      "Cancelled": "cancelled",
      "RTO Initiated": "shipped",
      "RTO Delivered": "cancelled",
    };

    const mappedStatus = statusMap[srStatusName];
    const updatePayload = {
      "shiprocket.status": srStatusName,
      "shiprocket.lastUpdate": new Date().toISOString(),
    };

    if (mappedStatus && mappedStatus !== order.status) {
      updatePayload.status = mappedStatus;
      updatePayload[`statusHistory.${mappedStatus}`] = admin.firestore.FieldValue.serverTimestamp();
    }

    await orderRef.update(updatePayload);

    res.json({ 
      success: true, 
      srStatus: srStatusName, 
      localStatus: updatePayload.status || order.status 
    });
  } catch (err) {
    console.error("❌ Sync error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/orders/track/:orderId
 * Customer-facing. Returns real-time tracking info for an order.
 */
app.get("/api/orders/track/:orderId", async (req, res) => {
  const { orderId } = req.params;

  try {
    const orderSnap = await db.collection("orders").doc(orderId).get();
    if (!orderSnap.exists) return res.status(404).json({ error: "Order not found" });

    const order = orderSnap.data();
    const awbCode = order.shiprocket?.awbCode;

    if (!awbCode) {
      return res.json({
        success: true,
        tracked: false,
        message: "Shipment not yet dispatched",
        shiprocket: order.shiprocket || null,
      });
    }

    const data = await srFetch(`/courier/track/awb/${awbCode}`);
    res.json({ success: true, tracked: true, tracking: data, awbCode, shiprocket: order.shiprocket });
  } catch (err) {
    console.error("❌ Track order error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/webhook/shiprocket
 * Shiprocket pushes delivery status updates here.
 * Configure this URL in your Shiprocket account: Settings → Webhooks
 */
app.post("/api/webhook/shiprocket", async (req, res) => {
  try {
    const payload = req.body;
    console.log("📦 Shiprocket Webhook:", JSON.stringify(payload, null, 2));

    const awbCode = payload.awb || payload.awb_code;
    const srStatus = payload.current_status || payload.status;

    if (!awbCode || !srStatus) {
      return res.status(200).json({ received: true, skipped: true });
    }

    // Map Shiprocket status → our internal status
    const statusMap = {
      "Pickup Scheduled": "confirmed",
      "Pickup Generated": "confirmed",
      "Picked Up": "shipped",
      "In Transit": "shipped",
      "Out For Delivery": "shipped",
      "Delivered": "delivered",
      "Undelivered": "shipped",
      "Cancelled": "cancelled",
      "RTO Initiated": "shipped",
      "RTO Delivered": "cancelled",
    };

    const mappedStatus = statusMap[srStatus];

    // Find the order by AWB code
    const ordersSnap = await db.collection("orders")
      .where("shiprocket.awbCode", "==", awbCode)
      .limit(1)
      .get();

    if (ordersSnap.empty) {
      console.warn(`⚠️  Shiprocket webhook: No order found for AWB ${awbCode}`);
      return res.status(200).json({ received: true, skipped: true });
    }

    const orderDoc = ordersSnap.docs[0];
    const updatePayload = {
      "shiprocket.status": srStatus,
      "shiprocket.lastUpdate": new Date().toISOString(),
    };

    if (mappedStatus) {
      updatePayload.status = mappedStatus;
      updatePayload[`statusHistory.${mappedStatus}`] = new Date().toISOString();
    }

    await orderDoc.ref.update(updatePayload);
    console.log(`✅ Shiprocket webhook: Order ${orderDoc.id} updated → ${srStatus}`);
    res.status(200).json({ received: true, updated: true, orderId: orderDoc.id, status: srStatus });
  } catch (err) {
    console.error("❌ Shiprocket webhook error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  // Pre-fetch all static catalogue assets (fonts + decorative images) at startup.
  // This eliminates Cloudinary network calls during PDF generation on every request.
  prefetchCatalogueAssets().catch((err) =>
    console.warn('⚠️  Catalogue asset prefetch failed at startup (will fall back to Cloudinary URLs):', err.message)
  );
});

