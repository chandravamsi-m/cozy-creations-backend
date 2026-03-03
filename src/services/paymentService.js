// src/services/paymentService.js
const razorpay = require("../config/razorpay");
const crypto = require("crypto");
const { admin, db } = require("../config/firebase");

/**
 * Creates a Razorpay order.
 */
async function createRazorpayOrder(amount) {
  return await razorpay.orders.create({
    amount: Math.round(amount * 100),
    currency: "INR",
    receipt: `order_${Date.now()}`,
  });
}

/**
 * Verifies Razorpay signature.
 */
function verifySignature(orderId, paymentId, signature) {
  const hmac = crypto.createHmac("sha256", process.env.RAZORPAY_KEY_SECRET);
  hmac.update(`${orderId}|${paymentId}`);
  return hmac.digest("hex") === signature;
}

/**
 * Updates inventory after a successful payment or order placement.
 */
async function updateInventory(items) {
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
}

module.exports = {
  createRazorpayOrder,
  verifySignature,
  updateInventory,
};
