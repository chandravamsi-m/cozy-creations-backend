// src/controllers/orderController.js
const crypto = require("crypto");
const { db, admin } = require("../config/firebase");
const { createRazorpayOrder, verifySignature, createOrderRecord } = require("../services/paymentService");
const { buildCanonicalOrder } = require("../services/orderPricingService");
const { sendOrderConfirmationEmail } = require("../services/emailService");

function buildCodFingerprint(orderData) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify({
      userId: orderData.userId,
      items: orderData.items.map((item) => ({ productId: item.productId, quantity: item.quantity })),
      shippingAddress: {
        pincode: orderData.shippingAddress?.pincode,
        phone: orderData.shippingAddress?.phone,
      },
      total: orderData.total,
      paymentMethod: orderData.paymentMethod,
    }))
    .digest("hex");
}

function handleOrderError(res, error, fallbackMessage) {
  const status = error.status || 500;
  return res.status(status).json({
    error: error.message || fallbackMessage,
    code: error.code || "ORDER_ERROR",
  });
}

exports.createPayment = async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Login required" });

    const canonicalOrder = await buildCanonicalOrder({
      payload: req.body,
      paymentMethod: "online",
      user: req.user,
    });

    const razorpayOrder = await createRazorpayOrder(canonicalOrder.total);
    await db.collection("paymentAttempts").doc(razorpayOrder.id).set({
      userId: req.user.uid,
      status: "pending",
      orderData: canonicalOrder,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.json({
      orderId: razorpayOrder.id,
      amount: razorpayOrder.amount,
      currency: razorpayOrder.currency,
      key: process.env.RAZORPAY_KEY_ID,
      pricing: {
        subtotal: canonicalOrder.subtotal,
        discountTotal: canonicalOrder.discountTotal,
        deliveryFee: canonicalOrder.deliveryFee,
        platformFee: canonicalOrder.platformFee,
        total: canonicalOrder.total,
      },
    });
  } catch (err) {
    console.error("Create payment error:", err);
    handleOrderError(res, err, "Payment initiation failed");
  }
};

exports.verifyPayment = async (req, res) => {
  const {
    razorpay_order_id,
    razorpay_payment_id,
    razorpay_signature,
  } = req.body;

  try {
    if (!req.user) return res.status(401).json({ error: "Login required" });

    if (!verifySignature(razorpay_order_id, razorpay_payment_id, razorpay_signature)) {
      return res.status(400).json({ error: "Payment verification failed", code: "INVALID_SIGNATURE" });
    }

    const existingSnap = await db
      .collection("orders")
      .where("paymentId", "==", razorpay_payment_id)
      .limit(1)
      .get();

    if (!existingSnap.empty) {
      const existing = existingSnap.docs[0];
      return res.json({ success: true, orderId: existing.id, duplicate: true });
    }

    const attemptRef = db.collection("paymentAttempts").doc(razorpay_order_id);
    const attemptSnap = await attemptRef.get();
    if (!attemptSnap.exists) {
      return res.status(400).json({ error: "Payment attempt not found", code: "MISSING_PAYMENT_ATTEMPT" });
    }

    const attemptData = attemptSnap.data();
    if (attemptData.userId !== req.user.uid) {
      return res.status(403).json({ error: "Access denied", code: "PAYMENT_ATTEMPT_MISMATCH" });
    }

    if (attemptData.status === "completed" && attemptData.orderId) {
      return res.json({ success: true, orderId: attemptData.orderId, duplicate: true });
    }

    const orderId = await createOrderRecord({
      orderData: {
        ...attemptData.orderData,
        userId: req.user.uid,
        paymentMethod: "online",
        status: "confirmed",
        statusHistory: {
          pending: admin.firestore.FieldValue.serverTimestamp(),
          confirmed: admin.firestore.FieldValue.serverTimestamp(),
        },
      },
      paymentId: razorpay_payment_id,
      paymentOrderId: razorpay_order_id,
    });

    await attemptRef.set({
      status: "completed",
      orderId,
      paymentId: razorpay_payment_id,
      completedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    sendOrderConfirmationEmail(attemptData.orderData.userEmail, {
      ...attemptData.orderData,
      orderId,
    }).catch((emailError) => {
      console.error("Order confirmation email failed:", emailError);
    });

    res.json({ success: true, orderId });
  } catch (err) {
    console.error("Verify payment error:", err);
    handleOrderError(res, err, "Order processing failed");
  }
};

exports.placeCod = async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Login required" });

    const canonicalOrder = await buildCanonicalOrder({
      payload: req.body,
      paymentMethod: "cod",
      user: req.user,
    });

    const fingerprint = buildCodFingerprint(canonicalOrder);
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const recentSnap = await db
      .collection("orders")
      .where("userId", "==", req.user.uid)
      .where("paymentMethod", "==", "cod")
      .where("status", "==", "pending")
      .get();

    const maybeDuplicate = recentSnap.docs.find((doc) => {
      const data = doc.data();
      const createdAt = data.createdAt?.toDate ? data.createdAt.toDate() : null;
      return data.codFingerprint === fingerprint && createdAt && createdAt >= fiveMinutesAgo;
    });

    if (maybeDuplicate) {
      return res.json({ success: true, orderId: maybeDuplicate.id, duplicate: true });
    }

    const orderId = await createOrderRecord({
      orderData: {
        ...canonicalOrder,
        userId: req.user.uid,
        status: "pending",
        statusHistory: {
          pending: admin.firestore.FieldValue.serverTimestamp(),
        },
        codFingerprint: fingerprint,
      },
    });

    sendOrderConfirmationEmail(canonicalOrder.userEmail, {
      ...canonicalOrder,
      orderId,
    }).catch((emailError) => {
      console.error("COD confirmation email failed:", emailError);
    });

    res.json({
      success: true,
      orderId,
      pricing: {
        subtotal: canonicalOrder.subtotal,
        discountTotal: canonicalOrder.discountTotal,
        deliveryFee: canonicalOrder.deliveryFee,
        platformFee: canonicalOrder.platformFee,
        total: canonicalOrder.total,
      },
    });
  } catch (err) {
    console.error("Place COD error:", err);
    handleOrderError(res, err, "Order placement failed");
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
