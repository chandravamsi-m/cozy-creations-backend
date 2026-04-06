const { db } = require("../config/firebase");
const shippingService = require("./shippingService");

function createError(status, message, code) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  return err;
}

function toPositiveInt(value) {
  const num = Number(value);
  if (!Number.isInteger(num) || num <= 0) return null;
  return num;
}

function toCurrency(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.round(num));
}

function toCurrencyCeil(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.ceil(num));
}

function normalizeAddress(address) {
  if (!address || typeof address !== "object") {
    throw createError(400, "Shipping address is required", "INVALID_ADDRESS");
  }

  const normalized = {
    id: address.id || null,
    type: address.type || "home",
    fullName: String(address.fullName || address.name || "").trim(),
    phone: String(address.phone || "").trim(),
    houseNo: String(address.houseNo || "").trim(),
    area: String(address.area || "").trim(),
    landmark: String(address.landmark || "").trim(),
    city: String(address.city || "").trim(),
    state: String(address.state || "").trim(),
    pincode: String(address.pincode || "").trim(),
    street: String(address.street || "").trim(),
    isDefault: !!address.isDefault,
  };

  if (!normalized.fullName || !normalized.phone || !normalized.city || !normalized.state || !normalized.pincode) {
    throw createError(400, "Incomplete shipping address", "INVALID_ADDRESS");
  }

  if (!/^\d{6}$/.test(normalized.pincode)) {
    throw createError(400, "Invalid pincode", "INVALID_ADDRESS");
  }

  return normalized;
}

function normalizeRequestedItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw createError(400, "Cart items are required", "INVALID_ITEMS");
  }

  return items.map((item) => {
    if (!item || typeof item !== "object" || typeof item.productId !== "string") {
      throw createError(400, "Invalid cart items", "INVALID_ITEMS");
    }

    const quantity = toPositiveInt(item.quantity);
    if (!quantity) {
      throw createError(400, "Invalid item quantity", "INVALID_ITEMS");
    }

    return {
      productId: item.productId,
      quantity,
      customization: item.customization || null,
    };
  });
}

function offerAppliesToProduct(offer, product) {
  if (!offer?.isActive || !offer?.hasDiscount) return false;
  if (offer.applicableToAll) return true;
  if (Array.isArray(offer.applicableCategories) && offer.applicableCategories.includes(product.category)) return true;
  if (Array.isArray(offer.applicableProducts) && offer.applicableProducts.includes(product.id)) return true;
  return false;
}

function computeDiscountedUnitPrice(product, offer) {
  const originalPrice = toCurrency(product.price);
  if (!offerAppliesToProduct(offer, product)) {
    return {
      originalPrice,
      price: originalPrice,
      discountPerUnit: 0,
    };
  }

  let discountAmount = 0;
  if (offer.discountType === "percentage") {
    discountAmount = Math.round((originalPrice * Number(offer.discountValue || 0)) / 100);
  } else if (offer.discountType === "fixed") {
    discountAmount = Math.min(originalPrice, toCurrency(offer.discountValue));
  }

  const price = Math.max(0, originalPrice - discountAmount);
  return {
    originalPrice,
    price,
    discountPerUnit: Math.max(0, originalPrice - price),
  };
}

function chooseSurfaceCourier(allCouriers) {
  const couriers = (allCouriers || []).filter((courier) =>
    courier?.is_surface === true ||
    String(courier?.courier_name || courier?.name || "").toLowerCase().includes("surface")
  );

  if (couriers.length === 0) return null;

  const preferred = couriers.find((courier) =>
    String(courier?.courier_name || courier?.name || "").toLowerCase().includes("xpressbees")
  );

  if (preferred) return preferred;

  return couriers.reduce((best, current) => {
    if (!best) return current;
    return Number(current.rate || current.freight_charge || Infinity) < Number(best.rate || best.freight_charge || Infinity)
      ? current
      : best;
  }, null);
}

async function fetchSettingsAndOffer() {
  const [deliveryDoc, paymentDoc, offerDoc] = await Promise.all([
    db.collection("settings").doc("delivery").get(),
    db.collection("settings").doc("payment").get(),
    db.collection("settings").doc("offerBanner").get(),
  ]);

  return {
    delivery: deliveryDoc.exists
      ? deliveryDoc.data()
      : { isActive: false, amount: 0, freeDeliveryThreshold: 0, isShippingFeeEnabled: true },
    payment: paymentDoc.exists
      ? paymentDoc.data()
      : { isCodEnabled: true, isPlatformFeeEnabled: false, platformFee: 0 },
    offer: offerDoc.exists ? offerDoc.data() : null,
  };
}

async function fetchProductsMap(productIds) {
  const productDocs = await Promise.all(
    productIds.map((productId) => db.collection("products").doc(productId).get())
  );

  const productsMap = new Map();
  productDocs.forEach((docSnap) => {
    if (docSnap.exists) {
      productsMap.set(docSnap.id, { id: docSnap.id, ...docSnap.data() });
    }
  });
  return productsMap;
}

