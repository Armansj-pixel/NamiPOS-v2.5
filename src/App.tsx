// src/App.tsx — CHAFU MATCHA POS (FULL: POS + Inventory + Resep + Riwayat + Laporan + Loyalty)
// ------------------------------------------------------------------------------------------------
// Fitur:
// - Login Firebase (Email/Password) — admin tab berdasarkan email
// - POS: Tunai + E-Wallet (QR otomatis), cetak struk auto
// - Inventory (bahan), Resep per produk (auto deduct stok saat transaksi)
// - Riwayat transaksi (live dari Firestore, admin only)
// - Dashboard Laporan (harian/mingguan/bulanan/custom) — omzet, trx, AOV, top produk, stok rendah
// - Loyalty System: Earn & Redeem poin via No HP (1 poin = Rp100, earn: 1 poin / Rp10.000)
// ------------------------------------------------------------------------------------------------
// NOTE:
// - Pastikan file /public/qr-qris.png tersedia (dipakai untuk QRIS/ewallet).
// - Pastikan responsive.css sudah di-import dan ada di src/responsive.css.
// - ENV Vite (Vercel/Netlify) harus terisi: VITE_FIREBASE_*
// ------------------------------------------------------------------------------------------------

import React, { useEffect, useState } from "react";
import "./responsive.css";

import {
  db,
  fetchProducts, upsertProduct, removeProduct,
  fetchIngredients, upsertIngredient, deleteIngredient,
  fetchRecipes, setRecipeForProduct, deductStockForSale, adjustStock,
  type Ingredient as InvIngredient, type RecipeDoc
} from "./lib/firebase";

import {
  addDoc, collection, serverTimestamp,
  query, orderBy, onSnapshot, doc, getDoc, setDoc,
  deleteDoc, updateDoc, where, getDocs
} from "firebase/firestore";

import {
  getAuth, onAuthStateChanged,
  signInWithEmailAndPassword, signOut, User
} from "firebase/auth";

// =============== Utils ===============
const IDR = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n || 0);

const ADMIN_EMAILS = [
  "antonius.arman123@gmail.com",
  "ayuismaalabibbah@gmail.com",
];

const PAY_METHODS = ["Tunai", "QRIS", "GoPay", "OVO", "DANA", "Transfer"] as const;
type PayMethod = (typeof PAY_METHODS)[number];

const walletQR: Record<string, string> = {
  QRIS: "/qr-qris.png",
  GoPay: "/qr-qris.png",
  OVO: "/qr-qris.png",
  DANA: "/qr-qris.png",
  Transfer: "/qr-qris.png",
};

// =============== Types ===============
type Product = { id: number; name: string; price: number; active?: boolean };
type CartItem = { id: string; productId: number; name: string; price: number; qty: number };

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
  customerPhone?: string | null;
  earnedPoints?: number;
  redeemedPoints?: number;
  redeemValueRp?: number;
  deviceDate?: number;
};

// =============== Default seed (1x jika kosong) ===============
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

