function mapShiprocketStatus(status, fallback = null) {
  const normalized = String(status || "").trim().toUpperCase();
  if (!normalized) return fallback;

  if (
    normalized.includes("CANCELLED") ||
    normalized.includes("CANCELED") ||
    normalized.includes("CANCELLATION") ||
    normalized === "RTO DELIVERED"
  ) {
    return "cancelled";
  }

  if (normalized === "DELIVERED") {
    return "delivered";
  }

  if (
    normalized === "PICKUP SCHEDULED" ||
    normalized === "PICKUP GENERATED"
  ) {
    return "confirmed";
  }

  if (
    normalized === "PICKED UP" ||
    normalized === "IN TRANSIT" ||
    normalized === "OUT FOR DELIVERY" ||
    normalized === "UNDELIVERED" ||
    normalized === "RTO INITIATED"
  ) {
    return "shipped";
  }

  return fallback;
}

module.exports = { mapShiprocketStatus };
