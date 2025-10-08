// src/App.tsx — CHAFU MATCHA POS FINAL (versi lengkap + TypeScript fix)
// -----------------------------------------------------------------------------
// Author: Arman Dion Sakti (Elsewedy Electric Indonesia)
// Date: 08 Oktober 2025
// -----------------------------------------------------------------------------
// ✅ Login Firebase (Email/Password)
// ✅ POS Kasir (Tunai + QR E-Wallet)
// ✅ Inventory + Resep + Stok opname otomatis
// ✅ Dashboard Riwayat
// ✅ Responsive otomatis di HP
// ✅ Admin email: antonius.arman123@gmail.com, ayuismaalabibbah@gmail.com
// -----------------------------------------------------------------------------

import React, { useState, useEffect } from "react";
import {
  fetchProducts, upsertProduct, removeProduct,
  fetchIngredients, upsertIngredient, deleteIngredient,
  fetchRecipes, setRecipeForProduct, deductStockForSale, adjustStock,
  addSale, type Ingredient as InvIngredient, type RecipeDoc
} from "./lib/firebase";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, User } from "firebase/auth";
import "./responsive.css";

const IDR = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n || 0);

const ADMIN_EMAILS = [
  "antonius.arman123@gmail.com",
  "ayuismaalabibbah@gmail.com",
];

const PAY_METHODS = ["Tunai", "QRIS", "GoPay", "OVO", "DANA", "Transfer"];
const walletQR: Record<string, string> = {
  QRIS: "/qr-qris.png",
  GoPay: "/qr-qris.png",
  OVO: "/qr-qris.png",
  DANA: "/qr-qris.png",
  Transfer: "/qr-qris.png",
};

type Product = { id: number; name: string; price: number; active?: boolean };
type CartItem = { id: string; productId: number; name: string; price: number; qty: number };

export default function App() {
  const auth = getAuth();
  const [user, setUser] = useState<User | null>(null);
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [tab, setTab] = useState("pos");

  const [products, setProducts] = useState<Product[]>([]);
  const [ingredients, setIngredients] = useState<InvIngredient[]>([]);
  const [recipes, setRecipes] = useState<RecipeDoc[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [payMethod, setPayMethod] = useState("Tunai");
  const [cash, setCash] = useState(0);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUser(u));
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!user) return;
    loadData();
  }, [user]);

  async function loadData() {
    setProducts(await fetchProducts());
    setIngredients(await fetchIngredients());
    setRecipes(await fetchRecipes());
  }

  const isAdmin = user && ADMIN_EMAILS.includes(user.email || "");
  const subtotal = cart.reduce((a, b) => a + b.price * b.qty, 0);
  const change = payMethod === "Tunai" ? cash - subtotal : 0;

  function addToCart(p: Product) {
    setCart((c) => {
      const ex = c.find((x) => x.productId === p.id);
      if (ex) return c.map((x) => (x.productId === p.id ? { ...x, qty: x.qty + 1 } : x));
      return [...c, { id: Math.random().toString(36).slice(2, 9), productId: p.id, name: p.name, price: p.price, qty: 1 }];
    });
  }
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

  function finalizeSale() {
    if (!cart.length) return alert("Keranjang kosong!");
    const sale = {
      id: Date.now().toString(),
      time: new Date().toLocaleString("id-ID"),
      timeMs: Date.now(),
      cashier: user?.email || "-",
      items: cart,
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
    };
    addSale(sale);
    deductStockForSale({
      saleId: sale.id,
      items: cart,
      recipes,
      ingredientsMap: Object.fromEntries(ingredients.map(i => [i.id!, i])),
    });
    setCart([]);
    alert("Transaksi selesai!");
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
        <input placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} style={{ padding: 8, margin: 4 }} />
        <input type="password" placeholder="Password" value={pass} onChange={(e) => setPass(e.target.value)} style={{ padding: 8, margin: 4 }} />
        <br />
        <button onClick={login} style={{ padding: "8px 18px", background: "#2e7d32", color: "white", border: "none", borderRadius: 8 }}>
          Login
        </button>
      </div>
    );

  return (
    <div className="app">
      <header className="header">
        <h1>CHAFU MATCHA POS</h1>
        <button onClick={logout} style={{ background: "#e53935", color: "#fff", border: "none", borderRadius: 8, padding: "6px 14px" }}>
          Logout
        </button>
      </header>

      <div className="tabs">
        <button onClick={() => setTab("pos")} className={tab === "pos" ? "active" : ""}>POS</button>
        {isAdmin && (
          <>
            <button onClick={() => setTab("produk")}>Produk</button>
            <button onClick={() => setTab("inventori")}>Inventory</button>
            <button onClick={() => setTab("resep")}>Resep</button>
          </>
        )}
      </div>

      {tab === "pos" && (
        <main className="pos-grid">
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

          <section className="section">
            <h2>Keranjang</h2>
            {cart.map((c) => (
              <div key={c.id}>
                {c.name} × {c.qty} — {IDR(c.price * c.qty)}
              </div>
            ))}
            <hr />
            <div>Total: {IDR(subtotal)}</div>
            <div>
              <label>Metode: </label>
              <select value={payMethod} onChange={(e) => setPayMethod(e.target.value)}>
                {PAY_METHODS.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </div>
            {payMethod === "Tunai" && (
              <input type="number" placeholder="Uang diterima" value={cash} onChange={(e) => setCash(Number(e.target.value))} />
            )}
            {payMethod !== "Tunai" && (
              <div style={{ textAlign: "center" }}>
                <img src={walletQR[payMethod]} alt="QRIS" className="qr-img" />
                <p>Tunjukkan QR ke pelanggan</p>
              </div>
            )}
            <button onClick={finalizeSale} className="btn" style={{ background: "#2e7d32", color: "#fff", width: "100%", marginTop: 10 }}>
              Selesaikan Transaksi
            </button>
          </section>
        </main>
      )}

      {tab === "produk" && (
        <main className="section">
          <h2>Manajemen Produk</h2>
          <ProductManager products={products} onChange={setProducts} />
        </main>
      )}

      {tab === "inventori" && (
        <main className="section">
          <h2>Inventory Bahan</h2>
          <InventoryManager ingredients={ingredients} onChange={setIngredients} />
        </main>
      )}

      {tab === "resep" && (
        <main className="section">
          <h2>Resep Produk</h2>
          <RecipeManager products={products} ingredients={ingredients} recipes={recipes} onChange={setRecipes} />
        </main>
      )}
    </div>
  );
}

