// src/routes/webhooks.js
const express = require("express");
const router = express.Router();
const { db } = require("../config/firebase");

/**
 * Shiprocket pushes delivery status updates here.
 * We keep this endpoint idempotent and defensive.
 */
router.post("/shiprocket", async (req, res) => {
  try {
    const payload = req.body || {};
    console.log("📦 Shiprocket Webhook:", JSON.stringify(payload, null, 2));

    const awbCode = payload.awb || payload.awb_code;
    const srStatus = payload.current_status || payload.status;

    // Basic shape validation
    if (!awbCode || typeof awbCode !== "string" || !srStatus || typeof srStatus !== "string") {
      return res.status(200).json({ received: true, skipped: true, reason: "missing_awb_or_status" });
    }

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

    const ordersSnap = await db
      .collection("orders")
      .where("shiprocket.awbCode", "==", awbCode)
      .limit(1)
      .get();

    if (ordersSnap.empty) {
      console.warn(`⚠️ Shiprocket webhook: No order found for AWB ${awbCode}`);
      return res.status(200).json({ received: true, skipped: true, reason: "no_order_for_awb" });
    }

    const orderDoc = ordersSnap.docs[0];
    const current = orderDoc.data() || {};
    const currentSrStatus = current.shiprocket?.status;

    // Idempotency: if status hasn't changed, acknowledge but don't touch Firestore
    if (currentSrStatus === srStatus) {
      console.log(`ℹ️ Shiprocket webhook: Status unchanged for order ${orderDoc.id} (${srStatus})`);
      return res.status(200).json({ received: true, updated: false, orderId: orderDoc.id, status: srStatus });
    }

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
    res
      .status(200)
      .json({ received: true, updated: true, orderId: orderDoc.id, status: srStatus, mappedStatus: mappedStatus || null });
  } catch (err) {
    console.error("❌ Shiprocket webhook error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
