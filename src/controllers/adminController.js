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
const puppeteer = require("puppeteer");
const { PDFDocument } = require("pdf-lib");

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

    const docRef = await db.collection("products").add({
      ...product,
      isActive: product.isActive !== false,
      inventory: typeof product.inventory === "number" ? product.inventory : 100,
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
    await db.collection("products").doc(req.params.id).update({
      ...req.body.product,
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
      const { imageUrl } = productDoc.data();
      if (imageUrl) {
        try {
          const publicId = extractCloudinaryPublicId(imageUrl);
          if (publicId) await cloudinary.uploader.destroy(publicId);
        } catch (cloudinaryError) {
          console.error(`❌ Cloudinary deletion failed:`, cloudinaryError.message);
        }
      }
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
      minCartValue, bannerImageUrl
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
      minCartValue: minCartValue || 0,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };
    
    await db.collection("settings").doc("offerBanner").set(offerData, { merge: true });
    res.json({ success: true, offer: offerData });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// --- Settings ---

exports.updateDeliverySettings = async (req, res) => {
  try {
    const { isActive, amount, freeDeliveryThreshold, message } = req.body;
    const data = {
      isActive: !!isActive,
      amount: amount || 0,
      freeDeliveryThreshold: freeDeliveryThreshold || 0,
      message: message || "",
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
    const updateData = {
      status: req.body.status,
      [`statusHistory.${req.body.status.toLowerCase()}`]: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (req.body.expectedDeliveryDate) updateData.expectedDeliveryDate = req.body.expectedDeliveryDate;
    await db.collection("orders").doc(req.params.id).update(updateData);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// --- Users ---

exports.createUser = async (req, res) => {
  try {
    const { email, password, displayName, role } = req.body;
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
    const updates = { ...req.body, updatedAt: new Date().toISOString() };
    await db.collection("settings").doc("delivery").set(updates, { merge: true });
    res.json({ success: true });
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
