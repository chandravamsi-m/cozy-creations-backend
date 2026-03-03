// src/controllers/orderController.js
const { db, admin } = require("../config/firebase");
const { createRazorpayOrder, verifySignature, updateInventory } = require("../services/paymentService");

exports.createPayment = async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Login required" });
    const razorpayOrder = await createRazorpayOrder(req.body.total);
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
      return res.status(400).json({ error: "Payment verification failed" });
    }

    await updateInventory(orderData.items);

    const orderRef = await db.collection("orders").add({
      ...orderData,
      userId: req.user?.uid || "guest",
      status: "confirmed",
      statusHistory: {
        pending: admin.firestore.FieldValue.serverTimestamp(),
        confirmed: admin.firestore.FieldValue.serverTimestamp()
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

    await updateInventory(items);

    const orderRef = await db.collection("orders").add({
      userId: req.user?.uid || "guest",
      items,
      total,
      deliveryFee: deliveryFee ?? 0,
      platformFee: platformFee ?? 0,
      shippingAddress,
      customerName,
      userEmail,
      courierId: req.body.courierId || null,
      courierName: req.body.courierName || null,
      status: "pending",
      statusHistory: {
        pending: admin.firestore.FieldValue.serverTimestamp()
      },
      paymentMethod: "cod",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.json({ success: true, orderId: orderRef.id });
  } catch (err) {
    console.error("Place COD error:", err);
    res.status(500).json({ error: "Order placement failed" });
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
