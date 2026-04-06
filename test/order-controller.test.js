const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const { createResponse, loadWithMocks } = require("./controller-helpers");

function buildFirestoreFieldValue() {
  return {
    serverTimestamp: () => "SERVER_TIMESTAMP",
  };
}

function buildCodFingerprint(orderData) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify({
      userId: orderData.userId,
      items: orderData.items.map((item) => ({ productId: item.productId, quantity: item.quantity })),
      shippingAddress: {
        pincode: orderData.shippingAddress?.pincode,
        phone: orderData.shippingAddress?.phone,
      },
      total: orderData.total,
      paymentMethod: orderData.paymentMethod,
    }))
    .digest("hex");
}

test("createPayment stores canonical order in paymentAttempts and returns backend pricing", async () => {
  const storedAttempt = { id: null, payload: null };
  const canonicalOrder = {
    subtotal: 190,
    discountTotal: 10,
    deliveryFee: 61,
    platformFee: 30,
    total: 271,
    items: [{ productId: "p1", quantity: 1 }],
    shippingAddress: { pincode: "500081" },
    userEmail: "buyer@example.com",
  };

  const db = {
    collection(name) {
      assert.equal(name, "paymentAttempts");
      return {
        doc(id) {
          storedAttempt.id = id;
          return {
            async set(payload) {
              storedAttempt.payload = payload;
            },
          };
        },
      };
    },
  };

  const orderController = loadWithMocks("../src/controllers/orderController", {
    "../config/firebase": {
      db,
      admin: { firestore: { FieldValue: buildFirestoreFieldValue() } },
    },
    "../services/paymentService": {
      createRazorpayOrder: async () => ({ id: "rpay_1", amount: 27100, currency: "INR" }),
      verifySignature: () => true,
      createOrderRecord: async () => "unused",
    },
    "../services/orderPricingService": {
      buildCanonicalOrder: async () => canonicalOrder,
    },
    "../services/emailService": {
      sendOrderConfirmationEmail: async () => {},
    },
  });

  const req = { user: { uid: "user-1" }, body: { items: [] } };
  const res = createResponse();

  await orderController.createPayment(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.orderId, "rpay_1");
  assert.deepEqual(res.body.pricing, {
    subtotal: 190,
    discountTotal: 10,
    deliveryFee: 61,
    platformFee: 30,
    total: 271,
  });
  assert.equal(storedAttempt.id, "rpay_1");
  assert.equal(storedAttempt.payload.userId, "user-1");
  assert.equal(storedAttempt.payload.status, "pending");
  assert.deepEqual(storedAttempt.payload.orderData, canonicalOrder);
});

test("verifyPayment returns duplicate when an order already exists for the payment id", async () => {
  const orderController = loadWithMocks("../src/controllers/orderController", {
    "../config/firebase": {
      db: {
        collection(name) {
          assert.equal(name, "orders");
          return {
            where() {
              return {
                limit() {
                  return {
                    async get() {
                      return {
                        empty: false,
                        docs: [{ id: "existing-order" }],
                      };
                    },
                  };
                },
              };
            },
          };
        },
      },
      admin: { firestore: { FieldValue: buildFirestoreFieldValue() } },
    },
    "../services/paymentService": {
      createRazorpayOrder: async () => ({}),
      verifySignature: () => true,
      createOrderRecord: async () => "unused",
    },
    "../services/orderPricingService": {
      buildCanonicalOrder: async () => ({}),
    },
    "../services/emailService": {
      sendOrderConfirmationEmail: async () => {},
    },
  });

  const req = {
    user: { uid: "user-1" },
    body: {
      razorpay_order_id: "rpay_order",
      razorpay_payment_id: "pay_123",
      razorpay_signature: "sig",
    },
  };
  const res = createResponse();

  await orderController.verifyPayment(req, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, {
    success: true,
    orderId: "existing-order",
    duplicate: true,
  });
});

