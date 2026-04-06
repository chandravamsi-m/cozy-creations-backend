// src/controllers/emailController.js
const {
  resend,
  EMAIL_FROM,
  wrapLayout,
  sendOrderConfirmationEmail,
  sendStatusUpdateEmail,
} = require("../services/emailService");
const { admin } = require("../config/firebase");

exports.sendWelcomeEmail = async (req, res) => {
  try {
    const { email, name } = req.body;
    await resend.emails.send({
      from: `Cozy Creations <${EMAIL_FROM}>`,
      to: email,
      subject: "Welcome to Cozy Creations",
      html: wrapLayout(
        "Welcome to Cozy Creations",
        "<p>We're thrilled to have you! Explore our handcrafted candles and find your perfect glow.</p>",
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

exports.sendStatusUpdate = async (req, res) => {
  try {
    const { email, status, name, expectedDeliveryDate } = req.body;
    await sendStatusUpdateEmail({ email, status, name, expectedDeliveryDate });
    res.json({ success: true });
  } catch (err) {
    console.error("Status update email error:", err);
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
        subject: "Reset Your Password - Cozy Creations",
        html: wrapLayout(
          "Password Reset",
          `<p>We received a request to reset your password. Click the button below to secure your account:</p>
           <div style="text-align: center; margin: 32px 0;">
             <a href="${link}" style="background-color: #d97706; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold;">Reset Password</a>
           </div>
           <p>If you did not request this, you can safely ignore this email.</p>`,
          userRecord.displayName || "there"
        ),
      });
    } else {
      await resend.emails.send({
        from: `Cozy Creations <${EMAIL_FROM}>`,
        to: email,
        subject: "Safe Sign-in to Cozy Creations",
        html: wrapLayout(
          "Sign-in Security",
          "<p>You tried to reset your password, but your account is linked to a Google login. Please sign in directly using Google.</p>",
          userRecord.displayName || "there"
        ),
      });
    }
    res.json({ success: true });
  } catch (err) {
    console.error("Password reset email error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
};
