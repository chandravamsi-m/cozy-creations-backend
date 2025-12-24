require("dotenv").config();
const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");
const Razorpay = require("razorpay");
const crypto = require("crypto");

const app = express();
app.use(cors());
app.use(express.json());

// Initialize Firebase Admin
if (process.env.FIREBASE_ADMIN_CRED_JSON) {
  admin.initializeApp({
    credential: admin.credential.cert(
      JSON.parse(process.env.FIREBASE_ADMIN_CRED_JSON)
    ),
  });
} else {
  admin.initializeApp();
}

const db = admin.firestore();

// Middleware: Verify ID Token & Set req.user
async function maybeAuth(req, res, next) {
  const h = req.headers.authorization || "";
  if (h.startsWith("Bearer ")) {
    const idToken = h.split(" ")[1];
    try {
      const decoded = await admin.auth().verifyIdToken(idToken);
      req.user = decoded;
    } catch (err) {
      console.warn("Auth Warning: Invalid token", err.message);
    }
  }
  next();
}

// Helper: Verify User is Admin via UID
async function isAdminUid(uid) {
  if (!uid) return false;
  try {
    const userDoc = await db.collection("users").doc(uid).get();
    return userDoc.exists && userDoc.data().role === "admin";
  } catch (err) {
    console.error("isAdminUid check failed:", err);
    return false;
  }
}

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// ------------------------------------------
// PRODUCT MANAGEMENT (ADMIN ONLY)
// ------------------------------------------

app.post("/api/admin/products", maybeAuth, async (req, res) => {
  try {
    const uid = req.user?.uid;
    if (!(await isAdminUid(uid)))
      return res.status(403).json({ error: "forbidden" });

    const { product } = req.body;
    if (!product?.name || typeof product.price === "undefined") {
      return res.status(400).json({ error: "invalid_payload" });
    }

    const now = admin.firestore.FieldValue.serverTimestamp();
    const newProductData = {
      ...product,
      isActive: typeof product.isActive === "boolean" ? product.isActive : true,
      createdAt: now,
      updatedAt: now,
      thumbnailUrl: product.thumbnailUrl || product.imageUrl || null,
      inventory:
        typeof product.inventory === "number" ? product.inventory : 100,
    };

    // Auto-generate Firestore UID for the document
    const docRef = db.collection("products").doc();
    await docRef.set(newProductData);

    return res.json({
      id: docRef.id,
      product: { id: docRef.id, ...newProductData },
    });
  } catch (err) {
    console.error("Server Error:", err);
    return res.status(500).json({ error: "internal_error" });
  }
});

app.patch("/api/admin/products/:id", maybeAuth, async (req, res) => {
  try {
    const uid = req.user?.uid;
    if (!(await isAdminUid(uid)))
      return res.status(403).json({ error: "forbidden" });

    const productId = req.params.id;
    const updates = req.body.product;
    if (!updates || typeof updates !== "object")
      return res.status(400).json({ error: "invalid_payload" });

    updates.updatedAt = admin.firestore.FieldValue.serverTimestamp();
    await db.collection("products").doc(productId).update(updates);

    const doc = await db.collection("products").doc(productId).get();
    return res.json({ id: doc.id, product: doc.data() });
  } catch (err) {
    return res.status(500).json({ error: "internal_error" });
  }
});