// =============== App ===============
export default function App() {
  const auth = getAuth();

  // Auth
  const [user, setUser] = useState<User | null>(null);
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");

  // Tabs
  const [tab, setTab] = useState<"pos" | "produk" | "inventori" | "resep" | "riwayat" | "laporan">("pos");

  // Master data
  const [products, setProducts] = useState<Product[]>([]);
  const [ingredients, setIngredients] = useState<InvIngredient[]>([]);
  const [recipes, setRecipes] = useState<RecipeDoc[]>([]);

  // POS
  const [cart, setCart] = useState<CartItem[]>([]);
  const [payMethod, setPayMethod] = useState<PayMethod>("Tunai");
  const [cash, setCash] = useState<number>(0);
  const subtotal = cart.reduce((a, b) => a + b.price * b.qty, 0);

  // Riwayat (admin)
  const [sales, setSales] = useState<SaleRow[]>([]);

  // Loyalty
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerPoints, setCustomerPoints] = useState<number | null>(null);
  const [usePoints, setUsePoints] = useState<number>(0);
  function calcEarnedPoints(total: number) { return Math.floor(total / 10000); }        // earn: 1 poin / Rp10.000
  function pointsToRupiah(pts: number) { return pts * 100; }                            // redeem: 1 poin = Rp100
  // function rupiahToPoints(rp: number) { return Math.floor(rp / 100); }               // jika dibutuhkan

  // Laporan
  const [from, setFrom] = useState<string>(""); // yyyy-mm-dd
  const [to, setTo] = useState<string>("");
  const [report, setReport] = useState<{ omzet: number; trx: number; aov: number; top: { name: string; qty: number }[] }>({
    omzet: 0, trx: 0, aov: 0, top: []
  });

  // ---------- Auth lifecycle ----------
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) await ensureUserProfile(u);
    });
    return () => unsub();
  }, []);

  // ---------- Load master + subscribe riwayat ----------
  useEffect(() => {
    if (!user) return;
    loadData();

    if (isAdminEmail(user.email || "")) {
      const qSales = query(collection(db, "sales"), orderBy("createdAt", "desc"));
      const unsub = onSnapshot(qSales, (snap) => {
        const rows: SaleRow[] = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
        setSales(rows);
      });
      return () => unsub();
    }
  }, [user]);

  // ---------- Derived ----------
  function isAdminEmail(e: string) {
    return ADMIN_EMAILS.includes((e || "").toLowerCase());
  }
  const isAdmin = !!(user && isAdminEmail(user.email || ""));
  const redeemValueRp = pointsToRupiah(usePoints || 0);
  const finalTotal = Math.max(0, subtotal - redeemValueRp);
  const change = payMethod === "Tunai" ? Math.max(0, cash - finalTotal) : 0;

  // ---------- Data loaders ----------
  async function loadData() {
    let p = await fetchProducts();
    if (!p || p.length === 0) {
      await Promise.all(DEFAULT_PRODUCTS.map(upsertProduct));
      p = await fetchProducts();
    }
    setProducts(p);
    setIngredients(await fetchIngredients());
    setRecipes(await fetchRecipes());
  }

  async function ensureUserProfile(u: User) {
    const ref = doc(collection(db, "users"), u.uid);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      const mail = (u.email || "").toLowerCase();
      const role = isAdminEmail(mail) ? "owner" : "cashier";
      await setDoc(ref, { email: mail, role, createdAt: Date.now() });
    }
  }

  // ---------- Loyalty helpers ----------
  useEffect(() => { fetchCustomerPointsByPhone(customerPhone); }, [customerPhone]);

  async function fetchCustomerPointsByPhone(phone: string) {
    if (!phone) { setCustomerPoints(null); return; }
    const ref = doc(db, "customers", phone);
    const snap = await getDoc(ref);
    setCustomerPoints(snap.exists() ? ((snap.data() as any).points || 0) : 0);
  }

  async function addLoyaltyPoints(phone: string, earned: number, saleId: string) {
    if (!phone || earned <= 0) return;
    const ref = doc(db, "customers", phone);
    const snap = await getDoc(ref);
    const base = snap.exists() ? (snap.data() as any) : { points: 0, visits: 0 };
    await setDoc(ref, {
      ...base,
      points: (base.points || 0) + earned,
      visits: (base.visits || 0) + 1,
      lastVisit: Date.now()
    }, { merge: true });
    await addDoc(collection(db, "loyalty_logs"), {
      phone, pointsChange: earned, type: "earn", saleId, at: Date.now()
    });
  }

  async function redeemLoyaltyPoints(phone: string, usePts: number, saleId: string) {
    if (!phone || usePts <= 0) return;
    const ref = doc(db, "customers", phone);
    const snap = await getDoc(ref);
    const current = snap.exists() ? ((snap.data() as any).points || 0) : 0;
    const newPts = Math.max(0, current - usePts);
    await updateDoc(ref, { points: newPts });
    await addDoc(collection(db, "loyalty_logs"), {
      phone, pointsChange: -usePts, type: "redeem", saleId, at: Date.now()
    });
  }

  // ---------- POS actions ----------
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
    setUsePoints(0);
    setPayMethod("Tunai");
    setCustomerPhone("");
  }

  async function finalizeSale() {
    if (!cart.length) return alert("Keranjang kosong!");
    if (payMethod === "Tunai" && cash < finalTotal) return alert("Uang kurang!");

    const saleId = Date.now().toString();
    const earned = calcEarnedPoints(finalTotal);

    const rec: SaleRow = {
      time: new Date().toLocaleString("id-ID", { hour12: false }),
      timeMs: Date.now(),
      cashier: user?.email || "-",
      items: cart.map((i) => ({ name: i.name, qty: i.qty, price: i.price })),
      subtotal,
      discount: redeemValueRp,  // poin sebagai diskon
      taxRate: 0,
      serviceRate: 0,
      taxValue: 0,
      serviceValue: 0,
      total: finalTotal,
      payMethod,
      cash: payMethod === "Tunai" ? cash : 0,
      change: payMethod === "Tunai" ? Math.max(0, cash - finalTotal) : 0,
      createdAt: serverTimestamp(),
      customerPhone: customerPhone || null,
      earnedPoints: earned,
      redeemedPoints: usePoints || 0,
      redeemValueRp,
      deviceDate: Date.now(),
    };

    // simpan transaksi
    await addDoc(collection(db, "sales"), rec);

    // loyalty
    if (customerPhone) {
      if (usePoints > 0) await redeemLoyaltyPoints(customerPhone, usePoints, saleId);
      if (earned > 0) await addLoyaltyPoints(customerPhone, earned, saleId);
      await fetchCustomerPointsByPhone(customerPhone); // refresh saldo
    }

    // deduct stok
    await deductStockForSale({
      saleId,
      items: cart.map((c) => ({ productId: c.productId, name: c.name, qty: c.qty })),
      recipes,
      ingredientsMap: Object.fromEntries(ingredients.map((i) => [String(i.id), i])),
    });

    // print struk
    printReceipt({
      ...rec,
      subtotal,
      total: finalTotal,
      cash: rec.cash,
      change: rec.change,
    });

    clearCart();
    alert("Transaksi selesai ✅");
  }

  // ---------- Laporan ----------
  function ymdToMs(ymd: string) {
    const [y, m, d] = ymd.split("-").map(Number);
    return new Date(y, (m - 1), d, 0, 0, 0, 0).getTime();
  }

  async function getSalesRange(startMs: number, endMs: number) {
    const qy = query(
      collection(db, "sales"),
      where("deviceDate", ">=", startMs),
      where("deviceDate", "<", endMs),
      orderBy("deviceDate", "desc")
    );
    const snap = await getDocs(qy);
    return snap.docs.map(d => ({ id: d.id, ...d.data() })) as any[];
  }

  function summarizeSales(rows: any[]) {
    const omzet = rows.reduce((s, r) => s + (r.total || 0), 0);
    const trx = rows.length;
    const aov = trx ? Math.round(omzet / trx) : 0;

    const productCount: Record<string, number> = {};
    for (const r of rows) {
      for (const it of (r.items || [])) {
        productCount[it.name] = (productCount[it.name] || 0) + (it.qty || 0);
      }
    }
    const top = Object.entries(productCount)
      .sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([name, qty]) => ({ name, qty }));

    return { omzet, trx, aov, top };
  }

  async function loadReport() {
    if (!from || !to) return alert("Pilih tanggal dari & sampai");
    const start = ymdToMs(from);
    const end = ymdToMs(to) + 24 * 60 * 60 * 1000; // exclusive
    const rows = await getSalesRange(start, end);
    setReport(summarizeSales(rows));
  }

  // ---------- Auth UI ----------
  async function login() {
    try {
      await signInWithEmailAndPassword(auth, email, pass);
    } catch (e: any) {
      alert("Login gagal: " + e.message);
    }
  }
  async function logout() { await signOut(auth); }

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

  // ---------- Main UI ----------
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
              <button onClick={() => setTab("laporan")} className="btn">Laporan</button>
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

            {/* Loyalty: nomor HP & redeem */}
            <div>
              <label>No HP (loyalty): </label>
              <input
                placeholder="08xxxx"
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
              />
              {customerPhone && (
                <div style={{ marginTop: 6 }}>
                  <small>Saldo poin: <b>{customerPoints ?? "-"}</b></small>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6 }}>
                    <label>Gunakan Poin:</label>
                    <input
                      type="number"
                      min={0}
                      max={Math.max(0, customerPoints || 0)}
                      value={usePoints}
                      onChange={(e) => {
                        const v = Math.max(0, Math.min(Number(e.target.value) || 0, customerPoints || 0));
                        setUsePoints(v);
                      }}
                      style={{ width: 120 }}
                    />
                    <small>(Potongan: {IDR(redeemValueRp)})</small>
                  </div>
                </div>
              )}
            </div>

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
              <div><b>Subtotal:</b> {IDR(subtotal)}</div>
              {usePoints > 0 && <div><b>Potongan Poin:</b> -{IDR(redeemValueRp)}</div>}
              <div><b>Total Bayar:</b> {IDR(finalTotal)}</div>

              <div>
                <label>Metode:</label>{" "}
                <select value={payMethod} onChange={(e) => setPayMethod(e.target.value as PayMethod)}>
                  {PAY_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>

              {payMethod === "Tunai" ? (
                <>
                  <input type="number" placeholder="Uang diterima" value={cash} onChange={(e) => setCash(Number(e.target.value) || 0)} />
                  <div><b>Kembali:</b> {IDR(change)}</div>
                </>
              ) : (
                <div style={{ textAlign: "center" }}>
                  <img className="qr-img" src={walletQR[payMethod]} alt="QR" />
                  <p>Scan untuk bayar ({payMethod})</p>
                </div>
              )}

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

      {/* Riwayat (admin) */}
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
                    <td>{(s.items || []).map((it: any) => `${it.name} x${it.qty}`).join(", ")}</td>
                    <td style={{ textAlign: "right" }}>{IDR(s.total)}</td>
                    <td style={{ textAlign: "center" }}>{s.payMethod}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </main>
      )}

      {/* Laporan (admin) */}
      {tab === "laporan" && isAdmin && (
        <main className="section">
          <h2>Dashboard Laporan</h2>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <label>Dari:</label>
            <input type="date" value={from} onChange={e => setFrom(e.target.value)} />
            <label>Sampai:</label>
            <input type="date" value={to} onChange={e => setTo(e.target.value)} />
            <button className="btn" onClick={loadReport}>Terapkan</button>
            <button className="btn" onClick={() => {
              const t = new Date();
              const yyyy = t.getFullYear();
              const mm = String(t.getMonth() + 1).padStart(2, "0");
              const dd = String(t.getDate()).padStart(2, "0");
              setFrom(`${yyyy}-${mm}-${dd}`); setTo(`${yyyy}-${mm}-${dd}`);
            }}>Hari ini</button>
            <button className="btn" onClick={() => {
              const end = new Date();
              const start = new Date(end); start.setDate(end.getDate() - 6);
              const f = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
              setFrom(f(start)); setTo(f(end));
            }}>7 hari</button>
            <button className="btn" onClick={() => {
              const t = new Date();
              const f = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-01`;
              const toStr = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
              setFrom(f); setTo(toStr);
            }}>Bulan ini</button>
          </div>

          <div className="section" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginTop: 12 }}>
            <div className="btn"><b>Omzet</b><br />{IDR(report.omzet)}</div>
            <div className="btn"><b>Transaksi</b><br />{report.trx}</div>
            <div className="btn"><b>AOV</b><br />{IDR(report.aov)}</div>
          </div>

          <h3 style={{ marginTop: 16 }}>Top Produk</h3>
          {report.top.length === 0 ? <p>-</p> : (
            <ul>
              {report.top.map(t => <li key={t.name}>{t.name} — {t.qty} cup</li>)}
            </ul>
          )}

          <h3 style={{ marginTop: 16 }}>Stok Rendah</h3>
          <ul>
            {ingredients
              .filter(i => (i as any).minStock ? i.stock <= (i as any).minStock : i.stock <= 10)
              .map(i => <li key={i.id}>{i.name}: {i.stock} {i.unit}</li>)}
          </ul>
        </main>
      )}
    </div>
  );
}

// =============== Sub-Komponen: Product / Inventory / Recipe ===============

function ProductManager({ products, onChange }: { products: Product[]; onChange: (x: Product[]) => void }) {
  const [form, setForm] = useState<Product>({ id: 0, name: "", price: 0, active: true });

  async function save() {
    if (!form.id || !form.name || !form.price) return alert("ID, Nama, dan Harga wajib diisi!");
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
        <input placeholder="ID (unik angka)" type="number" value={form.id || ""} onChange={(e) => setForm({ ...form, id: Number(e.target.value) })} />
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
  const [temp, setTemp] = useState<{ [ingredientId: string]: number }>({}); // qty per gelas

  useEffect(() => {
    const found = recipes.find((r) => r.productId === selected);
    if (!found) { setTemp({}); return; }
    const map: { [k: string]: number } = {};
    for (const it of (found.items || []) as any[]) {
      if (it.ingredientId) map[it.ingredientId] = Number(it.qty || 0);
    }
    setTemp(map);
  }, [selected, recipes]);

  async function saveRecipe() {
    if (!selected) return alert("Pilih produk dulu!");
    const items = Object.entries(temp)
      .filter(([, qty]) => (qty || 0) > 0)
      .map(([ingredientId, qty]) => ({ ingredientId, qty }));
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

// =============== Print Struk ===============
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
      ${rec.discount ? `<tr class="tot"><td>Potongan Poin</td><td></td><td style="text-align:right">-${rec.discount.toLocaleString("id-ID")}</td></tr>` : ""}
      <tr class="tot"><td>Total</td><td></td><td style="text-align:right">${rec.total.toLocaleString("id-ID")}</td></tr>
      ${rec.cash ? `<tr><td>Tunai</td><td></td><td style='text-align:right'>${rec.cash.toLocaleString("id-ID")}</td></tr>` : ""}
      ${rec.cash ? `<tr><td>Kembali</td><td></td><td style='text-align:right'>${rec.change.toLocaleString("id-ID")}</td></tr>` : ""}
    </table>
    <p class="meta">Terima kasih! Follow @chafumatcha</p>
  </div>
  <script>window.print()</script>
</body></html>`;
  w.document.write(html);
  w.document.close();
}
