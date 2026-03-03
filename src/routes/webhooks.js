// src/routes/webhooks.js
const express = require("express");
const router = express.Router();
const { db } = require("../config/firebase");

/**
 * Shiprocket pushes delivery status updates here.
 */
router.post("/shiprocket", async (req, res) => {
  try {
    const payload = req.body;
    console.log("📦 Shiprocket Webhook:", JSON.stringify(payload, null, 2));

    const awbCode = payload.awb || payload.awb_code;
    const srStatus = payload.current_status || payload.status;

    if (!awbCode || !srStatus) return res.status(200).json({ received: true, skipped: true });

    const statusMap = {
      "Pickup Scheduled": "confirmed",
      "Pickup Generated": "confirmed",
      "Picked Up": "shipped",
      "In Transit": "shipped",
      "Out For Delivery": "shipped",
      "Delivered": "delivered",
      "Undelivered": "shipped",
      "Cancelled": "cancelled",
      "RTO Initiated": "shipped",
      "RTO Delivered": "cancelled",
    };

    const mappedStatus = statusMap[srStatus];

    const ordersSnap = await db.collection("orders").where("shiprocket.awbCode", "==", awbCode).limit(1).get();

    if (ordersSnap.empty) {
      console.warn(`⚠️ Shiprocket webhook: No order found for AWB ${awbCode}`);
      return res.status(200).json({ received: true, skipped: true });
    }

    const orderDoc = ordersSnap.docs[0];
    const updatePayload = {
      "shiprocket.status": srStatus,
      "shiprocket.lastUpdate": new Date().toISOString(),
    };

    if (mappedStatus) {
      updatePayload.status = mappedStatus;
      updatePayload[`statusHistory.${mappedStatus}`] = new Date().toISOString();
    }

    await orderDoc.ref.update(updatePayload);
    console.log(`✅ Shiprocket webhook: Order ${orderDoc.id} updated → ${srStatus}`);
    res.status(200).json({ received: true, updated: true, orderId: orderDoc.id, status: srStatus });
  } catch (err) {
    console.error("❌ Shiprocket webhook error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