app.delete("/api/admin/products/:id", maybeAuth, async (req, res) => {
  try {
    const uid = req.user?.uid;
    if (!(await isAdminUid(uid)))
      return res.status(403).json({ error: "forbidden" });

    await db.collection("products").doc(req.params.id).update({
      isActive: false,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return res.json({ success: true, message: "Product deactivated" });
  } catch (err) {
    return res.status(500).json({ error: "internal_error" });
  }
});

// PERMANENT DELETE PRODUCT (ADMIN ONLY)
app.delete("/api/admin/products/:id/permanent", maybeAuth, async (req, res) => {
  try {
    const uid = req.user?.uid;
    if (!(await isAdminUid(uid))) return res.status(403).json({ error: "forbidden" });

    const productId = req.params.id;
    await db.collection("products").doc(productId).delete();

    return res.json({ success: true, message: "Product permanently deleted" });
  } catch (err) {
    console.error("PERMANENT DELETE ERROR:", err);
    return res.status(500).json({ error: "internal_error" });
  }
});

// ------------------------------------------
// RAZORPAY PAYMENT & ORDERS
// ------------------------------------------

app.post("/api/orders/create-payment", maybeAuth, async (req, res) => {
  try {
    const uid = req.user?.uid;
    if (!uid) return res.status(401).json({ error: "unauthorized" });

    const { items, total } = req.body;
    if (!items?.length || !total)
      return res.status(400).json({ error: "missing_data" });

    const razorpayOrder = await razorpay.orders.create({
      amount: Math.round(total * 100), // paise
      currency: "INR",
      receipt: `order_${Date.now()}_${uid.substring(0, 5)}`,
    });

    return res.json({
      orderId: razorpayOrder.id,
      amount: razorpayOrder.amount,
      currency: razorpayOrder.currency,
      key: process.env.RAZORPAY_KEY_ID,
    });
  } catch (err) {
    console.error("Razorpay Create Error:", err);
    return res.status(500).json({ error: "payment_creation_failed" });
  }
});

app.post("/api/orders/verify-payment", maybeAuth, async (req, res) => {
  try {
    const uid = req.user?.uid;
    if (!uid) return res.status(401).json({ error: "unauthorized" });

    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      orderData,
    } = req.body;

    // Verify Signature
    const hmac = crypto.createHmac("sha256", process.env.RAZORPAY_KEY_SECRET);
    hmac.update(`${razorpay_order_id}|${razorpay_payment_id}`);
    if (hmac.digest("hex") !== razorpay_signature) {
      return res.status(400).json({ error: "invalid_signature" });
    }

    // Process Line Items and Inventory
    const finalItems = [];
    for (const it of orderData.items) {
      const pSnap = await db.collection("products").doc(it.productId).get();
      if (pSnap.exists) {
        const p = pSnap.data();
        finalItems.push({
          productId: pSnap.id,
          name: p.name,
          price: p.price,
          quantity: it.quantity,
          customization: it.customization || null,
        });

        if (typeof p.inventory === "number") {
          await db
            .collection("products")
            .doc(pSnap.id)
            .update({
              inventory: Math.max(0, p.inventory - it.quantity),
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
        }
      }
    }

    // Save Order
    const orderRef = await db.collection("orders").add({
      userId: uid,
      items: finalItems,
      total: orderData.total,
      shippingAddress: orderData.shippingAddress,
      status: "pending",
      payment: {
        razorpay_order_id,
        razorpay_payment_id,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      },
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return res.json({ success: true, orderId: orderRef.id });
  } catch (err) {
    console.error("Verification Error:", err);
    return res.status(500).json({ error: "internal_error" });
  }
});

// PLACE COD ORDER (ANY AUTHENTICATED USER)
app.post("/api/orders/place-cod", maybeAuth, async (req, res) => {
  try {
    const uid = req.user?.uid;
    if (!uid) return res.status(401).json({ error: "unauthorized" });

    const { items, total, shippingAddress } = req.body;
    if (!items?.length || !total || !shippingAddress) {
      return res.status(400).json({ error: "invalid_payload" });
    }

    // 1. Process Line Items and Inventory
    const finalItems = [];
    for (const item of items) {
      const pSnap = await db.collection("products").doc(item.productId).get();
      if (pSnap.exists) {
        const p = pSnap.data();
        finalItems.push({ 
          productId: pSnap.id, 
          name: p.name, 
          price: p.price, 
          quantity: item.quantity, 
          customization: item.customization || null 
        });
        
        if (typeof p.inventory === "number") {
          await db.collection("products").doc(pSnap.id).update({
            inventory: Math.max(0, p.inventory - item.quantity),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          });
        }
      }
    }

    // 2. Save COD Order to Firestore
    const orderRef = await db.collection("orders").add({
      userId: uid,
      items: finalItems,
      total: total,
      shippingAddress: shippingAddress,
      status: "pending",
      paymentMethod: "cod",
      paymentStatus: "awaiting_collection",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return res.json({ success: true, orderId: orderRef.id });
  } catch (err) {
    console.error("COD ORDER ERROR:", err);
    return res.status(500).json({ error: "internal_error" });
  }
});

// ------------------------------------------
// ADMIN ORDER VIEWS
// ------------------------------------------

app.get("/api/admin/orders", maybeAuth, async (req, res) => {
  try {
    const uid = req.user?.uid;
    if (!(await isAdminUid(uid)))
      return res.status(403).json({ error: "forbidden" });

    const snap = await db
      .collection("orders")
      .orderBy("createdAt", "desc")
      .limit(100)
      .get();
    const orders = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return res.json({ orders });
  } catch (err) {
    return res.status(500).json({ error: "internal_error" });
  }
});

app.patch("/api/admin/orders/:id", maybeAuth, async (req, res) => {
  try {
    const uid = req.user?.uid;
    if (!(await isAdminUid(uid)))
      return res.status(403).json({ error: "forbidden" });

    await db.collection("orders").doc(req.params.id).update({
      status: req.body.status,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: "internal_error" });
  }
});

// DELETE USER (ADMIN ONLY)
app.delete("/api/admin/users/:uid", maybeAuth, async (req, res) => {
  try {
    const adminUid = req.user?.uid;
    if (!(await isAdminUid(adminUid))) return res.status(403).json({ error: "forbidden" });

    const targetUid = req.params.uid;
    if (adminUid === targetUid) return res.status(400).json({ error: "cannot_delete_self" });

    // 1. Delete from Firebase Auth
    await admin.auth().deleteUser(targetUid);
    
    // 2. Delete from Firestore
    await db.collection("users").doc(targetUid).delete();

    return res.json({ success: true, message: "User permanently deleted" });
  } catch (err) {
    console.error("DELETE USER ERROR:", err);
    return res.status(500).json({ error: "internal_error" });
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`🚀 Backend live on port ${PORT}`));
