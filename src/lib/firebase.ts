import { initializeApp, getApps } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

export const firebaseConfig = {
  apiKey: "AIzaSyDLHhO9wx8jqItcNoAdKDXvR0BPtr0zB8c",
  authDomain: "unicon-creator.firebaseapp.com",
  projectId: "unicon-creator",
  storageBucket: "unicon-creator.firebasestorage.app",
  messagingSenderId: "1024367424818",
  appId: "1:1024367424818:web:f7ead455253cc83a95532b"
};

// Initialize Firebase
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
export const db = getFirestore(app);
export const auth = getAuth(app);
