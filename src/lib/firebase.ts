// Firebase app initialization and exports
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
import { getStorage } from "firebase/storage";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyAU6j6lcgw1AfbupSYm79hw0z-INpVnOSQ",
  authDomain: "curiosity-whiteboard.firebaseapp.com",
  projectId: "curiosity-whiteboard",
  storageBucket: "curiosity-whiteboard.appspot.com",
  messagingSenderId: "551312018216",
  appId: "1:551312018216:web:bcb00c0a5ea17d777ade1d",
  measurementId: "G-CKB2P919KC",
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const analytics =
  typeof window !== "undefined" ? getAnalytics(app) : null;
export const storage = getStorage(app);
export const database = getFirestore(app);
