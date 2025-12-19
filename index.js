// backend/index.js
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const admin = require("firebase-admin");
// const Stripe = require("stripe");
const Razorpay = require("razorpay");
const crypto = require("crypto");

const app = express();
app.use(cors());
app.use(bodyParser.json());

/**
 * Initialize Firebase Admin
 * You can either pass full JSON via env or use a file path.
 */
if (process.env.FIREBASE_ADMIN_CRED_JSON) {
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_ADMIN_CRED_JSON))
  });
} else {
  admin.initializeApp();
}

const db = admin.firestore();
// const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// Middleware: maybe auth — verifies ID token and sets req.user if valid
async function maybeAuth(req, res, next) {
  const h = req.headers.authorization || "";
  if (h.startsWith("Bearer ")) {
    const idToken = h.split(" ")[1];
    try {
      const decoded = await admin.auth().verifyIdToken(idToken);
      req.user = decoded;
    } catch (err) {
      console.warn("Invalid token:", err.message);
    }
  }
  next();
}

/**
 * ADMIN CHECK helper:
 * Updated to check "users" collection by email instead of "admins" collection by UID.
 * Document ID is sanitized email (lowercase, non-alphanumeric replaced with underscore).
 */
async function isAdminUid(uid, email) {
  if (!uid || !email) return false;
  try {
    // Sanitize email the same way frontend does: lowercase and replace non-alphanumeric with underscore
    const emailDocId = email.toLowerCase().replace(/[^a-z0-9]/g, "_");
    const userDoc = await db.collection("users").doc(emailDocId).get();
    
    if (userDoc.exists) {
      const userData = userDoc.data();
      // Verify UID matches (extra security check)
      if (userData.uid === uid && userData.role === "admin") {
        return true;
      }
    }
    return false;
  } catch (err) {
    console.error("isAdminUid err", err);
    return false;
  }
}

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

/**
 * POST /api/admin/products
 * Protected: admin only
 * Body: { product: { name, price, category, ... } }
 * Server sets createdAt, thumbnailUrl optional handling.
 */
app.post("/api/admin/products", maybeAuth, async (req, res) => {
  try {
    const uid = req.user ? req.user.uid : null;
    const email = req.user ? req.user.email : null;
    if (!uid || !email || !(await isAdminUid(uid, email))) {
      return res.status(403).json({ error: "forbidden" });
    }

    const product = req.body.product;
    if (!product || !product.name || typeof product.price === "undefined") {
      return res.status(400).json({ error: "invalid product payload" });
    }

    // ensure required defaults
    const now = admin.firestore.FieldValue.serverTimestamp();
    const docRef = await db.collection("products").add({
      ...product,
      isActive: typeof product.isActive === "boolean" ? product.isActive : true,
      createdAt: now,
      updatedAt: now,
      thumbnailUrl: product.thumbnailUrl || product.imageUrl || null,
      inventory: typeof product.inventory === "number" ? product.inventory : null,
    });

    const saved = await docRef.get();

    return res.json({ id: docRef.id, product: { id: docRef.id, ...saved.data() } });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "internal_error" });
  }
});

/**
 * POST /api/orders
 * Body: { items: [{ productId, quantity }], billing: {...} }
 * Header optional: Authorization: Bearer <idToken>
 *
 * Steps:
 * - verify items exist, active, and inventory
 * - compute total server-side using product.price
 * - create order doc with status: pending
 * - create Stripe PaymentIntent (if stripe configured) and return clientSecret
 */
