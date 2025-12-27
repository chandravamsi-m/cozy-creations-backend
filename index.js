require("dotenv").config();
const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");
const Razorpay = require("razorpay");
const crypto = require("crypto");

const nodemailer = require("nodemailer");

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

// Create a transporter using your Gmail
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: "cozycreationscandle@gmail.com",
    pass: "odfv eblk aqls khzz",
  },
});

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

// HELPER: Professional Email Layout Wrapper
const wrapLayout = (title, content, name) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="margin:0; padding:0; background-color:#FBFAF9; font-family: Arial, -apple-system, BlinkMacSystemFont, sans-serif;">

  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#FBFAF9; padding:40px 0;">
    <tr>
      <td align="center">

        <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff; border-radius:14px; overflow:hidden; border:1px solid #e5e7eb;">
          
          <!-- Header -->
          <!-- Header / Hero Logo -->
<tr>
  <td
    align="center"
    style="
      background:#111827;
      padding:0;
    "
  >
    <img
      src="https://res.cloudinary.com/dumkblp3v/image/upload/v1766752763/cozy_creation_logo_mu3loj.webp"
      alt="Cozy Creations"
      width="600";
      height="240
      style="
        display:block;
        width:100%;
        max-width:600px;
        height:auto;
      "
    />
  </td>
</tr>


          <!-- Body -->
          <tr>
            <td style="padding:40px 36px; color:#374151; line-height:1.7;">
              <h2 style="margin:0 0 20px; font-size:24px; color:#111827;">
                ${title}
              </h2>

              <p style="margin:0 0 12px; font-size:16px; color:#111827; font-weight:600;">
                Hi ${name || "there"},
              </p>

              ${content}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding:28px; background:#fafafa; color:#9ca3af; font-size:13px;">
              <p style="margin:0;">
                © 2025 Cozy Creations.<br />
                All rights reserved.
              </p>
            </td>
          </tr>

        </table>

      </td>
    </tr>
  </table>

