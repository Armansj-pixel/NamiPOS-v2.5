// src/lib/firebase.ts
// Kompatibel dengan Vite + TypeScript ES2021
// Pastikan ENV Netlify sudah diisi: VITE_FIREBASE_*
// (API key Firebase yang dibundle ke client bukan rahasia server)

import { initializeApp } from "firebase/app";
import {
  getFirestore,
  enableIndexedDbPersistence,
  collection, doc, getDocs, getDoc,
  setDoc, addDoc, deleteDoc,
  query, orderBy, writeBatch, serverTimestamp,
} from "firebase/firestore";

// ---------- Konfigurasi dari ENV ----------
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:
    (import.meta.env as any).VITE_FIREBASE_PROJECT_ID ||
    (import.meta.env as any).VITE_FIREBASE_PROJECT, // fallback
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: (import.meta.env as any).VITE_FIREBASE_MEASUREMENT_ID,
};

// ---------- Init ----------
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

// Aktifkan cache offline (abaikan error multi-tab)
enableIndexedDbPersistence(db).catch(() => {
  /* no-op */
});

// ---------- Tipe Data ----------
export type Product = {
  id: number;
  name: string;
  price: number;
  category?: string;
  active?: boolean;
};

export type Ingredient = {
  id?: string;
  name: string;
  unit: string;      // "gr" | "ml" | "pcs"
  stock: number;     // stok saat ini
  minStock?: number; // ambang minimal
  avgCost?: number;  // opsional
};

export type RecipeItem = { ingredientId: string; qty: number };
export type RecipeDoc = { productId: number; items: RecipeItem[] };

// ---------- PRODUCTS ----------
export async function fetchProducts(): Promise<Product[]> {
  const snap = await getDocs(collection(db, "products"));
  // dokumen products di-identifikasi pakai id string/number
  return snap.docs.map((d) => {
    const data = d.data() as any;
    const idNum = Number(data.id ?? d.id);
    return {
      id: isNaN(idNum) ? (data.id ?? d.id) : idNum,
      name: data.name,
      price: Number(data.price) || 0,
      category: data.category || "Signature",
      active: data.active !== false,
    } as Product;
  });
}

export async function upsertProduct(p: Product) {
  const ref = doc(collection(db, "products"), String(p.id));
  await setDoc(
    ref,
    {
      id: p.id,
      name: p.name,
      price: p.price,
      category: p.category || "Signature",
      active: p.active !== false,
    },
    { merge: true }
  );
}

export async function removeProduct(id: number) {
  await deleteDoc(doc(collection(db, "products"), String(id)));
}

// ---------- SALES ----------
export async function addSale(rec: any) {
  // Simpan ke collection "sales" (id otomatis, simpan id struk di field "receiptId")
  await addDoc(collection(db, "sales"), {
    receiptId: rec.id,
    ...rec,
    createdAt: serverTimestamp(),
  });
}

// (opsional, jika dibutuhkan nantinya)
export async function fetchSales() {
  const q = query(collection(db, "sales"), orderBy("timeMs", "desc"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
}

// ---------- INGREDIENTS ----------
export async function fetchIngredients(): Promise<Ingredient[]> {
  const snap = await getDocs(collection(db, "ingredients"));
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
}

export async function upsertIngredient(ing: Ingredient) {
  if (ing.id) {
    const ref = doc(collection(db, "ingredients"), ing.id);
    await setDoc(ref, { ...ing, stock: Number(ing.stock) || 0 }, { merge: true });
    return ing.id;
  } else {
    const res = await addDoc(collection(db, "ingredients"), {
      ...ing,
      stock: Number(ing.stock) || 0,
    });
    return res.id;
  }
}

export async function deleteIngredient(id: string) {
  await deleteDoc(doc(collection(db, "ingredients"), id));
}

// ---------- RECIPES ----------
export async function fetchRecipes(): Promise<RecipeDoc[]> {
  // Dokumen recipes disimpan per productId sebagai ID dokumen
  const snap = await getDocs(collection(db, "recipes"));
  return snap.docs.map((d) => d.data() as RecipeDoc);
}

export async function setRecipeForProduct(productId: number, items: RecipeItem[]) {
  await setDoc(doc(collection(db, "recipes"), String(productId)), { productId, items });
}

export async function getRecipe(productId: number): Promise<RecipeDoc | null> {
  const ref = doc(collection(db, "recipes"), String(productId));
  const s = await getDoc(ref);
  return s.exists() ? (s.data() as RecipeDoc) : null;
}

// ---------- STOCK DEDUCT (konsumsi saat transaksi) ----------
type DeductCartItem = { productId: number; name: string; qty: number };

export async function deductStockForSale(opts: {
  saleId: string;
  items: DeductCartItem[];
  recipes: RecipeDoc[];
  ingredientsMap?: Record<string, Ingredient>;
}) {
  // Akumulasi penggunaan bahan
  const totalUse: Record<string, { qty: number; unit: string }> = {};
  for (const it of opts.items) {
    const recipe = opts.recipes.find((r) => r.productId === it.productId);
    if (!recipe) continue; // produk tanpa resep → tidak konsumsi
    for (const r of recipe.items) {
      const prevQty = totalUse[r.ingredientId]?.qty || 0;
      const newQty = prevQty + (Number(r.qty) || 0) * (Number(it.qty) || 0);
      totalUse[r.ingredientId] = {
        qty: newQty,
        unit: opts.ingredientsMap?.[r.ingredientId]?.unit || "",
      };
    }
  }

  // Siapkan batch update
  const batch = writeBatch(db);

  // Kurangi stok per ingredient
  for (const ingId of Object.keys(totalUse)) {
    const ref = doc(collection(db, "ingredients"), ingId);
    const prev = opts.ingredientsMap?.[ingId];
    const newStock = Math.max(0, (prev?.stock || 0) - totalUse[ingId].qty); // floor ke 0 (aman sebelum opname)
    batch.set(ref, { stock: newStock }, { merge: true });
  }

  // Tulis log konsumsi
  const logRef = doc(collection(db, "stock_logs"));
  batch.set(logRef, {
    ts: serverTimestamp(),
    type: "consume",
    refId: opts.saleId,
    lines: Object.entries(totalUse).map(([ingredientId, v]) => ({
      ingredientId,
      qty: v.qty,
      unit: v.unit,
    })),
  });

  await batch.commit();
  return totalUse;
}

// ---------- STOCK ADJUST (opname/penyesuaian) ----------
export async function adjustStock(adjs: { ingredientId: string; newStock: number; note?: string }[]) {
  const batch = writeBatch(db);
  const lines: any[] = [];

  for (const a of adjs) {
    const ref = doc(collection(db, "ingredients"), a.ingredientId);
    batch.set(ref, { stock: Number(a.newStock) || 0 }, { merge: true });
    lines.push({
      ingredientId: a.ingredientId,
      newStock: Number(a.newStock) || 0,
      note: a.note || "stock opname",
    });
  }

  // log penyesuaian
  const logRef = doc(collection(db, "stock_logs"));
  batch.set(logRef, {
    ts: serverTimestamp(),
    type: "adjust",
    lines,
  });

  await batch.commit();
}
