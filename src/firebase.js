import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";

const firebaseConfig = {
  apiKey: "AIzaSyBcxI4Ys4jotRZgnQEkXriI9RVCmCQwuVE",
  authDomain: "simulation-x.firebaseapp.com",
  databaseURL: "https://simulation-x-default-rtdb.europe-west1.firebasedatabase.app/",
  projectId: "simulation-x",
  storageBucket: "simulation-x.firebasestorage.app",
  messagingSenderId: "860329810665",
  appId: "1:860329810665:web:7b112c66bf2bdab90d2e78",
  measurementId: "G-D39HCH33Q8"
};

const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