app.post("/api/orders", maybeAuth, async (req, res) => {
  try {
    const { items, billing } = req.body;
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "empty_cart" });
    }

    // fetch products
    const productIds = items.map(i => i.productId);
    const productDocs = await Promise.all(productIds.map(id => db.collection("products").doc(id).get()));

    let total = 0;
    const lineItems = [];

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const pSnap = productDocs[i];
      if (!pSnap.exists) return res.status(400).json({ error: `product ${it.productId} missing` });

      const p = pSnap.data();
      if (!p.isActive) return res.status(400).json({ error: `product ${it.productId} inactive` });

      const qty = parseInt(it.quantity, 10);
      if (!qty || qty <= 0) return res.status(400).json({ error: "invalid_quantity" });

      if (typeof p.inventory === "number" && p.inventory < qty) {
        return res.status(400).json({ error: `insufficient_inventory for ${p.name}` });
      }

      // Price trusted from server; we assume price is whole-rupee integer
      const price = p.price;
      lineItems.push({ productId: pSnap.id, name: p.name, price, quantity: qty });
      total += price * qty;
    }

    // optional: apply server discounts or shipping here
    // round or sanitize total if needed

    // create order in Firestore
    const orderRef = db.collection("orders").doc();
    const orderData = {
      userId: req.user ? req.user.uid : null,
      items: lineItems,
      billing: billing || null,
      total,
      currency: "INR",
      status: "pending",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    await orderRef.set(orderData);

    // create Stripe PaymentIntent (if configured)
    let clientSecret = null;

if (process.env.STRIPE_SECRET_KEY && process.env.STRIPE_SECRET_KEY !== "") {
  try {
    const paymentIntent = await stripe.paymentIntents.create({
      amount: total * 100,
      currency: "inr",
      metadata: { orderId: orderRef.id }
    });
    await orderRef.update({ stripePaymentIntentId: paymentIntent.id });
    clientSecret = paymentIntent.client_secret;
  } catch (err) {
    console.error("Stripe create PaymentIntent failed:", err.message);
    // DO NOT break order creation — just skip Stripe
  }
}

    return res.json({ orderId: orderRef.id, clientSecret });
  } catch (err) {
    console.error("create order error", err);
    return res.status(500).json({ error: "internal_error" });
  }
});

// UPDATE PRODUCT (ADMIN ONLY)
app.patch("/api/admin/products/:id", maybeAuth, async (req, res) => {
  try {
    const uid = req.user ? req.user.uid : null;
    const email = req.user ? req.user.email : null;
    if (!uid || !email || !(await isAdminUid(uid, email))) {
      return res.status(403).json({ error: "forbidden" });
    }

    const productId = req.params.id;
    const updates = req.body.product;

    if (!updates || typeof updates !== "object") {
      return res.status(400).json({ error: "invalid_update_payload" });
    }

    // always set updatedAt
    updates.updatedAt = admin.firestore.FieldValue.serverTimestamp();

    // update product
    await db.collection("products").doc(productId).update(updates);

    const updatedDoc = await db.collection("products").doc(productId).get();
    return res.json({ id: updatedDoc.id, product: updatedDoc.data() });

  } catch (err) {
    console.error("UPDATE PRODUCT ERROR:", err);
    return res.status(500).json({ error: "internal_error" });
  }
});

