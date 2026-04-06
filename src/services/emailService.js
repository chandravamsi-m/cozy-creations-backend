// src/services/emailService.js
const resend = require("../config/resend");
const { escapeHtml } = require("../utils/escapeHtml");

const EMAIL_FROM = process.env.EMAIL_FROM;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;

function wrapLayout(title, content, name) {
  return `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
      <h2 style="color: #d97706;">Cozy Creations</h2>
      <h3 style="color: #333;">${escapeHtml(title)}</h3>
      <p>Hello ${escapeHtml(name || "Customer")},</p>
      ${content}
      <p>Best regards,<br/>The Cozy Creations Team</p>
      <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;"/>
      <p style="font-size: 12px; color: #999;">This is an automated email, please do not reply.</p>
    </div>
  `;
}

function buildItemTable(items) {
  let rows = "";
  items.forEach((item) => {
    rows += `
      <tr>
        <td style="padding: 10px; border-bottom: 1px solid #eee;">${escapeHtml(item.name)}</td>
        <td style="padding: 10px; border-bottom: 1px solid #eee; text-align: center;">${escapeHtml(item.quantity)}</td>
        <td style="padding: 10px; border-bottom: 1px solid #eee; text-align: right;">Rs. ${escapeHtml(item.price)}</td>
      </tr>
    `;
  });

  return `
    <table style="width: 100%; border-collapse: collapse; margin-top: 20px;">
      <thead>
        <tr style="background-color: #f9fafb;">
          <th style="padding: 10px; text-align: left; border-bottom: 2px solid #eee;">Item</th>
          <th style="padding: 10px; border-bottom: 2px solid #eee;">Qty</th>
          <th style="padding: 10px; text-align: right; border-bottom: 2px solid #eee;">Price</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  `;
}

async function sendOrderConfirmationEmail(email, orderData) {
  const table = buildItemTable(orderData.items || []);
  const safeTotal = escapeHtml(orderData.total ?? 0);
  const safeName = orderData.customerName || "Customer";

  await resend.emails.send({
    from: `Cozy Creations <${EMAIL_FROM}>`,
    to: email,
    subject: "Order Confirmed - Cozy Creations",
    html: wrapLayout(
      "Order Confirmed",
      `<p>Thank you for your order. We are preparing it with care.</p>${table}<p style="margin-top:20px; font-size:18px; font-weight:700;">Grand Total: Rs. ${safeTotal}</p>`,
      safeName
    ),
  });

  await resend.emails.send({
    from: `Cozy Creations <${EMAIL_FROM}>`,
    to: ADMIN_EMAIL,
    subject: `New Order - Rs. ${safeTotal}`,
    html: wrapLayout(
      "New Order Received",
      `<p>From: ${escapeHtml(safeName)}</p>${table}<p style="font-weight:700;">Total: Rs. ${safeTotal}</p>`,
      "Admin"
    ),
  });
}

async function sendStatusUpdateEmail({ email, status, name, expectedDeliveryDate }) {
  let deliveryNote = "";
  if (expectedDeliveryDate) {
    const dateStr = new Date(expectedDeliveryDate).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
    deliveryNote = `<p style="margin-top:16px; font-weight:700; color:#166534;">Estimated Arrival: ${escapeHtml(dateStr)}</p>`;
  }

  await resend.emails.send({
    from: `Cozy Creations <${EMAIL_FROM}>`,
    to: email,
    subject: `Order Update - ${escapeHtml(status)}`,
    html: wrapLayout(
      "Order Update",
      `<div style="padding:20px; background:#f0fdf4; border-radius:12px; text-align:center;"><h3 style="margin:0; color:#166534;">Status: ${escapeHtml(String(status).toUpperCase())}</h3>${deliveryNote}</div><p style="margin-top:20px;">We will keep you posted as your order progresses.</p>`,
      name
    ),
  });
}

module.exports = {
  resend,
  EMAIL_FROM,
  ADMIN_EMAIL,
  wrapLayout,
  buildItemTable,
  sendOrderConfirmationEmail,
  sendStatusUpdateEmail,
};
