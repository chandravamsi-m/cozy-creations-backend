const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");
const Razorpay = require("razorpay");
const crypto = require("crypto");
const { Resend } = require("resend");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());

// ------------------------------------------
// INITIALIZATION
// ------------------------------------------

// Firebase Admin
if (process.env.FIREBASE_ADMIN_CRED_JSON) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert(
        JSON.parse(process.env.FIREBASE_ADMIN_CRED_JSON)
      ),
    });
  } catch (err) {
    console.warn("Firebase Admin Init Error:", err.message);
    admin.initializeApp();
  }
} else {
  admin.initializeApp();
}

const db = admin.firestore();

// Razorpay
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// Resend Email
const resend = new Resend(process.env.RESEND_API_KEY);
const EMAIL_FROM = process.env.EMAIL_FROM;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;

// ------------------------------------------
// MIDDLEWARE & HELPERS
// ------------------------------------------

async function maybeAuth(req, res, next) {
  const authHeader = req.headers.authorization || "";
  if (authHeader.startsWith("Bearer ")) {
    try {
      req.user = await admin.auth().verifyIdToken(authHeader.split(" ")[1]);
    } catch (err) {
      console.warn("Auth Warning: Invalid token");
    }
  }
  next();
}

async function isAdminUid(uid) {
  if (!uid) return false;
  try {
    const userDoc = await db.collection("users").doc(uid).get();
    return userDoc.exists && userDoc.data().role === "admin";
  } catch (err) {
    console.error("Admin check failed:", err.message);
    return false;
  }
}

