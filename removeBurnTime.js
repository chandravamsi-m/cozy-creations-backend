require('dotenv').config();
const { db } = require('./src/config/firebase');
const admin = require('firebase-admin');

async function removeBurnTime() {
  try {
    const snapshot = await db.collection('scented-sticks').get();
    let count = 0;
    const batch = db.batch();
    
    snapshot.forEach(doc => {
      const data = doc.data();
      if (data.burnTimeMinutes !== undefined) {
        batch.update(doc.ref, {
          burnTimeMinutes: admin.firestore.FieldValue.delete()
        });
        count++;
      }
    });

    if (count > 0) {
      await batch.commit();
      console.log(`Successfully removed burnTimeMinutes from ${count} documents.`);
    } else {
      console.log('No documents found with burnTimeMinutes field.');
    }
  } catch (error) {
    console.error('Error:', error);
  }
}

removeBurnTime();
