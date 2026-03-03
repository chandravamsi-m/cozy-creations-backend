// src/services/shippingService.js
const { srFetch } = require("../../shiprocket");

exports.checkServiceability = async (pincode, weight, isCod) => {
  const pickupPincode = process.env.SHIPROCKET_PICKUP_PINCODE || "500081";
  const path = `/courier/serviceability?pickup_postcode=${pickupPincode}&delivery_postcode=${pincode}&weight=${weight}&cod=${isCod ? 1 : 0}`;
  return await srFetch(path);
};

exports.createShiprocketOrder = async (orderData, packagingConfig = {}) => {
  // Extract name and phone from various possible locations
  const address = orderData.shippingAddress || {};
  const customerName = orderData.customerName || address.fullName || address.name || "Customer";
  const phone = address.phone || "0000000000";
  const email = orderData.userEmail || "no-reply@cozycreations.com";

  // Calculate total dimensions and actual weight
  const totals = orderData.items.reduce((acc, item) => {
    const cat = (item.category || "").toLowerCase();
    const pkg = packagingConfig[cat] || { l: 10, w: 10, h: 10 };
    
    // Simple stacking along Length
    acc.l += (Number(pkg.l) * (item.quantity || 1));
    acc.w = Math.max(acc.w, Number(pkg.w));
    acc.h = Math.max(acc.h, Number(pkg.h));
    
    acc.actualWeight += ((item.weightGrams || 300) * (item.quantity || 1));
    return acc;
  }, { l: 0, w: 0, h: 0, actualWeight: 0 });

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
    length: totals.l || 10,
    breadth: totals.w || 10,
    height: totals.h || 10,
    weight: Math.max(0.1, totals.actualWeight / 1000),
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
