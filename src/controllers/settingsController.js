// src/controllers/settingsController.js
const { db } = require("../config/firebase");

exports.getDeliverySettings = async (req, res) => {
  try {
    const doc = await db.collection("settings").doc("delivery").get();
    if (!doc.exists) {
      return res.json({
        delivery: { isActive: false, amount: 0, freeDeliveryThreshold: 0, message: "" }
      });
    }
    res.json({ delivery: doc.data() });
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

exports.getPublicSettings = async (req, res) => {
  try {
    const [deliveryDoc, paymentDoc, offerDoc] = await Promise.all([
      db.collection("settings").doc("delivery").get(),
      db.collection("settings").doc("payment").get(),
      db.collection("settings").doc("offerBanner").get(),
    ]);

    res.json({
      delivery: deliveryDoc.exists ? deliveryDoc.data() : { isActive: false, amount: 0, freeDeliveryThreshold: 0 },
      payment: paymentDoc.exists ? paymentDoc.data() : { isCodEnabled: true, isPlatformFeeEnabled: false, platformFee: 0 },
      offer: offerDoc.exists ? offerDoc.data() : { isActive: false }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
