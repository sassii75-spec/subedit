import { initializeApp } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, doc, setDoc } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyDLHhO9wx8jqItcNoAdKDXvR0BPtr0zB8c",
  authDomain: "unicon-creator.firebaseapp.com",
  projectId: "unicon-creator",
  storageBucket: "unicon-creator.firebasestorage.app",
  messagingSenderId: "1024367424818",
  appId: "1:1024367424818:web:f7ead455253cc83a95532b"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

async function run() {
  const email = 'admin@unicon.com';
  const password = 'admin1234!';
  
  console.log(`Creating user in Auth: ${email}...`);
  const userCredential = await createUserWithEmailAndPassword(auth, email, password);
  const uid = userCredential.user.uid;
  console.log(`Auth user created. UID: ${uid}`);
  
  console.log('Creating user profile document in Firestore `subedit_users`...');
  await setDoc(doc(db, 'subedit_users', uid), {
    uid,
    email,
    name: '관리자',
    role: 'ADMIN',
    createdAt: new Date().toISOString()
  });
  console.log('Firestore profile created with role: ADMIN');
  
  process.exit(0);
}

run().catch(err => {
  console.error('Error creating admin:', err);
  process.exit(1);
});