// SOFT DELETE PRODUCT (ADMIN ONLY)
app.delete("/api/admin/products/:id", maybeAuth, async (req, res) => {
  try {
    const uid = req.user ? req.user.uid : null;
    const email = req.user ? req.user.email : null;
    if (!uid || !email || !(await isAdminUid(uid, email))) {
      return res.status(403).json({ error: "forbidden" });
    }

    const productId = req.params.id;

    await db.collection("products").doc(productId).update({
      isActive: false,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    return res.json({ success: true, message: "Product deactivated" });

  } catch (err) {
    console.error("DELETE PRODUCT ERROR:", err);
    return res.status(500).json({ error: "internal_error" });
  }
});

// ==========================
// ADMIN ORDERS (ADMIN ONLY)
// ==========================

// LIST ORDERS
app.get("/api/admin/orders", maybeAuth, async (req, res) => {
  try {
    const uid = req.user ? req.user.uid : null;
    const email = req.user ? req.user.email : null;
    if (!uid || !email || !(await isAdminUid(uid, email))) {
      return res.status(403).json({ error: "forbidden" });
    }

    const limitParam = parseInt(req.query.limit, 10);
    const limitN = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 200) : 100;

    const snap = await db
      .collection("orders")
      .orderBy("createdAt", "desc")
      .limit(limitN)
      .get();

    const orders = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return res.json({ orders });
  } catch (err) {
    console.error("LIST ORDERS ERROR:", err);
    return res.status(500).json({ error: "internal_error" });
  }
});

// ORDER DETAILS
app.get("/api/admin/orders/:id", maybeAuth, async (req, res) => {
  try {
    const uid = req.user ? req.user.uid : null;
    const email = req.user ? req.user.email : null;
    if (!uid || !email || !(await isAdminUid(uid, email))) {
      return res.status(403).json({ error: "forbidden" });
    }

    const orderId = req.params.id;
    const snap = await db.collection("orders").doc(orderId).get();

    if (!snap.exists) return res.status(404).json({ error: "not_found" });
    return res.json({ id: snap.id, order: { id: snap.id, ...snap.data() } });
  } catch (err) {
    console.error("GET ORDER ERROR:", err);
    return res.status(500).json({ error: "internal_error" });
  }
});

// OPTIONAL: UPDATE ORDER STATUS
app.patch("/api/admin/orders/:id", maybeAuth, async (req, res) => {
  try {
    const uid = req.user ? req.user.uid : null;
    const email = req.user ? req.user.email : null;
    if (!uid || !email || !(await isAdminUid(uid, email))) {
      return res.status(403).json({ error: "forbidden" });
    }

    const orderId = req.params.id;
    const updates = req.body || {};
    const allowedStatuses = ["pending", "confirmed", "packed", "shipped", "delivered", "cancelled"];

    if (!updates.status || !allowedStatuses.includes(updates.status)) {
      return res.status(400).json({ error: "invalid_status" });
    }

    await db.collection("orders").doc(orderId).update({
      status: updates.status,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    const snap = await db.collection("orders").doc(orderId).get();
    return res.json({ id: snap.id, order: { id: snap.id, ...snap.data() } });
  } catch (err) {
    console.error("UPDATE ORDER ERROR:", err);
    return res.status(500).json({ error: "internal_error" });
  }
});

// ============================================
// RAZORPAY PAYMENT INTEGRATION CODE
// ============================================

/**
 * POST /api/orders/create-payment
 * Protected: requires authentication
 * Body: { items: [{ productId, quantity, customization }], total: number }
 * 
 * Creates a Razorpay order and returns order details for frontend
 */
app.post("/api/orders/create-payment", maybeAuth, async (req, res) => {
  try {
    const uid = req.user ? req.user.uid : null;
    if (!uid) {
      console.error("CREATE PAYMENT: No user found");
      return res.status(401).json({ error: "unauthorized", message: "User not authenticated" });
    }

    // Check if Razorpay is configured
    if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
      console.error("CREATE PAYMENT: Razorpay keys not configured");
      return res.status(500).json({ 
        error: "payment_not_configured", 
        message: "Razorpay keys are not configured on the server" 
      });
    }

    const { items, total } = req.body;

    // Validate input
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "empty_cart", message: "Cart is empty" });
    }

    if (!total || typeof total !== "number" || total <= 0) {
      return res.status(400).json({ error: "invalid_total", message: "Invalid total amount" });
    }

    console.log(`CREATE PAYMENT: Processing order for user ${uid}, ${items.length} items, total: ${total}`);

    // Verify products exist and are active
    const productIds = items.map((i) => i.productId);
    const productDocs = await Promise.all(
      productIds.map((id) => db.collection("products").doc(id).get())
    );

    const lineItems = [];
    let calculatedTotal = 0;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const productDoc = productDocs[i];

      if (!productDoc.exists) {
        return res.status(400).json({ 
          error: "product_not_found", 
          message: `Product ${item.productId} not found` 
        });
      }

      const product = productDoc.data();
      if (!product.isActive) {
        return res.status(400).json({ 
          error: "product_inactive", 
          message: `Product ${item.productId} is inactive` 
        });
      }

      const quantity = parseInt(item.quantity, 10);
      if (!quantity || quantity <= 0) {
        return res.status(400).json({ error: "invalid_quantity", message: "Invalid quantity" });
      }

      // Check inventory if available
      if (typeof product.inventory === "number" && product.inventory < quantity) {
        return res.status(400).json({ 
          error: "insufficient_inventory", 
          message: `Insufficient inventory for ${product.name}` 
        });
      }

      const price = product.price;
      lineItems.push({
        productId: productDoc.id,
        name: product.name,
        price,
        quantity,
        customization: item.customization || null,
      });

      calculatedTotal += price * quantity;
    }

    // Verify total matches (with small tolerance for rounding)
    if (Math.abs(calculatedTotal - total) > 1) {
      return res.status(400).json({ 
        error: "total_mismatch",
        message: `Calculated total (${calculatedTotal}) doesn't match provided total (${total})`
      });
    }

    // Create Razorpay order
    // Amount should be in paise (smallest currency unit)
    // For INR, 1 rupee = 100 paise
    const amountInPaise = Math.round(total * 100);

    console.log(`CREATE PAYMENT: Creating Razorpay order for ${amountInPaise} paise`);

    try {
      const razorpayOrder = await razorpay.orders.create({
        amount: amountInPaise,
        currency: "INR",
        receipt: `order_${Date.now()}_${uid.substring(0, 8)}`,
        notes: {
          userId: uid,
          itemCount: items.length,
        },
      });

      console.log(`CREATE PAYMENT: Razorpay order created: ${razorpayOrder.id}`);

      // Return Razorpay order details to frontend
      return res.json({
        orderId: razorpayOrder.id,
        amount: razorpayOrder.amount,
        currency: razorpayOrder.currency,
        key: process.env.RAZORPAY_KEY_ID, // Razorpay key for frontend
      });
    } catch (razorpayError) {
      console.error("CREATE PAYMENT: Razorpay API error:", razorpayError);
      return res.status(500).json({ 
        error: "razorpay_error", 
        message: razorpayError.message || "Failed to create Razorpay order" 
      });
    }
  } catch (err) {
    console.error("CREATE PAYMENT ERROR:", err);
    return res.status(500).json({ 
      error: "internal_error", 
      message: err.message || "Internal server error" 
    });
  }
});

