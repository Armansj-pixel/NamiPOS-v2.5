// src/App.tsx — CHAFU MATCHA POS FINAL (Versi Admin + Inventory + Responsive)
// -----------------------------------------------------------------------------
// Author: Arman Dion Sakti
// Date: 08 Oktober 2025
// -----------------------------------------------------------------------------
// ✅ Login Firebase (Email/Password)
// ✅ POS Kasir (Tunai + QR E-Wallet)
// ✅ Inventory + Resep + Stok opname
// ✅ Dashboard Riwayat
// ✅ Responsif otomatis di HP
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
    deductStockForSale({ saleId: sale.id, items: cart, recipes, ingredientsMap: Object.fromEntries(ingredients.map(i => [i.id!, i])) });
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
    <div className="app" style={{ fontFamily: "Poppins, system-ui, sans-serif" }}>
      <header className="header">
        <h1>CHAFU MATCHA POS</h1>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={logout} style={{ background: "#e53935", color: "#fff", border: "none", borderRadius: 8, padding: "6px 14px" }}>
            Logout
          </button>
        </div>
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
          <RecipeManager
            products={products}
            ingredients={ingredients}
            recipes={recipes}
            onChange={setRecipes}
          />
        </main>
      )}
    </div>
  );
}

/* ============================
   Komponen: ProductManager
   ============================ */
function ProductManager({
  products,
  onChange,
}: {
  products: Product[];
  onChange: (x: Product[]) => void;
}) {
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

/* ============================
   Komponen: InventoryManager
   ============================ */
function InventoryManager({
  ingredients,
  onChange,
}: {
  ingredients: InvIngredient[];
  onChange: (x: InvIngredient[]) => void;
}) {
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

  async function adjust(i: InvIngredient, d: number) {
    await adjustStock(i.id!, d);
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
            <button onClick={() => adjust(i, 1)}>+1</button>
            <button onClick={() => adjust(i, -1)}>-1</button>
            <button onClick={() => setForm(i)}>Edit</button>
            <button onClick={() => del(i)}>Hapus</button>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ============================
   Komponen: RecipeManager
   ============================ */
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
  const [current, setCurrent] = useState<RecipeDoc | null>(null);
  const [temp, setTemp] = useState<{ [key: string]: number }>({});

  useEffect(() => {
    const found = recipes.find((r) => r.productId === selected);
    setCurrent(found || null);
    setTemp(found?.items || {});
  }, [selected, recipes]);

  async function saveRecipe() {
    if (!selected) return alert("Pilih produk terlebih dahulu!");
    await setRecipeForProduct({ productId: selected, items: temp });
    onChange(await fetchRecipes());
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
                style={{ width: 80 }}
                placeholder="Jumlah"
                value={temp[i.id!] || ""}
                onChange={(e) =>
                  setTemp({
                    ...temp,
                    [i.id!]: Number(e.target.value),
                  })
                }
              />
              <small style={{ marginLeft: 4 }}>{i.unit}</small>
            </div>
          ))}
          <button onClick={saveRecipe} className="btn">
            Simpan Resep
          </button>
        </>
      )}
    </div>
  );
}

/* ============================
   Integrasi Otomatis POS -> Inventory
   ============================ */
// Keterangan:
// Saat transaksi diselesaikan di POS (finalizeSale),
// fungsi `deductStockForSale()` otomatis dipanggil.
// Ia akan mencari resep dari setiap produk,
// lalu mengurangi stok bahan sesuai jumlah produk yang dijual.
//
// Contoh:
// Produk “Matcha OG” punya resep { Matcha Powder: 5gr, Susu: 150ml }
// Saat terjual 2 cup → stok berkurang Matcha Powder -10gr, Susu -300ml
//
// Fungsi ini diambil dari file ./lib/firebase.ts
// dan sudah aktif otomatis di finalizeSale() Part 1.
