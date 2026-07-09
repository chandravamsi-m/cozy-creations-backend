// src/controllers/adminController.js
const { db, admin } = require("../config/firebase");
const cloudinary = require("../config/cloudinary");
const { extractCloudinaryPublicId } = require("../utils/cloudinary");
const { 
  catalogueProgress, 
  prefetchCatalogueAssets, 
  generateMultiPageCatalogue, 
  generateMultiPageBulkCatalogue 
} = require("../services/catalogueService");
const shippingService = require("../services/shippingService");
const { sendOrderDeliveredWhatsApp, sendOrderCancelledWhatsApp } = require("../services/whatsappService");
const puppeteer = require("puppeteer");
const { PDFDocument } = require("pdf-lib");

// ─────────────────────────────────────────────────────────────────────────────
// SHARED UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

async function isImageInUse(url, excludeProductId = null) {
  const collections = ["products", "scented-sticks", "perfumes"];
  for (const col of collections) {
    const snap1 = await db.collection(col).where("imageUrl", "==", url).limit(2).get();
    for (const doc of snap1.docs) if (doc.id !== excludeProductId) return true;
    
    const snap2 = await db.collection(col).where("images", "array-contains", url).limit(2).get();
    for (const doc of snap2.docs) if (doc.id !== excludeProductId) return true;

    const snap3 = await db.collection(col).where("videoUrl", "==", url).limit(2).get();
    for (const doc of snap3.docs) if (doc.id !== excludeProductId) return true;
  }
  return false;
}

const ALLOWED_PRODUCT_FIELDS = [
  "name",
  "category",
  "price",
  "weightGrams",
  "waxType",
  "dimensions",
  "dimensionUnit",
  "quantityPack",
  "customizableFragrance",
  "customizableColor",
  "altText",
  "imageUrl",
  "thumbnailUrl",
  "images",
  "videoUrl",
  "isActive",
  "bulkPricingTiers",
];

function normalizeBulkPricingTiers(product) {
  const tiers = Array.isArray(product.bulkPricingTiers)
    ? product.bulkPricingTiers
    : (Array.isArray(product.bulkPricing) ? product.bulkPricing : []);

  return tiers
    .map((tier) => ({
      minQty: String(tier.minQty || "").trim(),
      pricePerPc: Number(tier.pricePerPc),
    }))
    .filter((tier) => tier.minQty && Number.isFinite(tier.pricePerPc) && tier.pricePerPc > 0);
}


async function normalizeProductPayload(inputProduct, existingProduct = null) {
  if (!inputProduct || typeof inputProduct !== "object") {
    throw new Error("Invalid product payload");
  }

  const payload = {};
  for (const field of ALLOWED_PRODUCT_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(inputProduct, field)) {
      payload[field] = inputProduct[field];
    }
  }

  if (inputProduct.imageBuffer && typeof inputProduct.imageBuffer === "string" && inputProduct.imageBuffer.startsWith("data:image")) {
    const uploadResult = await cloudinary.uploader.upload(inputProduct.imageBuffer, {
      folder: "cozy-creations/products",
      format: "webp",
      quality: "auto",
    });
    payload.imageUrl = uploadResult.secure_url;
    payload.thumbnailUrl = uploadResult.secure_url;
  }

  if (Object.prototype.hasOwnProperty.call(inputProduct, "price")) {
    payload.price = Number(inputProduct.price) || 0;
  }
  if (Object.prototype.hasOwnProperty.call(inputProduct, "weightGrams")) {
    payload.weightGrams = Number(inputProduct.weightGrams) || 0;
  }
  if (Object.prototype.hasOwnProperty.call(inputProduct, "quantityPack")) {
    payload.quantityPack = Number(inputProduct.quantityPack) || 1;
  }
  if (Object.prototype.hasOwnProperty.call(inputProduct, "bulkPricingTiers") || Object.prototype.hasOwnProperty.call(inputProduct, "bulkPricing")) {
    payload.bulkPricingTiers = normalizeBulkPricingTiers(inputProduct);
  }

  if (Array.isArray(inputProduct.images)) {
    payload.images = inputProduct.images
      .filter(url => typeof url === 'string' && url.startsWith('http'))
      .slice(0, 5);
  }

  if (!payload.altText && (payload.name || existingProduct?.name)) {
    payload.altText = payload.name || existingProduct?.name;
  }

  return payload;
}

// --- Dashboard Stats ---

