// src/controllers/emailController.js
const { resend, EMAIL_FROM, ADMIN_EMAIL, wrapLayout, buildItemTable } = require("../services/emailService");
const { admin } = require("../config/firebase");

exports.sendWelcomeEmail = async (req, res) => {
  try {
    const { email, name } = req.body;
    await resend.emails.send({
      from: `Cozy Creations <${EMAIL_FROM}>`,
      to: email,
      subject: "Welcome to Cozy Creations 🕯️",
      html: wrapLayout(
        "Welcome to Cozy Creations 🕯️",
        "<p>We're thrilled to have you! Explore our handcrafted candles and find your perfect glow.</p>",
        name
      ),
    });
    res.json({ success: true });
  } catch (err) {
    console.error("❌ Welcome Email Error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.sendOrderConfirmation = async (req, res) => {
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
};

exports.sendStatusUpdate = async (req, res) => {
  try {
    const { email, status, name, expectedDeliveryDate } = req.body;
    let deliveryNote = "";
    if (expectedDeliveryDate) {
      const dateStr = new Date(expectedDeliveryDate).toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
      deliveryNote = `<p style="margin-top:16px; font-weight:700; color:#166534;">Estimated Arrival: ${dateStr}</p>`;
    }

    await resend.emails.send({
      from: `Cozy Creations <${EMAIL_FROM}>`,
      to: email,
      subject: `Order Update - ${status}`,
      html: wrapLayout(
        "Order Update 📦",
        `<div style="padding:20px; background:#f0fdf4; border-radius:12px; text-align:center;"><h3 style="margin:0; color:#166534;">Status: ${status.toUpperCase()}</h3>${deliveryNote}</div><p style="margin-top:20px;">We'll keep you posted as your order progresses.</p>`,
        name
      ),
    });
    res.json({ success: true });
  } catch (err) {
    console.error("❌ Status Update Error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.sendPasswordReset = async (req, res) => {
  const { email } = req.body;
  try {
    const userRecord = await admin.auth().getUserByEmail(email);
    const hasPasswordProvider = userRecord.providerData.some(p => p.providerId === "password");

    if (hasPasswordProvider) {
      const link = await admin.auth().generatePasswordResetLink(email);
      await resend.emails.send({
        from: `Cozy Creations <${EMAIL_FROM}>`,
        to: email,
        subject: "Reset Your Password - Cozy Creations 🕯️",
        html: wrapLayout(
          "Password Reset",
          `<p>We received a request to reset your password. Click the button below to secure your account:</p>
           <div style="text-align: center; margin: 32px 0;">
             <a href="${link}" style="background-color: #d97706; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold;">Reset Password</a>
           </div>
           <p>If you didn't request this, you can safely ignore this email.</p>`,
          userRecord.displayName || "there"
        ),
      });
    } else {
      await resend.emails.send({
        from: `Cozy Creations <${EMAIL_FROM}>`,
        to: email,
        subject: "Safe Sign-in to Cozy Creations 🕯️",
        html: wrapLayout(
          "Sign-in Security",
          `<p>You tried to reset your password, but your account is linked to a Google login. Please sign in directly using Google.</p>`,
          userRecord.displayName || "there"
        ),
      });
    }
    res.json({ success: true });
  } catch (err) {
    console.error("❌ Password Reset Error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
};
