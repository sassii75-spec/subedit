import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyDLHhO9wx8jqItcNoAdKDXvR0BPtr0zB8c",
  authDomain: "unicon-creator.firebaseapp.com",
  projectId: "unicon-creator",
  storageBucket: "unicon-creator.firebasestorage.app",
  messagingSenderId: "1024367424818",
  appId: "1:1024367424818:web:f7ead455253cc83a95532b"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function test() {
  try {
    const exams = await getDocs(collection(db, "unicon_exams"));
    console.log("Exams count:", exams.docs.length);
    const history = await getDocs(collection(db, "subedit_history"));
    console.log("History count:", history.docs.length);
  } catch (e) {
    console.error("Error reading db:", e.message);
  }
}

test();