test("verifyPayment creates an order, completes the attempt, and sends confirmation email", async () => {
  const setCalls = [];
  let sentEmail = null;

  const attemptRef = {
    async get() {
      return {
        exists: true,
        data() {
          return {
            userId: "user-1",
            status: "pending",
            orderData: {
              total: 281,
              userEmail: "buyer@example.com",
              items: [{ productId: "p1", quantity: 1 }],
            },
          };
        },
      };
    },
    async set(payload, options) {
      setCalls.push({ payload, options });
    },
  };

  const db = {
    collection(name) {
      if (name === "orders") {
        return {
          where() {
            return {
              limit() {
                return {
                  async get() {
                    return { empty: true, docs: [] };
                  },
                };
              },
            };
          },
        };
      }

      if (name === "paymentAttempts") {
        return {
          doc(id) {
            assert.equal(id, "rpay_order");
            return attemptRef;
          },
        };
      }

      throw new Error(`Unexpected collection ${name}`);
    },
  };

  const orderController = loadWithMocks("../src/controllers/orderController", {
    "../config/firebase": {
      db,
      admin: { firestore: { FieldValue: buildFirestoreFieldValue() } },
    },
    "../services/paymentService": {
      createRazorpayOrder: async () => ({}),
      verifySignature: () => true,
      createOrderRecord: async ({ orderData, paymentId, paymentOrderId }) => {
        assert.equal(orderData.paymentMethod, "online");
        assert.equal(orderData.userId, "user-1");
        assert.equal(paymentId, "pay_123");
        assert.equal(paymentOrderId, "rpay_order");
        return "created-order";
      },
    },
    "../services/orderPricingService": {
      buildCanonicalOrder: async () => ({}),
    },
    "../services/emailService": {
      sendOrderConfirmationEmail: async (email, payload) => {
        sentEmail = { email, payload };
      },
    },
  });

  const req = {
    user: { uid: "user-1" },
    body: {
      razorpay_order_id: "rpay_order",
      razorpay_payment_id: "pay_123",
      razorpay_signature: "sig",
    },
  };
  const res = createResponse();

  await orderController.verifyPayment(req, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { success: true, orderId: "created-order" });
  assert.equal(setCalls.length, 1);
  assert.equal(setCalls[0].payload.status, "completed");
  assert.equal(setCalls[0].payload.orderId, "created-order");
  assert.equal(setCalls[0].payload.paymentId, "pay_123");
  assert.deepEqual(setCalls[0].options, { merge: true });
  assert.equal(sentEmail.email, "buyer@example.com");
  assert.equal(sentEmail.payload.orderId, "created-order");
});

test("placeCod returns a duplicate pending order created within five minutes", async () => {
  const now = new Date();
  const canonicalOrder = {
    userId: "user-1",
    items: [{ productId: "p1", quantity: 2 }],
    shippingAddress: { pincode: "500081", phone: "9999999999" },
    total: 562,
    paymentMethod: "cod",
    userEmail: "buyer@example.com",
  };

  const duplicateDoc = {
    id: "cod-order-existing",
    data() {
      return {
        codFingerprint: "will-be-overwritten",
        createdAt: {
          toDate() {
            return now;
          },
        },
      };
    },
  };

  let getCalled = false;
  const orderController = loadWithMocks("../src/controllers/orderController", {
    "../config/firebase": {
      db: {
        collection(name) {
          assert.equal(name, "orders");
          return {
            where() {
              return this;
            },
            async get() {
              getCalled = true;
              return { docs: [duplicateDoc] };
            },
          };
        },
      },
      admin: { firestore: { FieldValue: buildFirestoreFieldValue() } },
    },
    "../services/paymentService": {
      createRazorpayOrder: async () => ({}),
      verifySignature: () => true,
      createOrderRecord: async () => "new-order",
    },
    "../services/orderPricingService": {
      buildCanonicalOrder: async () => canonicalOrder,
    },
    "../services/emailService": {
      sendOrderConfirmationEmail: async () => {},
    },
  });

  const req = { user: { uid: "user-1" }, body: {} };
  const res = createResponse();

  const originalData = duplicateDoc.data;
  duplicateDoc.data = function patchedData() {
    return {
      codFingerprint: buildCodFingerprint(canonicalOrder),
      createdAt: originalData.call(this).createdAt,
    };
  };

  await orderController.placeCod(req, res);

  assert.equal(getCalled, true);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, {
    success: true,
    orderId: "cod-order-existing",
    duplicate: true,
  });
});
