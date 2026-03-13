
// Standard modular Firebase imports for v9+ to ensure correct module resolution
import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBAtZtO0WAQvJn2GX0GwxVOhoPdrBdMZ6Q",
  authDomain: "kura-b41ea.firebaseapp.com",
  projectId: "kura-b41ea",
  storageBucket: "kura-b41ea.firebasestorage.app",
  messagingSenderId: "195629533280",
  appId: "1:195629533280:web:c398d6de444e82b56e1b05",
  measurementId: "G-PG7ZYJ81M5"
};

/**
 * Singleton Pattern for Firebase Initialization.
 * Ensures that the app is only initialized once, even during React Hot Module Replacement.
 */
// Fix: Explicitly handle app initialization using named exports from firebase/app to resolve compiler errors.
const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

// Initialize services linked to the singleton instance
const auth = getAuth(app);
const db = getFirestore(app);

export { auth, db };
