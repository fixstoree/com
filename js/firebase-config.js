/*
 * FIX STORE — Firebase Web App configuration.
 * Project: fix-store-project
 * This config contains Firebase PUBLIC client identifiers only.
 * It is not a Firebase Admin service-account key and grants no privileges.
 *
 * Before using live accounts:
 * 1. Firebase Console > Authentication > Sign-in method > Email/Password: Enable
 * 2. Firebase Console > Authentication > Settings > Authorized domains: Add hosting domain
 * 3. Firebase Console > Firestore Database: Create database; publish firestore.rules
 * 4. Provision the devbank admin with the local-only scripts/bootstrap-admin.mjs
 *
 * Firebase Auth + Firestore are automatically initialized by js/app.js on each page.
 */
window.FIXSTORE_FIREBASE_CONFIG = {
  apiKey: "AIzaSyAqN3ECYW03PB3WVGre7WleqdcwOUbvmTA",
  authDomain: "fix-store-project.firebaseapp.com",
  projectId: "fix-store-project",
  storageBucket: "fix-store-project.firebasestorage.app",
  messagingSenderId: "171364300768",
  appId: "1:171364300768:web:35aa6dd4c907620202dd85",
  measurementId: "G-KMN0BB5DB8"
};

// GitHub Pages cannot run Node.js APIs. Set this to the actual HTTPS Cloud Run service URL.
// Cloud Run -> Services -> fix-store-api -> URL (do not include /api/health).
// Example format: https://fix-store-api-xxxxxxxxxx-as.a.run.app
// This public URL is not a password. Keep all payment keys in Google Secret Manager.
window.FIXSTORE_API_BASE = 'https://REPLACE-WITH-YOUR-CLOUD-RUN-URL.run.app';
