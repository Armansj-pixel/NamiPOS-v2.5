// src/App.tsx — NamiPOS V2.4.6 (RESTORE + INVENTORY + RECIPES INTEGRATION)
// Fitur:
// - Login
// - Dashboard (ringkas)
// - Kasir (tambah/kurang qty, subtotal, simpan ke 'sales', cetak 80mm)
// - Riwayat (paginasi sederhana)
// - Produk (CRUD: nama, harga, kategori, gambar/url, aktif/nonaktif, hapus)
// - Inventori (CRUD: nama, satuan, stok, min stock, hapus)
// - Resep (per-produk: daftar bahan & takaran; integrasi ke POS -> cek & potong stok otomatis)
// - Peringatan stok menipis
//
// Koleksi Firestore yang dipakai:
// products: { name, price, category, imageUrl, active }
// ingredients: { name, unit, stock, min }
// recipes: docId = productId, { items: [{ ingredientId, qty }] }
// sales: { items, total, cashier, time }
// shifts: { user, openAt, closeAt, isOpen }
// orders: { name, phone, items, status, time }
//
// Catatan:
// - Tanpa komponen UI eksternal. Tailwind saja.
// - TypeScript aman (tidak akses .value di HTMLElement langsung).

import React, { useEffect, useMemo, useState } from "react";
import {
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  User,
} from "firebase/auth";
import {
  collection,
  addDoc,
  getDocs,
  getFirestore,
  query,
  orderBy,
  updateDoc,
  deleteDoc,
  doc,
  setDoc,
  getDoc,
  serverTimestamp,
  onSnapshot,
  limit,
  startAfter,
  Timestamp,
} from "firebase/firestore";
import app from "./lib/firebase";

// ===== Firebase =====
const auth = getAuth(app);
const db = getFirestore(app);

// ===== Utils =====
const IDR = (n: number) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(n || 0);

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function cls(...a: (string | false | undefined)[]) {
  return a.filter(Boolean).join(" ");
}

// ===== Types =====
type Page =
  | "login"
  | "dashboard"
  | "kasir"
  | "history"
  | "orders"
  | "public"
  | "products"
  | "inventory";

type Product = {
  id: string;
  name: string;
  price: number;
  category?: string;
  imageUrl?: string;
  active?: boolean;
};

type CartItem = {
  id: string; // productId
  name: string;
  price: number;
  qty: number;
};

type ShiftLite = {
  id: string;
  user: string;
} | null;

type SaleRow = {
  id: string;
  cashier: string;
  total: number;
  time?: Timestamp | null;
  items: { name: string; qty: number; price: number }[];
};

type Ingredient = {
  id: string;
  name: string;
  unit: string;
  stock: number;
  min?: number;
};

type RecipeItem = {
  ingredientId: string;
  qty: number; // takaran per 1 porsi produk
};

type RecipeDoc = {
  items: RecipeItem[];
};