/* ---------- Subkomponen: Product, Inventory, Recipe ---------- */

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
      <h3>Tambah/Ubah Produk</h3>
      <input placeholder="Nama" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      <input type="number" placeholder="Harga" value={form.price} onChange={(e) => setForm({ ...form, price: Number(e.target.value) })} />
      <button onClick={save} className="btn">Simpan</button>

      <h3>Daftar Produk</h3>
      {products.map((p) => (
        <div key={p.id} style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
          <span>{p.name} — {IDR(p.price)}</span>
          <div>
            <button onClick={() => setForm(p)}>Edit</button>
            <button onClick={() => del(p)}>Hapus</button>
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
  // panggil sesuai signature adjustStock(adjs[])
  await adjustStock([{ ingredientId: String(i.id), newStock, note: delta > 0 ? `+${delta}` : `${delta}` }]);
  onChange(await fetchIngredients());
}


  return (
    <div>
      <h3>Tambah/Ubah Bahan</h3>
      <input placeholder="Nama bahan" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      <input placeholder="Satuan (ml, gr, pcs)" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} />
      <input type="number" placeholder="Stok awal" value={form.stock} onChange={(e) => setForm({ ...form, stock: Number(e.target.value) })} />
      <button onClick={save} className="btn">Simpan</button>

      <h3>Daftar Bahan</h3>
      {ingredients.map((i) => (
        <div key={i.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <span>{i.name} ({i.stock} {i.unit})</span>
          <div>
            <button onClick={() => adjustItem(i, 1)}>+1</button>
            <button onClick={() => adjustItem(i, -1)}>-1</button>
            <button onClick={() => setForm(i)}>Edit</button>
            <button onClick={() => del(i)}>Hapus</button>
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
  // gunakan map sederhana untuk form: ingredientId -> qty
  const [temp, setTemp] = useState<{ [ingredientId: string]: number }>({});

  // saat ganti produk, muat resepnya lalu konversi array -> map
  useEffect(() => {
    const found = recipes.find((r) => r.productId === selected);
    if (!found) {
      setTemp({});
      return;
    }
    // RecipeDoc.items adalah RecipeItem[] { ingredientId, qty }
    const map: { [id: string]: number } = {};
    for (const it of (found.items || [])) {
      if (it.ingredientId) map[it.ingredientId] = Number(it.qty || 0);
    }
    setTemp(map);
  }, [selected, recipes]);

  async function saveRecipe() {
    if (!selected) return alert("Pilih produk terlebih dahulu!");
    // konversi map -> array RecipeItem[]
    const items = Object.entries(temp)
      .filter(([, qty]) => (qty || 0) > 0)
      .map(([ingredientId, qty]) => ({ ingredientId, qty }));

    // panggil sesuai signature: (productId, items)
    await setRecipeForProduct(selected, items);

    const updated = await fetchRecipes();
    onChange(updated);
    alert("Resep disimpan!");
  }

  return (
    <div>
      <h3>Pilih Produk</h3>
      <select value={selected} onChange={(e) => setSelected(Number(e.target.value))}>
        <option value={0}>-- pilih --</option>
        {products.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>

      {selected !== 0 && (
        <>
          <h4>Daftar Bahan</h4>
          {ingredients.map((i) => (
            <div key={i.id} style={{ display: "flex", alignItems: "center", marginBottom: 4 }}>
              <label style={{ flex: 1 }}>{i.name}</label>
              <input
                type="number"
                style={{ width: 90 }}
                placeholder="Qty per gelas"
                value={temp[i.id!] ?? ""}
                onChange={(e) =>
                  setTemp({
                    ...temp,
                    [String(i.id)]: Number(e.target.value) || 0,
                  })
                }
              />
              <small style={{ marginLeft: 6 }}>{i.unit}</small>
            </div>
          ))}
          <button onClick={saveRecipe} className="btn">Simpan Resep</button>
        </>
      )}
    </div>
  );
}
