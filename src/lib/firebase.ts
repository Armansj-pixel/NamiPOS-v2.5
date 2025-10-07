// src/lib/firebase.ts
import { initializeApp } from "firebase/app";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentSingleTabManager,
  collection, doc, getDocs, getDoc, setDoc, addDoc, serverTimestamp, query, orderBy
} from "firebase/firestore";

// ✅ Gunakan environment variables dari Netlify
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID
};

// 🔥 Inisialisasi Firebase
const app = initializeApp(firebaseConfig);

// 🔄 Firestore dengan offline persistence
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentSingleTabManager() })
});

// ================== CRUD HELPERS ==================

// 🟩 Ambil daftar produk
export async function fetchProducts(): Promise<any[]> {
  const snap = await getDocs(collection(db, "products"));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// 🟩 Tambah / update produk
export async function upsertProduct(p: any) {
  const ref = doc(collection(db, "products"), String(p.id));
  await setDoc(ref, {
    name: p.name,
    price: p.price,
    category: p.category || "Signature",
    active: p.active !== false
  }, { merge: true });
}

// 🟦 Ambil daftar transaksi
export async function fetchSales(): Promise<any[]> {
  const q = query(collection(db, "sales"), orderBy("createdAt", "desc"));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// 🟧 Simpan transaksi baru
export async function addSale(rec: any) {
  await addDoc(collection(db, "sales"), {
    ...rec,
    createdAt: serverTimestamp(),
  });
}

// 🟨 Ambil & simpan pengaturan toko (opsional)
export async function fetchSettings() {
  const ref = doc(collection(db, "meta"), "settings");
  const s = await getDoc(ref);
  return s.exists() ? s.data() : {};
}
export async function saveSettings(obj: any) {
  const ref = doc(collection(db, "meta"), "settings");
  await setDoc(ref, obj, { merge: true });
}
