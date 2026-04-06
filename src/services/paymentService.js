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

async function createOrderRecord({ orderData, paymentId = null, paymentOrderId = null }) {
  const orderRef = db.collection("orders").doc();

  await db.runTransaction(async (transaction) => {
    const productRefs = orderData.items.map((item) => db.collection("products").doc(item.productId));
    const productSnaps = await Promise.all(productRefs.map((ref) => transaction.get(ref)));

    productSnaps.forEach((productSnap, index) => {
      if (!productSnap.exists) {
        throw new Error(`Product not found: ${orderData.items[index].productId}`);
      }
    });

    transaction.set(orderRef, {
      ...orderData,
      paymentId,
      paymentOrderId,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  });

  return orderRef.id;
}

module.exports = {
  createRazorpayOrder,
  verifySignature,
  createOrderRecord,
};
