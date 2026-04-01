const { srFetch } = require('./src/utils/shiprocket');
require('dotenv').config();

async function test() {
  try {
    const data = await srFetch('/settings/company/pickup');
    const locations = data.data.shipping_address;
    locations.forEach(loc => {
      console.log(`Name: ${loc.pickup_location}, Pincode: ${loc.pin_code}`);
    });
  } catch (err) {
    console.error(err);
  }
}

test();
