const { srFetch } = require('./src/utils/shiprocket');
require('dotenv').config();

const SR_ID = process.argv[2];
if (!SR_ID) {
  console.error('Usage: node test-sr-order.js <id>');
  process.exit(1);
}

async function test() {
  // Try shipment details endpoint
  console.log('\n--- Trying /shipments?id=... ---');
  try {
    const data = await srFetch(`/shipments?id=${SR_ID}`);
    console.log(JSON.stringify(data?.data?.slice?.(0, 1) ?? data, null, 2));
  } catch(e) { console.error('shipments by id:', e.message); }

  // Try order details endpoint variant
  console.log('\n--- Trying /orders?filter_by=ship_rocket_shipment_id&filter=... ---');
  try {
    const data = await srFetch(`/orders?filter_by=shipment_id&filter=${SR_ID}`);
    console.log(JSON.stringify(data?.data?.slice?.(0, 1) ?? data, null, 2));
  } catch(e) { console.error('orders by shipment_id:', e.message); }
}

test();
