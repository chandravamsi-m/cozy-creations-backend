// src/routes/webhooks.js
const express = require("express");
const crypto = require("crypto");
const router = express.Router();
const { db } = require("../config/firebase");
const { mapShiprocketStatus } = require("../utils/shiprocketStatus");

function getWebhookSignature(req) {
  return req.get("x-api-key") || req.get("x-shiprocket-signature") || req.get("x-webhook-signature") || req.get("x-signature") || "";
}

function isValidWebhookSignature(req) {
  const secret = process.env.SHIPROCKET_WEBHOOK_SECRET;
  if (!secret || (!req.rawBody && !req.get("x-api-key"))) return false;

  const provided = getWebhookSignature(req).trim();

  // 1. Simple Token Match (as shown in the Shiprocket UI screenshot)
  if (provided === secret) return true;

  // 2. HMAC Signature Verification (Fallback for robust providers)
  if (req.rawBody) {
    const digest = crypto.createHmac("sha256", secret).update(req.rawBody).digest("hex");
    const base64Digest = crypto.createHmac("sha256", secret).update(req.rawBody).digest("base64");
    return provided === digest || provided === base64Digest;
  }

  return false;
}

router.post("/updates", async (req, res) => {
  try {
    if (!process.env.SHIPROCKET_WEBHOOK_SECRET) {
      console.error("❌ Webhook Error: SHIPROCKET_WEBHOOK_SECRET is missing from environment variables.");
      return res.status(503).json({ error: "Webhook secret is not configured", code: "WEBHOOK_NOT_CONFIGURED" });
    }

    if (!isValidWebhookSignature(req)) {
      console.warn("⚠️ Webhook Security: Invalid Signature. Check if your Shiprocket token matches Render secret.");
      return res.status(401).json({ error: "Invalid webhook signature", code: "INVALID_WEBHOOK_SIGNATURE" });
    }

    const payload = req.body || {};

    const awbCode = payload.awb || payload.awb_code;
    const shipmentId = String(payload.shipment_id || payload.shipmentId || payload.shipment?.shipment_id || "").trim();
    const shiprocketOrderId = String(
      payload.order_id ||
      payload.orderId ||
      payload.order?.id ||
      payload.channel_order_id ||
      payload.reference_no ||
      ""
    ).trim();
    const srStatus = payload.current_status || payload.status;

    if ((!awbCode || typeof awbCode !== "string") && !shipmentId && !shiprocketOrderId) {
      return res.status(200).json({ received: true, skipped: true, reason: "missing_tracking_identity" });
    }
    if (!srStatus || typeof srStatus !== "string") {
      return res.status(200).json({ received: true, skipped: true, reason: "missing_status" });
    }

    const mappedStatus = mapShiprocketStatus(srStatus, null);

    let ordersSnap;
    if (awbCode && typeof awbCode === "string") {
      ordersSnap = await db
        .collection("orders")
        .where("shiprocket.awbCode", "==", awbCode)
        .limit(1)
        .get();
    }

    if ((!ordersSnap || ordersSnap.empty) && shipmentId) {
      ordersSnap = await db
        .collection("orders")
        .where("shiprocket.shipmentId", "==", shipmentId)
        .limit(1)
        .get();
    }

    if ((!ordersSnap || ordersSnap.empty) && shiprocketOrderId) {
      ordersSnap = await db
        .collection("orders")
        .where("shiprocket.orderId", "==", shiprocketOrderId)
        .limit(1)
        .get();
    }

    if ((!ordersSnap || ordersSnap.empty) && shiprocketOrderId) {
      const directDoc = await db.collection("orders").doc(shiprocketOrderId).get();
      if (directDoc.exists) {
        ordersSnap = {
          empty: false,
          docs: [directDoc],
        };
      }
    }

    if (!ordersSnap || ordersSnap.empty) {
      console.warn(
        `Shiprocket webhook: No order found for AWB ${awbCode || "-"} / shipment ${shipmentId || "-"} / order ${shiprocketOrderId || "-"}`
      );
      return res.status(200).json({ received: true, skipped: true, reason: "no_order_for_identity" });
    }

    const orderDoc = ordersSnap.docs[0];
    const current = orderDoc.data() || {};
    const currentSrStatus = current.shiprocket?.status;

    if (currentSrStatus === srStatus) {
      return res.status(200).json({ received: true, updated: false, orderId: orderDoc.id, status: srStatus });
    }

    const updatePayload = {
      "shiprocket.status": srStatus,
      "shiprocket.lastUpdate": new Date().toISOString(),
    };
    if (awbCode && typeof awbCode === "string") updatePayload["shiprocket.awbCode"] = awbCode;
    if (shipmentId) updatePayload["shiprocket.shipmentId"] = shipmentId;
    if (shiprocketOrderId) updatePayload["shiprocket.orderId"] = shiprocketOrderId;

    if (mappedStatus) {
      updatePayload.status = mappedStatus;
      updatePayload[`statusHistory.${mappedStatus}`] = new Date().toISOString();
    }

    await orderDoc.ref.update(updatePayload);

    res.status(200).json({
      received: true,
      updated: true,
      orderId: orderDoc.id,
      status: srStatus,
      mappedStatus: mappedStatus || null,
    });
  } catch (err) {
    console.error("Shiprocket webhook error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