</body>
</html>
`;

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
    if (!(await isAdminUid(uid)))
      return res.status(403).json({ error: "forbidden" });

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
          customization: item.customization || null,
        });

        if (typeof p.inventory === "number") {
          await db
            .collection("products")
            .doc(pSnap.id)
            .update({
              inventory: Math.max(0, p.inventory - item.quantity),
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
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
    if (!(await isAdminUid(adminUid)))
      return res.status(403).json({ error: "forbidden" });

    const targetUid = req.params.uid;
    if (adminUid === targetUid)
      return res.status(400).json({ error: "cannot_delete_self" });

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

// 1. WELCOME EMAIL (Personalized)
app.post("/api/send-welcome-email", async (req, res) => {
  const { email, name } = req.body;
  try {
    const html = wrapLayout(
      "Welcome to Cozy Creations",
      `
    <p style="font-size:15px; margin:0 0 16px;">
      We’re truly delighted to have you with us.
      At <strong>Cozy Creations</strong>, every candle is handcrafted to bring warmth,
      calm, and character into your space.
    </p>

    <p style="font-size:15px; margin:0 0 24px;">
      From soothing fragrances to elegant designs, we hope our creations
      become part of your everyday moments.
    </p>

    <a href="https://cozy-creations-32109.web.app/products"
       style="
         display:inline-block;
     background-color:#ffffff;
     color:#111827 !important;
     padding:14px 28px;
     border-radius:8px;
     text-decoration:none;
     font-weight:600;
     font-size:14px;
     border:1px solid #e5e7eb;
       ">
      Start Exploring
    </a>
  `,
      name
    );

    await transporter.sendMail({
      from: '"Cozy Creations" <cozycreationscandle@gmail.com>',
      to: email,
      subject: "Welcome to Cozy Creations 🕯️",
      html,
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});
// 2. ORDER CONFIRMATION
app.post("/api/send-order-confirmation", async (req, res) => {
  const { email, orderData } = req.body;
  
  // 1. DATA PREP
  const adminEmail = "cozycreationscandle@gmail.com"; // 🚨 Ensure this is YOUR email
  const shipping = orderData?.shippingAddress || {};
  const name = shipping.fullName || "Customer";
  const items = orderData?.items || [];

  try {
    // 2. BUILD ITEMS SUMMARY TABLE
    const itemsRows = items.map(item => `
      <tr>
        <td style="padding: 12px; border-bottom: 1px solid #eee;">
          <strong style="color: #111827;">${item.name || item.productId}</strong>
          <br/><span style="color: #9ca3af; font-size: 12px;">Qty: ${item.quantity}</span>
        </td>
        <td align="right" style="padding: 12px; border-bottom: 1px solid #eee; font-weight: 600;">
          ₹${item.totalAmount || (item.quantity * 500)}
        </td>
      </tr>
    `).join("");

    // --- A. CUSTOMER EMAIL CONTENT ---
    const customerHtml = wrapLayout(
      "Your Order is Confirmed!",
      `
        <p style="font-size:15px; margin:0 0 16px;">
          Hi ${name}, thank you for choosing Cozy Creations! We've received your order and our artisans are already getting started.
        </p>
        <table width="100%" style="border-collapse:collapse; margin:24px 0; border:1px solid #e5e7eb; border-radius:12px; overflow:hidden;">
          <thead><tr style="background:#f9fafb;"><th align="left" style="padding:12px; font-size:11px; color:#6b7280; text-transform:uppercase;">Product</th><th align="right" style="padding:12px; font-size:11px; color:#6b7280; text-transform:uppercase;">Total</th></tr></thead>
          <tbody>${itemsRows}</tbody>
          <tfoot><tr><td style="padding:16px; font-weight:600;">Grand Total</td><td align="right" style="padding:16px; font-size:18px; font-weight:700; color:#111827;">₹${orderData?.total || 0}</td></tr></tfoot>
        </table>
        <div style="background:#f9fafb; padding:20px; border-radius:12px; font-size:14px; line-height: 1.6;">
          <strong style="color: #111827; text-transform: uppercase; font-size: 12px; letter-spacing: 0.5px;">Shipping To:</strong><br/>
          <div style="margin-top: 8px;">${name}<br/>${shipping.phone || ""}</div>
        </div>
      `,
      name
    );

    // --- B. ADMIN ALERT CONTENT ---
    const adminHtml = wrapLayout(
      "🚨 New Order Received!",
      `
        <div style="background: #FFFBEB; border: 1px solid #FEF3C7; padding: 20px; border-radius: 12px; margin-bottom: 24px;">
           <p style="margin:0; font-size: 16px; color: #92400E;"><strong>You have a new order to process!</strong></p>
           <p style="margin:8px 0 0; font-size: 14px; color: #B45309;">Order ID: #${orderData?.orderId}</p>
        </div>
        <p><strong>Customer:</strong> ${name} (${email})</p>
        <p><strong>Total Value:</strong> ₹${orderData?.total}</p>
        <p><strong>Method:</strong> ${orderData?.paymentMethod?.toUpperCase()}</p>
        <div style="text-align: center; margin-top: 32px;">
          <a href="https://cozy-creations-32109.web.app/admin/orders" class="btn">View in Dashboard</a>
        </div>
      `,
      "Admin"
    );

    // 3. SEND BOTH EMAILS
    // Send to Customer
    await transporter.sendMail({
      from: '"Cozy Creations" <cozycreationscandle@gmail.com>',
      to: email,
      subject: "Your Cozy Creations Order Confirmation 🕯️",
      html: customerHtml,
    });

    // Send to Admin (You)
    await transporter.sendMail({
      from: '"Store Alert" <cozycreationscandle@gmail.com>',
      to: adminEmail,
      subject: `🚨 NEW ORDER #${orderData?.orderId} received!`,
      html: adminHtml,
    });

    res.json({ success: true });
  } catch (err) {
    console.error("Order confirmation email error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3. STATUS UPDATE (Personalized)
app.post("/api/send-status-update", async (req, res) => {
  const { email, orderId, status, name } = req.body;
  
  // 1. DATA SAFETY
  const recipientName = name || "Valued Customer";
  const cleanOrderId = orderId || "---";
  const cleanStatus = status ? status.toUpperCase() : "PENDING";

  try {
    // 2. BUILD PROFESSIONAL HTML
    const html = wrapLayout(
      "Your Order Status Has Been Updated",
      `
        <p style="font-size:15px; margin:0 0 16px;">
          Hi ${recipientName}, we have an exciting update regarding your order <strong>#${cleanOrderId}</strong>.
        </p>

        <div style="text-align: center; margin: 32px 0;">
          <div style="display: inline-block; padding: 12px 32px; background: linear-gradient(135deg, #FEF3C7 0%, #FDE68A 100%); border-radius: 100px; border: 1px solid #F59E0B;">
            <p style="margin:0; font-size:12px; color:#92400e; text-transform:uppercase; letter-spacing: 1px; font-weight: 800;">
              Final Status: ${cleanStatus}
            </p>
          </div>
        </div>

        <div style="background: #F9FAFB; padding: 24px; border-radius: 12px; border-left: 4px solid #111827; margin: 24px 0;">
          <p style="margin:0; font-size:14px; color:#374151; line-height: 1.6;">
            <strong>What's happening?</strong><br/>
            Our team is carefully handling your handcrafted items. You'll receive another notification if there are any further updates or tracking information available.
          </p>
        </div>

        <p style="text-align: center; font-size: 14px; color: #6b7280; margin-top: 32px;">
          Thank you for choosing Cozy Creations for your space. 🕯️
        </p>
      `,
      recipientName
    );

    // 3. SEND WITH PROFESSIONAL SUBJECT
    await transporter.sendMail({
      from: '"Cozy Creations" <cozycreationscandle@gmail.com>',
      to: email,
      subject: "Update Regarding Your Cozy Creations Order 📦", // Professional subject
      html: html,
    });

    res.json({ success: true });
  } catch (err) {
    console.error("Status update email error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4. SECURE PASSWORD RESET (Professional Template)
app.post("/api/send-password-reset", async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ success: false });

  try {
    // 1. Check if user exists and get their info
    let userName = "Customer";
    let userRecord;
    
    try {
      userRecord = await admin.auth().getUserByEmail(email);
      
      // Try to get display name from Firestore
      const userDoc = await admin.firestore().collection('users').doc(userRecord.uid).get();
      if (userDoc.exists && userDoc.data().displayName) {
        userName = userDoc.data().displayName;
      } else if (userRecord.displayName) {
        userName = userRecord.displayName;
      } else {
        // Extract from email as fallback
        const emailPart = email.split('@')[0];
        const firstName = emailPart.split(/[._]/)[0];
        userName = firstName.charAt(0).toUpperCase() + firstName.slice(1);
      }
    } catch (e) {
      return res.status(404).json({ 
        success: false, 
        error: "No account found with this email. Please sign up first." 
      });
    }

    // 2. Generate secure reset link
    const resetLink = await admin.auth().generatePasswordResetLink(email);

    // 3. Send PREMIUM email with enhanced design
    const html = wrapLayout("Secure Password Reset", 
      `<p>We received a request to reset the password for your Cozy Creations account.</p>
       
       <div style="background: linear-gradient(135deg, #FEF3C7 0%, #FDE68A 100%); border-left: 4px solid #F59E0B; padding: 20px; border-radius: 8px; margin: 24px 0;">
         <p style="margin: 0; font-size: 14px; color: #92400E;">
           <strong>🔒 Security Notice:</strong> This link expires in <strong>1 hour</strong> for your protection.
         </p>
       </div>

       <div style="text-align: center; margin: 32px 0;">
         <a href="${resetLink}" class="btn" style="background: linear-gradient(135deg, #111827 0%, #374151 100%); box-shadow: 0 4px 12px rgba(0,0,0,0.15);">
           Reset My Password
         </a>
       </div>

       <div style="background: #F9FAFB; padding: 16px; border-radius: 8px; margin-top: 32px;">
         <p style="margin: 0; font-size: 13px; color: #6B7280; line-height: 1.6;">
           <strong>Didn't request this?</strong><br/>
           If you didn't ask to reset your password, you can safely ignore this email. Your account remains secure.
         </p>
       </div>`, 
      userName
    );

    await transporter.sendMail({
      from: '"Cozy Creations Security" <cozycreationscandle@gmail.com>',
      to: email,
      subject: "🔐 Reset your Cozy Creations password",
      html: html
    });

    res.json({ success: true });
  } catch (err) {
    console.error("Password reset error:", err);
    res.status(500).json({ success: false, error: "Something went wrong on our end." });
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`🚀 Backend live on port ${PORT}`));
