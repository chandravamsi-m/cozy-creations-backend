// src/services/shippingService.js
const { srFetch } = require("../utils/shiprocket");

exports.checkServiceability = async (pincode, weight, isCod, dimensions = {}, amount = 0) => {
  const pickupPincode = process.env.SHIPROCKET_PICKUP_PINCODE || "500055";
  const { l = 10, w = 10, h = 10 } = dimensions;
  
  // Construct path with dimensions and declared value for accuracy
  const path = `/courier/serviceability?pickup_postcode=${pickupPincode}&delivery_postcode=${pincode}&weight=${weight}&cod=${isCod ? 1 : 0}&length=${l}&breadth=${w}&height=${h}&declared_value=${amount}`;
  
  return await srFetch(path);
};

/**
 * Parses a dimension string into { base, height } for 2D, or { l, w, h } for 3D.
 */
function parseDimensionString(dim) {
  if (!dim || typeof dim !== "string") return null;
  const cleaned = dim.replace(/\s*(cm|mm)\s*/gi, "").trim();
  const parts = cleaned.split("x").map(Number);
  
  if (parts.some(isNaN) || parts.some((p) => p <= 0)) return null;

  if (parts.length === 3) {
    return { l: parts[0], w: parts[1], h: parts[2], is3D: true };
  }
  if (parts.length === 2) {
    // AxB: A = base, B = height
    return { base: parts[0], height: parts[1], is3D: false };
  }
  return null;
}

/**
 * Compute effective dimensions and weight for one cart item,
 * accounting for pack quantity and cart quantity.
 * Only Length is scaled by total units to preserve Volume Invariance.
 */
function getEffectiveShipmentDimensions(item) {
  const cartQty = item.quantity || 1;
  const packQty = Number(item.quantityPack) || 1;
  const totalUnits = cartQty * packQty;

  const totalWeightGrams = (Number(item.weightGrams) || 300) * totalUnits;
  const weightKg = totalWeightGrams / 1000;

  const parsed = parseDimensionString(item.dimensions);
  let l, w, h;
  if (!parsed) {
    l = 10 * totalUnits;
    w = 10;
    h = 10;
  } else if (parsed.is3D) {
    l = parsed.l * totalUnits;
    w = parsed.w;
    h = parsed.h;
  } else {
    l = parsed.base * totalUnits;
    w = parsed.base;
    h = parsed.height;
  }
  return { weightKg, l, w, h };
}

exports.createShiprocketOrder = async (orderData, packagingConfig = {}, courierId = null) => {
  const buffer = 3; // Hardcoded 3cm buffer for outer box/padding

  // Extract name and phone from various possible locations
  const address = orderData.shippingAddress || {};
  const customerName = orderData.customerName || address.fullName || address.name || "Customer";
  const phone = address.phone || orderData.customerPhone || "0000000000";
  const email = orderData.userEmail || orderData.customerEmail || "no-reply@cozycreations.com";

  // Calculate total dimensions and actual weight dynamically from product data
  const totals = orderData.items.reduce((acc, item) => {
    const { weightKg, l, w, h } = getEffectiveShipmentDimensions(item);
    acc.actualWeight += weightKg;
    acc.l += l;
    acc.w = Math.max(acc.w, w);
    acc.h = Math.max(acc.h, h);
    return acc;
  }, { l: 0, w: 0, h: 0, actualWeight: 0 });

  // Add the packaging buffer (outer box thickness/padding)
  const finalL = Math.max(1, totals.l + buffer);
  const finalW = Math.max(1, totals.w + buffer);
  const finalH = Math.max(1, totals.h + buffer);

  const srOrder = {
    order_id: orderData.id,
    order_date: new Date().toISOString().split('T')[0],
    pickup_location: process.env.SHIPROCKET_PICKUP_LOCATION || "HOME",
    billing_customer_name: customerName,
    billing_last_name: ".",
    billing_address: address.houseNo 
      ? `${address.houseNo}, ${address.area}` 
      : (address.street || "Address line 1"),
    billing_address_2: address.landmark || "",
    billing_city: address.city || "City",
    billing_pincode: address.pincode || "500001",
    billing_state: address.state || "State",
    billing_country: "India",
    billing_email: email,
    billing_phone: phone,
    shipping_is_billing: true,
    order_items: orderData.items.map(item => ({
      // Include variant label in name so admin packing slip shows correct size
      name: item.variantLabel
        ? `${item.name || "Product"} - ${item.variantLabel}`
        : (item.name || "Product"),
      sku: item.variantLabel
        ? `${item.productId || "SKU"}-${item.variantLabel}`
        : (item.productId || "SKU-" + Date.now()),
      units: item.quantity || 1,
      selling_price: item.price || 0,
      discount: 0,
      tax: 0,
      hsn: 0,
    })),
    payment_method: orderData.paymentMethod === "cod" ? "COD" : "Prepaid",
    sub_total: (orderData.total || 0) - ((orderData.deliveryFee || 0) + (orderData.platformFee || 0)),
    shipping_charges: (orderData.deliveryFee || 0) + (orderData.platformFee || 0),
    length: finalL,
    breadth: finalW,
    height: finalH,
    weight: Math.max(0.1, totals.actualWeight),
    // Pass the courier ID from rate check so Shiprocket assigns the correct courier
    ...(courierId ? { courier_id: courierId } : {}),
  };

  return await srFetch("/orders/create/adhoc", {
    method: "POST",
    body: JSON.stringify(srOrder),
  });
};

