import { initializeApp, getApps } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyB0iLbq0spDc9xXAjsbIU_b6pQOVVYMh1A",
  authDomain: "insurance-crm-31ff4.firebaseapp.com",
  projectId: "insurance-crm-31ff4",
  storageBucket: "insurance-crm-31ff4.firebasestorage.app",
  messagingSenderId: "543855381179",
  appId: "1:543855381179:web:09396c72ef35125d9ff79e",
  measurementId: "G-2W186RX2XP"
};

// Initialize Firebase
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
export const db = getFirestore(app);
