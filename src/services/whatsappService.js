// src/services/whatsappService.js
const twilioClient = require("../config/twilio");

const FROM         = process.env.TWILIO_WHATSAPP_NUMBER;   // whatsapp:+14155238886
const ADMIN_NUMBER = process.env.ADMIN_WHATSAPP_NUMBER;    // +919000487224

/**
 * Normalises an Indian phone number to E.164 format (+91XXXXXXXXXX).
 * Handles numbers stored as:
 *   - "9876543210"       → "+919876543210"
 *   - "+919876543210"    → "+919876543210"  (unchanged)
 *   - "919876543210"     → "+919876543210"
 *   - "0091XXXXXXXXXX"   → "+91XXXXXXXXXX"
 */
function normaliseIndianPhone(raw) {
  if (!raw) return null;

  const digits = String(raw).replace(/[^\d]/g, "");

  if (digits.length === 10)                                return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith("91"))     return `+${digits}`;
  if (digits.length === 13 && digits.startsWith("091"))    return `+${digits.slice(1)}`;

  // Already fully qualified or unknown — pass through
  const original = String(raw).trim();
  return original.startsWith("+") ? original : `+${digits}`;
}

/**
 * Core send helper — fire-and-forget safe.
 * Silently fails if phone is missing/invalid or Twilio errors.
 */
async function sendWhatsApp(to, body) {
  // Feature Flag: Skip if disabled in .env
  if (process.env.ENABLE_WHATSAPP_NOTIFICATIONS !== "true") {
    // We log it so developers know why it didn't send during testing
    console.log("ℹ️ WhatsApp Notification skipped (Feature disabled in .env)");
    return;
  }

  if (!to || !FROM) return;

  const e164 = normaliseIndianPhone(to);
  if (!e164) return;

  const waNumber = e164.startsWith("whatsapp:") ? e164 : `whatsapp:${e164}`;

  return twilioClient.messages.create({
    from: FROM,
    to: waNumber,
    body,
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const DIVIDER = "──────────────────";

function formatItems(items = []) {
  return items
    .map((item) => {
      const lineTotal = (item.price * item.quantity).toLocaleString("en-IN");
      const variantSuffix = item.variantLabel ? ` (${item.variantLabel})` : "";
      return `  › ${item.name}${variantSuffix} × ${item.quantity}   ₹${lineTotal}`;
    })
    .join("\n");
}

function formatAddress(addr = {}) {
  const line1 = [addr.houseNo, addr.area].filter(Boolean).join(", ") || addr.street || "";
  return [line1, addr.city, addr.state, addr.pincode].filter(Boolean).join(", ");
}

function formatPayment(method) {
  const m = String(method || "online").toLowerCase();
  if (m === "cod") return "Cash on Delivery (COD)";
  return "Online Payment";
}

// ─── Customer Notifications ───────────────────────────────────────────────────

/**
 * Sent immediately when an order is placed (online or COD).
 */
async function sendOrderConfirmationWhatsApp(phone, orderData) {
  if (!phone) return;

  const name        = orderData.customerName || "Valued Customer";
  const orderId     = orderData.orderId || orderData.id || "—";
  const payment     = formatPayment(orderData.paymentMethod);
  const itemsText   = formatItems(orderData.items);
  const addressText = formatAddress(orderData.shippingAddress);
  const total       = Number(orderData.total ?? 0).toLocaleString("en-IN");

  const body =
`🕯️ *Cozy Creations*
${DIVIDER}
*Order Confirmed!* ✅

Dear ${name},

Thank you for your order. We have successfully received it and our team is now preparing your handcrafted order with love and care.

${DIVIDER}
📋 *Order Details*
${DIVIDER}
*Order ID:*  #${orderId}
*Payment:*   ${payment}

*Items Ordered:*
${itemsText}

${DIVIDER}
*Order Total:*  ₹${total}
${DIVIDER}

📍 *Delivery Address*
${addressText}

We will notify you once your order has been delivered. For any assistance, feel free to reach us.

📧 cozycreationscorner13@gmail.com
📞 +91 80194 01322

Warm regards,
*Cozy Creations* 🕯️`;

  return sendWhatsApp(phone, body);
}

/**
 * Sent when the order status is updated to "delivered".
 */
async function sendOrderDeliveredWhatsApp(phone, orderData) {
  if (!phone) return;

  const name    = orderData.customerName || "Valued Customer";
  const orderId = orderData.orderId || orderData.id || "—";
  const total   = Number(orderData.total ?? 0).toLocaleString("en-IN");

  const body =
`🕯️ *Cozy Creations*
${DIVIDER}
*Your Order Has Been Delivered!* 🎉

Dear ${name},

We are delighted to inform you that your order *#${orderId}* (₹${total}) has been successfully delivered to your address.

We hope our products bring warmth and joy to your space. ✨

${DIVIDER}
💛 *Enjoyed your purchase?*
Your feedback means the world to a small handcrafted business like ours. We would love to hear from you!

📧 cozycreationscorner13@gmail.com
📞 +91 80194 01322
🌐 https://cozycreations.in/
${DIVIDER}

Thank you for choosing Cozy Creations.

Warm regards,
*Cozy Creations* 🕯️`;

  return sendWhatsApp(phone, body);
}

/**
 * Sent when the order is cancelled.
 */
async function sendOrderCancelledWhatsApp(phone, orderData) {
  if (!phone) return;

  const name    = orderData.customerName || "Valued Customer";
  const orderId = orderData.orderId || orderData.id || "—";

  const body =
`🕯️ *Cozy Creations*
${DIVIDER}
*Order Cancellation Confirmed* ❌

Dear ${name},

We would like to inform you that your order *#${orderId}* has been cancelled.

${DIVIDER}
If this cancellation was made in error, or if you have any concerns regarding your order or a refund, please do not hesitate to contact us — we are here to help.

📧 cozycreationscorner13@gmail.com
📞 +91 80194 01322
${DIVIDER}

We hope to have the opportunity to serve you again soon.

Warm regards,
*Cozy Creations* 🕯️`;

  return sendWhatsApp(phone, body);
}

// ─── Admin Notification ───────────────────────────────────────────────────────

/**
 * Pings the admin WhatsApp when a new order is placed.
 */
async function sendAdminNewOrderWhatsApp(orderData) {
  if (!ADMIN_NUMBER) return;

  const name      = orderData.customerName || "—";
  const orderId   = orderData.orderId || orderData.id || "—";
  const payment   = formatPayment(orderData.paymentMethod);
  const itemsText = formatItems(orderData.items);
  const phone     = orderData.shippingAddress?.phone || "—";
  const address   = formatAddress(orderData.shippingAddress || {});
  const total     = Number(orderData.total ?? 0).toLocaleString("en-IN");

  const body =
`🛒 *Cozy Creations — New Order Alert*
${DIVIDER}
A new order has been placed. Please process it at the earliest.

${DIVIDER}
👤 *Customer Details*
${DIVIDER}
*Name:*     ${name}
*Phone:*    ${phone}
*Address:*  ${address}

${DIVIDER}
📋 *Order Details*
${DIVIDER}
*Order ID:*  #${orderId}
*Payment:*   ${payment}

*Items:*
${itemsText}

${DIVIDER}
*Total:*  ₹${total}
${DIVIDER}

👉 Log in to the Admin Dashboard to create the shipment and update the order status.`;

  return sendWhatsApp(ADMIN_NUMBER, body);
}

module.exports = {
  sendOrderConfirmationWhatsApp,
  sendOrderDeliveredWhatsApp,
  sendOrderCancelledWhatsApp,
  sendAdminNewOrderWhatsApp,
};
