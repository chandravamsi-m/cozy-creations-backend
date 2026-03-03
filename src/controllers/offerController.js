// src/controllers/offerController.js
const { db } = require("../config/firebase");

exports.getActiveOffer = async (req, res) => {
  try {
    const offerDoc = await db.collection("settings").doc("offerBanner").get();
    if (!offerDoc.exists || !offerDoc.data().isActive) {
      return res.json({ offer: null });
    }
    res.json({ offer: offerDoc.data() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
