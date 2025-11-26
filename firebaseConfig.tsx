// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
import { getStorage } from "firebase/storage";
import { getFirestore } from "firebase/firestore";


// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyAU6j6lcgw1AfbupSYm79hw0z-INpVnOSQ",
  authDomain: "curiosity-whiteboard.firebaseapp.com",
  projectId: "curiosity-whiteboard",
  storageBucket: "curiosity-whiteboard.firebasestorage.app",
  messagingSenderId: "551312018216",
  appId: "1:551312018216:web:bcb00c0a5ea17d777ade1d",
  measurementId: "G-CKB2P919KC",
};

// Initialize Firebase
export const app = initializeApp(firebaseConfig);
export const analytics = getAnalytics(app);
export const storage = getStorage(app);
export const database = getFirestore(app);