async function calculateShippingFee({ items, shippingAddress, paymentMethod, discountedSubtotal, deliverySettings }) {
  const deliveryConfig = deliverySettings || {};
  const standardFee = toCurrency(deliveryConfig.amount);
  const freeDeliveryThreshold = toCurrency(deliveryConfig.freeDeliveryThreshold);

  if (deliveryConfig.isShippingFeeEnabled === false) {
    return { deliveryFee: 0, courierId: null, courierName: null, shippingSource: "disabled" };
  }

  if (freeDeliveryThreshold > 0 && discountedSubtotal >= freeDeliveryThreshold) {
    return { deliveryFee: 0, courierId: null, courierName: null, shippingSource: "threshold" };
  }

  try {
    const totals = items.reduce((acc, item) => {
      const { weightKg, l, w, h } = shippingService.getEffectiveShipmentDimensions(item);
      acc.actualWeight += weightKg;
      acc.l += l;
      acc.w = Math.max(acc.w, w);
      acc.h = Math.max(acc.h, h);
      return acc;
    }, { actualWeight: 0, l: 0, w: 0, h: 0 });

    const result = await shippingService.checkServiceability(
      shippingAddress.pincode,
      Math.max(0.5, Number(totals.actualWeight.toFixed(2))),
      paymentMethod === "cod",
      {
        l: Math.ceil(totals.l + 3),
        w: Math.ceil(totals.w + 3),
        h: Math.ceil(totals.h + 3),
      },
      discountedSubtotal
    );

    const selectedPartner = chooseSurfaceCourier(result?.data?.available_courier_companies || []);
    if (!selectedPartner) {
      return { deliveryFee: standardFee, courierId: null, courierName: null, shippingSource: "standard" };
    }

    const freight = Number(selectedPartner.freight_charge || selectedPartner.rate || 0);
    const codCharges = paymentMethod === "cod" ? Number(selectedPartner.cod_charges || 0) : 0;
    const deliveryFee = toCurrencyCeil((freight + codCharges) * 1.18);

    return {
      deliveryFee,
      courierId: selectedPartner.courier_company_id || selectedPartner.id || null,
      courierName: selectedPartner.courier_name || selectedPartner.name || null,
      shippingSource: "shiprocket",
    };
  } catch (_) {
    return { deliveryFee: standardFee, courierId: null, courierName: null, shippingSource: "standard" };
  }
}

async function buildCanonicalOrder({ payload, paymentMethod, user }) {
  const items = normalizeRequestedItems(payload.items);
  const shippingAddress = normalizeAddress(payload.shippingAddress);
  const customerName = String(payload.customerName || shippingAddress.fullName || "").trim();
  const userEmail = String(payload.userEmail || user?.email || "").trim();

  if (!customerName || !userEmail) {
    throw createError(400, "Customer details are required", "INVALID_CUSTOMER");
  }

  const { delivery, payment, offer } = await fetchSettingsAndOffer();
  if (paymentMethod === "cod" && payment?.isCodEnabled === false) {
    throw createError(400, "Cash on Delivery is currently unavailable", "COD_DISABLED");
  }

  const productIds = [...new Set(items.map((item) => item.productId))];
  const productsMap = await fetchProductsMap(productIds);

  const canonicalItems = items.map((requestedItem) => {
    const product = productsMap.get(requestedItem.productId);
    if (!product || product.isActive === false) {
      throw createError(400, `Product unavailable: ${requestedItem.productId}`, "PRODUCT_UNAVAILABLE");
    }

    const pricing = computeDiscountedUnitPrice(product, offer);
    return {
      productId: product.id,
      name: product.name || "Product",
      quantity: requestedItem.quantity,
      price: pricing.price,
      originalPrice: pricing.originalPrice,
      discountPerUnit: pricing.discountPerUnit,
      image: product.thumbnailUrl || product.imageUrl || "",
      imageUrl: product.imageUrl || "",
      thumbnailUrl: product.thumbnailUrl || product.imageUrl || "",
      category: product.category || null,
      weightGrams: Number(product.weightGrams) || 0,
      dimensions: product.dimensions || null,
      quantityPack: Number(product.quantityPack) || 1,
      customization: requestedItem.customization || null,
      lineTotal: pricing.price * requestedItem.quantity,
      lineOriginalTotal: pricing.originalPrice * requestedItem.quantity,
    };
  });

  const subtotal = canonicalItems.reduce((sum, item) => sum + item.lineOriginalTotal, 0);
  const discountTotal = canonicalItems.reduce((sum, item) => sum + (item.discountPerUnit * item.quantity), 0);
  const discountedSubtotal = subtotal - discountTotal;
  const platformFee = payment?.isPlatformFeeEnabled ? toCurrency(payment.platformFee) : 0;
  const shipping = await calculateShippingFee({
    items: canonicalItems,
    shippingAddress,
    paymentMethod,
    discountedSubtotal,
    deliverySettings: delivery,
  });
  const total = discountedSubtotal + shipping.deliveryFee + platformFee;

  return {
    userId: user?.uid || "guest",
    customerName,
    userEmail,
    shippingAddress,
    items: canonicalItems,
    subtotal,
    discountTotal,
    discountedSubtotal,
    deliveryFee: shipping.deliveryFee,
    platformFee,
    total,
    courierId: shipping.courierId,
    courierName: shipping.courierName,
    paymentMethod,
    pricingSource: {
      offerApplied: !!offer?.isActive && !!offer?.hasDiscount,
      shippingSource: shipping.shippingSource,
    },
  };
}

module.exports = {
  buildCanonicalOrder,
  createError,
};
