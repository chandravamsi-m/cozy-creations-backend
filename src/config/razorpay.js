// src/config/razorpay.js
const Razorpay = require("razorpay");

const keyId = process.env.RAZORPAY_KEY_ID;
const keySecret = process.env.RAZORPAY_KEY_SECRET;

function detectRazorpayMode(value) {
  if (typeof value !== "string") return "unknown";
  if (value.startsWith("rzp_live_")) return "live";
  if (value.startsWith("rzp_test_")) return "test";
  return "unknown";
}

const razorpayMode = detectRazorpayMode(keyId);

if (!keyId || !keySecret) {
  throw new Error("Missing Razorpay credentials. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.");
}

console.log(`[Razorpay] Initialized in ${razorpayMode.toUpperCase()} mode`);

const razorpay = new Razorpay({
  key_id: keyId,
  key_secret: keySecret,
});

module.exports = razorpay;
