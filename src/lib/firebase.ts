// src/lib/firebase.ts
import { initializeApp } from "firebase/app";
import {
  getFirestore,
  enableIndexedDbPersistence,
  collection, doc, getDocs, getDoc, setDoc, addDoc, deleteDoc,
  query, orderBy, serverTimestamp
} from "firebase/firestore";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,   // pastikan KEY env-nya *_PROJECT_ID
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

// aktifkan cache offline; abaikan error multi-tab
enableIndexedDbPersistence(db).catch(() => { /* no-op */ });

// ===== PRODUCTS =====
export async function fetchProducts() {
  const snap = await getDocs(collection(db, "products"));
  return snap.docs.map(d => ({ id: isNaN(Number(d.id)) ? d.id : Number(d.id), ...d.data() }));
}
export async function upsertProduct(p: any) {
  const ref = doc(collection(db, "products"), String(p.id));
  await setDoc(ref, {
    name: p.name, price: p.price, category: p.category || "Signature", active: p.active !== false
  }, { merge: true });
}
export async function removeProduct(id: string | number) {
  await deleteDoc(doc(collection(db, "products"), String(id)));
}

// ===== SALES =====
export async function addSale(rec: any) {
  await addDoc(collection(db, "sales"), { ...rec, createdAt: serverTimestamp() });
}
export async function fetchSales() {
  const q = query(collection(db, "sales"), orderBy("timeMs", "desc"));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ===== SETTINGS (opsional) =====
export async function getSettings() {
  const ref = doc(collection(db, "meta"), "settings");
  const s = await getDoc(ref);
  return s.exists() ? s.data() : {};
}
export async function saveSettings(obj: any) {
  await setDoc(doc(collection(db, "meta"), "settings"), obj, { merge: true });
}