/**
 * POST /api/orders/verify-payment
 * Protected: requires authentication
 * Body: {
 *   razorpay_order_id: string,
 *   razorpay_payment_id: string,
 *   razorpay_signature: string,
 *   orderData: { items: [...], total: number }
 * }
 * 
 * Verifies Razorpay payment signature and creates order in Firestore
 */
app.post("/api/orders/verify-payment", maybeAuth, async (req, res) => {
  try {
    const uid = req.user ? req.user.uid : null;
    if (!uid) {
      return res.status(401).json({ error: "unauthorized", message: "User not authenticated" });
    }

    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      orderData,
    } = req.body;

    // Validate input
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ 
        error: "missing_payment_details", 
        message: "Missing payment verification details" 
      });
    }

    if (!orderData || !orderData.items || !orderData.total) {
      return res.status(400).json({ 
        error: "missing_order_data", 
        message: "Missing order data" 
      });
    }

    // Verify payment signature
    const hmac = crypto.createHmac("sha256", process.env.RAZORPAY_KEY_SECRET);
    hmac.update(`${razorpay_order_id}|${razorpay_payment_id}`);
    const generatedSignature = hmac.digest("hex");

    if (generatedSignature !== razorpay_signature) {
      console.error("VERIFY PAYMENT: Signature verification failed");
      return res.status(400).json({ 
        error: "invalid_signature", 
        message: "Payment signature verification failed" 
      });
    }

    // Fetch products to build order items
    const productIds = orderData.items.map((i) => i.productId);
    const productDocs = await Promise.all(
      productIds.map((id) => db.collection("products").doc(id).get())
    );

    const lineItems = [];
    let calculatedTotal = 0;

    for (let i = 0; i < orderData.items.length; i++) {
      const item = orderData.items[i];
      const productDoc = productDocs[i];

      if (!productDoc.exists) {
        return res.status(400).json({ 
          error: "product_not_found", 
          message: `Product ${item.productId} not found` 
        });
      }

      const product = productDoc.data();
      const quantity = parseInt(item.quantity, 10);
      const price = product.price;

      lineItems.push({
        productId: productDoc.id,
        name: product.name,
        price,
        quantity,
        customization: item.customization || null,
      });

      calculatedTotal += price * quantity;

      // Update inventory if available
      if (typeof product.inventory === "number") {
        const newInventory = product.inventory - quantity;
        if (newInventory >= 0) {
          await db.collection("products").doc(productDoc.id).update({
            inventory: newInventory,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        }
      }
    }

    // Create order in Firestore
    const orderRef = db.collection("orders").doc();
    const orderData_firestore = {
      userId: uid,
      items: lineItems,
      total: calculatedTotal,
      currency: "INR",
      status: "pending",
      payment: {
        razorpay_order_id,
        razorpay_payment_id,
        razorpay_signature,
        verified: true,
        verifiedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    await orderRef.set(orderData_firestore);

    console.log(`VERIFY PAYMENT: Order created successfully: ${orderRef.id}`);

    // Return order ID to frontend
    return res.json({
      success: true,
      orderId: orderRef.id,
      message: "Order placed successfully",
    });
  } catch (err) {
    console.error("VERIFY PAYMENT ERROR:", err);
    return res.status(500).json({ 
      error: "internal_error", 
      message: err.message || "Internal server error" 
    });
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Backend listening on ${PORT}`));

