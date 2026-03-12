// src/services/shippingService.js
const { srFetch } = require("../utils/shiprocket");

exports.checkServiceability = async (pincode, weight, isCod, dimensions = {}, amount = 0) => {
  const pickupPincode = process.env.SHIPROCKET_PICKUP_PINCODE || "500081";
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

  // Map our order to Shiprocket order format
  const srOrder = {
    order_id: orderData.id,
    order_date: new Date().toISOString().split('T')[0],
    pickup_location: process.env.SHIPROCKET_PICKUP_LOCATION || "HOME",
    billing_customer_name: customerName,
    billing_last_name: ".",
    billing_address: address.street || "Address line 1",
    billing_address_2: "",
    billing_city: address.city || "City",
    billing_pincode: address.pincode || "500001",
    billing_state: address.state || "State",
    billing_country: "India",
    billing_email: email,
    billing_phone: phone,
    shipping_is_billing: true,
    order_items: orderData.items.map(item => ({
      name: item.name || "Product",
      sku: item.productId || "SKU-" + Date.now(),
      units: item.quantity || 1,
      selling_price: item.price || 0,
      discount: 0,
      tax: 0,
      hsn: 0,
    })),
    payment_method: orderData.paymentMethod === "cod" ? "COD" : "Prepaid",
    sub_total: orderData.total || 0,
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
