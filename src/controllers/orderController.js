// src/controllers/orderController.js
const { db, admin } = require("../config/firebase");
const { createRazorpayOrder, verifySignature, updateInventory } = require("../services/paymentService");

function toNonNegativeNumber(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return null;
  return num;
}

function validateOrderItems(items) {
  if (!Array.isArray(items) || items.length === 0) return false;
  return items.every((item) => {
    if (!item || typeof item !== "object") return false;
    if (!item.productId || typeof item.productId !== "string") return false;
    const qty = toNonNegativeNumber(item.quantity);
    const price = toNonNegativeNumber(item.price);
    return qty !== null && qty > 0 && price !== null;
  });
}

function validateOrderData(orderData) {
  if (!orderData || typeof orderData !== "object") return false;

  if (!validateOrderItems(orderData.items)) return false;

  const total = toNonNegativeNumber(orderData.total);
  if (total === null || total === 0) return false;

  if (orderData.deliveryFee != null && toNonNegativeNumber(orderData.deliveryFee) === null) {
    return false;
  }
  if (orderData.platformFee != null && toNonNegativeNumber(orderData.platformFee) === null) {
    return false;
  }

  const addr = orderData.shippingAddress || {};
  if (!addr || typeof addr !== "object" || !addr.fullName || !addr.pincode) {
    return false;
  }

  return true;
}

exports.createPayment = async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Login required" });

    const total = toNonNegativeNumber(req.body.total);
    if (total === null || total === 0) {
      return res.status(400).json({ error: "Invalid total amount" });
    }

    const razorpayOrder = await createRazorpayOrder(total);
    res.json({
      orderId: razorpayOrder.id,
      amount: razorpayOrder.amount,
      currency: razorpayOrder.currency,
      key: process.env.RAZORPAY_KEY_ID,
    });
  } catch (err) {
    console.error("Create payment error:", err);
    res.status(500).json({ error: "Payment initiation failed" });
  }
};

exports.verifyPayment = async (req, res) => {
  const {
    razorpay_order_id,
    razorpay_payment_id,
    razorpay_signature,
    orderData,
  } = req.body;

  try {
    if (!verifySignature(razorpay_order_id, razorpay_payment_id, razorpay_signature)) {
      console.error("Signature mismatch. Check RAZORPAY_KEY_SECRET in .env!");
      return res.status(400).json({ error: "Payment verification failed: Signature mismatch" });
    }

    if (!validateOrderData(orderData)) {
      console.error("Invalid order data:", JSON.stringify(orderData, null, 2));
      return res.status(400).json({ error: "Invalid order data" });
    }

    // Idempotency: if we've already created an order for this payment, return it
    const existingSnap = await db
      .collection("orders")
      .where("paymentId", "==", razorpay_payment_id)
      .limit(1)
      .get();

    if (!existingSnap.empty) {
      const existing = existingSnap.docs[0];
      return res.json({ success: true, orderId: existing.id, duplicate: true });
    }

    await updateInventory(orderData.items);

    const orderRef = await db.collection("orders").add({
      ...orderData,
      userId: req.user?.uid || "guest",
      status: "confirmed",
      statusHistory: {
        pending: admin.firestore.FieldValue.serverTimestamp(),
        confirmed: admin.firestore.FieldValue.serverTimestamp(),
      },
      paymentId: razorpay_payment_id,
      courierId: orderData.courierId || null,
      courierName: orderData.courierName || null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.json({ success: true, orderId: orderRef.id });
  } catch (err) {
    console.error("Verify payment error:", err);
    res.status(500).json({ error: "Order processing failed" });
  }
};

exports.placeCod = async (req, res) => {
  try {
    const { items, total, deliveryFee, platformFee, shippingAddress, customerName, userEmail } = req.body;

    const orderData = {
      items,
      total,
      deliveryFee,
      platformFee,
      shippingAddress,
      customerName,
      userEmail,
      courierId: req.body.courierId || null,
      courierName: req.body.courierName || null,
    };

    if (!validateOrderData(orderData)) {
      return res.status(400).json({ error: "Invalid order data" });
    }

    const userId = req.user?.uid || "guest";

    // Basic idempotency: avoid duplicate recent COD orders with same items & total
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

    const recentSnap = await db
      .collection("orders")
      .where("userId", "==", userId)
      .where("status", "==", "pending")
      .get();

    const itemsJson = JSON.stringify(items || []);
    const maybeDuplicate = recentSnap.docs.find((doc) => {
      const data = doc.data();
      const sameTotal = data.total === total;
      const sameItems = JSON.stringify(data.items || []) === itemsJson;
      const createdAt = data.createdAt && data.createdAt.toDate ? data.createdAt.toDate() : null;
      const recent = createdAt && createdAt >= fiveMinutesAgo;
      return sameTotal && sameItems && recent && data.paymentMethod === "cod";
    });

    if (maybeDuplicate) {
      return res.json({ success: true, orderId: maybeDuplicate.id, duplicate: true });
    }

    await updateInventory(items);

    const orderRef = await db.collection("orders").add({
      userId,
      items,
      total,
      deliveryFee: deliveryFee ?? 0,
      platformFee: platformFee ?? 0,
      shippingAddress,
      customerName,
      userEmail,
      courierId: orderData.courierId || null,
      courierName: orderData.courierName || null,
      status: "pending",
      statusHistory: {
        pending: admin.firestore.FieldValue.serverTimestamp(),
      },
      paymentMethod: "cod",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.json({ success: true, orderId: orderRef.id });
  } catch (err) {
    console.error("Place COD error:", err);
    res.status(500).json({ error: "Order placement failed", message: err.message, stack: err.stack });
  }
};

exports.getUserOrders = async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Login required" });
    const snap = await db
      .collection("orders")
      .where("userId", "==", req.user.uid)
      .orderBy("createdAt", "desc")
      .get();
    res.json(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
