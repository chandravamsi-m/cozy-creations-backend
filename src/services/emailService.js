// src/services/emailService.js
const resend = require("../config/resend");

const EMAIL_FROM = process.env.EMAIL_FROM;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;

/**
 * Wraps content in the standard email layout.
 */
function wrapLayout(title, content, name) {
  return `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
      <h2 style="color: #d97706;">Cozy Creations</h2>
      <h3 style="color: #333;">${title}</h3>
      <p>Hello ${name || 'Customer'},</p>
      ${content}
      <p>Best regards,<br/>The Cozy Creations Team</p>
      <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;"/>
      <p style="font-size: 12px; color: #999;">This is an automated email, please do not reply.</p>
    </div>
  `;
}

/**
 * Builds an HTML table for order items.
 */
function buildItemTable(items) {
  let rows = "";
  items.forEach(item => {
    rows += `
      <tr>
        <td style="padding: 10px; border-bottom: 1px solid #eee;">${item.name}</td>
        <td style="padding: 10px; border-bottom: 1px solid #eee; text-align: center;">${item.quantity}</td>
        <td style="padding: 10px; border-bottom: 1px solid #eee; text-align: right;">₹${item.price}</td>
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

module.exports = {
  resend,
  EMAIL_FROM,
  ADMIN_EMAIL,
  wrapLayout,
  buildItemTable,
};
