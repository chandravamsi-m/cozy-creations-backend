// src/controllers/emailController.js
const {
  resend,
  EMAIL_FROM,
  wrapLayout,
  sendOrderConfirmationEmail,
} = require("../services/emailService");
const { admin } = require("../config/firebase");

exports.sendWelcomeEmail = async (req, res) => {
  try {
    const { email, name } = req.body;
    await resend.emails.send({
      from: `Cozy Creations <${EMAIL_FROM}>`,
      to: email,
      subject: "🕯️ Welcome to Cozy Creations",
      html: wrapLayout(
        "Welcome to Cozy Creations!",
        `
          <p style="margin:0 0 16px; color:#555;">We're so glad you're here. At <strong style="color:#191816;">Cozy Creations</strong>, every candle is lovingly handcrafted to bring warmth, calm, and a little magic to your everyday moments.</p>
          <p style="margin:0 0 28px; color:#555;">Browse our collection, find your perfect scent, and light up your world.</p>
          <div style="text-align:center; margin-bottom:8px;">
            <a href="https://cozycreations.in/products" style="display:inline-block; background-color:#ffd34d; color:#191816; padding:14px 32px; text-decoration:none; border-radius:10px; font-weight:700; font-family:Arial,sans-serif; font-size:15px; letter-spacing:0.5px;">Shop Now →</a>
          </div>
        `,
        name
      ),
    });
    res.json({ success: true });
  } catch (err) {
    console.error("Welcome email error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.sendOrderConfirmation = async (req, res) => {
  const { email, orderData } = req.body;
  try {
    await sendOrderConfirmationEmail(email, orderData);
    res.json({ success: true });
  } catch (err) {
    console.error("Order confirmation email error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
};



exports.sendPasswordReset = async (req, res) => {
  const { email } = req.body;
  try {
    const userRecord = await admin.auth().getUserByEmail(email);
    const hasPasswordProvider = userRecord.providerData.some((provider) => provider.providerId === "password");

    if (hasPasswordProvider) {
      const link = await admin.auth().generatePasswordResetLink(email);
      await resend.emails.send({
        from: `Cozy Creations <${EMAIL_FROM}>`,
        to: email,
        subject: "🔐 Reset Your Password - Cozy Creations",
        html: wrapLayout(
          "Password Reset Request",
          `
            <p style="margin:0 0 16px; color:#555;">We received a request to reset the password for your Cozy Creations account. Click the button below to set a new password.</p>
            <div style="text-align:center; margin:28px 0;">
              <a href="${link}" style="display:inline-block; background-color:#191816; color:#ffd34d; padding:14px 32px; text-decoration:none; border-radius:10px; font-weight:700; font-family:Arial,sans-serif; font-size:15px; letter-spacing:0.5px;">Reset My Password →</a>
            </div>
            <div style="padding:18px 20px; background:#fdf8f0; border-radius:12px; border-left:4px solid #ffd34d;">
              <p style="margin:0; font-size:13px; color:#6b6b6b;">⚠️ This link will expire shortly. If you did not request a password reset, you can safely ignore this email — your account is secure.</p>
            </div>
          `,
          userRecord.displayName || email.split("@")[0].split(/[._]/)[0].replace(/^(.)/, (c) => c.toUpperCase())
        ),
      });
      return res.json({ success: true });
    }

    // Google / other OAuth account — no password reset available
    return res.json({ success: false, type: "google_account" });
  } catch (err) {
    console.error("Password reset email error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
};