// ===== App =====
export default function App() {
  // Auth
  const [user, setUser] = useState<User | null>(null);
  const [page, setPage] = useState<Page>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // Kasir / Master
  const [products, setProducts] = useState<Product[]>([]);
  const [queryText, setQueryText] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [shift, setShift] = useState<ShiftLite>(null);
  const subtotal = useMemo(
    () => cart.reduce((s, i) => s + (Number(i.price) || 0) * (Number(i.qty) || 0), 0),
    [cart]
  );

  // History
  const [historyRows, setHistoryRows] = useState<SaleRow[]>([]);
  const [histCursor, setHistCursor] = useState<any>(null);
  const [histLoading, setHistLoading] = useState(false);

  // Orders
  const [orders, setOrders] = useState<any[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);

  // Inventory & Recipes
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [recipes, setRecipes] = useState<Record<string, RecipeItem[]>>({}); // key: productId -> items[]

  // UI states for CRUD
  // Products form
  const [pForm, setPForm] = useState<Partial<Product>>({
    id: "",
    name: "",
    price: 0,
    category: "Signature",
    imageUrl: "",
    active: true,
  });
  const [pEditingId, setPEditingId] = useState<string | null>(null);

  // Ingredients form
  const [iForm, setIForm] = useState<Partial<Ingredient>>({
    id: "",
    name: "",
    unit: "pcs",
    stock: 0,
    min: 0,
  });
  const [iEditingId, setIEditingId] = useState<string | null>(null);

  // Recipe form per product (UI sederhana)
  const [recipeEditFor, setRecipeEditFor] = useState<string | null>(null); // productId
  const [rNewIngId, setRNewIngId] = useState<string>("");
  const [rNewQty, setRNewQty] = useState<number>(0);

  // Low stock
  const lowStockList = useMemo(
    () => ingredients.filter((g) => (g.min ?? 0) > 0 && g.stock <= (g.min ?? 0)),
    [ingredients]
  );

  // ===== Auth watch =====
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setPage(u ? "kasir" : "login");
    });
    return () => unsub();
  }, []);

  // ===== Live products, ingredients, recipes =====
  useEffect(() => {
    if (!user) return;
    const unsubP = onSnapshot(query(collection(db, "products")), (snap) => {
      const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as Product[];
      setProducts(rows.filter((p) => p.active !== false));
    });

    const unsubI = onSnapshot(query(collection(db, "ingredients")), (snap) => {
      const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as Ingredient[];
      setIngredients(rows);
    });

    const unsubR = onSnapshot(query(collection(db, "recipes")), (snap) => {
      const map: Record<string, RecipeItem[]> = {};
      snap.docs.forEach((d) => {
        const x = d.data() as RecipeDoc;
        map[d.id] = x?.items ?? [];
      });
      setRecipes(map);
    });

    return () => {
      unsubP();
      unsubI();
      unsubR();
    };
  }, [user]);

  // ===== Derived =====
  const filteredProducts = useMemo(() => {
    const q = queryText.toLowerCase();
    return products.filter((p) => p.name?.toLowerCase().includes(q));
  }, [products, queryText]);

  // ===== Auth handlers =====
  const handleLogin = async () => {
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch (err: any) {
      alert("Login gagal: " + (err?.message || err));
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
    setUser(null);
    setPage("login");
  };

  // ===== Shift =====
  const openShift = async () => {
    if (!user?.email) return alert("Belum login");
    const ref = await addDoc(collection(db, "shifts"), {
      user: user.email,
      openAt: serverTimestamp(),
      isOpen: true,
    });
    setShift({ id: ref.id, user: user.email });
  };

  const closeShift = async () => {
    if (!shift) return alert("Belum ada shift aktif");
    await updateDoc(doc(db, "shifts", shift.id), {
      isOpen: false,
      closeAt: serverTimestamp(),
    });
    setShift(null);
    alert("Shift ditutup");
  };

  // ===== POS =====
  const addToCart = (p: Product) => {
    setCart((prev) => {
      const idx = prev.findIndex((i) => i.id === p.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], qty: next[idx].qty + 1 };
        return next;
      }
      return [...prev, { id: p.id, name: p.name, price: p.price, qty: 1 }];
    });
  };
  const incQty = (id: string) =>
    setCart((prev) => prev.map((i) => (i.id === id ? { ...i, qty: i.qty + 1 } : i)));
  const decQty = (id: string) =>
    setCart((prev) =>
      prev.map((i) => (i.id === id ? { ...i, qty: Math.max(1, i.qty - 1) } : i))
    );
  const rmItem = (id: string) => setCart((prev) => prev.filter((i) => i.id !== id));
  const clearCart = () => setCart([]);

  // Cek stok sebelum simpan sale
  function checkStockForCart(): { ok: boolean; short: { ingredient: Ingredient; need: number }[] } {
    const needMap = new Map<string, number>(); // ingredientId -> total needed
    for (const ci of cart) {
      const r = recipes[ci.id] || [];
      for (const rit of r) {
        const need = (needMap.get(rit.ingredientId) || 0) + rit.qty * ci.qty;
        needMap.set(rit.ingredientId, need);
      }
    }
    const short: { ingredient: Ingredient; need: number }[] = [];
    for (const [ingId, need] of needMap.entries()) {
      const ing = ingredients.find((g) => g.id === ingId);
      if (!ing) continue;
      if (ing.stock < need) {
        short.push({ ingredient: ing, need });
      }
    }
    return { ok: short.length === 0, short };
  }

  const handleSaveSale = async () => {
    if (!user?.email) return alert("Belum login");
    if (!cart.length) return alert("Keranjang kosong");

    // 1) cek stok berdasarkan resep
    const { ok, short } = checkStockForCart();
    if (!ok) {
      const msg =
        "Stok bahan tidak mencukupi:\n" +
        short.map((s) => `- ${s.ingredient.name}: butuh ${s.need} ${s.ingredient.unit}, tersedia ${s.ingredient.stock}`).join("\n");
      alert(msg);
      return;
    }

    try {
      // 2) simpan transaksi
      const payload = {
        items: cart.map((c) => ({ name: c.name, price: c.price, qty: c.qty })),
        total: subtotal,
        cashier: user.email,
        time: serverTimestamp(),
      };
      const ref = await addDoc(collection(db, "sales"), payload);

      // 3) potong stok per ingredient sesuai total pemakaian
      //    hitung aggregate pemakaian ingredient
      const needMap = new Map<string, number>();
      for (const ci of cart) {
        const r = recipes[ci.id] || [];
        for (const rit of r) {
          const need = (needMap.get(rit.ingredientId) || 0) + rit.qty * ci.qty;
          needMap.set(rit.ingredientId, need);
        }
      }
      // apply update
      for (const [ingId, need] of needMap.entries()) {
        const ing = ingredients.find((g) => g.id === ingId);
        if (!ing) continue;
        const newStock = Math.max(0, (ing.stock || 0) - need);
        await updateDoc(doc(db, "ingredients", ingId), { stock: newStock });
      }

      // 4) print & clear
      printReceipt(payload, ref.id);
      setCart([]);
      alert("Transaksi tersimpan #" + ref.id);
    } catch (err: any) {
      alert("Gagal simpan transaksi: " + (err?.message || err));
    }
  };

  // Print 80mm
  function printReceipt(
    rec: {
      items: { name: string; price: number; qty: number }[];
      total: number;
      cashier: string;
      time?: any;
    },
    saleId?: string
  ) {
    const itemsHtml = rec.items
      .map(
        (i) =>
          `<tr><td>${i.name}</td><td style='text-align:center'>${i.qty}x</td><td style='text-align:right'>${IDR(
            i.price * i.qty
          )}</td></tr>`
      )
      .join("");
    const w = window.open("", "_blank", "width=380,height=600");
    if (!w) return;
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Struk</title>
<style>
body{font-family:ui-monospace,Consolas,monospace}
.wrap{width:300px;margin:0 auto}
h2{margin:6px 0;text-align:center}
td{padding:4px 0;border-bottom:1px dashed #ccc;font-size:12px}
.tot td{border-bottom:none;font-weight:700}
.meta{font-size:12px;text-align:center;opacity:.8}
img{display:block;margin:0 auto 6px;height:42px}
</style></head><body>
<div class="wrap">
  <img src="/logo-pos.png" onerror="this.style.display='none'"/>
  <h2>NamiPOS — Outlet</h2>
  <div class="meta">${saleId || "DRAFT"}<br/>${new Date().toLocaleString("id-ID",{hour12:false})}</div>
  <hr/>
  <table style="width:100%;border-collapse:collapse">
    ${itemsHtml}
    <tr class="tot"><td>Total</td><td></td><td style="text-align:right">${IDR(rec.total)}</td></tr>
    <tr><td>Kasir</td><td></td><td style='text-align:right'>${rec.cashier}</td></tr>
  </table>
  <p class="meta">Terima kasih!</p>
</div>
<script>window.print();</script>
</body></html>`;
    w.document.write(html);
    w.document.close();
  }

  // ===== History =====
  async function loadHistory(reset = true) {
    if (!user) return;
    setHistLoading(true);
    try {
      const cons: any[] = [orderBy("time", "desc"), limit(30)];
      if (!reset && histCursor) cons.push(startAfter(histCursor));
      const snap = await getDocs(query(collection(db, "sales"), ...cons));
      const rows: SaleRow[] = snap.docs.map((d) => {
        const x = d.data() as any;
        return {
          id: d.id,
          cashier: x.cashier || "-",
          total: x.total || 0,
          time: x.time || null,
          items: (x.items || []).map((it: any) => ({
            name: it.name,
            qty: it.qty,
            price: it.price,
          })),
        };
      });
      setHistoryRows((prev) => (reset ? rows : [...prev, ...rows]));
      setHistCursor(snap.docs.length ? snap.docs[snap.docs.length - 1] : null);
    } finally {
      setHistLoading(false);
    }
  }

  // ===== Orders Inbox =====
  const loadOrders = async () => {
    setOrdersLoading(true);
    try {
      const snap = await getDocs(
        query(collection(db, "orders"), orderBy("time", "desc"))
      );
      setOrders(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
    } finally {
      setOrdersLoading(false);
    }
  };

  useEffect(() => {
    if (page === "orders") loadOrders();
  }, [page]);

  const createPublicOrder = async (name: string, phone: string, items: any[]) => {
    await addDoc(collection(db, "orders"), {
      name,
      phone,
      items,
      time: serverTimestamp(),
      status: "pending",
    });
    alert("Pesanan berhasil dikirim!");
  };

  // ===== Products CRUD =====
  function startNewProduct() {
    setPEditingId(null);
    setPForm({
      id: "",
      name: "",
      price: 0,
      category: "Signature",
      imageUrl: "",
      active: true,
    });
  }
  function startEditProduct(p: Product) {
    setPEditingId(p.id);
    setPForm({ ...p });
  }
  async function saveProduct() {
    const id = pEditingId || uid();
    const data: Product = {
      id,
      name: (pForm.name || "").trim() || "Produk",
      price: Number(pForm.price) || 0,
      category: (pForm.category || "Signature").trim(),
      imageUrl: (pForm.imageUrl || "").trim(),
      active: pForm.active !== false,
    };
    await setDoc(doc(db, "products", id), data, { merge: true });
    setPEditingId(null);
    startNewProduct();
  }
  async function toggleActiveProduct(p: Product) {
    await updateDoc(doc(db, "products", p.id), { active: !(p.active !== false) });
  }
  async function hardDeleteProduct(p: Product) {
    if (!confirm(`Hapus permanen produk "${p.name}"?`)) return;
    await deleteDoc(doc(db, "products", p.id));
    // opsional: hapus resepnya juga
    await deleteDoc(doc(db, "recipes", p.id)).catch(() => {});
  }

  // ===== Ingredients CRUD =====
  function startNewIng() {
    setIEditingId(null);
    setIForm({ id: "", name: "", unit: "pcs", stock: 0, min: 0 });
  }
  function startEditIng(i: Ingredient) {
    setIEditingId(i.id);
    setIForm({ ...i });
  }
  async function saveIngredient() {
    const id = iEditingId || uid();
    const data: Ingredient = {
      id,
      name: (iForm.name || "").trim() || "Bahan",
      unit: (iForm.unit || "pcs").trim(),
      stock: Number(iForm.stock) || 0,
      min: Number(iForm.min) || 0,
    };
    await setDoc(doc(db, "ingredients", id), data, { merge: true });
    setIEditingId(null);
    startNewIng();
  }
  async function deleteIngredientRow(i: Ingredient) {
    if (!confirm(`Hapus bahan "${i.name}"?`)) return;
    await deleteDoc(doc(db, "ingredients", i.id));
  }

  // ===== Recipes CRUD =====
  function openRecipeEditor(productId: string) {
    setRecipeEditFor(productId);
    setRNewIngId("");
    setRNewQty(0);
  }
  async function addRecipeItem() {
    const pid = recipeEditFor!;
    if (!pid) return;
    if (!rNewIngId || rNewQty <= 0) {
      alert("Pilih bahan & qty > 0");
      return;
    }
    const cur = recipes[pid] || [];
    const existIdx = cur.findIndex((r) => r.ingredientId === rNewIngId);
    let next: RecipeItem[];
    if (existIdx >= 0) {
      next = [...cur];
      next[existIdx] = { ...next[existIdx], qty: rNewQty };
    } else {
      next = [...cur, { ingredientId: rNewIngId, qty: rNewQty }];
    }
    await setDoc(doc(db, "recipes", pid), { items: next }, { merge: true });
    setRNewIngId("");
    setRNewQty(0);
  }
  async function removeRecipeItem(ingredientId: string) {
    const pid = recipeEditFor!;
    const cur = recipes[pid] || [];
    const next = cur.filter((r) => r.ingredientId !== ingredientId);
    await setDoc(doc(db, "recipes", pid), { items: next }, { merge: true });
  }

  // ===== UI Shell =====
  const Shell: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <div className="min-h-screen bg-neutral-50">
      <header className="sticky top-0 z-30 bg-white/80 backdrop-blur border-b">
        <div className="max-w-7xl mx-auto px-3 md:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img
              src="/logo-pos.png"
              alt="NamiPOS"
              className="h-7"
              onError={(e: any) => (e.currentTarget.style.display = "none")}
            />
            <div>
              <div className="font-bold">NamiPOS — Outlet</div>
              <div className="text-[11px] text-neutral-500">
                Masuk: {user?.email || "-"}
              </div>
            </div>
          </div>
          <nav className="flex gap-2">
            {(["dashboard", "kasir", "history", "products", "inventory", "orders", "public"] as Page[]).map(
              (t) => (
                <button
                  key={t}
                  onClick={() => {
                    setPage(t);
                    if (t === "history") loadHistory(true);
                  }}
                  className={cls(
                    "px-3 py-1.5 rounded-lg border",
                    page === t ? "bg-emerald-50 border-emerald-300" : "bg-white"
                  )}
                >
                  {t === "dashboard"
                    ? "Dashboard"
                    : t === "kasir"
                    ? "Kasir"
                    : t === "history"
                    ? "Riwayat"
                    : t === "products"
                    ? "Produk"
                    : t === "inventory"
                    ? "Inventori"
                    : t === "orders"
                    ? "Orders"
                    : "Order Publik"}
                </button>
              )
            )}
            <button
              onClick={handleLogout}
              className="px-3 py-1.5 rounded-lg border bg-rose-50 text-rose-700"
            >
              Keluar
            </button>
          </nav>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-3 md:px-6 py-4">{children}</main>
    </div>
  );

  // ===== Pages =====
  // LOGIN
  if (page === "login") {
    return (
      <div className="min-h-screen bg-neutral-50 flex items-center justify-center p-4">
        <div className="w-full max-w-sm bg-white border rounded-2xl shadow-sm p-6">
          <div className="flex items-center gap-3 mb-4 justify-center">
            <img
              src="/logo-pos.png"
              alt="NamiPOS"
              className="h-9"
              onError={(e: any) => (e.currentTarget.style.display = "none")}
            />
            <h1 className="text-xl font-bold">NamiPOS</h1>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleLogin();
            }}
            className="space-y-3"
          >
            <input
              className="w-full border rounded-lg p-3"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <input
              className="w-full border rounded-lg p-3"
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button className="w-full bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg p-3">
              Masuk
            </button>
          </form>
          <p className="text-xs text-neutral-500 mt-3 text-center">
            Masuk untuk mengelola POS
          </p>
        </div>
      </div>
    );
  }

  // DASHBOARD
  if (page === "dashboard") {
    return (
      <Shell>
        <section className="bg-white rounded-2xl shadow-sm border p-4">
          <h2 className="font-bold text-lg mb-2">Dashboard</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
            <KPI title="Produk Aktif" value={String(products.length)} />
            <KPI title="Item di Keranjang" value={String(cart.length)} />
            <KPI title="Subtotal Keranjang" value={IDR(subtotal)} />
            <KPI title="Low Stock" value={String(lowStockList.length)} />
          </div>

          {lowStockList.length > 0 && (
            <div className="mt-4 border rounded-2xl p-3 bg-amber-50">
              <div className="font-semibold mb-1">Peringatan Stok Menipis</div>
              <ul className="text-sm list-disc ml-4">
                {lowStockList.map((g) => (
                  <li key={g.id}>
                    {g.name} • stok {g.stock} {g.unit} (min {g.min})
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </Shell>
    );
  }

  // KASIR
  if (page === "kasir") {
    return (
      <Shell>
        <section className="bg-white rounded-2xl shadow-sm border p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold text-lg">Kasir</h2>
            <button
              onClick={shift ? closeShift : openShift}
              className={cls(
                "px-3 py-2 rounded-lg text-white",
                shift ? "bg-rose-600" : "bg-emerald-600"
              )}
            >
              {shift ? "Tutup Shift" : "Buka Shift"}
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
            {/* Produk */}
            <div className="md:col-span-7">
              <div className="mb-3">
                <input
                  className="w-full border rounded-lg px-3 py-2"
                  placeholder="Cari menu…"
                  value={queryText}
                  onChange={(e) => setQueryText(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {filteredProducts.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => addToCart(p)}
                    className="text-left rounded-2xl border bg-white p-3 hover:shadow"
                  >
                    <div className="h-20 w-full rounded-xl bg-gradient-to-br from-emerald-50 to-emerald-100 mb-2 overflow-hidden">
                      {p.imageUrl ? (
                        <img
                          src={p.imageUrl}
                          className="h-full w-full object-cover"
                          onError={(e: any) => (e.currentTarget.style.display = "none")}
                        />
                      ) : null}
                    </div>
                    <div className="font-medium leading-tight">{p.name}</div>
                    <div className="text-xs text-neutral-500">{p.category || "Signature"}</div>
                    <div className="mt-1 font-semibold">{IDR(Number(p.price || 0))}</div>
                  </button>
                ))}
                {filteredProducts.length === 0 && (
                  <div className="text-sm text-neutral-500">Produk tidak ditemukan.</div>
                )}
              </div>
            </div>

            {/* Keranjang */}
            <div className="md:col-span-5">
              <div className="rounded-2xl border p-3">
                <h3 className="font-semibold mb-2">Keranjang</h3>
                {cart.length === 0 ? (
                  <div className="text-sm text-neutral-500">Belum ada item.</div>
                ) : (
                  <>
                    <div className="space-y-2">
                      {cart.map((i) => (
                        <div
                          key={i.id}
                          className="grid grid-cols-12 items-center gap-2 border rounded-xl p-2"
                        >
                          <div className="col-span-6">
                            <div className="font-medium leading-tight">{i.name}</div>
                            <div className="text-xs text-neutral-500">{IDR(i.price)}</div>
                          </div>
                          <div className="col-span-4 flex items-center justify-end gap-2">
                            <button className="px-2 py-1 border rounded" onClick={() => decQty(i.id)}>
                              -
                            </button>
                            <div className="w-8 text-center font-medium">{i.qty}</div>
                            <button className="px-2 py-1 border rounded" onClick={() => incQty(i.id)}>
                              +
                            </button>
                          </div>
                          <div className="col-span-2 flex justify-end">
                            <button className="px-2 py-1 rounded border" onClick={() => rmItem(i.id)}>
                              x
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="border-t mt-3 pt-3 flex items-center justify-between text-lg font-semibold">
                      <span>Total</span>
                      <span>{IDR(subtotal)}</span>
                    </div>
                    <div className="mt-3 flex gap-2 justify-end">
                      <button className="px-3 py-2 rounded-lg border" onClick={clearCart}>
                        Bersihkan
                      </button>
                      <button
                        onClick={handleSaveSale}
                        className="px-3 py-2 rounded-lg bg-emerald-600 text-white"
                      >
                        Simpan & Cetak
                      </button>
                    </div>
                  </>
                )}
              </div>

              {/* Warning stok menipis */}
              {lowStockList.length > 0 && (
                <div className="mt-3 border rounded-2xl p-3 bg-amber-50">
                  <div className="font-semibold mb-1">Peringatan Stok Menipis</div>
                  <ul className="text-sm list-disc ml-4">
                    {lowStockList.map((g) => (
                      <li key={g.id}>
                        {g.name} • stok {g.stock} {g.unit} (min {g.min})
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </section>
      </Shell>
    );
  }

  // HISTORY
  if (page === "history") {
    return (
      <Shell>
        <section className="bg-white rounded-2xl shadow-sm border p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-bold">Riwayat Transaksi</h2>
            <div className="flex gap-2">
              <button
                className="px-3 py-2 rounded-lg border"
                onClick={() => loadHistory(true)}
                disabled={histLoading}
              >
                {histLoading ? "Memuat…" : "Muat Ulang"}
              </button>
              <button
                className="px-3 py-2 rounded-lg border"
                onClick={() => loadHistory(false)}
                disabled={histLoading || !histCursor}
              >
                {histLoading ? "Memuat…" : "Muat Lagi"}
              </button>
            </div>
          </div>
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b">
                  <th className="py-2">Waktu</th>
                  <th>Kasir</th>
                  <th>Item</th>
                  <th className="text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {historyRows.map((s) => (
                  <tr key={s.id} className="border-b hover:bg-emerald-50/40">
                    <td className="py-2">
                      {s.time
                        ? new Date(s.time.toDate()).toLocaleString("id-ID", {
                            hour12: false,
                          })
                        : "-"}
                    </td>
                    <td>{s.cashier}</td>
                    <td className="truncate">
                      {s.items.map((i) => `${i.name}x${i.qty}`).join(", ")}
                    </td>
                    <td className="text-right font-medium">{IDR(s.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!historyRows.length && !histLoading && (
              <div className="text-sm text-neutral-500">Belum ada transaksi.</div>
            )}
          </div>
        </section>
      </Shell>
    );
  }

  // PRODUCTS (CRUD + edit resep)
  if (page === "products") {
    return (
      <Shell>
        <section className="bg-white rounded-2xl shadow-sm border p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-bold">Manajemen Produk</h2>
            <button onClick={startNewProduct} className="px-3 py-2 rounded-lg border">
              + Produk Baru
            </button>
          </div>

          {/* Form */}
          <div className="border rounded-2xl p-3 mb-4 bg-neutral-50">
            <div className="grid md:grid-cols-2 gap-2">
              <label className="text-sm">
                Nama
                <input
                  className="w-full border rounded-lg px-3 py-2"
                  value={pForm.name || ""}
                  onChange={(e) => setPForm((s) => ({ ...s, name: e.target.value }))}
                />
              </label>
              <label className="text-sm">
                Harga
                <input
                  type="number"
                  className="w-full border rounded-lg px-3 py-2"
                  value={Number(pForm.price) || 0}
                  onChange={(e) => setPForm((s) => ({ ...s, price: Number(e.target.value) || 0 }))}
                />
              </label>
              <label className="text-sm">
                Kategori
                <input
                  className="w-full border rounded-lg px-3 py-2"
                  value={pForm.category || ""}
                  onChange={(e) => setPForm((s) => ({ ...s, category: e.target.value }))}
                />
              </label>
              <label className="text-sm">
                Gambar (URL)
                <input
                  className="w-full border rounded-lg px-3 py-2"
                  value={pForm.imageUrl || ""}
                  onChange={(e) => setPForm((s) => ({ ...s, imageUrl: e.target.value }))}
                />
              </label>
              <label className="text-sm flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={pForm.active !== false}
                  onChange={(e) => setPForm((s) => ({ ...s, active: e.target.checked }))}
                />
                Aktif
              </label>
            </div>
            <div className="mt-3 flex gap-2">
              <button className="px-3 py-2 rounded-lg bg-emerald-600 text-white" onClick={saveProduct}>
                {pEditingId ? "Simpan Perubahan" : "Simpan Produk"}
              </button>
              <button className="px-3 py-2 rounded-lg border" onClick={startNewProduct}>
                Reset Form
              </button>
            </div>
          </div>

          {/* Tabel produk */}
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b">
                  <th className="py-2">Nama</th>
                  <th>Kategori</th>
                  <th>Harga</th>
                  <th>Aktif</th>
                  <th>Resep</th>
                  <th className="text-right">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {products.map((p) => (
                  <tr key={p.id} className="border-b">
                    <td className="py-2">
                      <div className="font-medium">{p.name}</div>
                      <div className="text-[11px] text-neutral-500 break-all">
                        {p.imageUrl || "-"}
                      </div>
                    </td>
                    <td>{p.category || "-"}</td>
                    <td>{IDR(Number(p.price || 0))}</td>
                    <td>{p.active !== false ? "Ya" : "Tidak"}</td>
                    <td>
                      <button
                        className="px-2 py-1 rounded border"
                        onClick={() => openRecipeEditor(p.id)}
                      >
                        Edit Resep
                      </button>
                    </td>
                    <td className="text-right">
                      <button
                        className="px-2 py-1 rounded border mr-2"
                        onClick={() => startEditProduct(p)}
                      >
                        Edit
                      </button>
                      <button
                        className="px-2 py-1 rounded border mr-2"
                        onClick={() => toggleActiveProduct(p)}
                      >
                        {p.active !== false ? "Nonaktif" : "Aktifkan"}
                      </button>
                      <button
                        className="px-2 py-1 rounded border text-rose-600"
                        onClick={() => hardDeleteProduct(p)}
                      >
                        Hapus
                      </button>
                    </td>
                  </tr>
                ))}
                {products.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-3 text-neutral-500">
                      Belum ada produk.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Editor Resep */}
          {recipeEditFor && (
            <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setRecipeEditFor(null)}>
              <div className="bg-white rounded-2xl p-4 w-full max-w-xl" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-2">
                  <div className="font-semibold">Edit Resep — {products.find(p=>p.id===recipeEditFor)?.name || recipeEditFor}</div>
                  <button className="px-2 py-1 rounded border" onClick={() => setRecipeEditFor(null)}>Tutup</button>
                </div>

                <div className="mb-3">
                  <div className="text-sm font-medium mb-1">Takaran per 1 porsi:</div>
                  <table className="w-full text-sm border rounded">
                    <thead>
                      <tr className="text-left border-b bg-neutral-50">
                        <th className="py-2 px-2">Bahan</th>
                        <th className="px-2">Qty</th>
                        <th className="px-2">Satuan</th>
                        <th className="px-2 text-right">Aksi</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(recipes[recipeEditFor] || []).map((ri) => {
                        const ing = ingredients.find((g) => g.id === ri.ingredientId);
                        return (
                          <tr key={ri.ingredientId} className="border-b">
                            <td className="py-2 px-2">{ing?.name || ri.ingredientId}</td>
                            <td className="px-2">{ri.qty}</td>
                            <td className="px-2">{ ing?.unit || "-" }</td>
                            <td className="px-2 text-right">
                              <button className="px-2 py-1 rounded border text-rose-600" onClick={() => removeRecipeItem(ri.ingredientId)}>
                                Hapus
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                      {(recipes[recipeEditFor] || []).length === 0 && (
                        <tr>
                          <td colSpan={4} className="py-2 px-2 text-neutral-500">
                            Belum ada bahan di resep ini.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                  <select
                    className="border rounded-lg px-3 py-2"
                    value={rNewIngId}
                    onChange={(e) => setRNewIngId(e.target.value)}
                  >
                    <option value="">Pilih bahan…</option>
                    {ingredients.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name} ({g.unit})
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    className="border rounded-lg px-3 py-2"
                    placeholder="Qty per porsi"
                    value={Number(rNewQty) || 0}
                    onChange={(e) => setRNewQty(Number(e.target.value) || 0)}
                  />
                  <button className="px-3 py-2 rounded-lg bg-emerald-600 text-white" onClick={addRecipeItem}>
                    Tambah ke Resep
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>
      </Shell>
    );
  }

  // INVENTORY
  if (page === "inventory") {
    return (
      <Shell>
        <section className="bg-white rounded-2xl shadow-sm border p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-bold">Inventori</h2>
            <button onClick={startNewIng} className="px-3 py-2 rounded-lg border">
              + Bahan Baru
            </button>
          </div>

          {/* Form */}
          <div className="border rounded-2xl p-3 mb-4 bg-neutral-50">
            <div className="grid md:grid-cols-4 gap-2">
              <label className="text-sm">
                Nama
                <input
                  className="w-full border rounded-lg px-3 py-2"
                  value={iForm.name || ""}
                  onChange={(e) => setIForm((s) => ({ ...s, name: e.target.value }))}
                />
              </label>
              <label className="text-sm">
                Satuan
                <input
                  className="w-full border rounded-lg px-3 py-2"
                  value={iForm.unit || "pcs"}
                  onChange={(e) => setIForm((s) => ({ ...s, unit: e.target.value }))}
                />
              </label>
              <label className="text-sm">
                Stok
                <input
                  type="number"
                  className="w-full border rounded-lg px-3 py-2"
                  value={Number(iForm.stock) || 0}
                  onChange={(e) => setIForm((s) => ({ ...s, stock: Number(e.target.value) || 0 }))}
                />
              </label>
              <label className="text-sm">
                Minimal
                <input
                  type="number"
                  className="w-full border rounded-lg px-3 py-2"
                  value={Number(iForm.min) || 0}
                  onChange={(e) => setIForm((s) => ({ ...s, min: Number(e.target.value) || 0 }))}
                />
              </label>
            </div>
            <div className="mt-3 flex gap-2">
              <button className="px-3 py-2 rounded-lg bg-emerald-600 text-white" onClick={saveIngredient}>
                {iEditingId ? "Simpan Perubahan" : "Simpan Bahan"}
              </button>
              <button className="px-3 py-2 rounded-lg border" onClick={startNewIng}>
                Reset Form
              </button>
            </div>
          </div>

          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b">
                  <th className="py-2">Nama</th>
                  <th>Satuan</th>
                  <th>Stok</th>
                  <th>Min</th>
                  <th className="text-right">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {ingredients.map((i) => (
                  <tr key={i.id} className="border-b">
                    <td className="py-2">{i.name}</td>
                    <td>{i.unit}</td>
                    <td>{i.stock}</td>
                    <td>{i.min ?? 0}</td>
                    <td className="text-right">
                      <button className="px-2 py-1 rounded border mr-2" onClick={() => startEditIng(i)}>
                        Edit
                      </button>
                      <button className="px-2 py-1 rounded border text-rose-600" onClick={() => deleteIngredientRow(i)}>
                        Hapus
                      </button>
                    </td>
                  </tr>
                ))}
                {ingredients.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-3 text-neutral-500">
                      Belum ada data inventori.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </Shell>
    );
  }

  // ORDERS
  if (page === "orders") {
    return (
      <Shell>
        <section className="bg-white rounded-2xl shadow-sm border p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-bold">Daftar Order Masuk</h2>
            <button
              onClick={loadOrders}
              className="px-3 py-2 rounded-lg border"
              disabled={ordersLoading}
            >
              {ordersLoading ? "Memuat…" : "Muat Ulang"}
            </button>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
            {orders.map((o) => (
              <div key={o.id} className="border rounded-2xl p-3">
                <div className="font-semibold">
                  {o.name} ({o.phone})
                </div>
                <div className="text-xs text-neutral-500 mb-2">Status: {o.status}</div>
                <ul className="text-sm list-disc ml-4">
                  {o.items?.map((it: any, i: number) => (
                    <li key={i}>
                      {it.name} x{it.qty}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            {orders.length === 0 && !ordersLoading && (
              <div className="text-sm text-neutral-500">Belum ada pesanan.</div>
            )}
          </div>
        </section>
      </Shell>
    );
  }

  // PUBLIC ORDER
  if (page === "public") {
    return (
      <Shell>
        <section className="max-w-lg mx-auto bg-white rounded-2xl shadow-sm border p-4">
          <div className="flex items-center gap-2 mb-3">
            <img
              src="/logo-pos.png"
              className="h-7"
              onError={(e: any) => (e.currentTarget.style.display = "none")}
            />
            <div className="font-semibold">Order Online — Outlet</div>
          </div>

          <div className="space-y-2">
            <input id="field_name" className="border rounded-lg px-3 py-2 w-full" placeholder="Nama" />
            <input id="field_phone" className="border rounded-lg px-3 py-2 w-full" placeholder="No HP" />
            <textarea
              id="field_items"
              className="border rounded-lg px-3 py-2 w-full"
              placeholder="Pesanan (pisahkan koma, contoh: Matcha, Red Velvet, Brown Sugar)"
            />
          </div>

          <button
            onClick={() => {
              const name = (document.getElementById("field_name") as HTMLInputElement)?.value?.trim() || "";
              const phone = (document.getElementById("field_phone") as HTMLInputElement)?.value?.trim() || "";
              const itemsText = (document.getElementById("field_items") as HTMLTextAreaElement)?.value?.trim() || "";
              const items = itemsText ? itemsText.split(",").map((t) => ({ name: t.trim(), qty: 1 })) : [];
              if (!name || !phone || items.length === 0) {
                alert("Nama, No HP, dan daftar pesanan wajib diisi.");
                return;
              }
              createPublicOrder(name, phone, items);
              ["field_name", "field_phone", "field_items"].forEach((id) => {
                const el = document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | null;
                if (el) el.value = "";
              });
            }}
            className="mt-3 bg-emerald-600 text-white w-full py-2 rounded-lg"
          >
            Kirim Pesanan
          </button>
        </section>
      </Shell>
    );
  }

  return null;
}

// Small KPI
function KPI({ title, value }: { title: string; value: string }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border p-4">
      <div className="text-[12px] text-neutral-500">{title}</div>
      <div className="text-xl font-bold mt-1">{value}</div>
    </div>
  );
}