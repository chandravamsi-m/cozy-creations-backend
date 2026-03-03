// src/config/firebase.js
const admin = require("firebase-admin");

if (!admin.apps.length) {
  if (process.env.FIREBASE_ADMIN_CRED_JSON) {
    try {
      admin.initializeApp({
        credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_ADMIN_CRED_JSON)),
      });
    } catch (err) {
      console.warn("Firebase Admin Init Error:", err.message);
      admin.initializeApp();
    }
  } else {
    admin.initializeApp();
  }
}

const db = admin.firestore();

module.exports = { admin, db };
