// src/controllers/shippingController.js
const shippingService = require("../services/shippingService");
const { db, admin } = require("../config/firebase");
const { mapShiprocketStatus } = require("../utils/shiprocketStatus");

async function reconcileAwbOwnership(orderId, shipmentId, awbCode) {
  if (!awbCode) return;

  const conflictsSnap = await db
    .collection("orders")
    .where("shiprocket.awbCode", "==", awbCode)
    .get();

  const updates = conflictsSnap.docs
    .filter((doc) => doc.id !== orderId)
    .filter((doc) => String(doc.data()?.shiprocket?.shipmentId || "") !== String(shipmentId))
    .map((doc) =>
      doc.ref.update({
        "shiprocket.awbCode": admin.firestore.FieldValue.delete(),
        "shiprocket.identityConflict": {
          resolvedAt: new Date().toISOString(),
          conflictingAwbCode: awbCode,
          conflictingShipmentId: shipmentId,
        },
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      })
    );

  await Promise.all(updates);
}

async function hydrateShipmentIdentity(orderId, orderData) {
  const shipmentId = orderData.shiprocket?.shipmentId;
  const shiprocketOrderId = orderData.shiprocket?.orderId || null;

  if (!shipmentId && !shiprocketOrderId) {
    return {
      shipmentId: null,
      awbCode: orderData.shiprocket?.awbCode || null,
      shiprocketStatus: orderData.shiprocket?.status || null,
      courierName: orderData.shiprocket?.courierName || orderData.courierName || null,
      snapshotFound: false,
      shiprocketOrderId: null,
    };
  }

  const snapshot = shipmentId
    ? await shippingService.getShipmentSnapshotByShipmentId(shipmentId)
    : await shippingService.getShipmentSnapshotByOrderId(shiprocketOrderId);
  const fallbackSnapshot = !snapshot && shiprocketOrderId
    ? await shippingService.getShipmentSnapshotByOrderId(shiprocketOrderId)
    : null;
  const localOrderSnapshot = !snapshot && !fallbackSnapshot
    ? await shippingService.getShipmentSnapshotByOrderId(orderId)
    : null;
  const resolvedSnapshot = snapshot || fallbackSnapshot || localOrderSnapshot;

  const awbCode = resolvedSnapshot?.awbCode || orderData.shiprocket?.awbCode || null;
  const shiprocketStatus = resolvedSnapshot?.status || orderData.shiprocket?.status || null;
  const courierName = resolvedSnapshot?.courierName || orderData.shiprocket?.courierName || orderData.courierName || null;
  const resolvedShipmentId = resolvedSnapshot?.shipmentId || shipmentId || null;
  const resolvedOrderId = resolvedSnapshot?.orderId || shiprocketOrderId || null;

  if (awbCode && resolvedShipmentId) {
    await reconcileAwbOwnership(orderId, resolvedShipmentId, awbCode);
  }

  return {
    shipmentId: resolvedShipmentId,
    awbCode,
    shiprocketStatus,
    courierName,
    snapshotFound: !!resolvedSnapshot,
    shiprocketOrderId: resolvedOrderId,
  };
}