exports.generateLabel = async (shipmentId) => {
  return await srFetch("/courier/generate/label", {
    method: "POST",
    body: JSON.stringify({ shipment_id: [shipmentId] }),
  });
};

exports.getShipmentTracking = async (awbCode) => {
  return await srFetch(`/courier/track/awb/${awbCode}`);
};

exports.cancelShiprocketOrder = async ({ shiprocketOrderId, shipmentId, awbCode }) => {
  const attempts = [];

  if (awbCode) {
    attempts.push({
      label: "awb",
      path: "/orders/cancel/shipment/awbs",
      body: { awbs: [String(awbCode)] },
    });
  }

  if (shiprocketOrderId) {
    const normalizedOrderId = Number.isFinite(Number(shiprocketOrderId))
      ? Number(shiprocketOrderId)
      : shiprocketOrderId;
    attempts.push({
      label: "order",
      path: "/orders/cancel",
      body: { ids: [normalizedOrderId] },
    });
  }

  if (shipmentId) {
    const normalizedShipmentId = Number.isFinite(Number(shipmentId))
      ? Number(shipmentId)
      : shipmentId;
    attempts.push({
      label: "shipment",
      path: "/orders/cancel/shipment/ids",
      body: { ids: [normalizedShipmentId] },
    });
  }

  if (attempts.length === 0) {
    return {
      attempted: false,
      cancelled: false,
      reason: "no_shiprocket_identity",
    };
  }

  const errors = [];
  for (const attempt of attempts) {
    try {
      const response = await srFetch(attempt.path, {
        method: "POST",
        body: JSON.stringify(attempt.body),
      });
      return {
        attempted: true,
        cancelled: true,
        via: attempt.label,
        response,
      };
    } catch (error) {
      errors.push(`${attempt.label}: ${error.message}`);
    }
  }

  return {
    attempted: true,
    cancelled: false,
    reason: "shiprocket_cancel_failed",
    errors,
  };
};

function findShipmentEntryByShipmentId(payload, shipmentId) {
  const target = String(shipmentId);
  const candidates = Array.isArray(payload) ? payload : (payload?.data || payload?.orders || payload?.response || []);

  for (const entry of candidates) {
    if (!entry || typeof entry !== "object") continue;

    if (String(entry.shipment_id || entry.shipmentId || "") === target) {
      return entry;
    }

    if (Array.isArray(entry.shipments)) {
      const shipment = entry.shipments.find((item) => String(item?.shipment_id || item?.shipmentId || item?.id || "") === target);
      if (shipment) {
        return { ...entry, shipment };
      }
    }
  }

  return null;
}

