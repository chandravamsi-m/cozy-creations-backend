// src/services/emailService.js
const resend = require("../config/resend");
const { escapeHtml } = require("../utils/escapeHtml");

const EMAIL_FROM = process.env.EMAIL_FROM;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;

// ─── Brand Palette (matches website) ────────────────────────────────────────
const BRAND = {
  yellow: "#ffd34d",
  dark:   "#191816",
  muted:  "#6b6b6b",
  light:  "#fdf8f0",
  border: "#f0e8d5",
  white:  "#ffffff",
  green:  "#166534",
  greenBg:"#f0fdf4",
};

// ─── Master Layout Wrapper ──────────────────────────────────────────────────────
function wrapLayout(title, content, name) {
  const greeting = name
    ? `<h2 class="email-title" style="margin:0 0 4px; font-size:22px; color:${BRAND.dark}; font-family:Georgia,serif; font-weight:700;">${escapeHtml(title)}</h2>
       <p style="margin:0 0 24px; font-size:14px; color:${BRAND.muted}; font-family:Arial,sans-serif;">Hello, <strong style="color:${BRAND.dark};">${escapeHtml(name)}</strong> 👋</p>`
    : `<h2 class="email-title" style="margin:0 0 24px; font-size:22px; color:${BRAND.dark}; font-family:Georgia,serif; font-weight:700;">${escapeHtml(title)}</h2>`;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="x-apple-disable-message-reformatting" />
  <title>${escapeHtml(title)} - Cozy Creations</title>
  <style>
    @media only screen and (max-width: 600px) {
      .email-card  { width: 96% !important; border-radius: 12px !important; }
      .email-body  { padding: 24px 20px !important; }
      .email-foot  { padding: 14px 20px !important; }
      .email-title { font-size: 18px !important; }
      .email-h1    { font-size: 19px !important; }
    }
  </style>
</head>
<body style="margin:0; padding:0; background-color:#f5f0e8; font-family:Georgia,'Times New Roman',serif;">

  <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
         style="background-color:#f5f0e8; padding:32px 12px;">
    <tr>
      <td align="center">

        <!-- Card -->
        <table class="email-card" cellpadding="0" cellspacing="0" role="presentation"
               style="width:100%; max-width:600px; background-color:${BRAND.white};
                      border-radius:16px; overflow:hidden;
                      box-shadow:0 4px 24px rgba(0,0,0,0.10);">

          <!-- Header: brand name only -->
          <tr>
            <td style="background-color:${BRAND.dark}; padding:22px 36px; text-align:center;">
              <h1 class="email-h1" style="margin:0; font-size:24px; color:${BRAND.white};
                         font-family:Georgia,serif; font-weight:700; letter-spacing:1px;">Cozy Creations</h1>
              <div style="width:36px; height:2px; background:${BRAND.yellow}; margin:10px auto 0;"></div>
            </td>
          </tr>

          <!-- Body: title + greeting + content + sign-off, all in one white cell -->
          <tr>
            <td class="email-body" style="padding:36px 40px 32px; background-color:${BRAND.white};">
              <div style="font-size:15px; color:#444; line-height:1.75; font-family:Arial,sans-serif;">

                ${greeting}

                ${content}

                <!-- Sign-off -->
                <div style="margin-top:36px; padding-top:20px; border-top:1px solid ${BRAND.border};">
                  <p style="margin:0 0 2px; font-size:13px; color:${BRAND.muted}; font-family:Arial,sans-serif;">With warmth &amp; care,</p>
                  <p style="margin:0; font-size:16px; font-weight:700; color:${BRAND.dark}; font-family:Georgia,serif;">Cozy Creations</p>
                </div>

              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td class="email-foot" style="background-color:${BRAND.dark}; padding:16px 36px; text-align:center;">
              <p style="margin:0 0 4px; font-size:11px; color:#888; font-family:Arial,sans-serif;">© ${new Date().getFullYear()} Cozy Creations. All rights reserved.</p>
              <p style="margin:0; font-size:11px; color:#666; font-family:Arial,sans-serif;">This is an automated email — please do not reply.</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>

</body>
</html>
  `;
}

// ─── Order Items Table (with product images) ─────────────────────────────────
function buildItemTable(items) {
  let rows = "";
  items.forEach((item) => {
    const imgSrc = item.thumbnailUrl || item.image || item.imageUrl || "";
    const imgHtml = imgSrc
      ? `<img src="${imgSrc}" alt="${escapeHtml(item.name)}" width="52" height="52"
           style="width:52px; height:52px; object-fit:cover; border-radius:10px; display:block; border:1px solid ${BRAND.border};" />`
      : `<div style="width:52px; height:52px; background:${BRAND.light}; border-radius:10px; display:flex; align-items:center; justify-content:center; font-size:22px; border:1px solid ${BRAND.border};">🕯️</div>`;

    rows += `
      <tr>
        <td style="padding: 14px 12px; border-bottom: 1px solid ${BRAND.border};">
          <table cellpadding="0" cellspacing="0"><tr>
            <td style="padding-right:12px; vertical-align:middle;">${imgHtml}</td>
            <td style="vertical-align:middle;">
              <p style="margin:0; font-size:13px; font-weight:600; color:${BRAND.dark}; font-family: Arial, sans-serif;">${escapeHtml(item.name)}</p>
              ${item.customization ? `<p style="margin:3px 0 0; font-size:11px; color:${BRAND.muted}; font-family: Arial, sans-serif;">Note: ${escapeHtml(item.customization)}</p>` : ""}
            </td>
          </tr></table>
        </td>
        <td style="padding: 14px 12px; border-bottom: 1px solid ${BRAND.border}; text-align:center; font-size:14px; color:${BRAND.muted}; font-family: Arial, sans-serif; vertical-align:middle;">
          ${escapeHtml(String(item.quantity))}
        </td>
        <td style="padding: 14px 12px; border-bottom: 1px solid ${BRAND.border}; text-align:right; font-size:14px; font-weight:600; color:${BRAND.dark}; font-family: Arial, sans-serif; vertical-align:middle;">
          ₹${escapeHtml(String(item.price * item.quantity))}
        </td>
      </tr>
    `;
  });

  return `
    <table style="width:100%; border-collapse:collapse; margin-top:8px; border: 1px solid ${BRAND.border}; border-radius:12px; overflow:hidden;">
      <thead>
        <tr style="background-color:${BRAND.dark};">
          <th style="padding:12px; text-align:left; font-size:11px; font-family: Arial, sans-serif; letter-spacing:2px; color:${BRAND.yellow}; text-transform:uppercase; font-weight:600;">Item</th>
          <th style="padding:12px; text-align:center; font-size:11px; font-family: Arial, sans-serif; letter-spacing:2px; color:${BRAND.yellow}; text-transform:uppercase; font-weight:600;">Qty</th>
          <th style="padding:12px; text-align:right; font-size:11px; font-family: Arial, sans-serif; letter-spacing:2px; color:${BRAND.yellow}; text-transform:uppercase; font-weight:600;">Total</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  `;
}

// ─── Billing Summary (subtotal + fees + total) ───────────────────────────────
function buildBillingSummary({ subtotal, discountTotal, deliveryFee, platformFee, total }) {
  const rows = [];

  rows.push(`
    <tr>
      <td style="padding:8px 0; font-size:14px; color:${BRAND.muted}; font-family:Arial,sans-serif;">Subtotal</td>
      <td style="padding:8px 0; font-size:14px; color:${BRAND.dark}; text-align:right; font-family:Arial,sans-serif;">₹${escapeHtml(String(subtotal ?? 0))}</td>
    </tr>`);

  if (discountTotal > 0) {
    rows.push(`
    <tr>
      <td style="padding:8px 0; font-size:14px; color:#16a34a; font-family:Arial,sans-serif;">🏷️ Discount</td>
      <td style="padding:8px 0; font-size:14px; color:#16a34a; text-align:right; font-family:Arial,sans-serif;">−₹${escapeHtml(String(discountTotal))}</td>
    </tr>`);
  }

  rows.push(`
    <tr>
      <td style="padding:8px 0; font-size:14px; color:${BRAND.muted}; font-family:Arial,sans-serif;">Shipping Fee</td>
      <td style="padding:8px 0; font-size:14px; color:${(deliveryFee ?? 0) === 0 ? '#16a34a' : BRAND.dark}; text-align:right; font-family:Arial,sans-serif;">${(deliveryFee ?? 0) === 0 ? 'FREE 🎉' : '₹' + escapeHtml(String(deliveryFee))}</td>
    </tr>`);

  rows.push(`
    <tr>
      <td style="padding:8px 0; font-size:14px; color:${BRAND.muted}; font-family:Arial,sans-serif;">Platform Fee</td>
      <td style="padding:8px 0; font-size:14px; color:${(platformFee ?? 0) === 0 ? BRAND.muted : BRAND.dark}; text-align:right; font-family:Arial,sans-serif;">${(platformFee ?? 0) === 0 ? 'NIL' : '₹' + escapeHtml(String(platformFee))}</td>
    </tr>`);

  return `
    <table style="width:100%; border-collapse:collapse; margin-top:16px;">
      <tbody>
        ${rows.join("")}
        <tr style="border-top: 2px solid ${BRAND.yellow};">
          <td style="padding:14px 0 0; font-size:17px; font-weight:700; color:${BRAND.dark}; font-family:Georgia,serif;">Grand Total</td>
          <td style="padding:14px 0 0; font-size:20px; font-weight:700; color:${BRAND.dark}; text-align:right; font-family:Georgia,serif;">₹${escapeHtml(String(total ?? 0))}</td>
        </tr>
      </tbody>
    </table>
  `;
}

// ─── Order Confirmation Email ─────────────────────────────────────────────────
async function sendOrderConfirmationEmail(email, orderData) {
  const table = buildItemTable(orderData.items || []);
  const safeTotal = escapeHtml(String(orderData.total ?? 0));
  const safeName = orderData.customerName || "Customer";

  // Customer email
  const billing = buildBillingSummary({
    subtotal:      orderData.subtotal      ?? 0,
    discountTotal: orderData.discountTotal ?? 0,
    deliveryFee:   orderData.deliveryFee   ?? 0,
    platformFee:   orderData.platformFee   ?? 0,
    total:         orderData.total         ?? 0,
  });

  await resend.emails.send({
    from: `Cozy Creations <${EMAIL_FROM}>`,
    to: email,
    subject: "✨ Order Confirmed - Cozy Creations",
    html: wrapLayout(
      "Your Order is Confirmed!",
      `
        <p style="margin:0 0 20px; color:#555;">Thank you for your order! We're now preparing your candles with love and care. You'll receive another update once your package is on its way.</p>
        <p style="margin:0 0 12px; font-size:13px; font-weight:700; color:${BRAND.muted}; letter-spacing:2px; text-transform:uppercase;">Order Summary</p>
        ${table}
        ${billing}
        <div style="margin-top:28px; padding:20px; background:${BRAND.light}; border-radius:12px; border-left:4px solid ${BRAND.yellow};">
          <p style="margin:0; font-size:13px; color:${BRAND.muted};">🕯️ Each candle is made by hand, just for you. We appreciate your patience as we craft your order.</p>
        </div>
      `,
      safeName
    ),
  });

  // Admin notification — matches customer email shell, customer-info-first
  const addr = orderData.shippingAddress || {};
  const adminItemRows = (orderData.items || []).map((item) =>
    `<tr>
      <td style="padding:8px 0; font-size:14px; color:${BRAND.dark}; font-family:Arial,sans-serif; border-bottom:1px solid ${BRAND.border};">${escapeHtml(item.name)} <span style="color:${BRAND.muted};">× ${escapeHtml(String(item.quantity))}</span></td>
      <td style="padding:8px 0; font-size:14px; font-weight:600; color:${BRAND.dark}; text-align:right; font-family:Arial,sans-serif; border-bottom:1px solid ${BRAND.border};">₹${escapeHtml(String(item.price * item.quantity))}</td>
    </tr>`
  ).join("");

  const adminBilling = buildBillingSummary({
    subtotal:      orderData.subtotal      ?? 0,
    discountTotal: orderData.discountTotal ?? 0,
    deliveryFee:   orderData.deliveryFee   ?? 0,
    platformFee:   orderData.platformFee   ?? 0,
    total:         orderData.total         ?? 0,
  });

  await resend.emails.send({
    from: `Cozy Creations <${EMAIL_FROM}>`,
    to: ADMIN_EMAIL,
    subject: `🛒 New Order — ₹${safeTotal} · ${escapeHtml(safeName)}`,
    html: wrapLayout(
      "New Order Received",
      `
        <!-- Customer Details -->
        <p style="margin:0 0 10px; font-size:11px; font-weight:700; color:${BRAND.muted}; letter-spacing:2px; text-transform:uppercase;">Customer Details</p>
        <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${BRAND.border}; border-radius:10px; overflow:hidden; margin-bottom:28px;">
          <tr style="background:${BRAND.light};">
            <td style="padding:10px 14px; font-size:12px; font-weight:700; color:${BRAND.muted}; width:100px;">Name</td>
            <td style="padding:10px 14px; font-size:13px; font-weight:700; color:${BRAND.dark};">${escapeHtml(safeName)}</td>
          </tr>
          <tr>
            <td style="padding:10px 14px; font-size:12px; font-weight:700; color:${BRAND.muted}; border-top:1px solid ${BRAND.border};">Email</td>
            <td style="padding:10px 14px; font-size:13px; color:${BRAND.dark}; border-top:1px solid ${BRAND.border};">${escapeHtml(orderData.userEmail || "—")}</td>
          </tr>
          <tr style="background:${BRAND.light};">
            <td style="padding:10px 14px; font-size:12px; font-weight:700; color:${BRAND.muted}; border-top:1px solid ${BRAND.border};">Phone</td>
            <td style="padding:10px 14px; font-size:13px; font-weight:700; color:${BRAND.dark}; border-top:1px solid ${BRAND.border};">${escapeHtml(addr.phone || "—")}</td>
          </tr>
          <tr>
            <td style="padding:10px 14px; font-size:12px; font-weight:700; color:${BRAND.muted}; border-top:1px solid ${BRAND.border}; vertical-align:top;">Address</td>
            <td style="padding:10px 14px; font-size:13px; color:${BRAND.dark}; border-top:1px solid ${BRAND.border}; line-height:1.7;">
              ${escapeHtml(addr.street || "")}<br/>
              ${escapeHtml(addr.city || "")}, ${escapeHtml(addr.state || "")} — ${escapeHtml(addr.pincode || "")}
            </td>
          </tr>
          <tr style="background:${BRAND.light};">
            <td style="padding:10px 14px; font-size:12px; font-weight:700; color:${BRAND.muted}; border-top:1px solid ${BRAND.border};">Payment</td>
            <td style="padding:10px 14px; font-size:13px; font-weight:700; color:${BRAND.dark}; border-top:1px solid ${BRAND.border}; text-transform:uppercase;">${escapeHtml(String(orderData.paymentMethod || "Online"))}</td>
          </tr>
        </table>

        <!-- Items -->
        <p style="margin:0 0 10px; font-size:11px; font-weight:700; color:${BRAND.muted}; letter-spacing:2px; text-transform:uppercase;">Items Ordered</p>
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:4px;">
          <thead>
            <tr style="background:${BRAND.dark};">
              <th style="padding:10px 12px; text-align:left; font-size:11px; color:${BRAND.yellow}; letter-spacing:2px; text-transform:uppercase; font-weight:600;">Item</th>
              <th style="padding:10px 12px; text-align:right; font-size:11px; color:${BRAND.yellow}; letter-spacing:2px; text-transform:uppercase; font-weight:600;">Total</th>
            </tr>
          </thead>
          <tbody>${adminItemRows}</tbody>
        </table>
        ${adminBilling}

        <p style="margin:24px 0 0; font-size:13px; color:${BRAND.muted};">Log in to your Admin Dashboard to process this order and create the shipment.</p>
      `,
      "Admin"
    ),
  });
}


module.exports = {
  resend,
  EMAIL_FROM,
  ADMIN_EMAIL,
  wrapLayout,
  buildItemTable,
  buildBillingSummary,
  sendOrderConfirmationEmail,
};