async function clearStaleTrackingIfNeeded(orderId, orderData, identity) {
  if (!identity.shipmentId || identity.awbCode) {
    return {
      cleaned: false,
      localStatus: orderData.status,
    };
  }

  const updatePayload = {
    "shiprocket.awbCode": admin.firestore.FieldValue.delete(),
    "shiprocket.status": admin.firestore.FieldValue.delete(),
    "shiprocket.lastUpdate": admin.firestore.FieldValue.delete(),
    "shiprocket.lastSyncAttempt": new Date().toISOString(),
    "shiprocket.lastTrackingReset": new Date().toISOString(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  let localStatus = orderData.status;
  if (["shipped", "delivered", "cancelled"].includes(String(orderData.status || "").toLowerCase())) {
    localStatus = "packed";
    updatePayload.status = localStatus;
    updatePayload["statusHistory.packed"] = admin.firestore.FieldValue.serverTimestamp();
  }

  await db.collection("orders").doc(orderId).update(updatePayload);

  return {
    cleaned: true,
    localStatus,
  };
}

async function applySnapshotStatus(orderId, orderData, identity) {
  const snapshotStatus = identity.shiprocketStatus || null;
  const localStatus = mapShiprocketStatus(snapshotStatus, null);
  if (!snapshotStatus || !localStatus) {
    return null;
  }

  const updatePayload = {
    "shiprocket.status": snapshotStatus,
    "shiprocket.shipmentId": identity.shipmentId || orderData.shiprocket?.shipmentId || null,
    "shiprocket.orderId": identity.shiprocketOrderId || orderData.shiprocket?.orderId || null,
    "shiprocket.lastUpdate": new Date().toISOString(),
    "shiprocket.lastSyncAttempt": new Date().toISOString(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  if (identity.awbCode) {
    updatePayload["shiprocket.awbCode"] = identity.awbCode;
  }
  if (identity.courierName) {
    updatePayload["shiprocket.courierName"] = identity.courierName;
  }
  if (localStatus !== orderData.status) {
    updatePayload.status = localStatus;
    updatePayload[`statusHistory.${localStatus}`] = admin.firestore.FieldValue.serverTimestamp();
  }

  await db.collection("orders").doc(orderId).update(updatePayload);
  return {
    success: true,
    srStatus: snapshotStatus,
    localStatus,
    awbCode: identity.awbCode || null,
    shiprocketOrderId: identity.shiprocketOrderId || orderData.shiprocket?.orderId || null,
    shipmentId: identity.shipmentId || orderData.shiprocket?.shipmentId || null,
    courierName: identity.courierName || orderData.shiprocket?.courierName || orderData.courierName || null,
    lastSyncAttempt: updatePayload["shiprocket.lastSyncAttempt"],
    source: "shipment_snapshot",
  };
}

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
    if (orderData.shiprocket?.shipmentId) {
      return res.json({ success: true, existing: true, shiprocket: orderData.shiprocket });
    }
    
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
      courierName: orderData.courierName || null,
      lastUpdate: new Date().toISOString(),
    };

    if (shiprocketInfo.awbCode) {
      await reconcileAwbOwnership(orderId, shiprocketInfo.shipmentId, shiprocketInfo.awbCode);
    }

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
    const identity = await hydrateShipmentIdentity(id, orderData);
    let awbCode = identity.awbCode;
    const snapshotApplied = await applySnapshotStatus(id, orderData, identity);
    if (snapshotApplied && ["cancelled", "delivered"].includes(snapshotApplied.localStatus)) {
      return res.json(snapshotApplied);
    }

    if (!awbCode) {
      const cleaned = await clearStaleTrackingIfNeeded(id, orderData, identity);
      return res.status(409).json({
        error: identity.shipmentId || identity.shiprocketOrderId
          ? "AWB not assigned yet. Complete Ship Now in Shiprocket to generate the shipment and tracking details."
          : "No Shiprocket order found. Please create the shipment first.",
        code: "NO_AWB_FOUND",
        cleaned: cleaned.cleaned,
        localStatus: cleaned.localStatus,
        shiprocketOrderId: identity.shiprocketOrderId || orderData.shiprocket?.orderId || null,
        shipmentId: identity.shipmentId || orderData.shiprocket?.shipmentId || null,
        courierName: identity.courierName || orderData.shiprocket?.courierName || orderData.courierName || null,
        lastSyncAttempt: new Date().toISOString(),
      });
    }

    const tracking = await shippingService.getShipmentTracking(awbCode);
    const srStatus = tracking.tracking_data?.shipment_track?.[0]?.current_status;

    if (srStatus) {
      const localStatus = mapShiprocketStatus(srStatus, orderDoc.data().status);

      const updatePayload = {
        "shiprocket.status": srStatus,
        "shiprocket.awbCode": awbCode,
        "shiprocket.shipmentId": identity.shipmentId || orderData.shiprocket?.shipmentId || null,
        "shiprocket.courierName": identity.courierName || null,
        "shiprocket.lastUpdate": new Date().toISOString(),
        "shiprocket.lastSyncAttempt": new Date().toISOString(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      if (localStatus !== orderDoc.data().status) {
        updatePayload.status = localStatus;
        updatePayload[`statusHistory.${localStatus}`] = admin.firestore.FieldValue.serverTimestamp();
      }

      await db.collection("orders").doc(id).update(updatePayload);

      return res.json({
        success: true,
        srStatus,
        localStatus,
        awbCode,
        shiprocketOrderId: identity.shiprocketOrderId || orderData.shiprocket?.orderId || null,
        shipmentId: identity.shipmentId || orderData.shiprocket?.shipmentId || null,
        courierName: identity.courierName || orderData.shiprocket?.courierName || orderData.courierName || null,
        lastSyncAttempt: updatePayload["shiprocket.lastSyncAttempt"],
      });
    }

    await db.collection("orders").doc(id).update({
      "shiprocket.lastSyncAttempt": new Date().toISOString(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.json({
      success: false,
      message: "No status update available",
      shiprocketOrderId: identity.shiprocketOrderId || orderData.shiprocket?.orderId || null,
      shipmentId: identity.shipmentId || orderData.shiprocket?.shipmentId || null,
      courierName: identity.courierName || orderData.shiprocket?.courierName || orderData.courierName || null,
      lastSyncAttempt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("❌ Sync Error:", err.message);
    res.status(500).json({ error: err.message });
  }
};

/**
 * Silently auto-heals a missing AWB and fetches live tracking status.
 * Called from both My Orders page (customer) and Admin Orders page (background).
 * Security: Only the order's own user can call this (admins use /admin/orders/:id/sync).
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

    // No shipment created yet — nothing to fetch
    if (!orderData.shiprocket?.shipmentId) {
      return res.json({ success: false, reason: "no_shipment" });
    }

    const identity = await hydrateShipmentIdentity(id, orderData);
    let awbCode = identity.awbCode;
    const snapshotApplied = await applySnapshotStatus(id, orderData, identity);
    if (snapshotApplied && ["cancelled", "delivered"].includes(snapshotApplied.localStatus)) {
      return res.json(snapshotApplied);
    }
    const updatePayload = {};
    const healed = awbCode && awbCode !== orderData.shiprocket?.awbCode;
    updatePayload["shiprocket.lastSyncAttempt"] = new Date().toISOString();
    if (awbCode) {
      updatePayload["shiprocket.awbCode"] = awbCode;
    }
    if (identity.courierName) {
      updatePayload["shiprocket.courierName"] = identity.courierName;
    }

    // ── Step 2: Fetch live tracking status if AWB available ───────────────────
    let srStatus = null;
    let localStatus = null;
    if (awbCode) {
      try {
        const tracking = await shippingService.getShipmentTracking(awbCode);
        srStatus = tracking.tracking_data?.shipment_track?.[0]?.current_status;

        if (srStatus) {
          localStatus = mapShiprocketStatus(srStatus, orderData.status);
          updatePayload["shiprocket.status"] = srStatus;
          updatePayload["shiprocket.lastUpdate"] = new Date().toISOString();
          if (localStatus !== orderData.status) {
            updatePayload["status"] = localStatus;
            updatePayload[`statusHistory.${localStatus}`] = new Date().toISOString();
          }
        }
      } catch (trackErr) {
        // Non-fatal: tracking might not be available yet
        console.warn(`⚠️ Tracking fetch failed for order ${id}:`, trackErr.message);
      }
    }

    if (!awbCode) {
      const cleaned = await clearStaleTrackingIfNeeded(id, orderData, identity);
      return res.json({
        success: false,
        reason: "no_awb",
        cleaned: cleaned.cleaned,
        localStatus: cleaned.localStatus,
        awbCode: null,
        srStatus: null,
        shiprocketOrderId: identity.shiprocketOrderId || orderData.shiprocket?.orderId || null,
        shipmentId: identity.shipmentId || orderData.shiprocket?.shipmentId || null,
        courierName: identity.courierName || orderData.shiprocket?.courierName || orderData.courierName || null,
        lastSyncAttempt: updatePayload["shiprocket.lastSyncAttempt"],
        message: identity.shipmentId || identity.shiprocketOrderId
          ? "AWB not assigned yet. Complete Ship Now in Shiprocket to generate the shipment and tracking details."
          : "No Shiprocket order found yet.",
      });
    }

    if (Object.keys(updatePayload).length > 0) {
      updatePayload["updatedAt"] = admin.firestore.FieldValue.serverTimestamp();
      await db.collection("orders").doc(id).update(updatePayload);
    }

    return res.json({
      success: true,
      awbCode: awbCode || null,
      healed,
      srStatus: srStatus || null,
      localStatus: localStatus || null,
      shiprocketOrderId: identity.shiprocketOrderId || orderData.shiprocket?.orderId || null,
      shipmentId: identity.shipmentId || orderData.shiprocket?.shipmentId || null,
      courierName: identity.courierName || orderData.shiprocket?.courierName || orderData.courierName || null,
      lastSyncAttempt: updatePayload["shiprocket.lastSyncAttempt"],
    });
  } catch (err) {
    // Silent failure — never break the customer page
    console.error("❌ Auto-sync error:", err.message);
    res.json({ success: false, reason: "error" });
  }
};
