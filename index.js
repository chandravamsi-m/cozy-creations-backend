const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");
const Razorpay = require("razorpay");
const crypto = require("crypto");
const nodemailer = require("nodemailer");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());

// ------------------------------------------
// INITIALIZATION
// ------------------------------------------

if (process.env.FIREBASE_ADMIN_CRED_JSON) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert(
        JSON.parse(process.env.FIREBASE_ADMIN_CRED_JSON)
      ),
    });
  } catch (err) {
    console.warn(
      "Firebase Admin Init Error (fallback to default):",
      err.message
    );
    admin.initializeApp();
  }
} else {
  // If no env variable, try default ADC or google-services.json if present
  admin.initializeApp();
}

const db = admin.firestore();

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS, // Use App Password from Google
  },
});

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// ------------------------------------------
// MIDDLEWARE & HELPERS
// ------------------------------------------

async function maybeAuth(req, res, next) {
  const h = req.headers.authorization || "";
  if (h.startsWith("Bearer ")) {
    const idToken = h.split(" ")[1];
    try {
      req.user = await admin.auth().verifyIdToken(idToken);
    } catch (err) {
      console.warn("Auth Warning: Invalid token provided.");
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
    console.error("isAdminUid check failed:", err.message);
    return false;
  }
}

// Reusable Email Layout
/**
 * Professional HTML Email Wrapper
 */
const wrapLayout = (title, content, name) => {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
<body style="margin:0; padding:0; background-color:#FBFAF9; font-family: 'Segoe UI', Arial, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#FBFAF9; padding:40px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff; border-radius:14px; overflow:hidden; border:1px solid #e5e7eb; box-shadow: 0 4px 6px rgba(0,0,0,0.02);">
        <!-- Header Logo Area -->
        <tr>
          <td align="center" style="background:#111827; padding:0;">
            <img src="https://res.cloudinary.com/dumkblp3v/image/upload/v1766752763/cozy_creation_logo_mu3loj.webp" alt="Cozy Creations" width="600" style="display:block; width:100%; height:auto;" />
          </td>
        </tr>
        <!-- Main Content Area -->
        <tr>
          <td style="padding:40px 36px; color:#374151; line-height:1.7;">
            <h2 style="margin:0 0 20px; font-size:24px; color:#111827; font-weight: 700;">${title}</h2>
            <p style="margin:0 0 12px; font-size:16px; color:#111827; font-weight:600;">Hi ${
              name || "Customer"
            },</p>
            ${content}
          </td>
        </tr>
        <!-- Footer Area -->
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
};

/**
 * Builds a professional HTML table for order items
 */
const buildItemTable = (items) => {
  const rows = items
    .map(
      (item) => `
    <tr>
      <td style="padding: 16px 0; border-bottom: 1px solid #f1f1f1;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td width="60" valign="top">
              <img src="${
                item.image || "https://via.placeholder.com/60"
              }" alt="${
        item.name
      }" width="60" height="60" style="border-radius: 8px; object-fit: cover; background: #f9f9f9;" />
            </td>
            <td style="padding-left: 16px;">
              <p style="margin: 0; font-weight: 700; color: #111827; font-size: 15px;">${
                item.name
              }</p>
              <p style="margin: 4px 0 0; font-size: 13px; color: #6b7280;">Quantity: ${
                item.quantity
              } x ₹${item.price}</p>
            </td>
            <td align="right" valign="top">
              <p style="margin: 0; font-weight: 700; color: #111827; font-size: 15px;">₹${
                item.quantity * item.price
              }</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>`
    )
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
    if (!product || !product.name)
      return res.status(400).json({ error: "Invalid product data" });

    const now = admin.firestore.FieldValue.serverTimestamp();
    const newDoc = {
      ...product,
      isActive: product.isActive !== false,
      createdAt: now,
      updatedAt: now,
      inventory:
        typeof product.inventory === "number" ? product.inventory : 100,
    };

    const docRef = await db.collection("products").add(newDoc);
    res.json({ id: docRef.id, product: { id: docRef.id, ...newDoc } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch("/api/admin/products/:id", maybeAuth, async (req, res) => {
  try {
    if (!(await isAdminUid(req.user?.uid)))
      return res.status(403).json({ error: "Access Denied" });
    const updates = req.body.product;
    updates.updatedAt = admin.firestore.FieldValue.serverTimestamp();

    await db.collection("products").doc(req.params.id).update(updates);
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
    const { total } = req.body;

    const razorpayOrder = await razorpay.orders.create({
      amount: Math.round(total * 100),
      currency: "INR",
      receipt: `order_rcpt_${Date.now()}`,
    });

    res.json({
      orderId: razorpayOrder.id,
      amount: razorpayOrder.amount,
      currency: razorpayOrder.currency,
      key: process.env.RAZORPAY_KEY_ID,
    });
  } catch (err) {
    res.status(500).json({ error: "Could not initiate payment" });
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
    hmac.update(razorpay_order_id + "|" + razorpay_payment_id);
    if (hmac.digest("hex") !== razorpay_signature)
      return res.status(400).json({ error: "Payment verification failed" });

    // Deduct individual product stock
    for (const item of orderData.items) {
      const pRef = db.collection("products").doc(item.productId);
      const pSnap = await pRef.get();
      if (pSnap.exists && typeof pSnap.data().inventory === "number") {
        const newStock = Math.max(0, pSnap.data().inventory - item.quantity);
        await pRef.update({
          inventory: newStock,
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
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.json({ success: true, orderId: orderRef.id });
  } catch (err) {
    res.status(500).json({ error: "Internal Server Error" });
  }
});

app.post("/api/orders/place-cod", maybeAuth, async (req, res) => {
  try {
    const { items, total, shippingAddress } = req.body;

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
      status: "pending",
      paymentMethod: "cod",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.json({ success: true, orderId: orderRef.id });
  } catch (err) {
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// ------------------------------------------
// ADMIN VIEWS (ORDERS & USERS)
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
  const { email, name } = req.body;
  try {
    const html = wrapLayout(
      "Welcome to the Cozy Creations",
      "<p>We're thrilled to have you! Explore our curated scents and find your perfect glow.</p>",
      name
    );
    await transporter.sendMail({
      from: '"Cozy Creations" <' + process.env.GMAIL_USER + ">",
      to: email,
      subject: "Welcome to Cozy Creations! 🕯️",
      html,
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).send();
  }
});

app.post("/api/send-order-confirmation", async (req, res) => {
  const { email, orderData } = req.body;
  try {
    const table = buildItemTable(orderData.items);

    // Prepare Customer Email
    const customerHtml = wrapLayout(
      "Order Confirmed",
      `
      <p>Thank you for your order! We've received your request and are preparing it with care.</p>
      ${table}
      <div style="margin-top: 20px; padding: 20px; background: #f9f9f9; border-radius: 12px; border: 1px solid #eee;">
        <p style="margin: 0; font-size: 18px; font-weight: 700; color: #111827;">Grand Total: ₹${orderData.total}</p>
        <p style="margin: 8px 0 0; font-size: 14px; color: #6b7280;">Contact: ${orderData.shippingAddress?.phone}</p>
      </div>
    `,
      orderData.customerName || "Customer"
    );

    await transporter.sendMail({
      from: '"Cozy Creations" <' + process.env.GMAIL_USER + ">",
      to: email,
      subject: "Order Confirmation! 🕯️",
      html: customerHtml,
    });

    // Prepare Admin Alert
    const adminHtml = wrapLayout(
      "🚨 New Order Received",
      `
      <p>A new order has been placed by <b>${
        orderData.customerName
      }</b> (${email}).</p>
      ${table}
      <p style="font-size: 20px; font-weight: 700;">Total: ₹${
        orderData.total
      }</p>
      <p>Method: ${orderData.paymentMethod?.toUpperCase()}</p>
    `,
      "Admin"
    );

    await transporter.sendMail({
      from: '"Store Alert" <' + process.env.GMAIL_USER + ">",
      to: process.env.ADMIN_EMAIL,
      subject: "🚨 NEW ORDER - ₹" + orderData.total,
      html: adminHtml,
    });

    res.json({ success: true });
  } catch (err) {
    res.status(500).send({ error: "Failed to send confirmation email" });
  }
});

app.post("/api/send-status-update", async (req, res) => {
  try {
    const html = wrapLayout(
      "Order Status Updated",
      `
      <div style="padding: 20px; background: #f0fdf4; border-radius: 12px; border: 1px solid #dcfce7; text-align: center;">
        <h3 style="margin: 0; font-size: 20px; color: #166534;">New Status: ${req.body.status.toUpperCase()}</h3>
      </div>
      <p style="margin-top: 20px;">We're working hard to get your package to you as quickly as possible!</p>
    `,
      req.body.name
    );

    await transporter.sendMail({
      from: '"Cozy Creations" <' + process.env.GMAIL_USER + ">",
      to: req.body.email,
      subject: "Order Update",
      html,
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).send({ error: "Failed to send status update" });
  }
});

app.post("/api/send-password-reset", async (req, res) => {
  const { email } = req.body;
  try {
    const link = await admin.auth().generatePasswordResetLink(email);
    const html = wrapLayout(
      "Password Reset",
      `<p>Click the link below to reset your password. It expires in 1 hour.</p><a href="${link}">Reset Password</a>`,
      "Customer"
    );
    await transporter.sendMail({
      from: '"Cozy Creations Security" <' + process.env.GMAIL_USER + ">",
      to: email,
      subject: "Password Reset Request",
      html,
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).send();
  }
});

app.post("/api/contact", async (req, res) => {
  const {
    name,
    email,
    phone,
    collection,
    product,
    quantity,
    customization,
    location,
  } = req.body;
  try {
    const html = wrapLayout(
      "Bulk Inquiry Received",
      `<p>We received your inquiry for ${quantity}x ${product}. Our team will contact you shortly.</p>`,
      name
    );
    await transporter.sendMail({
      from: '"Cozy Creations" <' + process.env.GMAIL_USER + ">",
      to: email,
      subject: "We received your bulk inquiry! 🕯️",
      html,
    });

    // Alert Admin with details
    await transporter.sendMail({
      from: '"Bulk Inquiry" <' + process.env.GMAIL_USER + ">",
      to: process.env.ADMIN_EMAIL,
      subject: "🚨 NEW BULK INQUIRY",
      html: `<p><b>Customer:</b> ${name} (${email})</p><p><b>Products:</b> ${quantity}x ${product}</p><p><b>Customization:</b> ${customization}</p><p><b>Location:</b> ${location}</p>`,
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).send();
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
