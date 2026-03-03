// src/controllers/shippingController.js
const shippingService = require("../services/shippingService");
const { db, admin } = require("../config/firebase");

exports.checkServiceability = async (req, res) => {
  try {
    const { pincode, weight, cod } = req.query;
    if (!pincode || !weight) return res.status(400).json({ error: "Missing parameters" });

    const data = await shippingService.checkServiceability(pincode, weight, cod === "1" || cod === "true");
    // Wrap in { data: ... } because the frontend expects json.data.data.available_courier_companies
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
    console.log(`🚀 Creating shipment for order ${orderId}...`);
    
    const pkgDoc = await db.collection("settings").doc("packaging").get();
    const packagingConfig = pkgDoc.exists ? (pkgDoc.data().categoryPackaging || {}) : {};

    const srResult = await shippingService.createShiprocketOrder(orderData, packagingConfig);
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

    const awbCode = orderDoc.data().shiprocket?.awbCode;
    if (!awbCode) return res.status(400).json({ error: "No AWB found" });

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

      return res.json({ success: true, srStatus, localStatus });
    }

    res.json({ success: false, message: "No status update available" });
  } catch (err) {
    console.error("❌ Sync Error:", err.message);
    res.status(500).json({ error: err.message });
  }
};
