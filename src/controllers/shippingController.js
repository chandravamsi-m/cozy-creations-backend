// src/controllers/shippingController.js
const shippingService = require("../services/shippingService");
const { db, admin } = require("../config/firebase");

exports.checkServiceability = async (req, res) => {
  try {
    const { pincode, weight, cod, l, w, h, amount } = req.query;
    if (!pincode || !weight) return res.status(400).json({ error: "Missing parameters" });

    const dimensions = {
      l: Number(l) || 10,
      w: Number(w) || 10,
      h: Number(h) || 10
    };

    const data = await shippingService.checkServiceability(
      pincode, 
      weight, 
      cod === "1" || cod === "true",
      dimensions,
      Number(amount) || 0
    );

    // Serviceability check successful
    res.json({ data });
  } catch (err) {
    console.error("❌ Serviceability Error:", err.message);
    res.status(500).json({ error: err.message });
  }
};

exports.createShipment = async (req, res) => {
  try {
    const { orderId } = req.body;
    const orderDoc = await db.collection("orders").doc(orderId).get();
    if (!orderDoc.exists) return res.status(404).json({ error: "Order not found" });

    const orderData = { id: orderDoc.id, ...orderDoc.data() };
    
    const pkgDoc = await db.collection("settings").doc("packaging").get();
    const packagingConfig = pkgDoc.exists ? (pkgDoc.data().categoryPackaging || {}) : {};

    const courierId = orderData.courierId || null;

    const srResult = await shippingService.createShiprocketOrder(orderData, packagingConfig, courierId);
    console.log("✅ Shiprocket order created:", srResult.order_id);

    const shiprocketInfo = {
      orderId: srResult.order_id,
      shipmentId: srResult.shipment_id,
      status: "NEW",
      awbCode: srResult.awb_code || null,
      lastUpdate: new Date().toISOString(),
    };

    await db.collection("orders").doc(orderId).update({
      shiprocket: shiprocketInfo,
      status: "packed",
      [`statusHistory.packed`]: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.json({ success: true, shiprocket: shiprocketInfo });
  } catch (err) {
    console.error("❌ Create Shipment Error:", err.message);
    res.status(500).json({ error: err.message });
  }
};

exports.generateLabel = async (req, res) => {
  try {
    const { id } = req.params;
    const orderDoc = await db.collection("orders").doc(id).get();
    if (!orderDoc.exists) return res.status(404).json({ error: "Order not found" });

    const shipmentId = orderDoc.data().shiprocket?.shipmentId;
    if (!shipmentId) return res.status(400).json({ error: "No shipment ID found for this order" });

    const result = await shippingService.generateLabel(shipmentId);
    res.json({ labelUrl: result.label_url });
  } catch (err) {
    console.error("❌ Label Generation Error:", err.message);
    res.status(500).json({ error: err.message });
  }
};

exports.syncStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const orderDoc = await db.collection("orders").doc(id).get();
    if (!orderDoc.exists) return res.status(404).json({ error: "Order not found" });

    let orderData = orderDoc.data();
    let awbCode = orderData.shiprocket?.awbCode;

    // ── Auto-Heal: AWB missing but we have a Shiprocket Shipment ID ──────────
    if (!awbCode && orderData.shiprocket?.shipmentId) {
      console.log(`🔄 AWB missing for order ${id}. Fetching from Shiprocket via shipmentId...`);
      try {
        const fetchedAwb = await shippingService.getAwbByShipmentId(orderData.shiprocket.shipmentId);

        if (fetchedAwb) {
          console.log(`✅ Auto-healed AWB for order ${id}: ${fetchedAwb}`);
          await db.collection("orders").doc(id).update({
            "shiprocket.awbCode": fetchedAwb,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          awbCode = fetchedAwb;
        } else {
          console.warn(`⚠️ Shiprocket did not return an AWB for order ${id} yet.`);
          return res.status(400).json({ error: "AWB not yet assigned by Shiprocket. Please schedule pickup first." });
        }
      } catch (healErr) {
        console.error("❌ AWB auto-heal failed:", healErr.message);
        return res.status(500).json({ error: "Could not fetch AWB from Shiprocket: " + healErr.message });
      }
    }

    if (!awbCode) return res.status(400).json({ error: "No AWB found. Please create the shipment first." });

    const tracking = await shippingService.getShipmentTracking(awbCode);
    const srStatus = tracking.tracking_data?.shipment_track?.[0]?.current_status;

    if (srStatus) {
      // Map Shiprocket status to local
      const statusMap = {
        "PICKUP SCHEDULED": "confirmed",
        "PICKUP GENERATED": "confirmed",
        "PICKED UP": "shipped",
        "IN TRANSIT": "shipped",
        "OUT FOR DELIVERY": "shipped",
        "DELIVERED": "delivered",
        "CANCELLED": "cancelled",
      };
      const localStatus = statusMap[srStatus.toUpperCase()] || orderDoc.data().status;

      await db.collection("orders").doc(id).update({
        "shiprocket.status": srStatus,
        status: localStatus,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      return res.json({ success: true, srStatus, localStatus, awbCode });
    }

    res.json({ success: false, message: "No status update available" });
  } catch (err) {
    console.error("❌ Sync Error:", err.message);
    res.status(500).json({ error: err.message });
  }
};

/**
 * Silently auto-heals a missing AWB for a user's own order.
 * Called automatically from the My Orders page — no admin access needed.
 * Only works if the order belongs to the authenticated user.
 */
exports.autoSyncAwb = async (req, res) => {
  try {
    const { id } = req.params;
    const orderDoc = await db.collection("orders").doc(id).get();
    if (!orderDoc.exists) return res.status(404).json({ error: "Order not found" });

    const orderData = orderDoc.data();

    // Security: ensure the order belongs to the requesting user
    if (orderData.userId !== req.user?.uid) {
      return res.status(403).json({ error: "Access denied" });
    }

    // Already has AWB — nothing to do
    if (orderData.shiprocket?.awbCode) {
      return res.json({ success: true, awbCode: orderData.shiprocket.awbCode, healed: false });
    }

    // No shipment created yet — nothing to fetch
    if (!orderData.shiprocket?.shipmentId) {
      return res.json({ success: false, reason: "no_shipment" });
    }

    const fetchedAwb = await shippingService.getAwbByShipmentId(orderData.shiprocket.shipmentId);

    if (fetchedAwb) {
      await db.collection("orders").doc(id).update({
        "shiprocket.awbCode": fetchedAwb,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      console.log(`✅ Auto-synced AWB for order ${id}: ${fetchedAwb}`);
      return res.json({ success: true, awbCode: fetchedAwb, healed: true });
    }

    return res.json({ success: false, reason: "awb_not_yet_assigned" });
  } catch (err) {
    // Silent failure — don't break the My Orders page
    console.error("❌ Auto-sync AWB error:", err.message);
    res.json({ success: false, reason: "error" });
  }
};
