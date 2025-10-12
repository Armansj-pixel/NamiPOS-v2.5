// src/lib/firebase.ts
import { initializeApp, getApps } from "firebase/app";
import { getAuth } from "firebase/auth";
import {
  getFirestore, collection, doc, getDoc, getDocs, addDoc, setDoc, updateDoc, deleteDoc,
  query, orderBy, where, writeBatch, increment as fsIncrement, serverTimestamp
} from "firebase/firestore";

// ==== Init Firebase (Vite) ====
const cfg = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

const app = getApps().length ? getApps()[0] : initializeApp(cfg);
export const auth = getAuth(app);
export const db = getFirestore(app);

// ==== Utils ====
export const IDR = (n:number) => new Intl.NumberFormat("id-ID",{style:"currency",currency:"IDR",maximumFractionDigits:0}).format(n||0);
export const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
};

// ==== Types ====
export type Product = {
  id?: string;
  name: string;
  price: number;
  category: string;
  active?: boolean;
};

export type Ingredient = {
  id?: string;
  name: string;
  unit: string;     // "gr" | "ml" | "pcs"
  stock: number;    // current on-hand
  low?: number;     // low-stock threshold
};

export type RecipeItem = { ingredientId: string; qty: number }; // qty per 1 cup
export type RecipeDoc = { id?: string; productId: string; items: RecipeItem[] };

// ==== Collections refs ====
const C_PRODUCTS = "products";
const C_INGR = "ingredients";
const C_RECIPES = "recipes";

// ===============================
// Products
// ===============================
export async function fetchProducts(): Promise<Product[]> {
  const snap = await getDocs(query(collection(db, C_PRODUCTS), orderBy("name","asc")));
  return snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
}

export async function upsertProduct(p: Product): Promise<string> {
  if (p.id) {
    await setDoc(doc(db, C_PRODUCTS, p.id), { name: p.name, price: p.price, category: p.category, active: p.active!==false }, { merge: true });
    return p.id;
  } else {
    const ref = await addDoc(collection(db, C_PRODUCTS), { name: p.name, price: p.price, category: p.category, active: p.active!==false, createdAt: serverTimestamp() });
    return ref.id;
  }
}

export async function removeProduct(productId: string): Promise<void> {
  await deleteDoc(doc(db, C_PRODUCTS, productId));
  // (opsional) hapus recipe terkait
  const rs = await getDocs(query(collection(db, C_RECIPES), where("productId","==",productId)));
  const batch = writeBatch(db);
  rs.forEach(d => batch.delete(d.ref));
  await batch.commit();
}

// ===============================
// Ingredients
// ===============================
export async function fetchIngredients(): Promise<Ingredient[]> {
  const snap = await getDocs(query(collection(db, C_INGR), orderBy("name","asc")));
  return snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
}

export async function upsertIngredient(i: Ingredient): Promise<string> {
  const payload = {
    name: i.name,
    unit: i.unit,
    stock: Number(i.stock || 0),
    low: Number(i.low || 0),
    updatedAt: serverTimestamp(),
  };
  if (i.id) {
    await setDoc(doc(db, C_INGR, i.id), payload, { merge: true });
    return i.id;
  } else {
    const ref = await addDoc(collection(db, C_INGR), { ...payload, createdAt: serverTimestamp() });
    return ref.id;
  }
}

export async function deleteIngredient(ingredientId: string): Promise<void> {
  await deleteDoc(doc(db, C_INGR, ingredientId));
}

// Penyesuaian stok (+/-) dalam satuan bahan
export async function adjustStock(ingredientId: string, delta: number): Promise<void> {
  await updateDoc(doc(db, C_INGR, ingredientId), {
    stock: fsIncrement(delta),
    updatedAt: serverTimestamp(),
  });
}

// ===============================
// Recipes
// ===============================
export async function fetchRecipes(): Promise<RecipeDoc[]> {
  const snap = await getDocs(collection(db, C_RECIPES));
  return snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
}

// Set/Upsert recipe untuk satu produk
export async function setRecipeForProduct(productId: string, items: RecipeItem[]): Promise<string> {
  // satu recipe per productId
  const existing = await getDocs(query(collection(db, C_RECIPES), where("productId","==",productId)));
  if (!items || items.length === 0) {
    // hapus jika kosong
    const batch = writeBatch(db);
    existing.forEach(d => batch.delete(d.ref));
    await batch.commit();
    return "deleted";
  }
  if (existing.empty) {
    const ref = await addDoc(collection(db, C_RECIPES), { productId, items, updatedAt: serverTimestamp() });
    return ref.id;
  } else {
    const ref = existing.docs[0].ref;
    await updateDoc(ref, { items, updatedAt: serverTimestamp() });
    return existing.docs[0].id;
  }
}

// ===============================
// Deduct stock after sale
// items: array {productId, qty}
// recipes: optional pre-fetched recipes to avoid extra reads
// ===============================
export async function deductStockForSale(items: { productId: string; qty: number }[], recipes?: RecipeDoc[]): Promise<void> {
  // Kumpulkan kebutuhan per ingredient
  const need: Record<string, number> = {};

  // ambil recipes jika tidak disediakan
  let recipeList: RecipeDoc[] = recipes || await fetchRecipes();

  // Index recipes by productId
  const map = new Map<string, RecipeItem[]>();
  for (const r of recipeList) {
    if (r.productId) map.set(r.productId, r.items || []);
  }

  for (const it of items) {
    const rItems = map.get(it.productId) || [];
    for (const r of rItems) {
      need[r.ingredientId] = (need[r.ingredientId] || 0) + (r.qty * it.qty);
    }
  }

  const batch = writeBatch(db);
  for (const [ingId, qty] of Object.entries(need)) {
    const ref = doc(db, C_INGR, ingId);
    // pakai increment negatif
    batch.update(ref, { stock: fsIncrement(-qty), updatedAt: serverTimestamp() });
  }
  await batch.commit();
}

// (opsional) export Firestore primitives kalau dibutuhkan App.tsx
export {
  collection, doc, getDoc, getDocs, addDoc, setDoc, updateDoc, deleteDoc,
  query, orderBy, where, serverTimestamp, writeBatch, fsIncrement as increment
};