const test = require("node:test");
const assert = require("node:assert/strict");

const { mapShiprocketStatus } = require("../src/utils/shiprocketStatus");
const { resolveShiprocketSnapshotStatus } = require("../src/services/shippingService");

test("mapShiprocketStatus maps cancellation variants to cancelled", () => {
  assert.equal(mapShiprocketStatus("CANCELED"), "cancelled");
  assert.equal(mapShiprocketStatus("CANCELLED"), "cancelled");
  assert.equal(mapShiprocketStatus("Order Cancelled"), "cancelled");
});

test("mapShiprocketStatus maps delivery lifecycle states correctly", () => {
  assert.equal(mapShiprocketStatus("OUT FOR DELIVERY"), "shipped");
  assert.equal(mapShiprocketStatus("IN TRANSIT"), "shipped");
  assert.equal(mapShiprocketStatus("DELIVERED"), "delivered");
});

test("resolveShiprocketSnapshotStatus prefers top-level textual status over numeric shipment code", () => {
  const entry = { status: "CANCELED" };
  const shipment = { status: 8 };

  assert.equal(resolveShiprocketSnapshotStatus(entry, shipment), "CANCELED");
});

test("resolveShiprocketSnapshotStatus falls back to shipment textual status when needed", () => {
  const entry = { status: null };
  const shipment = { status: "OUT FOR DELIVERY" };

  assert.equal(resolveShiprocketSnapshotStatus(entry, shipment), "OUT FOR DELIVERY");
});

test("resolveShiprocketSnapshotStatus falls back to numeric shipment status only when no text exists", () => {
  const entry = {};
  const shipment = { status: 8 };

  assert.equal(resolveShiprocketSnapshotStatus(entry, shipment), 8);
});
