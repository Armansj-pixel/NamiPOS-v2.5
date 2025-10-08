// src/App.tsx — CHAFU MATCHA POS (FINAL, with Sales History & Auto-Print)
// -----------------------------------------------------------------------------
// Fitur: Login (Firebase Email/Password) • POS + QR E-Wallet • Save Sales
// • Auto Print Receipt • Inventory • Recipes (auto deduct) • Riwayat (live)
// -----------------------------------------------------------------------------
// Admin email (bisa lihat tab Produk/Inventory/Resep/Riwayat):
//  - antonius.arman123@gmail.com
//  - ayuismaalabibbah@gmail.com
// -----------------------------------------------------------------------------

import React, { useEffect, useState } from "react";
import {
  // Firebase helpers from your ./lib/firebase
  db,
  fetchProducts, upsertProduct, removeProduct,
  fetchIngredients, upsertIngredient, deleteIngredient,
  fetchRecipes, setRecipeForProduct, deductStockForSale, adjustStock,
  type Ingredient as InvIngredient, type RecipeDoc
} from "./lib/firebase";

import {
  addDoc, collection, serverTimestamp,
  query, orderBy, onSnapshot, doc, getDoc, setDoc
} from "firebase/firestore";

import {
  getAuth, onAuthStateChanged,
  signInWithEmailAndPassword, signOut, User
} from "firebase/auth";

import "./responsive.css";

const IDR = (n: number) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n || 0);

const ADMIN_EMAILS = [
  "antonius.arman123@gmail.com",
  "ayuismaalabibbah@gmail.com",
];

const PAY_METHODS = ["Tunai", "QRIS", "GoPay", "OVO", "DANA", "Transfer"] as const;
const walletQR: Record<string, string> = {
  QRIS: "/qr-qris.png",
  GoPay: "/qr-qris.png",
  OVO: "/qr-qris.png",
  DANA: "/qr-qris.png",
  Transfer: "/qr-qris.png",
};

type Product = { id: number; name: string; price: number; active?: boolean };
type CartItem = { id: string; productId: number; name: string; price: number; qty: number };
type PayMethod = (typeof PAY_METHODS)[number];

type SaleRow = {
  id?: string;
  time: string;
  timeMs: number;
  cashier: string;
  items: { name: string; qty: number; price: number }[];
  subtotal: number;
  discount: number;
  taxRate: number;
  serviceRate: number;
  taxValue: number;
  serviceValue: number;
  total: number;
  payMethod: string;
  cash: number;
  change: number;
  createdAt?: any;
};

// --- DEFAULT SEED PRODUCTS (1x saat kosong) ---
const DEFAULT_PRODUCTS: Product[] = [
  { id: 1, name: "Matcha OG", price: 15000, active: true },
  { id: 2, name: "Matcha Cloud", price: 18000, active: true },
  { id: 3, name: "Strawberry Cream Matcha", price: 17000, active: true },
  { id: 4, name: "Choco Matcha", price: 17000, active: true },
  { id: 5, name: "Matcha Cookies", price: 17000, active: true },
  { id: 6, name: "Honey Matcha", price: 18000, active: true },
  { id: 7, name: "Coconut Matcha", price: 18000, active: true },
  { id: 8, name: "Orange Matcha", price: 17000, active: true },
];

