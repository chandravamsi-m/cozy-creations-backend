// src/controllers/settingsController.js
const { db } = require("../config/firebase");

exports.getDeliverySettings = async (req, res) => {
  try {
    const doc = await db.collection("settings").doc("delivery").get();
    if (!doc.exists) {
      return res.json({
        delivery: { isActive: false, amount: 0, freeDeliveryThreshold: 0, message: "", isShippingFeeEnabled: true }
      });
    }
    const data = doc.data();
    if (data.isShippingFeeEnabled === undefined) data.isShippingFeeEnabled = true;

    // Environment variable override (Source of Truth)
    const isShippingFeeEnabled = process.env.ENABLE_SHIPPING_FEE !== 'false';
    data.isShippingFeeEnabled = isShippingFeeEnabled;

    res.json({ delivery: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getPaymentSettings = async (req, res) => {
  try {
    const doc = await db.collection("settings").doc("payment").get();
    if (!doc.exists) return res.json({ payment: { isCodEnabled: true } });
    res.json({ payment: doc.data() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getPackagingSettings = async (req, res) => {
  try {
    const doc = await db.collection("settings").doc("packaging").get();
    if (!doc.exists) return res.json({ categoryPackaging: {} });
    res.json(doc.data());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.updatePackagingSettings = async (req, res) => {
  try {
    const { categoryPackaging } = req.body;
    if (!categoryPackaging || typeof categoryPackaging !== "object") {
      return res.status(400).json({ error: "Invalid packaging data" });
    }
    await db.collection("settings").doc("packaging").set(
      { categoryPackaging, updatedAt: new Date().toISOString() },
      { merge: true }
    );
    res.json({ success: true, categoryPackaging });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getAnnouncementStrip = async (req, res) => {
  try {
    const doc = await db.collection("settings").doc("announcementStrip").get();
    if (!doc.exists) {
      return res.json({ announcementStrip: { isActive: false, messages: [] } });
    }
    res.json({ announcementStrip: doc.data() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.updateAnnouncementStrip = async (req, res) => {
  try {
    const { isActive, messages } = req.body;

    if (typeof isActive !== "boolean") {
      return res.status(400).json({ error: "isActive must be a boolean" });
    }
    if (!Array.isArray(messages)) {
      return res.status(400).json({ error: "messages must be an array" });
    }

    // Sanitize: each message must have an id (string) and text (non-empty string)
    const sanitized = messages
      .filter(m => m && typeof m.text === "string" && m.text.trim())
      .map(m => ({
        id: String(m.id || Date.now() + Math.random()),
        text: String(m.text).trim().slice(0, 200), // max 200 chars per message
      }));

    const data = {
      isActive: !!isActive,
      messages: sanitized,
      updatedAt: new Date().toISOString(),
    };

    await db.collection("settings").doc("announcementStrip").set(data);
    res.json({ success: true, announcementStrip: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getPublicSettings = async (req, res) => {
  try {
    const [deliveryDoc, paymentDoc, offerDoc, stripDoc] = await Promise.all([
      db.collection("settings").doc("delivery").get(),
      db.collection("settings").doc("payment").get(),
      db.collection("settings").doc("offerBanner").get(),
      db.collection("settings").doc("announcementStrip").get(),
    ]);

    const deliveryData = deliveryDoc.exists ? deliveryDoc.data() : { isActive: false, amount: 0, freeDeliveryThreshold: 0, isShippingFeeEnabled: true };
    if (deliveryData.isShippingFeeEnabled === undefined) deliveryData.isShippingFeeEnabled = true;

    // Environment variable override (Source of Truth)
    const isShippingFeeEnabled = process.env.ENABLE_SHIPPING_FEE !== 'false';
    deliveryData.isShippingFeeEnabled = isShippingFeeEnabled;

    res.json({
      delivery: deliveryData,
      payment: paymentDoc.exists ? paymentDoc.data() : { isCodEnabled: true, isPlatformFeeEnabled: false, platformFee: 0 },
      offer: offerDoc.exists ? offerDoc.data() : { isActive: false },
      announcementStrip: stripDoc.exists ? stripDoc.data() : { isActive: false, messages: [] },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
