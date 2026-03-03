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
    let qualifies = false;
    
    if (offer.applicableToAll) {
      qualifies = true;
    } else {
      if (offer.applicableCategories?.includes(category)) qualifies = true;
      if (offer.applicableProducts?.includes(productId)) qualifies = true;
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
    
    let discountAmount = 0;
    let discountPercent = 0;
    
    if (offer.discountType === "percentage") {
      discountPercent = offer.discountValue;
      discountAmount = (productPrice * offer.discountValue) / 100;
    } else if (offer.discountType === "fixed") {
      discountAmount = Math.min(offer.discountValue, productPrice);
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
};
