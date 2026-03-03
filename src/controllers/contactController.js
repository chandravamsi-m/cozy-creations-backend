// src/controllers/contactController.js
const { ADMIN_EMAIL, EMAIL_FROM, wrapLayout, resend } = require("../services/emailService");

exports.submitInquiry = async (req, res) => {
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
            <td style="padding: 8px 0; color: #6b7280; font-size: 14px; width: 140px;">Name:</td>
            <td style="padding: 8px 0; color: #111827; font-size: 14px; font-weight: 600;">${name || "Not provided"}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Email:</td>
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
    
    // Send email to admin
    await resend.emails.send({
      from: `Cozy Creations <${EMAIL_FROM}>`,
      to: ADMIN_EMAIL,
      subject: `📧 New Inquiry from ${name}`,
      html: wrapLayout(
        "New Contact Inquiry 📩",
        inquiryContent,
        "Admin"
      ),
    });
    
    res.json({ success: true, message: "Inquiry submitted successfully" });
  } catch (error) {
    console.error("❌ Contact form error:", error);
    res.status(500).json({ success: false, message: "Failed to submit inquiry" });
  }
};
