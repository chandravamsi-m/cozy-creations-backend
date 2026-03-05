/**
 * Shiprocket API Helper Module
 * Handles token lifecycle (auto-refresh every 24h) and exposes
 * a pre-configured `srFetch` wrapper for all Shiprocket API calls.
 *
 * Environment variables required in .env:
 *   SHIPROCKET_EMAIL=your-api-user@email.com
 *   SHIPROCKET_PASSWORD=your-api-user-password
 *   SHIPROCKET_PICKUP_LOCATION=your-warehouse-name-in-shiprocket
 */

const fetch = (...args) =>
  import("node-fetch").then(({ default: f }) => f(...args));

const SR_BASE = "https://apiv2.shiprocket.in/v1/external";

let _token = null;
let _tokenExpiry = 0; // Unix ms

/**
 * Returns a valid Shiprocket JWT token, refreshing if needed.
 */
async function getToken() {
  const now = Date.now();

  // Token valid for 23h (1h buffer before 24h expiry)
  if (_token && now < _tokenExpiry) return _token;

  const res = await fetch(`${SR_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: process.env.SHIPROCKET_EMAIL,
      password: process.env.SHIPROCKET_PASSWORD,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Shiprocket auth failed: ${err.message || res.status}`);
  }

  const data = await res.json();
  _token = data.token;
  _tokenExpiry = now + 23 * 60 * 60 * 1000; // 23 hours
  console.log("✅ Shiprocket token refreshed");
  return _token;
}

/**
 * Authenticated fetch wrapper for Shiprocket API.
 * @param {string} path   - API path (e.g. "/orders/create/adhoc")
 * @param {Object} options - fetch options (method, body, etc.)
 */
async function srFetch(path, options = {}) {
  const token = await getToken();
  const res = await fetch(`${SR_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data?.message || `Shiprocket error: ${res.status}`);
  }

  return data;
}

module.exports = { getToken, srFetch, SR_BASE };
