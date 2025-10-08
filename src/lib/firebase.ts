// src/lib/firebase.ts
// -----------------------------------------------------------------------------
// Firebase helper library untuk CHAFU MATCHA POS
// Fitur: Produk • Inventori • Resep • Stok Otomatis • Sales
// -----------------------------------------------------------------------------

import { initializeApp } from "firebase/app";
import {
  getFirestore, collection, getDocs, doc, setDoc, addDoc, deleteDoc,
  updateDoc, increment
} from "firebase/firestore";

// --- Konfigurasi Firebase ---
// Semua value ini diambil dari ENV (Netlify / Vite)
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

// Inisialisasi Firebase
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

// -----------------------------------------------------------------------------
// 🟩 PRODUK
// -----------------------------------------------------------------------------
export type Product = {
  id: number;
  name: string;
  price: number;
  active?: boolean;
};

export async function fetchProducts(): Promise<Product[]> {
  const q = await getDocs(collection(db, "products"));
  return q.docs.map((d) => d.data() as Product);
}

export async function upsertProduct(p: Product) {
  await setDoc(doc(db, "products", String(p.id)), p);
}

export async function removeProduct(id: number) {
  await deleteDoc(doc(db, "products", String(id)));
}

// -----------------------------------------------------------------------------
// 🟨 INVENTORI
// -----------------------------------------------------------------------------
export type Ingredient = {
  id?: string;
  name: string;
  unit: string;
  stock: number;
};

export async function fetchIngredients(): Promise<Ingredient[]> {
  const q = await getDocs(collection(db, "ingredients"));
  return q.docs.map((d) => ({ id: d.id, ...d.data() })) as Ingredient[];
}

export async function upsertIngredient(i: Ingredient) {
  if (i.id) await setDoc(doc(db, "ingredients", i.id), i);
  else await addDoc(collection(db, "ingredients"), i);
}

export async function deleteIngredient(id: string) {
  await deleteDoc(doc(db, "ingredients", id));
}

// update stok langsung (misalnya opname manual)
export async function adjustStock(
  updates: { ingredientId: string; newStock: number; note?: string }[]
) {
  const logBatch = updates.map(async (u) => {
    await setDoc(doc(db, "ingredients", u.ingredientId), { stock: u.newStock }, { merge: true });
    await addDoc(collection(db, "stock_logs"), {
      ingredientId: u.ingredientId,
      newStock: u.newStock,
      note: u.note || "manual update",
      at: Date.now(),
    });
  });
  await Promise.all(logBatch);
}

// -----------------------------------------------------------------------------
// 🟦 RESEP PRODUK
// -----------------------------------------------------------------------------
export type RecipeItem = { ingredientId: string; qty: number };
export type RecipeDoc = { productId: number; items: RecipeItem[] };

export async function fetchRecipes(): Promise<RecipeDoc[]> {
  const q = await getDocs(collection(db, "recipes"));
  return q.docs.map((d) => d.data() as RecipeDoc);
}

export async function setRecipeForProduct(
  productId: number,
  items: RecipeItem[]
) {
  await setDoc(doc(db, "recipes", String(productId)), { productId, items });
}

// -----------------------------------------------------------------------------
// 🟥 DEDUKSI STOK SAAT PENJUALAN
// -----------------------------------------------------------------------------
export async function deductStockForSale(opts: {
  saleId: string;
  items: { productId: number; name: string; qty: number }[];
  recipes: RecipeDoc[];
  ingredientsMap: { [id: string]: Ingredient };
}) {
  const { saleId, items, recipes, ingredientsMap } = opts;

  const totalUse: Record<string, number> = {};

  for (const s of items) {
    const recipe = recipes.find((r) => r.productId === s.productId);
    if (!recipe) continue;
    for (const r of recipe.items) {
      totalUse[r.ingredientId] = (totalUse[r.ingredientId] || 0) + r.qty * s.qty;
    }
  }

  for (const [ingredientId, usedQty] of Object.entries(totalUse)) {
    const ing = ingredientsMap[ingredientId];
    if (!ing) continue;
    const newStock = Math.max(0, (ing.stock || 0) - usedQty);
    await updateDoc(doc(db, "ingredients", ingredientId), { stock: newStock });
    await addDoc(collection(db, "stock_logs"), {
      saleId,
      ingredientId,
      usedQty,
      newStock,
      note: "auto deduct by sale",
      at: Date.now(),
    });
  }
}