function findShipmentEntryByOrderId(payload, orderId) {
  const target = String(orderId);
  const candidates = Array.isArray(payload) ? payload : (payload?.data || payload?.orders || payload?.response || []);

  for (const entry of candidates) {
    if (!entry || typeof entry !== "object") continue;

    if (
      String(entry.id || entry.order_id || entry.orderId || entry.channel_order_id || entry.reference_no || "") === target
    ) {
      return entry;
    }

    if (Array.isArray(entry.shipments)) {
      const shipment = entry.shipments.find((item) =>
        String(item?.order_id || item?.orderId || item?.channel_order_id || item?.reference_no || "") === target
      );
      if (shipment) {
        return { ...entry, shipment };
      }
    }
  }

  return null;
}

function resolveShiprocketSnapshotStatus(entry, shipment) {
  return (
    (typeof entry?.current_status === "string" ? entry.current_status : null) ||
    (typeof entry?.status === "string" ? entry.status : null) ||
    (typeof shipment?.current_status === "string" ? shipment.current_status : null) ||
    (typeof shipment?.status === "string" ? shipment.status : null) ||
    entry?.current_status ||
    entry?.status ||
    shipment?.current_status ||
    shipment?.status ||
    null
  );
}

exports.getShipmentSnapshotByShipmentId = async (shipmentId) => {
  const data = await srFetch(`/orders?filter_by=shipment_id&filter=${shipmentId}`);
  const entry = findShipmentEntryByShipmentId(data, shipmentId);
  if (!entry) return null;

  const shipment = entry.shipment || (Array.isArray(entry.shipments) ? entry.shipments[0] : null) || entry;
  const resolvedStatus = resolveShiprocketSnapshotStatus(entry, shipment);
  return {
    shipmentId: String(
      shipment?.shipment_id ||
      shipment?.shipmentId ||
      entry?.shipment_id ||
      entry?.shipmentId ||
      shipmentId
    ),
    awbCode: shipment?.awb || shipment?.awb_code || entry?.awb || entry?.awb_code || null,
    status: resolvedStatus,
    courierName:
      shipment?.courier_name ||
      shipment?.courier ||
      entry?.courier_name ||
      entry?.courier ||
      null,
    orderId: entry?.id || entry?.order_id || null,
    raw: entry,
  };
};

exports.getShipmentSnapshotByOrderId = async (orderId) => {
  const data = await srFetch(`/orders?filter_by=order_id&filter=${orderId}`);
  const entry = findShipmentEntryByOrderId(data, orderId);
  if (!entry) return null;

  const shipment = entry.shipment || (Array.isArray(entry.shipments) ? entry.shipments[0] : null) || entry;
  const resolvedStatus = resolveShiprocketSnapshotStatus(entry, shipment);
  return {
    shipmentId: String(
      shipment?.shipment_id ||
      shipment?.shipmentId ||
      entry?.shipment_id ||
      entry?.shipmentId ||
      ""
    ) || null,
    awbCode: shipment?.awb || shipment?.awb_code || entry?.awb || entry?.awb_code || null,
    status: resolvedStatus,
    courierName:
      shipment?.courier_name ||
      shipment?.courier ||
      entry?.courier_name ||
      entry?.courier ||
      null,
    orderId: entry?.id || entry?.order_id || orderId || null,
    raw: entry,
  };
};

/**
 * Fetches order details from Shiprocket using the shipment ID.
 * Used to auto-heal missing AWB codes that were assigned after initial order creation
 * (e.g., when "Ship Now" is clicked from the Shiprocket dashboard).
 * Response structure: response[0].shipments[0].awb
 */
exports.getAwbByShipmentId = async (shipmentId) => {
  const snapshot = await exports.getShipmentSnapshotByShipmentId(shipmentId);
  return snapshot?.awbCode || null;
};

exports.getEffectiveShipmentDimensions = getEffectiveShipmentDimensions;
exports.resolveShiprocketSnapshotStatus = resolveShiprocketSnapshotStatus;
