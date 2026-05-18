// src/controllers/productController.js
const { db } = require("../config/firebase");

exports.getPublicProducts = async (req, res) => {
  try {
    const snap = await db.collection("products").where("isActive", "!=", false).get();
    res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.calculateDiscount = async (req, res) => {
  try {
    const { productId, productPrice, category } = req.body;
    
    // Fetch all active offers from new offers collection
    const offersSnapshot = await db.collection("offers").where("isActive", "==", true).get();
    let offers = offersSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    // Fallback to legacy if no new offers exist
    if (offers.length === 0) {
      const legacyDoc = await db.collection("settings").doc("offerBanner").get();
      if (legacyDoc.exists && legacyDoc.data().isActive) {
        offers = [{ id: "legacy", ...legacyDoc.data() }];
      }
    }

    const priceNum = Number(productPrice) || 0;
    const noDiscount = {
      hasDiscount: false,
      originalPrice: priceNum,
      discountedPrice: priceNum,
      savedAmount: 0,
      discountPercent: 0,
      offerName: ""
    };

    if (offers.length === 0) {
      return res.json(noDiscount);
    }

    let bestResult = noDiscount;

    for (const offer of offers) {
      if (!offer.hasDiscount) continue;

      let qualifies = false;
      if (offer.applicableToAll) {
        qualifies = true;
      } else {
        if (offer.applicableCategories?.includes(category)) qualifies = true;
        if (offer.applicableProducts?.includes(productId)) qualifies = true;
      }

      if (!qualifies) continue;

      let discountAmount = 0;
      let discountPercent = 0;

      if (offer.discountType === "percentage") {
        discountPercent = Number(offer.discountValue || 0);
        discountAmount = (priceNum * discountPercent) / 100;
      } else if (offer.discountType === "fixed") {
        discountAmount = Math.min(Number(offer.discountValue || 0), priceNum);
        discountPercent = priceNum > 0 ? Math.round((discountAmount / priceNum) * 100) : 0;
      }

      const discountedPrice = Math.max(0, priceNum - discountAmount);
      const savedAmount = Math.round(priceNum - discountedPrice);

      if (savedAmount > bestResult.savedAmount) {
        bestResult = {
          hasDiscount: savedAmount > 0,
          originalPrice: priceNum,
          discountedPrice: Math.round(discountedPrice),
          savedAmount: savedAmount,
          discountPercent: discountPercent,
          discountType: offer.discountType,
          offerName: offer.name || "Offer"
        };
      }
    }

    res.json(bestResult);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
