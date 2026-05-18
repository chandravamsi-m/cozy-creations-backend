// src/controllers/offerController.js
const { db } = require("../config/firebase");
const cloudinary = require("../config/cloudinary");
const { extractCloudinaryPublicId } = require("../utils/cloudinary");

const OFFERS_COLLECTION = "offers";

// ─── Public Route ─────────────────────────────────────────────────────────────

/**
 * GET /api/offers/active
 * Returns all currently active offers for the storefront.
 * Also migrates the legacy single offerBanner on first call if needed.
 */
exports.getActiveOffers = async (req, res) => {
  try {
    // Fetch from the new `offers` collection
    const snapshot = await db
      .collection(OFFERS_COLLECTION)
      .where("isActive", "==", true)
      .get();

    const offers = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

    // Legacy fallback: if no offers exist in new collection, try old offerBanner
    if (offers.length === 0) {
      const legacyDoc = await db.collection("settings").doc("offerBanner").get();
      if (legacyDoc.exists && legacyDoc.data().isActive) {
        return res.json({ offers: [{ id: "legacy", ...legacyDoc.data() }] });
      }
    }

    res.json({ offers });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── Admin Routes ─────────────────────────────────────────────────────────────

/**
 * GET /api/admin/offers
 * Returns ALL offers (active + inactive) for the admin panel.
 * On first call, migrates the legacy offerBanner document if no offers exist yet.
 */
exports.listAllOffers = async (req, res) => {
  try {
    const snapshot = await db
      .collection(OFFERS_COLLECTION)
      .orderBy("createdAt", "desc")
      .get();

    let offers = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

    // Auto-migrate legacy single offer on first load
    if (offers.length === 0) {
      const legacyDoc = await db.collection("settings").doc("offerBanner").get();
      if (legacyDoc.exists) {
        const legacyData = legacyDoc.data();
        const newRef = db.collection(OFFERS_COLLECTION).doc();
        const migratedOffer = {
          name: "Default Offer (Migrated)",
          ...legacyData,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        await newRef.set(migratedOffer);
        offers = [{ id: newRef.id, ...migratedOffer }];
      }
    }

    res.json({ offers });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * POST /api/admin/offers
 * Creates a new offer document in the `offers` collection.
 */
exports.createOffer = async (req, res) => {
  try {
    const body = req.body;
    if (!body || typeof body !== "object") {
      return res.status(400).json({ error: "Invalid offer data" });
    }

    const offerData = sanitizeOffer(body);
    offerData.createdAt = new Date();
    offerData.updatedAt = new Date();

    const docRef = await db.collection(OFFERS_COLLECTION).add(offerData);
    const newDoc = await docRef.get();

    res.status(201).json({ offer: { id: newDoc.id, ...newDoc.data() } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * PUT /api/admin/offers/:offerId
 * Updates an existing offer document.
 */
exports.updateOffer = async (req, res) => {
  try {
    const { offerId } = req.params;
    const body = req.body;

    if (!offerId) {
      return res.status(400).json({ error: "offerId is required" });
    }

    const offerRef = db.collection(OFFERS_COLLECTION).doc(offerId);
    const existing = await offerRef.get();
    if (!existing.exists) {
      return res.status(404).json({ error: "Offer not found" });
    }

    const existingData = existing.data();
    const offerData = sanitizeOffer(body);
    offerData.updatedAt = new Date();

    // Image Cleanup Logic: Find removed image and destroy it in Cloudinary
    if (existingData.bannerImageUrl && existingData.bannerImageUrl !== offerData.bannerImageUrl) {
      const publicId = extractCloudinaryPublicId(existingData.bannerImageUrl);
      if (publicId) {
        try {
          await cloudinary.uploader.destroy(publicId);
        } catch (cloudinaryError) {
          console.error(`❌ Cloudinary deletion failed for old offer banner ${existingData.bannerImageUrl}:`, cloudinaryError.message);
        }
      }
    }

    await offerRef.update(offerData);
    const updated = await offerRef.get();

    res.json({ offer: { id: updated.id, ...updated.data() } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * DELETE /api/admin/offers/:offerId
 * Permanently deletes an offer document.
 */
exports.deleteOffer = async (req, res) => {
  try {
    const { offerId } = req.params;

    if (!offerId) {
      return res.status(400).json({ error: "offerId is required" });
    }

    const offerRef = db.collection(OFFERS_COLLECTION).doc(offerId);
    const existing = await offerRef.get();
    if (!existing.exists) {
      return res.status(404).json({ error: "Offer not found" });
    }

    const existingData = existing.data();

    // Image Cleanup Logic: Destroy image in Cloudinary
    if (existingData.bannerImageUrl) {
      const publicId = extractCloudinaryPublicId(existingData.bannerImageUrl);
      if (publicId) {
        try {
          await cloudinary.uploader.destroy(publicId);
        } catch (cloudinaryError) {
          console.error(`❌ Cloudinary deletion failed for deleted offer banner ${existingData.bannerImageUrl}:`, cloudinaryError.message);
        }
      }
    }

    await offerRef.delete();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sanitizeOffer(body) {
  return {
    name: String(body.name || "Unnamed Offer").trim(),
    isActive: Boolean(body.isActive),

    // Discount settings
    hasDiscount: Boolean(body.hasDiscount),
    discountType: body.discountType === "fixed" ? "fixed" : "percentage",
    discountValue: Math.max(0, Number(body.discountValue) || 0),

    // Targeting
    applicableToAll: Boolean(body.applicableToAll),
    applicableCategories: Array.isArray(body.applicableCategories) ? body.applicableCategories : [],
    applicableProducts: Array.isArray(body.applicableProducts) ? body.applicableProducts : [],

    // Banner settings
    hasBanner: Boolean(body.hasBanner),
    offerHeading: String(body.offerHeading || "").trim(),
    offerText: String(body.offerText || "").trim(),
    bannerImageUrl: String(body.bannerImageUrl || "").trim(),
    email: String(body.email || "").trim(),
    phone: String(body.phone || "").trim(),
  };
}