// Email Template Helpers
const wrapLayout = (title, content, name) => `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
<body style="margin:0; padding:0; background-color:#FBFAF9; font-family: 'Segoe UI', Arial, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#FBFAF9; padding:40px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff; border-radius:14px; overflow:hidden; border:1px solid #e5e7eb; box-shadow: 0 4px 6px rgba(0,0,0,0.02);">
        <tr>
          <td align="center" style="background:#111827; padding:0;">
           <img src="https://res.cloudinary.com/dumkblp3v/image/upload/v1767161543/cozy-creation-logo_fhljek.webp" alt="Cozy Creations" width="600" style="display:block; width:100%; height:auto;" />
          </td>
        </tr>
        <tr>
          <td style="padding:40px 36px; color:#374151; line-height:1.7;">
            <h2 style="margin:0 0 20px; font-size:24px; color:#111827; font-weight: 700;">${title}</h2>
            <p style="margin:0 0 12px; font-size:16px; color:#111827; font-weight:600;">Hi ${
              name || "Customer"
            },</p>
            ${content}
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:28px; background:#fafafa; color:#9ca3af; font-size:13px;">
            <p style="margin:0;">© 2025 Cozy Creations Corner.<br />Crafted with love in India.</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

const buildItemTable = (items) => {
  const rows = items
    .map((item) => {
      // Ensure image URL is valid and has protocol
      const imageUrl = item.image && item.image.startsWith('http') 
        ? item.image 
        : 'https://via.placeholder.com/60';
      
      return `
    <tr>
      <td style="padding: 16px 0; border-bottom: 1px solid #f1f1f1;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td width="60" valign="top">
              <img src="${imageUrl}" alt="${item.name || 'Product'}" width="60" height="60" style="border-radius: 8px; object-fit: cover; background: #f9f9f9; display: block;" />
            </td>
            <td style="padding-left: 16px;">
              <p style="margin: 0; font-weight: 700; color: #111827; font-size: 15px;">${item.name || 'Product'}</p>
              <p style="margin: 4px 0 0; font-size: 13px; color: #6b7280;">Quantity: ${item.quantity} x ₹${item.price}</p>
            </td>
            <td align="right" valign="top">
              <p style="margin: 0; font-weight: 700; color: #111827; font-size: 15px;">₹${item.quantity * item.price}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>`;
    })
    .join("");
  return `<table width="100%" cellpadding="0" cellspacing="0" style="margin-top: 24px; border-top: 2px solid #111827;">${rows}</table>`;
};

// ------------------------------------------
// ADMIN ENDPOINTS (PRODUCTS)
// ------------------------------------------

app.post("/api/admin/products", maybeAuth, async (req, res) => {
  try {
    if (!(await isAdminUid(req.user?.uid)))
      return res.status(403).json({ error: "Access Denied" });
    const { product } = req.body;
    if (!product?.name)
      return res.status(400).json({ error: "Invalid product data" });

    const docRef = await db.collection("products").add({
      ...product,
      isActive: product.isActive !== false,
      inventory:
        typeof product.inventory === "number" ? product.inventory : 100,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.json({ id: docRef.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch("/api/admin/products/:id", maybeAuth, async (req, res) => {
  try {
    if (!(await isAdminUid(req.user?.uid)))
      return res.status(403).json({ error: "Access Denied" });
    await db
      .collection("products")
      .doc(req.params.id)
      .update({
        ...req.body.product,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/admin/products/:id", maybeAuth, async (req, res) => {
  try {
    if (!(await isAdminUid(req.user?.uid)))
      return res.status(403).json({ error: "Access Denied" });
    await db.collection("products").doc(req.params.id).update({
      isActive: false,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/admin/products/:id/permanent", maybeAuth, async (req, res) => {
  try {
    if (!(await isAdminUid(req.user?.uid)))
      return res.status(403).json({ error: "Access Denied" });
    await db.collection("products").doc(req.params.id).delete();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------
// ORDER & PAYMENT FLOW
// ------------------------------------------

app.post("/api/orders/create-payment", maybeAuth, async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Login required" });
    const razorpayOrder = await razorpay.orders.create({
      amount: Math.round(req.body.total * 100),
      currency: "INR",
      receipt: `order_${Date.now()}`,
    });
    res.json({
      orderId: razorpayOrder.id,
      amount: razorpayOrder.amount,
      currency: razorpayOrder.currency,
      key: process.env.RAZORPAY_KEY_ID,
    });
  } catch (err) {
    res.status(500).json({ error: "Payment initiation failed" });
  }
});

app.post("/api/orders/verify-payment", maybeAuth, async (req, res) => {
  const {
    razorpay_order_id,
    razorpay_payment_id,
    razorpay_signature,
    orderData,
  } = req.body;
  try {
    const hmac = crypto.createHmac("sha256", process.env.RAZORPAY_KEY_SECRET);
    hmac.update(`${razorpay_order_id}|${razorpay_payment_id}`);
    if (hmac.digest("hex") !== razorpay_signature) {
      return res.status(400).json({ error: "Payment verification failed" });
    }

    // Update inventory
    for (const item of orderData.items) {
      const pRef = db.collection("products").doc(item.productId);
      const pSnap = await pRef.get();
      if (pSnap.exists && typeof pSnap.data().inventory === "number") {
        await pRef.update({
          inventory: Math.max(0, pSnap.data().inventory - item.quantity),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
    }

    const orderRef = await db.collection("orders").add({
      ...orderData,
      userId: req.user?.uid || "guest",
      status: "pending",
      paymentId: razorpay_payment_id,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.json({ success: true, orderId: orderRef.id });
  } catch (err) {
    res.status(500).json({ error: "Order processing failed" });
  }
});

app.post("/api/orders/place-cod", maybeAuth, async (req, res) => {
  try {
    const { items, total, shippingAddress, customerName, userEmail } = req.body;

    // Update inventory
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

    const orderRef = await db.collection("orders").add({
      userId: req.user?.uid || "guest",
      items,
      total,
      shippingAddress,
      customerName,
      userEmail,
      status: "pending",
      paymentMethod: "cod",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.json({ success: true, orderId: orderRef.id });
  } catch (err) {
    res.status(500).json({ error: "Order placement failed" });
  }
});

// ------------------------------------------
// ADMIN VIEWS
// ------------------------------------------

app.get("/api/admin/orders", maybeAuth, async (req, res) => {
  try {
    if (!(await isAdminUid(req.user?.uid)))
      return res.status(403).json({ error: "Forbidden" });
    const snap = await db
      .collection("orders")
      .orderBy("createdAt", "desc")
      .limit(100)
      .get();
    res.json({ orders: snap.docs.map((d) => ({ id: d.id, ...d.data() })) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch("/api/admin/orders/:id", maybeAuth, async (req, res) => {
  try {
    if (!(await isAdminUid(req.user?.uid)))
      return res.status(403).json({ error: "Forbidden" });
    await db.collection("orders").doc(req.params.id).update({
      status: req.body.status,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/admin/users/:uid", maybeAuth, async (req, res) => {
  try {
    if (!(await isAdminUid(req.user?.uid)))
      return res.status(403).json({ error: "Forbidden" });
    await admin.auth().deleteUser(req.params.uid);
    await db.collection("users").doc(req.params.uid).delete();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------
// EMAIL SERVICES
// ------------------------------------------

app.post("/api/send-welcome-email", async (req, res) => {
  try {
    await resend.emails.send({
      from: `Cozy Creations <${EMAIL_FROM}>`,
      to: req.body.email,
      subject: "Welcome to Cozy Creations 🕯️",
      html: wrapLayout(
        "Welcome to Cozy Creations 🕯️",
        "<p>We're thrilled to have you! Explore our handcrafted candles and find your perfect glow.</p>",
        req.body.name
      ),
    });
    res.json({ success: true });
  } catch (err) {
    console.error("❌ Welcome Email Error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/send-order-confirmation", async (req, res) => {
  const { email, orderData } = req.body;
  try {
    const table = buildItemTable(orderData.items);
    const customerHtml = wrapLayout(
      "Order Confirmed 🕯️",
      `<p>Thank you for your order! We're preparing it with care.</p>${table}<p style="margin-top:20px; font-size:18px; font-weight:700;">Grand Total: ₹${orderData.total}</p>`,
      orderData.customerName || "Customer"
    );

    // Send to customer
    await resend.emails.send({
      from: `Cozy Creations <${EMAIL_FROM}>`,
      to: email,
      subject: "Order Confirmed! 🕯️",
      html: customerHtml,
    });

    // Send to admin
    await resend.emails.send({
      from: `Cozy Creations <${EMAIL_FROM}>`,
      to: ADMIN_EMAIL,
      subject: `🚨 New Order - ₹${orderData.total}`,
      html: wrapLayout(
        "New Order Received",
        `<p>From: ${orderData.customerName}</p>${table}<p style="font-weight:700;">Total: ₹${orderData.total}</p>`,
        "Admin"
      ),
    });

    res.json({ success: true });
  } catch (err) {
    console.error("❌ Order Confirmation Error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/send-status-update", async (req, res) => {
  try {
    await resend.emails.send({
      from: `Cozy Creations <${EMAIL_FROM}>`,
      to: req.body.email,
      subject: `Order Update - ${req.body.status}`,
      html: wrapLayout(
        "Order Update 📦",
        `<div style="padding:20px; background:#f0fdf4; border-radius:12px; text-align:center;"><h3 style="margin:0; color:#166534;">Status: ${req.body.status.toUpperCase()}</h3></div><p style="margin-top:20px;">We'll keep you posted as your order progresses.</p>`,
        req.body.name
      ),
    });
    res.json({ success: true });
  } catch (err) {
    console.error("❌ Status Update Error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/send-password-reset", async (req, res) => {
  try {
    const link = await admin.auth().generatePasswordResetLink(req.body.email);
    await resend.emails.send({
      from: `Cozy Creations <${EMAIL_FROM}>`,
      to: req.body.email,
      subject: "Reset Your Password",
      html: wrapLayout(
        "Password Reset",
        `<p>Click below to reset your password:</p><a href="${link}" style="display:inline-block; margin-top:16px; padding:12px 24px; background:#111827; color:#fff; text-decoration:none; border-radius:8px;">Reset Password</a>`,
        "Customer"
      ),
    });
    res.json({ success: true });
  } catch (err) {
    console.error("❌ Password Reset Error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/contact", async (req, res) => {
  try {
    const { name, email, phone, collection, product, productName, quantity, customization, location } = req.body;
    
    // Build collection display name
    const collectionNames = {
      flower: "Flower Collection",
      animal: "Animal Collection",
      festive: "Festive Collection",
      glassJar: "Glass Jar Collection",
      special: "Special Collection",
    };
    const collectionDisplay = collectionNames[collection] || collection || "Not specified";
    
    // Build product display (name + ID)
    const productDisplay = productName 
      ? `${productName} (ID: ${product})`
      : product || "Not specified";
    
    // Build inquiry details content
    const inquiryContent = `
      <div style="background: #f9fafb; padding: 20px; border-radius: 12px; margin: 24px 0;">
        <h3 style="margin: 0 0 16px; font-size: 16px; color: #111827; font-weight: 700;">Customer Information</h3>
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="padding: 8px 0; color: #6b7280; font-size: 14px; width: 140px;">Email:</td>
            <td style="padding: 8px 0; color: #111827; font-size: 14px; font-weight: 600;">${email || "Not provided"}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Phone:</td>
            <td style="padding: 8px 0; color: #111827; font-size: 14px; font-weight: 600;">${phone || "Not provided"}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Location:</td>
            <td style="padding: 8px 0; color: #111827; font-size: 14px; font-weight: 600;">${location || "Not provided"}</td>
          </tr>
        </table>
      </div>
      <div style="background: #fef3c7; padding: 20px; border-radius: 12px; border-left: 4px solid #FACC15; margin: 24px 0;">
        <h3 style="margin: 0 0 16px; font-size: 16px; color: #111827; font-weight: 700;">Product Inquiry</h3>
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="padding: 8px 0; color: #6b7280; font-size: 14px; width: 140px;">Collection:</td>
            <td style="padding: 8px 0; color: #111827; font-size: 14px; font-weight: 600;">${collectionDisplay}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Product:</td>
            <td style="padding: 8px 0; color: #111827; font-size: 14px; font-weight: 600;">${productDisplay}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Quantity:</td>
            <td style="padding: 8px 0; color: #111827; font-size: 14px; font-weight: 600;">${quantity || "Not specified"}</td>
          </tr>
          ${customization ? `
          <tr>
            <td style="padding: 8px 0; color: #6b7280; font-size: 14px; vertical-align: top;">Customization:</td>
            <td style="padding: 8px 0; color: #111827; font-size: 14px; font-weight: 600;">${customization}</td>
          </tr>
          ` : ""}
        </table>
      </div>
    `;
    
    // Send email to admin using consistent wrapLayout template
    await resend.emails.send({
      from: `Cozy Creations <${EMAIL_FROM}>`,
      to: ADMIN_EMAIL,
      subject: `🕯️ New Inquiry from ${name}`,
      html: wrapLayout(
        "New Contact Inquiry 📬",
        inquiryContent,
        "Admin"
      ),
    });
    
    res.json({ success: true, message: "Inquiry submitted successfully" });
  } catch (error) {
    console.error("❌ Contact form error:", error);
    res.status(500).json({ success: false, message: "Failed to submit inquiry" });
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