exports.getDashboardStats = async (req, res) => {
  try {
    // 1. Total Revenue, Total Orders, Sales Trend, Top Products
    let totalRevenue = 0;
    let totalOrders = 0;
    
    // Setup for 7-day trend
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
    sevenDaysAgo.setHours(0, 0, 0, 0);
    const trendDaysMap = {};
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const str = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      trendDaysMap[str] = { date: str, orders: 0 };
    }

    // Setup for 6-week trend
    const sixWeeksAgo = new Date();
    sixWeeksAgo.setDate(sixWeeksAgo.getDate() - 41);
    sixWeeksAgo.setHours(0, 0, 0, 0);
    const weeksRanges = [];
    const trendWeeksMap = {};
    for (let i = 5; i >= 0; i--) {
      const start = new Date();
      start.setDate(start.getDate() - (i * 7 + 6));
      start.setHours(0,0,0,0);
      const end = new Date(start);
      end.setDate(start.getDate() + 6);
      end.setHours(23,59,59,999);
      
      const label = `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
      weeksRanges.push({ start, end, label });
      trendWeeksMap[label] = { date: label, orders: 0 };
    }

    // Setup for 6-month trend
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
    sixMonthsAgo.setDate(1); 
    sixMonthsAgo.setHours(0, 0, 0, 0);
    const trendMonthsMap = {};
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const monthStr = d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
      trendMonthsMap[monthStr] = { date: monthStr, orders: 0 };
    }

    const statusCountMap = {};

    // --- OPTIMIZED DATA FETCHING ---
    // Fetch only orders from the last 6 months for trends and status breakdown
    const ordersSnap = await db.collection("orders")
      .where("createdAt", ">=", sixMonthsAgo)
      .get();
    
    ordersSnap.forEach(doc => {
      const data = doc.data();
      
      // Sales Trend Logging
      let orderDate = null;
      if (data.createdAt) {
        orderDate = data.createdAt.toDate ? data.createdAt.toDate() : new Date(data.createdAt._seconds * 1000);
      }
      
      if (orderDate) {
        if (orderDate >= sevenDaysAgo) {
          const dayStr = orderDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          if (trendDaysMap[dayStr]) trendDaysMap[dayStr].orders += 1;
        }
        if (orderDate >= sixWeeksAgo) {
          const week = weeksRanges.find(w => orderDate >= w.start && orderDate <= w.end);
          if (week && trendWeeksMap[week.label]) trendWeeksMap[week.label].orders += 1;
        }
        if (orderDate >= sixMonthsAgo) {
          const monthStr = orderDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
          if (trendMonthsMap[monthStr]) trendMonthsMap[monthStr].orders += 1;
        }
      }

      // Aggregate order count by status
      const status = data.status || "unknown";
      if (!statusCountMap[status]) statusCountMap[status] = 0;
      statusCountMap[status] += 1;

      // Process delivered orders for total revenue (Recent Revenue)
      if (status === "delivered") {
        totalRevenue += (Number(data.total) || 0);
      }
    });

    // Supplementary counts for "All Time" (Fast O(1) count queries)
    const [totalUsersCount, activeProductsCount, allTimeOrdersCount, activeScentedSticksCount, activePerfumesCount] = await Promise.all([
      db.collection("users").count().get(),
      db.collection("products").where("isActive", "==", true).count().get(),
      db.collection("orders").count().get(),
      db.collection("scented-sticks").where("isActive", "==", true).count().get(),
      db.collection("perfumes").where("isActive", "==", true).count().get(),
    ]);

    const totalUsers = totalUsersCount.data().count;
    const activeProducts = activeProductsCount.data().count;
    const activeScentedSticks = activeScentedSticksCount.data().count;
    const activePerfumes = activePerfumesCount.data().count;
    const allTimeOrders = allTimeOrdersCount.data().count;

    const salesTrend = {
      days: Object.values(trendDaysMap),
      weeks: Object.values(trendWeeksMap),
      months: Object.values(trendMonthsMap),
    };
    
    // Format Order Count by Status for Recharts PieChart (Excluding 'delivered')
    const ordersByStatus = Object.keys(statusCountMap)
      .filter(status => statusCountMap[status] > 0 && status.toLowerCase() !== "delivered")
      .map(status => ({
        name: status.charAt(0).toUpperCase() + status.slice(1),
        value: statusCountMap[status]
      }))
      .sort((a, b) => b.value - a.value);

    // Counts derived from optimized queries above
    // (Replacing heavy snapshots)

    // 4. Recent Orders (limit 5)
    const recentOrdersSnap = await db.collection("orders")
      .orderBy("createdAt", "desc")
      .limit(5)
      .get();
    
    // Format the timestamps before sending
    const recentOrders = recentOrdersSnap.docs.map(d => {
      const data = d.data();
      // Ensure createdAt is sent in a standard, plannable MS format or ISO
      let createdAtIso = null;
      if (data.createdAt) {
         createdAtIso = data.createdAt.toDate ? data.createdAt.toDate().toISOString() : new Date(data.createdAt._seconds * 1000).toISOString();
      }
      return { id: d.id, ...data, createdAtIso };
    });

    // 5. Get current admin's name
    let adminName = null;
    if (req.user && req.user.uid) {
      try {
        const adminDoc = await db.collection("users").doc(req.user.uid).get();
        if (adminDoc.exists) {
          adminName = adminDoc.data().displayName || null;
        }
      } catch (err) {
        console.error("Error fetching admin name:", err);
      }
    }

    res.json({
      success: true,
      stats: {
        totalRevenue,
        totalOrders: allTimeOrders,
        deliveredOrders: statusCountMap["delivered"] || 0,
        totalUsers,
        activeProducts,
        activeScentedSticks,
        activePerfumes,
        salesTrend,
        ordersByStatus
      },
      recentOrders,
      adminName
    });
  } catch (err) {
    console.error("❌ Dashboard Stats Error:", err);
    res.status(500).json({ error: "Failed to fetch dashboard stats", details: err.message });
  }
};

// --- Products ---

exports.getProducts = async (req, res) => {
  try {
    const snap = await db.collection("products").orderBy("updatedAt", "desc").get();
    res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.createProduct = async (req, res) => {
  try {
    const { product } = req.body;
    if (!product?.name) return res.status(400).json({ error: "Invalid product data" });

    const normalizedProduct = await normalizeProductPayload(product);

    const docRef = await db.collection("products").add({
      ...normalizedProduct,
      isActive: normalizedProduct.isActive !== false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.json({ id: docRef.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.updateProduct = async (req, res) => {
  try {
    const productRef = db.collection("products").doc(req.params.id);
    const currentSnap = await productRef.get();
    if (!currentSnap.exists) return res.status(404).json({ error: "Product not found" });

    const oldData = currentSnap.data();
    const normalizedProduct = await normalizeProductPayload(req.body.product, oldData);

    // Image Cleanup Logic: Only run if the update payload explicitly contains image fields.
    // If neither imageUrl nor images is present, it means no image change was made — skip cleanup.
    const payloadHasImages = Object.prototype.hasOwnProperty.call(req.body.product, 'imageUrl') ||
      Object.prototype.hasOwnProperty.call(req.body.product, 'images') ||
      Object.prototype.hasOwnProperty.call(req.body.product, 'videoUrl') ||
      (req.body.product?.imageBuffer && typeof req.body.product.imageBuffer === 'string');

    if (payloadHasImages) {
      const oldUrls = new Set();
      if (oldData.imageUrl) oldUrls.add(oldData.imageUrl);
      if (oldData.videoUrl) oldUrls.add(oldData.videoUrl);
      if (Array.isArray(oldData.images)) {
        oldData.images.forEach(url => { if (url) oldUrls.add(url); });
      }

      const newUrls = new Set();
      if (normalizedProduct.imageUrl) newUrls.add(normalizedProduct.imageUrl);
      if (normalizedProduct.videoUrl) newUrls.add(normalizedProduct.videoUrl);
      if (Array.isArray(normalizedProduct.images)) {
        normalizedProduct.images.forEach(url => { if (url) newUrls.add(url); });
      }

      // Identify URLs that are no longer in use for this product
      const removedUrls = [...oldUrls].filter(url => !newUrls.has(url));

      // Parallelize Cloudinary deletions to improve performance
      await Promise.all(removedUrls.map(async (url) => {
        try {
          if (await isImageInUse(url, req.params.id)) return;
          const publicId = extractCloudinaryPublicId(url);
          if (publicId) {
            const resourceType = url.includes('/video/') ? 'video' : 'image';
            await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
          }
        } catch (cleanupErr) {
          console.error(`Failed to cleanup orphaned image/video ${url}:`, cleanupErr.message);
        }
      }));
    }

    await productRef.update({
      ...normalizedProduct,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.softDeleteProduct = async (req, res) => {
  try {
    await db.collection("products").doc(req.params.id).update({
      isActive: false,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.permanentDeleteProduct = async (req, res) => {
  try {
    const productDoc = await db.collection("products").doc(req.params.id).get();
    if (productDoc.exists) {
      const { imageUrl, images, videoUrl } = productDoc.data();
      const urlsToDelete = new Set();
      if (imageUrl) urlsToDelete.add(imageUrl);
      if (videoUrl) urlsToDelete.add(videoUrl);
      if (Array.isArray(images)) images.forEach(url => { if (url) urlsToDelete.add(url); });
      
      // Parallelize Cloudinary deletions to improve performance
      await Promise.all([...urlsToDelete].map(async (url) => {
        try {
          if (await isImageInUse(url, req.params.id)) return;
          const publicId = extractCloudinaryPublicId(url);
          if (publicId) {
            const resourceType = url.includes('/video/') ? 'video' : 'image';
            await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
          }
        } catch (cleanupErr) {
          console.error("Failed to cleanup image/video on permanent delete:", cleanupErr.message);
        }
      }));
    }
    await db.collection("products").doc(req.params.id).delete();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


// --- Offers ---

exports.getOffers = async (req, res) => {
  try {
    const offerDoc = await db.collection("settings").doc("offerBanner").get();
    if (!offerDoc.exists) {
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
};

exports.updateOffer = async (req, res) => {
  try {
    const { 
      isActive, offerText, offerHeading, email, phone,
      hasDiscount, discountType, discountValue,
      applicableToAll, applicableCategories, applicableProducts,
      bannerImageUrl
    } = req.body;
    
    const offerData = {
      isActive: !!isActive,
      offerText: offerText || "",
      offerHeading: offerHeading || "Special Offer",
      email: email || "cozycreationscorner13@gmail.com",
      phone: phone || "+91 80194 01322",
      bannerImageUrl: bannerImageUrl || "",
      hasDiscount: !!hasDiscount,
      discountType: discountType || "percentage",
      discountValue: discountValue || 0,
      applicableToAll: applicableToAll !== undefined ? applicableToAll : true,
      applicableCategories: applicableCategories || [],
      applicableProducts: applicableProducts || [],
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };
    
    const offerRef = db.collection("settings").doc("offerBanner");
    const currentSnap = await offerRef.get();
    
    if (currentSnap.exists) {
      const oldBannerUrl = currentSnap.data().bannerImageUrl;
      if (oldBannerUrl && oldBannerUrl !== bannerImageUrl) {
        try {
          const publicId = extractCloudinaryPublicId(oldBannerUrl);
          if (publicId) await cloudinary.uploader.destroy(publicId);
        } catch (cleanupErr) {
          console.error("Failed to cleanup old banner image:", cleanupErr.message);
        }
      }
    }
    
    await offerRef.set(offerData, { merge: true });
    res.json({ success: true, offer: offerData });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// --- Settings ---

exports.updateDeliverySettings = async (req, res) => {
  try {
    const { isActive, amount, freeDeliveryThreshold, message, isShippingFeeEnabled, attarWeights } = req.body;
    const data = {
      isActive: !!isActive,
      amount: Number(amount) || 0,
      freeDeliveryThreshold: Number(freeDeliveryThreshold) || 0,
      message: message || "",
      isShippingFeeEnabled: isShippingFeeEnabled !== false,
      attarWeights: attarWeights || {},
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };
    await db.collection("settings").doc("delivery").set(data, { merge: true });
    res.json({ success: true, delivery: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.updatePaymentSettings = async (req, res) => {
  try {
    const { isCodEnabled, isPlatformFeeEnabled, platformFee } = req.body;
    const data = {
      isCodEnabled: isCodEnabled !== undefined ? isCodEnabled : true,
      isPlatformFeeEnabled: isPlatformFeeEnabled !== undefined ? isPlatformFeeEnabled : false,
      platformFee: Number(platformFee) || 0,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };
    await db.collection("settings").doc("payment").set(data, { merge: true });
    res.json({ success: true, payment: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// --- Orders ---

exports.getOrders = async (req, res) => {
  try {
    const snap = await db.collection("orders").orderBy("createdAt", "desc").limit(100).get();
    res.json({ orders: snap.docs.map(d => ({ id: d.id, ...d.data() })) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.updateOrder = async (req, res) => {
  try {
    const nextStatus = String(req.body.status || "").trim().toLowerCase();
    const allowedStatuses = new Set(["new", "packed", "shipped", "delivered", "cancelled"]);
    if (!allowedStatuses.has(nextStatus)) {
      return res.status(400).json({ error: "Invalid order status" });
    }

    const orderRef = db.collection("orders").doc(req.params.id);
    const orderSnap = await orderRef.get();
    if (!orderSnap.exists) return res.status(404).json({ error: "Order not found" });

    const currentStatus = String(orderSnap.data()?.status || "").toLowerCase();
    if (currentStatus === "delivered" && nextStatus === "cancelled") {
      return res.status(409).json({ error: "Delivered orders cannot be cancelled" });
    }

    const updateData = {
      status: nextStatus,
      [`statusHistory.${nextStatus}`]: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (req.body.expectedDeliveryDate) updateData.expectedDeliveryDate = req.body.expectedDeliveryDate;
    await orderRef.update(updateData);

    // WhatsApp notification on terminal statuses
    const orderData = { id: req.params.id, ...orderSnap.data() };
    if (nextStatus === "delivered") {
      sendOrderDeliveredWhatsApp(orderData.shippingAddress?.phone, orderData).catch((err) => {
        console.error("Delivered WhatsApp failed:", err.message);
      });
    }
    if (nextStatus === "cancelled") {
      sendOrderCancelledWhatsApp(orderData.shippingAddress?.phone, orderData).catch((err) => {
        console.error("Cancelled WhatsApp failed:", err.message);
      });
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.updateUser = async (req, res) => {
  try {
    const { uid } = req.params;
    const { email, password, displayName, role } = req.body;
    const updateData = {};
    if (password) {
      const userRecord = await admin.auth().getUser(uid);
      const isGoogleUser = userRecord.providerData.some(p => p.providerId === 'google.com');
      
      if (isGoogleUser) {
        return res.status(400).json({ error: "Cannot set password for users registered via Google Sign-In." });
      }

      const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*(),.?":{}|<>])[A-Za-z\d!@#$%^&*(),.?":{}|<>]{8,}$/;
      if (!passwordRegex.test(password)) {
        return res.status(400).json({ error: "Password must be at least 8 characters long, and include uppercase, lowercase, a number, and a special character." });
      }
      updateData.password = password;
    }
    if (displayName) updateData.displayName = displayName;

    if (Object.keys(updateData).length > 0) {
      await admin.auth().updateUser(uid, updateData);
    }

    const firestoreUpdate = {};
    if (displayName) firestoreUpdate.displayName = displayName;
    if (role) firestoreUpdate.role = role;
    if (Object.keys(firestoreUpdate).length > 0) {
      await db.collection("users").doc(uid).update(firestoreUpdate);
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.cancelOrder = async (req, res) => {
  try {
    const orderRef = db.collection("orders").doc(req.params.id);
    const orderSnap = await orderRef.get();
    if (!orderSnap.exists) return res.status(404).json({ error: "Order not found" });

    const order = orderSnap.data() || {};
    const currentStatus = String(order.status || "").toLowerCase();

    if (currentStatus === "delivered") {
      return res.status(409).json({ error: "Delivered orders cannot be cancelled" });
    }

    if (currentStatus === "cancelled") {
      return res.json({
        success: true,
        cancelledLocally: true,
        cancelledInShiprocket: String(order.shiprocket?.status || "").toUpperCase().includes("CANCEL"),
        alreadyCancelled: true,
      });
    }

    let shiprocketResult = {
      attempted: false,
      cancelled: false,
      reason: "no_shiprocket_identity",
    };

    if (order.shiprocket?.shipmentId || order.shiprocket?.orderId || order.shiprocket?.awbCode) {
      shiprocketResult = await shippingService.cancelShiprocketOrder({
        shiprocketOrderId: order.shiprocket?.orderId,
        shipmentId: order.shiprocket?.shipmentId,
        awbCode: order.shiprocket?.awbCode,
      });
    }

    const updatePayload = {
      status: "cancelled",
      "statusHistory.cancelled": admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      "shiprocket.lastUpdate": new Date().toISOString(),
    };

    if (shiprocketResult.attempted) {
      updatePayload["shiprocket.cancelAttemptedAt"] = new Date().toISOString();
      updatePayload["shiprocket.cancelledInShiprocket"] = !!shiprocketResult.cancelled;
      if (shiprocketResult.cancelled) {
        updatePayload["shiprocket.status"] = "CANCELLED";
      }
      if (shiprocketResult.reason) {
        updatePayload["shiprocket.cancelReason"] = shiprocketResult.reason;
      }
      if (shiprocketResult.errors?.length) {
        updatePayload["shiprocket.cancelErrors"] = shiprocketResult.errors;
      }
    }

    await orderRef.update(updatePayload);

    // WhatsApp notification for cancellation
    const orderForWa = { id: req.params.id, ...order };
    sendOrderCancelledWhatsApp(order.shippingAddress?.phone, orderForWa).catch((err) => {
      console.error("Cancel WhatsApp failed:", err.message);
    });

    res.json({
      success: true,
      cancelledLocally: true,
      cancelledInShiprocket: !!shiprocketResult.cancelled,
      shiprocketAttempted: !!shiprocketResult.attempted,
      shiprocketReason: shiprocketResult.reason || null,
      shiprocketErrors: shiprocketResult.errors || [],
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.deleteOrder = async (req, res) => {
  try {
    const orderRef = db.collection("orders").doc(req.params.id);
    const orderSnap = await orderRef.get();
    
    if (!orderSnap.exists) {
      return res.status(404).json({ error: "Order not found" });
    }

    // Optional: Only allow deleting cancelled orders as per logic
    const orderData = orderSnap.data();
    if (orderData.status !== "cancelled" && orderData.status !== "delivered") {
       // We can be strict or loose here. User said "clean up the orders which are no longer needed", 
       // but typically we delete cancelled ones. I'll allow deleting anything if requested via this admin route.
    }

    await orderRef.delete();

    res.json({ success: true, message: "Order deleted permanently" });
  } catch (err) {
    console.error("❌ Delete Order Error:", err);
    res.status(500).json({ error: "Failed to delete order", details: err.message });
  }
};

// --- Users ---

exports.createUser = async (req, res) => {
  try {
    const { email, password, displayName, role } = req.body;

    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*(),.?":{}|<>])[A-Za-z\d!@#$%^&*(),.?":{}|<>]{8,}$/;
    if (!passwordRegex.test(password)) {
      return res.status(400).json({ error: "Password must be at least 8 characters long, and include uppercase, lowercase, a number, and a special character." });
    }

    const userRecord = await admin.auth().createUser({ email, password, displayName });
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
};

exports.deleteUser = async (req, res) => {
  try {
    await admin.auth().deleteUser(req.params.uid);
    await db.collection("users").doc(req.params.uid).delete();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// --- Catalogue ---

exports.getCatalogueStatus = async (req, res) => {
  const status = catalogueProgress.get(req.user.uid) || { progress: 0, currentAction: "idle" };
  res.json(status);
};

exports.generateCatalogue = async (req, res) => {
  try {
    const snap = await db.collection("products").where("isActive", "!=", false).get();
    const products = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(p => !p.isBulk);
    if (products.length === 0) return res.status(404).json({ error: "No active products found" });

    const finalPdf = await generateMultiPageCatalogue(products, req.user.uid);
    
    res.contentType("application/pdf");
    res.setHeader("Content-Disposition", "attachment; filename=cozy-creations-catalogue.pdf");
    res.header('Access-Control-Expose-Headers', 'Content-Disposition');
    res.send(finalPdf);
  } catch (err) {
    console.error("❌ Catalogue Generation Error:", err);
    res.status(500).json({ error: "Failed to generate catalogue", details: err.message });
  }
};

exports.generateBulkCatalogue = async (req, res) => {
  try {
    const snap = await db.collection("products").where("isActive", "!=", false).get();
    const products = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(p => p.bulkPricingTiers && p.bulkPricingTiers.length > 0);
    
    if (products.length === 0) return res.status(404).json({ error: "No active bulk products found" });

    const finalPdf = await generateMultiPageBulkCatalogue(products, req.user.uid);
    
    res.contentType("application/pdf");
    res.setHeader("Content-Disposition", "attachment; filename=cozy-creations-bulk-catalogue.pdf");
    res.header('Access-Control-Expose-Headers', 'Content-Disposition');
    res.send(finalPdf);
  } catch (err) {
    console.error("❌ Bulk Catalogue Generation Error:", err);
    res.status(500).json({ error: "Failed to generate bulk catalogue", details: err.message });
  }
};

// --- Settings ---

exports.updateDeliverySettings = async (req, res) => {
  try {
    const { isActive, amount, freeDeliveryThreshold, message, isShippingFeeEnabled, attarWeights } = req.body;
    const data = {
      isActive: !!isActive,
      amount: Number(amount) || 0,
      freeDeliveryThreshold: Number(freeDeliveryThreshold) || 0,
      message: message || "",
      isShippingFeeEnabled: isShippingFeeEnabled !== false,
      attarWeights: attarWeights || {},
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };
    await db.collection("settings").doc("delivery").set(data, { merge: true });
    res.json({ success: true, delivery: data });
  } catch (err) {
    console.error("❌ Update Delivery Settings Error:", err.message);
    res.status(500).json({ error: err.message });
  }
};

exports.updatePaymentSettings = async (req, res) => {
  try {
    const { isCodEnabled, isPlatformFeeEnabled, platformFee } = req.body;
    const data = {
      isCodEnabled: isCodEnabled !== undefined ? isCodEnabled : true,
      isPlatformFeeEnabled: isPlatformFeeEnabled !== undefined ? isPlatformFeeEnabled : false,
      platformFee: Number(platformFee) || 0,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };
    await db.collection("settings").doc("payment").set(data, { merge: true });
    res.json({ success: true, payment: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// SCENTED STICKS (Dhoop Sticks / Agarbatti)
// ─────────────────────────────────────────────────────────────────────────────

const ALLOWED_SCENTED_STICK_FIELDS = [
  "name", "scentFamily", "ingredients", "altText",
  "imageUrl", "thumbnailUrl", "images", "videoUrl", "isActive", "variants",
];

// Default sizes for Dhoop Sticks
const DEFAULT_DHOOP_SIZES = ["50g", "100g", "200g", "500g"];

function normalizeScentedStickVariants(input) {
  if (!Array.isArray(input)) return [];
  return input
    .map((v) => ({
      label: String(v.label || "").trim(),
      price: Math.max(0, Number(v.price) || 0),
      weightGrams: Math.max(0, Number(v.weightGrams) || 0),
      isAvailable: v.isAvailable !== false,
    }))
    .filter((v) => v.label);
}

async function normalizeScentedStickPayload(input, existing = null) {
  if (!input || typeof input !== "object") throw new Error("Invalid scented stick payload");
  const payload = {};
  for (const field of ALLOWED_SCENTED_STICK_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(input, field)) payload[field] = input[field];
  }
  if (input.imageBuffer && typeof input.imageBuffer === "string" && input.imageBuffer.startsWith("data:image")) {
    const uploadResult = await cloudinary.uploader.upload(input.imageBuffer, {
      folder: "cozy-creations/scented-sticks", format: "webp", quality: "auto",
    });
    payload.imageUrl = uploadResult.secure_url;
    payload.thumbnailUrl = uploadResult.secure_url;
  }

  if (Object.prototype.hasOwnProperty.call(input, "variants")) {
    payload.variants = normalizeScentedStickVariants(input.variants);
  }
  if (Array.isArray(input.images)) {
    payload.images = input.images.filter(u => typeof u === "string" && u.startsWith("http")).slice(0, 5);
  }
  if (!payload.altText && (payload.name || existing?.name)) payload.altText = payload.name || existing?.name;
  return payload;
}

exports.getScentedSticks = async (req, res) => {
  try {
    const snap = await db.collection("scented-sticks").orderBy("updatedAt", "desc").get();
    res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  } catch (err) { res.status(500).json({ error: err.message }); }
};

exports.createScentedStick = async (req, res) => {
  try {
    const { product } = req.body;
    if (!product?.name) return res.status(400).json({ error: "Invalid scented stick data" });
    const normalized = await normalizeScentedStickPayload(product);
    const docRef = await db.collection("scented-sticks").add({
      ...normalized,
      isActive: normalized.isActive !== false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    res.json({ id: docRef.id });
  } catch (err) { res.status(500).json({ error: err.message }); }
};

exports.updateScentedStick = async (req, res) => {
  try {
    const ref = db.collection("scented-sticks").doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: "Scented stick not found" });
    const oldData = snap.data();
    const normalized = await normalizeScentedStickPayload(req.body.product, oldData);

    // Only run image cleanup if the update actually contains image fields
    const payloadHasImages = Object.prototype.hasOwnProperty.call(req.body.product, 'imageUrl') ||
      Object.prototype.hasOwnProperty.call(req.body.product, 'images') ||
      Object.prototype.hasOwnProperty.call(req.body.product, 'videoUrl') ||
      (req.body.product?.imageBuffer && typeof req.body.product.imageBuffer === 'string');

    if (payloadHasImages) {
      const oldUrls = new Set();
      if (oldData.imageUrl) oldUrls.add(oldData.imageUrl);
      if (oldData.videoUrl) oldUrls.add(oldData.videoUrl);
      if (Array.isArray(oldData.images)) oldData.images.forEach(u => { if (u) oldUrls.add(u); });
      const newUrls = new Set();
      if (normalized.imageUrl) newUrls.add(normalized.imageUrl);
      if (normalized.videoUrl) newUrls.add(normalized.videoUrl);
      if (Array.isArray(normalized.images)) normalized.images.forEach(u => { if (u) newUrls.add(u); });
      const removedUrls = [...oldUrls].filter(u => !newUrls.has(u));
      await Promise.all(removedUrls.map(async (url) => {
        try {
          if (await isImageInUse(url, req.params.id)) return;
          const pid = extractCloudinaryPublicId(url);
          if (pid) {
            const resourceType = url.includes('/video/') ? 'video' : 'image';
            await cloudinary.uploader.destroy(pid, { resource_type: resourceType });
          }
        } catch (e) { console.error("Cloudinary cleanup failed:", e.message); }
      }));
    }

    await ref.update({ ...normalized, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
};

exports.softDeleteScentedStick = async (req, res) => {
  try {
    await db.collection("scented-sticks").doc(req.params.id).update({
      isActive: false, updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
};

exports.permanentDeleteScentedStick = async (req, res) => {
  try {
    const docSnap = await db.collection("scented-sticks").doc(req.params.id).get();
    if (docSnap.exists) {
      const { imageUrl, images, videoUrl } = docSnap.data();
      const urlsToDelete = new Set();
      if (imageUrl) urlsToDelete.add(imageUrl);
      if (videoUrl) urlsToDelete.add(videoUrl);
      if (Array.isArray(images)) images.forEach(u => { if (u) urlsToDelete.add(u); });
      await Promise.all([...urlsToDelete].map(async (url) => {
        try {
          if (await isImageInUse(url, req.params.id)) return;
          const pid = extractCloudinaryPublicId(url);
          if (pid) {
            const resourceType = url.includes('/video/') ? 'video' : 'image';
            await cloudinary.uploader.destroy(pid, { resource_type: resourceType });
          }
        } catch (e) { console.error("Cloudinary deletion failed:", e.message); }
      }));
    }
    await db.collection("scented-sticks").doc(req.params.id).delete();
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
};

// ─────────────────────────────────────────────────────────────────────────────
// PERFUMES / ATTAR
// ─────────────────────────────────────────────────────────────────────────────

const ALLOWED_PERFUME_FIELDS = [
  "name", "scentFamily", "scentNotes", "longevityHours",
  "isAlcoholFree", "ingredients", "altText", "imageUrl",
  "thumbnailUrl", "images", "videoUrl", "isActive", "variants",
];

// Default sizes for Attar
const DEFAULT_ATTAR_SIZES = ["3ml", "6ml", "9ml", "12ml", "25ml", "50ml", "100ml"];

function normalizePerfumeVariants(input) {
  if (!Array.isArray(input)) return [];
  return input
    .map((v) => ({
      label: String(v.label || "").trim(),
      price: Math.max(0, Number(v.price) || 0),
      weightGrams: Math.max(0, Number(v.weightGrams) || 0),
      isAvailable: v.isAvailable !== false,
    }))
    .filter((v) => v.label);
}

async function normalizePerfumePayload(input, existing = null) {
  if (!input || typeof input !== "object") throw new Error("Invalid perfume payload");
  const payload = {};
  for (const field of ALLOWED_PERFUME_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(input, field)) payload[field] = input[field];
  }
  if (input.imageBuffer && typeof input.imageBuffer === "string" && input.imageBuffer.startsWith("data:image")) {
    const uploadResult = await cloudinary.uploader.upload(input.imageBuffer, {
      folder: "cozy-creations/perfumes", format: "webp", quality: "auto",
    });
    payload.imageUrl = uploadResult.secure_url;
    payload.thumbnailUrl = uploadResult.secure_url;
  }
  if (Object.prototype.hasOwnProperty.call(input, "longevityHours")) payload.longevityHours = Number(input.longevityHours) || 0;
  if (Object.prototype.hasOwnProperty.call(input, "isAlcoholFree")) payload.isAlcoholFree = !!input.isAlcoholFree;
  if (input.scentNotes && typeof input.scentNotes === "object") {
    payload.scentNotes = {
      top: String(input.scentNotes.top || "").trim(),
      middle: String(input.scentNotes.middle || "").trim(),
      base: String(input.scentNotes.base || "").trim(),
    };
  }
  if (Object.prototype.hasOwnProperty.call(input, "variants")) {
    payload.variants = normalizePerfumeVariants(input.variants);
  }
  if (Array.isArray(input.images)) {
    payload.images = input.images.filter(u => typeof u === "string" && u.startsWith("http")).slice(0, 5);
  }
  if (!payload.altText && (payload.name || existing?.name)) payload.altText = payload.name || existing?.name;
  return payload;
}

exports.getPerfumes = async (req, res) => {
  try {
    const snap = await db.collection("perfumes").orderBy("createdAt", "desc").get();
    res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  } catch (err) { res.status(500).json({ error: err.message }); }
};

exports.createPerfume = async (req, res) => {
  try {
    const { product } = req.body;
    if (!product?.name) return res.status(400).json({ error: "Invalid perfume data" });
    const normalized = await normalizePerfumePayload(product);
    const docRef = await db.collection("perfumes").add({
      ...normalized,
      isActive: normalized.isActive !== false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    res.json({ id: docRef.id });
  } catch (err) { res.status(500).json({ error: err.message }); }
};

exports.updatePerfume = async (req, res) => {
  try {
    const ref = db.collection("perfumes").doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: "Perfume not found" });
    const oldData = snap.data();
    const normalized = await normalizePerfumePayload(req.body.product, oldData);

    // Only run image cleanup if the update actually contains image fields
    const payloadHasImages = Object.prototype.hasOwnProperty.call(req.body.product, 'imageUrl') ||
      Object.prototype.hasOwnProperty.call(req.body.product, 'images') ||
      Object.prototype.hasOwnProperty.call(req.body.product, 'videoUrl') ||
      (req.body.product?.imageBuffer && typeof req.body.product.imageBuffer === 'string');

    if (payloadHasImages) {
      const oldUrls = new Set();
      if (oldData.imageUrl) oldUrls.add(oldData.imageUrl);
      if (oldData.videoUrl) oldUrls.add(oldData.videoUrl);
      if (Array.isArray(oldData.images)) oldData.images.forEach(u => { if (u) oldUrls.add(u); });
      const newUrls = new Set();
      if (normalized.imageUrl) newUrls.add(normalized.imageUrl);
      if (normalized.videoUrl) newUrls.add(normalized.videoUrl);
      if (Array.isArray(normalized.images)) normalized.images.forEach(u => { if (u) newUrls.add(u); });
      const removedUrls = [...oldUrls].filter(u => !newUrls.has(u));
      await Promise.all(removedUrls.map(async (url) => {
        try {
          if (await isImageInUse(url, req.params.id)) return;
          const pid = extractCloudinaryPublicId(url);
          if (pid) {
            const resourceType = url.includes('/video/') ? 'video' : 'image';
            await cloudinary.uploader.destroy(pid, { resource_type: resourceType });
          }
        } catch (e) { console.error("Cloudinary cleanup failed:", e.message); }
      }));
    }

    await ref.update({ ...normalized, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
};

exports.softDeletePerfume = async (req, res) => {
  try {
    await db.collection("perfumes").doc(req.params.id).update({
      isActive: false, updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
};

exports.permanentDeletePerfume = async (req, res) => {
  try {
    const docSnap = await db.collection("perfumes").doc(req.params.id).get();
    if (docSnap.exists) {
      const { imageUrl, images, videoUrl } = docSnap.data();
      const urlsToDelete = new Set();
      if (imageUrl) urlsToDelete.add(imageUrl);
      if (videoUrl) urlsToDelete.add(videoUrl);
      if (Array.isArray(images)) images.forEach(u => { if (u) urlsToDelete.add(u); });
      await Promise.all([...urlsToDelete].map(async (url) => {
        try {
          if (await isImageInUse(url, req.params.id)) return;
          const pid = extractCloudinaryPublicId(url);
          if (pid) {
            const resourceType = url.includes('/video/') ? 'video' : 'image';
            await cloudinary.uploader.destroy(pid, { resource_type: resourceType });
          }
        } catch (e) { console.error("Cloudinary deletion failed:", e.message); }
      }));
    }
    await db.collection("perfumes").doc(req.params.id).delete();
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
};

exports.generateCloudinarySignature = (req, res) => {
  try {
    const timestamp = Math.round(new Date().getTime() / 1000);
    const eager = "q_auto,f_auto,vc_auto,w_1080";
    const eager_async = "true";
    const paramsToSign = {
      timestamp,
      eager,
      eager_async
    };
    
    // We assume cloudinary is already configured with API_SECRET in index.js or adminController
    const cloudinary = require("cloudinary").v2;
    const signature = cloudinary.utils.api_sign_request(paramsToSign, process.env.CLOUDINARY_API_SECRET);

    res.json({
      signature,
      timestamp,
      eager,
      eager_async,
      apiKey: process.env.CLOUDINARY_API_KEY,
      cloudName: process.env.CLOUDINARY_CLOUD_NAME
    });
  } catch (err) {
    console.error("Cloudinary Signature Error:", err);
    res.status(500).json({ error: err.message });
  }
};

