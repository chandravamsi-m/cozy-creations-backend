const test = require("node:test");
const assert = require("node:assert/strict");

const { createResponse, loadWithMocks } = require("./controller-helpers");

function fieldValue() {
  return {
    serverTimestamp: () => "SERVER_TIMESTAMP",
  };
}

test("cancelOrder rejects delivered orders", async () => {
  const adminController = loadWithMocks("../src/controllers/adminController", {
    "../config/firebase": {
      db: {
        collection(name) {
          assert.equal(name, "orders");
          return {
            doc() {
              return {
                async get() {
                  return {
                    exists: true,
                    data() {
                      return { status: "delivered" };
                    },
                  };
                },
              };
            },
          };
        },
      },
      admin: { firestore: { FieldValue: fieldValue() } },
    },
    "../config/cloudinary": { uploader: { upload: async () => ({}), destroy: async () => ({}) } },
    "../utils/cloudinary": { extractCloudinaryPublicId: () => null },
    "../services/catalogueService": {
      catalogueProgress: new Map(),
      prefetchCatalogueAssets: async () => {},
      generateMultiPageCatalogue: async () => Buffer.from(""),
      generateMultiPageBulkCatalogue: async () => Buffer.from(""),
    },
    "../services/shippingService": {
      cancelShiprocketOrder: async () => ({ attempted: false, cancelled: false }),
    },
    puppeteer: {},
    "pdf-lib": { PDFDocument: {} },
  });

  const req = { params: { id: "order-1" } };
  const res = createResponse();

  await adminController.cancelOrder(req, res);

  assert.equal(res.statusCode, 409);
  assert.deepEqual(res.body, { error: "Delivered orders cannot be cancelled" });
});

test("cancelOrder cancels locally without Shiprocket when no shipping identity exists", async () => {
  const updates = [];
  let shiprocketAttempted = false;

  const adminController = loadWithMocks("../src/controllers/adminController", {
    "../config/firebase": {
      db: {
        collection(name) {
          assert.equal(name, "orders");
          return {
            doc(id) {
              assert.equal(id, "order-2");
              return {
                async get() {
                  return {
                    exists: true,
                    data() {
                      return {
                        status: "packed",
                        shiprocket: {},
                      };
                    },
                  };
                },
                async update(payload) {
                  updates.push(payload);
                },
              };
            },
          };
        },
      },
      admin: { firestore: { FieldValue: fieldValue() } },
    },
    "../config/cloudinary": { uploader: { upload: async () => ({}), destroy: async () => ({}) } },
    "../utils/cloudinary": { extractCloudinaryPublicId: () => null },
    "../services/catalogueService": {
      catalogueProgress: new Map(),
      prefetchCatalogueAssets: async () => {},
      generateMultiPageCatalogue: async () => Buffer.from(""),
      generateMultiPageBulkCatalogue: async () => Buffer.from(""),
    },
    "../services/shippingService": {
      cancelShiprocketOrder: async () => {
        shiprocketAttempted = true;
        return { attempted: true, cancelled: true };
      },
    },
    puppeteer: {},
    "pdf-lib": { PDFDocument: {} },
  });

  const req = { params: { id: "order-2" } };
  const res = createResponse();

  await adminController.cancelOrder(req, res);

  assert.equal(shiprocketAttempted, false);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.cancelledLocally, true);
  assert.equal(res.body.cancelledInShiprocket, false);
  assert.equal(res.body.shiprocketAttempted, false);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].status, "cancelled");
});

test("cancelOrder records Shiprocket cancellation metadata when Shiprocket is attempted", async () => {
  const updates = [];

  const adminController = loadWithMocks("../src/controllers/adminController", {
    "../config/firebase": {
      db: {
        collection(name) {
          assert.equal(name, "orders");
          return {
            doc(id) {
              assert.equal(id, "order-3");
              return {
                async get() {
                  return {
                    exists: true,
                    data() {
                      return {
                        status: "packed",
                        shiprocket: {
                          orderId: 123,
                          shipmentId: 456,
                        },
                      };
                    },
                  };
                },
                async update(payload) {
                  updates.push(payload);
                },
              };
            },
          };
        },
      },
      admin: { firestore: { FieldValue: fieldValue() } },
    },
    "../config/cloudinary": { uploader: { upload: async () => ({}), destroy: async () => ({}) } },
    "../utils/cloudinary": { extractCloudinaryPublicId: () => null },
    "../services/catalogueService": {
      catalogueProgress: new Map(),
      prefetchCatalogueAssets: async () => {},
      generateMultiPageCatalogue: async () => Buffer.from(""),
      generateMultiPageBulkCatalogue: async () => Buffer.from(""),
    },
    "../services/shippingService": {
      cancelShiprocketOrder: async () => ({
        attempted: true,
        cancelled: true,
        reason: "ok",
      }),
    },
    puppeteer: {},
    "pdf-lib": { PDFDocument: {} },
  });

  const req = { params: { id: "order-3" } };
  const res = createResponse();

  await adminController.cancelOrder(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.cancelledInShiprocket, true);
  assert.equal(res.body.shiprocketAttempted, true);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].status, "cancelled");
  assert.equal(updates[0]["shiprocket.cancelledInShiprocket"], true);
  assert.equal(updates[0]["shiprocket.status"], "CANCELLED");
});