export default function App() {
  const auth = getAuth();
  const [user, setUser] = useState<User | null>(null);
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");

  const [tab, setTab] = useState<"pos" | "produk" | "inventori" | "resep" | "riwayat">("pos");

  const [products, setProducts] = useState<Product[]>([]);
  const [ingredients, setIngredients] = useState<InvIngredient[]>([]);
  const [recipes, setRecipes] = useState<RecipeDoc[]>([]);

  const [cart, setCart] = useState<CartItem[]>([]);
  const [payMethod, setPayMethod] = useState<PayMethod>("Tunai");
  const [cash, setCash] = useState<number>(0);

  const [sales, setSales] = useState<SaleRow[]>([]); // for Riwayat

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) await ensureUserProfile(u);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!user) return;
    loadData();

    // subscribe sales (riwayat) — hanya jika admin (supaya rules aman)
    if (isAdminEmail(user.email || "")) {
      const qSales = query(collection(db, "sales"), orderBy("createdAt", "desc"));
      const unsubSales = onSnapshot(qSales, (snap) => {
        const rows: SaleRow[] = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
        setSales(rows);
      });
      return () => unsubSales();
    }
  }, [user]);

  async function loadData() {
    // Products (seed 1x kalau kosong)
    let p = await fetchProducts();
    if (!p || p.length === 0) {
      await Promise.all(DEFAULT_PRODUCTS.map(upsertProduct));
      p = await fetchProducts();
    }
    setProducts(p);

    // Inventory & Recipes
    setIngredients(await fetchIngredients());
    setRecipes(await fetchRecipes());
  }

  const isAdmin = !!(user && isAdminEmail(user.email || ""));
  const subtotal = cart.reduce((a, b) => a + b.price * b.qty, 0);
  const change = payMethod === "Tunai" ? Math.max(0, cash - subtotal) : 0;

  function isAdminEmail(e: string) {
    return ADMIN_EMAILS.includes((e || "").toLowerCase());
  }

  async function ensureUserProfile(u: User) {
    // optional profile doc users/{uid} for future role-based rules
    const ref = doc(collection(db, "users"), u.uid);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      const email = (u.email || "").toLowerCase();
      const role = isAdminEmail(email) ? "owner" : "cashier";
      await setDoc(ref, { email, role, createdAt: Date.now() });
    }
  }

  function addToCart(p: Product) {
    setCart((c) => {
      const ex = c.find((x) => x.productId === p.id);
      if (ex) return c.map((x) => (x.productId === p.id ? { ...x, qty: x.qty + 1 } : x));
      return [...c, { id: Math.random().toString(36).slice(2, 9), productId: p.id, name: p.name, price: p.price, qty: 1 }];
    });
  }
  function inc(ci: CartItem) {
    setCart((c) => c.map((x) => (x.id === ci.id ? { ...x, qty: x.qty + 1 } : x)));
  }
  function dec(ci: CartItem) {
    setCart((c) => c.map((x) => (x.id === ci.id ? { ...x, qty: Math.max(1, x.qty - 1) } : x)));
  }
  function rm(ci: CartItem) {
    setCart((c) => c.filter((x) => x.id !== ci.id));
  }
  function clearCart() {
    setCart([]);
    setCash(0);
    setPayMethod("Tunai");
  }

  async function finalizeSale() {
    if (!cart.length) return alert("Keranjang kosong!");
    if (payMethod === "Tunai" && cash < subtotal) return alert("Uang kurang!");

    const rec: SaleRow = {
      time: new Date().toLocaleString("id-ID", { hour12: false }),
      timeMs: Date.now(),
      cashier: user?.email || "-",
      items: cart.map((i) => ({ name: i.name, qty: i.qty, price: i.price })),
      subtotal,
      discount: 0,
      taxRate: 0,
      serviceRate: 0,
      taxValue: 0,
      serviceValue: 0,
      total: subtotal,
      payMethod,
      cash,
      change,
      createdAt: serverTimestamp(),
    };

    // save to Firestore
    await addDoc(collection(db, "sales"), rec);

    // deduct stock by recipes
    await deductStockForSale({
      saleId: String(rec.timeMs),
      items: cart.map((c) => ({ productId: c.productId, name: c.name, qty: c.qty })),
      recipes,
      ingredientsMap: Object.fromEntries(ingredients.map((i) => [String(i.id), i])),
    });

    // print receipt
    printReceipt({
      ...rec,
      // ensure numbers
      subtotal,
      total: subtotal,
      cash,
      change,
    });

    clearCart();
    alert("Transaksi selesai ✅");
  }

  async function login() {
    try {
      await signInWithEmailAndPassword(auth, email, pass);
    } catch (e: any) {
      alert("Login gagal: " + e.message);
    }
  }

  async function logout() {
    await signOut(auth);
  }

  if (!user)
    return (
      <div style={{ padding: 40, textAlign: "center" }}>
        <h2>CHAFU MATCHA POS Login</h2>
        <div style={{ display: "inline-flex", flexDirection: "column", gap: 8 }}>
          <input placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} style={{ padding: 10, borderRadius: 8 }} />
          <input type="password" placeholder="Password" value={pass} onChange={(e) => setPass(e.target.value)} style={{ padding: 10, borderRadius: 8 }} />
          <button onClick={login} className="btn" style={{ background: "#2e7d32", color: "#fff" }}>Login</button>
        </div>
      </div>
    );

  return (
    <div className="app">
      <header className="header">
        <h1>CHAFU MATCHA POS</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => setTab("pos")} className="btn">POS</button>
          {isAdmin && (
            <>
              <button onClick={() => setTab("produk")} className="btn">Produk</button>
              <button onClick={() => setTab("inventori")} className="btn">Inventory</button>
              <button onClick={() => setTab("resep")} className="btn">Resep</button>
              <button onClick={() => setTab("riwayat")} className="btn">Riwayat</button>
            </>
          )}
          <button onClick={logout} className="btn" style={{ background: "#e53935", color: "#fff" }}>Logout</button>
        </div>
      </header>

      {/* POS */}
      {tab === "pos" && (
        <main className="pos-grid">
          {/* Menu */}
          <section className="section">
            <h2>Menu</h2>
            <div className="product-grid">
              {products.filter(p => p.active !== false).map((p) => (
                <button key={p.id} onClick={() => addToCart(p)} className="btn button-tap">
                  <div>{p.name}</div>
                  <small>{IDR(p.price)}</small>
                </button>
              ))}
            </div>
          </section>

          {/* Keranjang */}
          <section className="section">
            <h2>Keranjang</h2>
            {cart.length === 0 && <p>Belum ada item.</p>}
            {cart.map((c) => (
              <div key={c.id} style={{ display: "grid", gridTemplateColumns: "1fr auto auto auto", gap: 8, alignItems: "center", marginBottom: 6 }}>
                <div>{c.name} <small>x{c.qty}</small></div>
                <div>{IDR(c.price * c.qty)}</div>
                <div>
                  <button className="btn" onClick={() => dec(c)}>-</button>
                  <button className="btn" onClick={() => inc(c)}>+</button>
                </div>
                <button className="btn" onClick={() => rm(c)}>Hapus</button>
              </div>
            ))}
            <hr />
            <div style={{ display: "grid", gap: 8 }}>
              <div><b>Total:</b> {IDR(subtotal)}</div>
              <div>
                <label>Metode:</label>{" "}
                <select value={payMethod} onChange={(e) => setPayMethod(e.target.value as PayMethod)}>
                  {PAY_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              {payMethod === "Tunai" ? (
                <input type="number" placeholder="Uang diterima" value={cash} onChange={(e) => setCash(Number(e.target.value) || 0)} />
              ) : (
                <div style={{ textAlign: "center" }}>
                  <img className="qr-img" src={walletQR[payMethod]} alt="QR" />
                  <p>Scan untuk bayar ({payMethod})</p>
                </div>
              )}
              {payMethod === "Tunai" && <div><b>Kembali:</b> {IDR(change)}</div>}
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn" onClick={clearCart}>Bersihkan</button>
                <button className="btn" style={{ background: "#2e7d32", color: "#fff", flex: 1 }} onClick={finalizeSale}>
                  Selesaikan & Cetak
                </button>
              </div>
            </div>
          </section>
        </main>
      )}

      {/* Produk */}
      {tab === "produk" && isAdmin && (
        <main className="section">
          <h2>Manajemen Produk</h2>
          <ProductManager products={products} onChange={setProducts} />
        </main>
      )}

      {/* Inventory */}
      {tab === "inventori" && isAdmin && (
        <main className="section">
          <h2>Inventory Bahan</h2>
          <InventoryManager ingredients={ingredients} onChange={setIngredients} />
        </main>
      )}

      {/* Resep */}
      {tab === "resep" && isAdmin && (
        <main className="section">
          <h2>Resep Produk</h2>
          <RecipeManager
            products={products}
            ingredients={ingredients}
            recipes={recipes}
            onChange={setRecipes}
          />
        </main>
      )}

      {/* Riwayat */}
      {tab === "riwayat" && isAdmin && (
        <main className="section table-scroll">
          <h2>Riwayat Transaksi</h2>
          {sales.length === 0 ? (
            <p>Belum ada transaksi.</p>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>Waktu</th>
                  <th style={{ textAlign: "left" }}>Item</th>
                  <th style={{ textAlign: "right" }}>Total</th>
                  <th style={{ textAlign: "center" }}>Metode</th>
                </tr>
              </thead>
              <tbody>
                {sales.map((s) => (
                  <tr key={s.id}>
                    <td>{s.time}</td>
                    <td>{s.items.map((it) => `${it.name} x${it.qty}`).join(", ")}</td>
                    <td style={{ textAlign: "right" }}>{IDR(s.total)}</td>
                    <td style={{ textAlign: "center" }}>{s.payMethod}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </main>
      )}
    </div>
  );
}

/* ============================
   Sub Komponen: Product / Inventory / Recipe
   ============================ */

function ProductManager({ products, onChange }: { products: Product[]; onChange: (x: Product[]) => void }) {
  const [form, setForm] = useState<Product>({ id: 0, name: "", price: 0, active: true });

  async function save() {
    if (!form.name || !form.price) return alert("Nama dan harga wajib diisi!");
    await upsertProduct(form);
    onChange(await fetchProducts());
    setForm({ id: 0, name: "", price: 0, active: true });
  }

  async function del(p: Product) {
    if (!confirm(`Hapus ${p.name}?`)) return;
    await removeProduct(p.id);
    onChange(await fetchProducts());
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <input placeholder="ID (angka unik)" type="number" value={form.id || ""} onChange={(e) => setForm({ ...form, id: Number(e.target.value) })} />
        <input placeholder="Nama" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input placeholder="Harga" type="number" value={form.price || 0} onChange={(e) => setForm({ ...form, price: Number(e.target.value) })} />
        <button className="btn" onClick={save}>Simpan</button>
      </div>
      {products.map((p) => (
        <div key={p.id} style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
          <span>{p.name} — {IDR(p.price)}</span>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn" onClick={() => setForm(p)}>Edit</button>
            <button className="btn" onClick={() => del(p)}>Hapus</button>
          </div>
        </div>
      ))}
    </div>
  );
}

function InventoryManager({ ingredients, onChange }: { ingredients: InvIngredient[]; onChange: (x: InvIngredient[]) => void }) {
  const [form, setForm] = useState<InvIngredient>({ name: "", unit: "", stock: 0 });

  async function save() {
    if (!form.name) return alert("Nama bahan wajib diisi!");
    await upsertIngredient(form);
    onChange(await fetchIngredients());
    setForm({ name: "", unit: "", stock: 0 });
  }

  async function del(i: InvIngredient) {
    if (!confirm(`Hapus ${i.name}?`)) return;
    await deleteIngredient(i.id!);
    onChange(await fetchIngredients());
  }

  async function adjustItem(i: InvIngredient, delta: number) {
    const current = Number(i.stock || 0);
    const newStock = current + delta;
    await adjustStock([{ ingredientId: String(i.id), newStock, note: delta > 0 ? `+${delta}` : `${delta}` }]);
    onChange(await fetchIngredients());
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <input placeholder="Nama bahan" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input placeholder="Satuan (ml/gr/pcs)" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} />
        <input placeholder="Stok awal" type="number" value={form.stock || 0} onChange={(e) => setForm({ ...form, stock: Number(e.target.value) })} />
        <button className="btn" onClick={save}>Simpan</button>
      </div>

      {ingredients.map((i) => (
        <div key={i.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <span>{i.name} ({i.stock} {i.unit})</span>
          <div style={{ display: "flex", gap: 6 }}>
            <button className="btn" onClick={() => adjustItem(i, 1)}>+1</button>
            <button className="btn" onClick={() => adjustItem(i, -1)}>-1</button>
            <button className="btn" onClick={() => setForm(i)}>Edit</button>
            <button className="btn" onClick={() => del(i)}>Hapus</button>
          </div>
        </div>
      ))}
    </div>
  );
}

function RecipeManager({
  products,
  ingredients,
  recipes,
  onChange,
}: {
  products: Product[];
  ingredients: InvIngredient[];
  recipes: RecipeDoc[];
  onChange: (x: RecipeDoc[]) => void;
}) {
  const [selected, setSelected] = useState<number>(0);
  // map sementara untuk form: ingredientId -> qty per gelas
  const [temp, setTemp] = useState<{ [ingredientId: string]: number }>({});

  useEffect(() => {
    const found = recipes.find((r) => r.productId === selected);
    if (!found) {
      setTemp({});
      return;
    }
    // RecipeDoc.items adalah array { ingredientId, qty }
    const map: { [k: string]: number } = {};
    for (const it of (found.items || []) as any[]) {
      if (it.ingredientId) map[it.ingredientId] = Number(it.qty || 0);
    }
    setTemp(map);
  }, [selected, recipes]);

  async function saveRecipe() {
    if (!selected) return alert("Pilih produk dulu!");
    // konversi map -> array RecipeItem[]
    const items = Object.entries(temp)
      .filter(([, qty]) => (qty || 0) > 0)
      .map(([ingredientId, qty]) => ({ ingredientId, qty }));

    // setRecipeForProduct(productId, items)
    await setRecipeForProduct(selected, items);
    const updated = await fetchRecipes();
    onChange(updated);
    alert("Resep disimpan!");
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
        <label>Pilih Produk:</label>
        <select value={selected} onChange={(e) => setSelected(Number(e.target.value))}>
          <option value={0}>-- pilih --</option>
          {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      {selected !== 0 && (
        <>
          <h4>Resep per 1 gelas</h4>
          {ingredients.map((i) => (
            <div key={i.id} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
              <div style={{ flex: 1 }}>{i.name}</div>
              <input
                type="number"
                placeholder="Qty"
                style={{ width: 90 }}
                value={temp[i.id!] ?? ""}
                onChange={(e) =>
                  setTemp({
                    ...temp,
                    [String(i.id)]: Number(e.target.value) || 0,
                  })
                }
              />
              <small>{i.unit}</small>
            </div>
          ))}
          <button className="btn" onClick={saveRecipe}>Simpan Resep</button>
        </>
      )}
    </div>
  );
}

/* ============================
   Print Receipt
   ============================ */
function printReceipt(rec: {
  time: string; cashier: string;
  items: { name: string; qty: number; price: number }[];
  subtotal: number; discount: number;
  taxRate: number; serviceRate: number;
  taxValue: number; serviceValue: number;
  total: number; cash: number; change: number;
}) {
  const w = window.open("", "_blank", "width=380,height=600");
  if (!w) return;

  const rows = rec.items.map(
    (i) => `<tr>
      <td>${i.name}</td>
      <td style='text-align:center'>${i.qty}x</td>
      <td style='text-align:right'>${(i.price * i.qty).toLocaleString('id-ID')}</td>
    </tr>`
  ).join("");

  const html = `
<!doctype html>
<html><head><meta charset="utf-8"><title>Struk</title>
<style>
  body { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  .wrap { width: 280px; margin: 0 auto; }
  h2 { margin: 8px 0; text-align: center; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 4px 0; font-size: 12px; border-bottom: 1px dashed #ddd; }
  .tot td { border-bottom: none; font-weight: 700; }
  .meta { font-size: 12px; text-align: center; opacity: .8; }
</style></head>
<body>
  <div class="wrap">
    <h2>CHAFU MATCHA</h2>
    <div class="meta">${rec.time}<br/>Kasir: ${rec.cashier}</div>
    <hr/>
    <table>
      ${rows}
      <tr class="tot"><td>Subtotal</td><td></td><td style="text-align:right">${rec.subtotal.toLocaleString("id-ID")}</td></tr>
      ${rec.discount ? `<tr class="tot"><td>Diskon</td><td></td><td style="text-align:right">-${rec.discount.toLocaleString("id-ID")}</td></tr>` : ""}
      <tr class="tot"><td>Total</td><td></td><td style="text-align:right">${rec.total.toLocaleString("id-ID")}</td></tr>
      <tr><td>Tunai</td><td></td><td style="text-align:right">${rec.cash.toLocaleString("id-ID")}</td></tr>
      <tr><td>Kembali</td><td></td><td style="text-align:right">${rec.change.toLocaleString("id-ID")}</td></tr>
    </table>
    <p class="meta">Terima kasih! Follow @chafumatcha</p>
  </div>
  <script>window.print()</script>
</body></html>`;
  w.document.write(html);
  w.document.close();
}
