// src/App.tsx — CHAFU MATCHA POS (FINAL 80mm)
// ------------------------------------------------------------------------------------
// Fitur:
// - Login Firebase (Email/Password) — admin tab by email
// - POS: Tunai + E-Wallet (QR otomatis), cetak struk auto (thermal 80mm)
// - Inventory (bahan), Resep (auto deduct stok saat transaksi)
// - Riwayat transaksi (live Firestore, admin only)
// - Dashboard Laporan (omzet, trx, AOV, top produk, stok rendah, rentang tanggal)
// - Loyalty: Earn & Redeem poin by No HP (1 poin / Rp10.000, 1 poin = Rp100; bisa diubah di settings)
// - Shift Kasir: Buka/Tutup shift, rekap per metode bayar, export CSV
// - Export CSV (Riwayat/Laporan), Export PDF ringkas (Laporan), Reorder CSV (stok kritis)
// ------------------------------------------------------------------------------------
// Kebutuhan:
// - /public/qr-qris.png untuk QR e-wallet
// - ENV Firebase (VITE_FIREBASE_*) sudah dihosting (Netlify/Vercel)
// - file ./lib/firebase.ts sudah yang terbaru (CRUD produk/ingredients/recipes + deductStockForSale)
// - ./responsive.css untuk styling dasar (optional)

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

// ---------------- Utils ----------------
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

// ---------------- Types ----------------
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

type ShiftDoc = {
  id?: string;
  openedAt: number;
  openedBy: string;
  closedAt?: number | null;
  closedBy?: string | null;
  cashOpen?: number;
  cashClose?: number;
  totals?: Record<string, number>;
  trxCount?: number;
};

type SettingsDoc = {
  pointEarnPerRp: number;     // 1 poin / X rupiah
  pointValueRp: number;       // 1 poin = Y rupiah
  maxRedeemPoints?: number;   // batas poin per trx (0 = no limit)
  pointExpiryDays?: number;   // 0 = no expiry (tidak dipakai di UI)
  lowStockThreshold?: number; // ambang stok rendah
};

// ---------------- Defaults ----------------
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

const DEFAULT_SETTINGS: SettingsDoc = {
  pointEarnPerRp: 10000,
  pointValueRp: 100,
  maxRedeemPoints: 0,
  pointExpiryDays: 0,
  lowStockThreshold: 10,
};

// ---------------- App ----------------
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

  // Settings
  const [settingsDoc, setSettingsDoc] = useState<SettingsDoc>(DEFAULT_SETTINGS);

  // POS
  const [cart, setCart] = useState<CartItem[]>([]);
  const [payMethod, setPayMethod] = useState<PayMethod>("Tunai");
  const [cash, setCash] = useState<number>(0);
  const subtotal = cart.reduce((a, b) => a + b.price * b.qty, 0);

  // Riwayat
  const [sales, setSales] = useState<SaleRow[]>([]);

  // Loyalty + katalog pelanggan
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPoints, setCustomerPoints] = useState<number | null>(null);
  const [customerSuggest, setCustomerSuggest] = useState<{ phone: string; name?: string; points?: number }[]>([]);
  const [usePoints, setUsePoints] = useState<number>(0);

  // Shift
  const [activeShift, setActiveShift] = useState<ShiftDoc | null>(null);

  // Laporan
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [report, setReport] = useState<{ omzet: number; trx: number; aov: number; top: { name: string; qty: number }[] }>({
    omzet: 0, trx: 0, aov: 0, top: []
  });

  // ---------- Auth lifecycle ----------
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        await ensureUserProfile(u);
        await loadSettings();
      }
    });
    return () => unsub();
  }, []);

  // ---------- Load master + subscribe riwayat + shift ----------
  useEffect(() => {
    if (!user) return;
    loadData();

    if (isAdminEmail(user.email || "")) {
      const qSales = query(collection(db, "sales"), orderBy("createdAt", "desc"));
      const unsub = onSnapshot(qSales, (snap) => {
        const rows: SaleRow[] = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
        setSales(rows);
      });
      // fetch active shift
      (async () => {
        const qy = query(collection(db, "shifts"), where("closedAt", "==", null), orderBy("openedAt", "desc"));
        const ss = await getDocs(qy);
        if (!ss.empty) {
          const d = ss.docs[0];
          setActiveShift({ id: d.id, ...(d.data() as any) });
        } else setActiveShift(null);
      })();

      return () => unsub();
    }
  }, [user]);

  // ---------- Derived ----------
  function isAdminEmail(e: string) {
    return ADMIN_EMAILS.includes((e || "").toLowerCase());
  }
  const isAdmin = !!(user && isAdminEmail(user.email || ""));

  function calcEarnedPoints(total: number) {
    const per = settingsDoc.pointEarnPerRp || 10000;
    return Math.floor(total / per);
  }
  function pointsToRupiah(pts: number) {
    const val = settingsDoc.pointValueRp || 100;
    return pts * val;
  }

  const redeemCap = (settingsDoc.maxRedeemPoints && settingsDoc.maxRedeemPoints > 0)
    ? Math.min(customerPoints || 0, settingsDoc.maxRedeemPoints)
    : (customerPoints || 0);

  const redeemValueRp = pointsToRupiah(usePoints || 0);
  const finalTotal = Math.max(0, subtotal - redeemValueRp);
  const change = payMethod === "Tunai" ? Math.max(0, cash - finalTotal) : 0;

  // ---------- Loaders ----------
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

  async function loadSettings() {
    const sref = doc(db, "settings", "global");
    const snap = await getDoc(sref);
    if (snap.exists()) {
      setSettingsDoc({ ...DEFAULT_SETTINGS, ...(snap.data() as SettingsDoc) });
    } else {
      await setDoc(sref, DEFAULT_SETTINGS);
      setSettingsDoc(DEFAULT_SETTINGS);
    }
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

  async function searchCustomerSuggest(prefix: string) {
    const list: { phone: string; name?: string; points?: number }[] = [];
    const ex = await getDoc(doc(db, "customers", prefix));
    if (ex.exists()) {
      const d = ex.data() as any;
      list.push({ phone: prefix, name: d.name, points: d.points });
    }
    setCustomerSuggest(list);
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
    setCustomerName("");
  }

  async function finalizeSale() {
    if (!cart.length) return alert("Keranjang kosong!");
    if (usePoints > redeemCap) return alert("Poin yang digunakan melebihi batas.");
    if (payMethod === "Tunai" && cash < finalTotal) return alert("Uang kurang!");

    const saleId = Date.now().toString();
    const earned = calcEarnedPoints(finalTotal);

    // simpan/merge nama customer (opsional)
    if (customerPhone && customerName.trim()) {
      await setDoc(doc(db, "customers", customerPhone), { name: customerName.trim() }, { merge: true });
    }

    const rec: SaleRow = {
      time: new Date().toLocaleString("id-ID", { hour12: false }),
      timeMs: Date.now(),
      cashier: user?.email || "-",
      items: cart.map((i) => ({ name: i.name, qty: i.qty, price: i.price })),
      subtotal,
      discount: redeemValueRp,
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

    await addDoc(collection(db, "sales"), rec);

    if (customerPhone) {
      if (usePoints > 0) await redeemLoyaltyPoints(customerPhone, usePoints, saleId);
      if (earned > 0) await addLoyaltyPoints(customerPhone, earned, saleId);
      await fetchCustomerPointsByPhone(customerPhone);
    }

    await deductStockForSale({
      saleId,
      items: cart.map((c) => ({ productId: c.productId, name: c.name, qty: c.qty })),
      recipes,
      ingredientsMap: Object.fromEntries(ingredients.map((i) => [String(i.id), i])),
    });

    printReceipt80mm({
      ...rec,
      subtotal,
      total: finalTotal,
      cash: rec.cash,
      change: rec.change,
    });

    clearCart();
    alert("Transaksi selesai ✅");
  }

  // ---------- Shift ----------
  async function openShift() {
    if (activeShift && !activeShift.closedAt) return alert("Shift masih aktif.");
    const cashOpen = Number(prompt("Cash Drawer Awal (opsional)?") || 0);
    const sh: ShiftDoc = {
      openedAt: Date.now(),
      openedBy: user?.email || "-",
      cashOpen
    };
    const ref = await addDoc(collection(db, "shifts"), { ...sh, closedAt: null });
    setActiveShift({ ...sh, id: ref.id, closedAt: null });
    alert("Shift dibuka ✅");
  }

  async function closeShift() {
    if (!activeShift || activeShift.closedAt) return alert("Tidak ada shift aktif.");
    const rows = await getSalesRange(activeShift.openedAt, Date.now());
    const totals: Record<string, number> = {};
    let trx = 0;
    for (const r of rows) {
      totals[r.payMethod] = (totals[r.payMethod] || 0) + (r.total || 0);
      trx++;
    }
    const cashClose = Number(prompt("Cash Drawer Akhir (opsional)?") || 0);
    await updateDoc(doc(db, "shifts", activeShift.id!), {
      closedAt: Date.now(),
      closedBy: user?.email || "-",
      totals,
      trxCount: trx,
      cashClose
    });
    exportShiftCSV({ ...activeShift, totals, trxCount: trx, cashClose, closedAt: Date.now(), closedBy: user?.email || "-" });
    setActiveShift(null);
    alert("Shift ditutup ✅ dan CSV diunduh.");
  }

  function exportShiftCSV(sh: ShiftDoc) {
    const hdr = ["openedAt", "openedBy", "closedAt", "closedBy", "trxCount", "cashOpen", "cashClose", "method", "amount"];
    const lines = [hdr.join(",")];
    const rows = Object.entries(sh.totals || { Unknown: 0 }).map(([m, a]) => [
      sh.openedAt, sh.openedBy, sh.closedAt, sh.closedBy, sh.trxCount ?? 0, sh.cashOpen ?? 0, sh.cashClose ?? 0, m, a
    ]);
    for (const r of rows) lines.push(r.join(","));
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `shift_${sh.openedAt}_${sh.closedAt}.csv`; a.click();
    URL.revokeObjectURL(url);
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
    const end = ymdToMs(to) + 24 * 60 * 60 * 1000;
    const rows = await getSalesRange(start, end);
    setReport(summarizeSales(rows));
  }

  // ---------- Export ----------
  function exportSalesCSV() {
    if (!sales.length) return alert("Tidak ada data.");
    const hdr = ["time", "payMethod", "total", "items"];
    const lines = [hdr.join(",")];
    for (const s of sales) {
      const items = (s.items || []).map(it => `${it.name} x${it.qty}`).join("; ");
      lines.push([s.time, s.payMethod, s.total, `"${String(items).replace(/"/g, '""')}"`].join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `sales_${Date.now()}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  function exportReportCSV() {
    const hdr = ["metric", "value"];
    const lines = [
      hdr.join(","),
      ["omzet", report.omzet].join(","),
      ["transaksi", report.trx].join(","),
      ["AOV", report.aov].join(","),
      "top_product,qty"
    ];
    for (const t of report.top) { lines.push([t.name, t.qty].join(",")); }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `report_${from}_${to}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  function exportReportPDF() {
    const w = window.open("", "_blank", "width=800,height=900");
    if (!w) return;
    w.document.write(`
      <html><head><title>Laporan</title></head><body>
      <h2>Laporan ${from} s/d ${to}</h2>
      <p>Omzet: ${IDR(report.omzet)}<br/>Transaksi: ${report.trx}<br/>AOV: ${IDR(report.aov)}</p>
      <h3>Top Produk</h3>
      <ul>${report.top.map(t => `<li>${t.name} — ${t.qty} cup</li>`).join("")}</ul>
      </body></html>
    `);
    w.document.close(); w.print();
  }

  function exportReorderCSV() {
    const low = ingredients.filter(i => i.stock <= (settingsDoc.lowStockThreshold || 10));
    if (!low.length) return alert("Tidak ada bahan di bawah ambang.");
    const hdr = ["name", "stock", "unit", "suggested_order"];
    const lines = [hdr.join(",")];
    for (const i of low) {
      const suggested = Math.max((settingsDoc.lowStockThreshold || 10) * 2 - (i.stock || 0), 0);
      lines.push([i.name, String(i.stock || 0), i.unit || "", String(suggested)].join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `reorder_${Date.now()}.csv`; a.click();
    URL.revokeObjectURL(url);
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
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={() => setTab("pos")} className="btn">POS</button>
          {isAdmin && (
            <>
              <button onClick={() => setTab("produk")} className="btn">Produk</button>
              <button onClick={() => setTab("inventori")} className="btn">Inventory</button>
              <button onClick={() => setTab("resep")} className="btn">Resep</button>
              <button onClick={() => setTab("riwayat")} className="btn">Riwayat</button>
              <button onClick={() => setTab("laporan")} className="btn">Laporan</button>
              <button onClick={openShift} className="btn">Buka Shift</button>
              <button onClick={closeShift} className="btn" style={{ background: "#263238", color: "#fff" }}>
                Tutup Shift {activeShift ? "(aktif)" : ""}
              </button>
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

            {/* Loyalty + katalog */}
            <div>
              <label>No HP (loyalty): </label>
              <input
                placeholder="08xxxx"
                value={customerPhone}
                onChange={(e) => { setCustomerPhone(e.target.value); if (e.target.value.length >= 3) searchCustomerSuggest(e.target.value); }}
                list="cust-suggest"
              />
              <datalist id="cust-suggest">
                {customerSuggest.map(c => (
                  <option key={c.phone} value={c.phone}>{c.name ? `${c.phone} - ${c.name}` : c.phone}</option>
                ))}
              </datalist>

              <div style={{ marginTop: 6, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <input placeholder="Nama pelanggan (opsional)" value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
                {customerPhone && <small>Saldo poin: <b>{customerPoints ?? "-"}</b></small>}
              </div>

              {customerPhone && (
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6 }}>
                  <label>Gunakan Poin:</label>
                  <input
                    type="number"
                    min={0}
                    max={Math.max(0, redeemCap)}
                    value={usePoints}
                    onChange={(e) => {
                      const v = Math.max(0, Math.min(Number(e.target.value) || 0, redeemCap));
                      setUsePoints(v);
                    }}
                    style={{ width: 120 }}
                  />
                  <small>(Potongan: {IDR(redeemValueRp)})</small>
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

      {/* Riwayat */}
      {tab === "riwayat" && isAdmin && (
        <main className="section table-scroll">
          <div style={{display:"flex", justifyContent:"space-between", alignItems:"center"}}>
            <h2>Riwayat Transaksi</h2>
            <button className="btn" onClick={exportSalesCSV}>Export CSV</button>
          </div>
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

      {/* Laporan */}
      {tab === "laporan" && isAdmin && (
        <main className="section">
          <div style={{display:"flex", justifyContent:"space-between", alignItems:"center"}}>
            <h2>Dashboard Laporan</h2>
            <div style={{display:"flex", gap:8}}>
              <button className="btn" onClick={exportReportCSV}>Export CSV</button>
              <button className="btn" onClick={exportReportPDF}>Export PDF</button>
              <button className="btn" onClick={exportReorderCSV}>Reorder CSV</button>
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
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
              .filter(i => i.stock <= (settingsDoc.lowStockThreshold || 10))
              .map(i => <li key={i.id}>{i.name}: {i.stock} {i.unit}</li>)}
          </ul>
        </main>
      )}
    </div>
  );
}

// ---------------- Sub-Komponen ----------------

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
      <div style={{ display: "
      // src/App.tsx — CHAFU MATCHA POS FINAL BUILD (Firebase + Inventory + Loyalty + Shift)
import React, { useState, useEffect } from "react";
import { db, auth } from "./lib/firebase";
import {
  addDoc, setDoc, updateDoc, getDoc, getDocs, deleteDoc,
  collection, doc, query, where, orderBy, serverTimestamp
} from "firebase/firestore";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from "firebase/auth";

// ============================
// 🔹 UTILS
// ============================
const IDR = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n || 0);
const uid = () => Math.random().toString(36).slice(2, 9);
const todayYMD = () => new Date().toISOString().slice(0, 10);
const nowStr = () => new Date().toLocaleString("id-ID", { hour12: false });

// ============================
// 🔹 TYPES
// ============================
interface Product { id: string; name: string; price: number; category: string; active?: boolean; }
interface Ingredient { id: string; name: string; stock: number; unit: string; minStock?: number; }
interface RecipeItem { ingredientId: string; qty: number; }
interface SaleItem { productId: string; name: string; qty: number; price: number; }
interface SaleRow {
  id?: string; time: string; timeMs: number; cashier: string;
  items: SaleItem[]; subtotal: number; discount: number; total: number;
  payMethod: string; cash: number; change: number; createdAt?: any;
}

// ============================
// 🔹 MAIN APP
// ============================
export default function App() {
  const [user, setUser] = useState<any>(null);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPass, setLoginPass] = useState("");
  const [tab, setTab] = useState("pos");
  const [products, setProducts] = useState<Product[]>([]);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [cart, setCart] = useState<SaleItem[]>([]);
  const [sales, setSales] = useState<SaleRow[]>([]);
  const [discount, setDiscount] = useState(0);
  const [cash, setCash] = useState(0);
  const [payMethod, setPayMethod] = useState("Tunai");

  // Loyalty
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPoints, setCustomerPoints] = useState<number | null>(null);
  const [usePoints, setUsePoints] = useState(0);
  const [settings, setSettings] = useState({
    pointEarnPerRp: 10000,
    pointValueRp: 100,
    lowStockThreshold: 10
  });

  // Shift
  const [activeShift, setActiveShift] = useState<any>(null);

  // ============================
  // AUTH
  // ============================
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUser(u));
    return () => unsub();
  }, []);

  const login = async () => {
    try {
      await signInWithEmailAndPassword(auth, loginEmail, loginPass);
      alert("Login berhasil!");
    } catch (e: any) {
      alert("Gagal login: " + e.message);
    }
  };
  const logout = async () => {
    await signOut(auth);
    setUser(null);
  };

  // ============================
  // LOAD DATA
  // ============================
  useEffect(() => {
    if (!user) return;
    const load = async () => {
      const ps = await getDocs(collection(db, "products"));
      setProducts(ps.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
      const ing = await getDocs(collection(db, "ingredients"));
      setIngredients(ing.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
      const sl = await getDocs(query(collection(db, "sales"), orderBy("timeMs", "desc")));
      setSales(sl.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
    };
    load();
  }, [user]);

  // ============================
  // CART ACTIONS
  // ============================
  const addToCart = (p: Product) => {
    setCart((prev) => {
      const found = prev.find((x) => x.productId === p.id);
      if (found) return prev.map((x) => x === found ? { ...x, qty: x.qty + 1 } : x);
      return [...prev, { productId: p.id, name: p.name, price: p.price, qty: 1 }];
    });
  };
  const inc = (id: string) => setCart((p) => p.map((x) => x.productId === id ? { ...x, qty: x.qty + 1 } : x));
  const dec = (id: string) => setCart((p) => p.map((x) => x.productId === id ? { ...x, qty: Math.max(1, x.qty - 1) } : x));
  const rm = (id: string) => setCart((p) => p.filter((x) => x.productId !== id));

  const subtotal = cart.reduce((s, i) => s + i.price * i.qty, 0);
  const total = Math.max(0, subtotal - discount - (usePoints * settings.pointValueRp));
  const change = Math.max(0, cash - total);

  // ============================
  // LOYALTY
  // ============================
  const fetchCustomer = async (phone: string) => {
    if (!phone) return;
    const ref = doc(db, "customers", phone);
    const snap = await getDoc(ref);
    setCustomerPoints(snap.exists() ? (snap.data() as any).points || 0 : 0);
  };
  useEffect(() => { fetchCustomer(customerPhone); }, [customerPhone]);

  const calcEarnedPoints = (total: number) => Math.floor(total / settings.pointEarnPerRp);

  const addLoyalty = async (phone: string, earned: number) => {
    if (!phone || earned <= 0) return;
    const ref = doc(db, "customers", phone);
    const snap = await getDoc(ref);
    const base = snap.exists() ? (snap.data() as any) : { points: 0, name: customerName };
    await setDoc(ref, {
      ...base,
      name: customerName || base.name,
      points: (base.points || 0) + earned
    }, { merge: true });
  };
  const redeemLoyalty = async (phone: string, pts: number) => {
    if (!phone || pts <= 0) return;
    const ref = doc(db, "customers", phone);
    const snap = await getDoc(ref);
    const base = snap.exists() ? (snap.data() as any) : { points: 0 };
    await updateDoc(ref, { points: Math.max(0, (base.points || 0) - pts) });
  };

  // ============================
  // FINALIZE SALE
  // ============================
  const finalize = async () => {
    if (!cart.length) return alert("Keranjang kosong!");
    if (payMethod === "Tunai" && cash < total) return alert("Uang kurang!");

    const earned = calcEarnedPoints(total);
    const sale: SaleRow = {
      time: nowStr(),
      timeMs: Date.now(),
      cashier: user?.email || "-",
      items: cart,
      subtotal,
      discount: discount + (usePoints * settings.pointValueRp),
      total,
      payMethod,
      cash,
      change,
      createdAt: serverTimestamp()
    };
    const ref = await addDoc(collection(db, "sales"), sale);

    if (customerPhone) {
      if (usePoints > 0) await redeemLoyalty(customerPhone, usePoints);
      if (earned > 0) await addLoyalty(customerPhone, earned);
    }

    printReceipt({ ...sale, id: ref.id });
    setCart([]); setCash(0); setDiscount(0); setUsePoints(0);
    alert("Transaksi berhasil!");
  };

  // ============================
  // PRINT RECEIPT (80mm)
  // ============================
  const printReceipt = (rec: any) => {
    const w = window.open("", "_blank", "width=380,height=600");
    if (!w) return;
    const itemsHtml = rec.items.map((i: any) =>
      `<tr><td>${i.name}</td><td>${i.qty}x</td><td style='text-align:right'>${IDR(i.price * i.qty)}</td></tr>`
    ).join("");
    w.document.write(`
      <html><head><title>Struk</title>
      <style>
        @media print {@page { size: 80mm auto; margin: 0; }}
        body { font-family: monospace; margin:0; }
        .wrap { width: 76mm; margin:auto; padding:3mm; }
        h2 { text-align:center; margin:4px 0; }
        table { width:100%; border-collapse:collapse; }
        td { padding:2px 0; border-bottom:1px dashed #aaa; font-size:12px; }
        .tot td { font-weight:700; border-bottom:none; }
        .meta { font-size:11px; text-align:center; margin-top:8px; }
      </style></head><body>
      <div class='wrap'>
        <h2>CHAFU MATCHA</h2>
        <div class='meta'>${rec.id || ""}<br>${rec.time}</div>
        <table>${itemsHtml}
          <tr class='tot'><td>Subtotal</td><td></td><td>${IDR(rec.subtotal)}</td></tr>
          ${rec.discount ? `<tr class='tot'><td>Diskon</td><td></td><td>-${IDR(rec.discount)}</td></tr>` : ""}
          <tr class='tot'><td>Total</td><td></td><td>${IDR(rec.total)}</td></tr>
          <tr><td>Tunai</td><td></td><td>${IDR(rec.cash)}</td></tr>
          <tr><td>Kembali</td><td></td><td>${IDR(rec.change)}</td></tr>
        </table>
        <div class='meta'>Terima kasih! Follow @chafumatcha</div>
      </div>
      <script>window.print()</script>
      </body></html>
    `);
    w.document.close();
  };

  // ============================
  // RENDER
  // ============================
  if (!user) {
    return (
      <div style={{ padding: 40, textAlign: "center" }}>
        <h2>CHAFU MATCHA POS LOGIN</h2>
        <input placeholder="Email" value={loginEmail} onChange={(e) => setLoginEmail(e.target.value)} /><br />
        <input placeholder="Password" type="password" value={loginPass} onChange={(e) => setLoginPass(e.target.value)} /><br />
        <button onClick={login}>Login</button>
      </div>
    );
  }

  return (
    <div style={{ padding: 12 }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2>Chafu Matcha POS</h2>
        <div>
          <span>{user.email}</span>{" "}
          <button onClick={logout}>Logout</button>
        </div>
      </header>

      <nav style={{ marginTop: 10 }}>
        <button onClick={() => setTab("pos")}>Kasir</button>
        <button onClick={() => setTab("history")}>Riwayat</button>
        <button onClick={() => setTab("report")}>Laporan</button>
      </nav>

      {tab === "pos" && (
        <main style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <section style={{ border: "1px solid #ccc", padding: 8 }}>
            <h3>Menu</h3>
            {products.map((p) => (
              <div key={p.id} style={{ borderBottom: "1px solid #ddd", padding: "4px 0", cursor: "pointer" }} onClick={() => addToCart(p)}>
                {p.name} - {IDR(p.price)}
              </div>
            ))}
          </section>

          <section style={{ border: "1px solid #ccc", padding: 8 }}>
            <h3>Keranjang</h3>
            {cart.map((c) => (
              <div key={c.productId} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>{c.name} x{c.qty}</span>
                <div>
                  <button onClick={() => dec(c.productId)}>-</button>
                  <button onClick={() => inc(c.productId)}>+</button>
                  <button onClick={() => rm(c.productId)}>x</button>
                </div>
              </div>
            ))}
            <hr />
            <div>Subtotal: {IDR(subtotal)}</div>
            <div>Diskon: <input type="number" value={discount} onChange={(e) => setDiscount(Number(e.target.value))} style={{ width: 80 }} /></div>
            <div>
              <label>No HP:</label>
              <input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} />
              <div>Nama: <input value={customerName} onChange={(e) => setCustomerName(e.target.value)} /></div>
              <div>Poin: {customerPoints ?? "-"}</div>
              <div>Gunakan Poin: <input type="number" value={usePoints} onChange={(e) => setUsePoints(Number(e.target.value))} /></div>
            </div>
            <div>Metode: <select value={payMethod} onChange={(e) => setPayMethod(e.target.value)}>
              <option>Tunai</option><option>QRIS</option><option>GoPay</option><option>OVO</option><option>DANA</option><option>Transfer</option>
            </select></div>
            {payMethod !== "Tunai" && <img src="/qr-qris.png" width={200} alt="QR" />}
            <div>Total: <b>{IDR(total)}</b></div>
            {payMethod === "Tunai" && (
              <div>
                Uang Tunai: <input type="number" value={cash} onChange={(e) => setCash(Number(e.target.value))} />
                <div>Kembali: {IDR(change)}</div>
              </div>
            )}
            <button onClick={finalize}>Selesaikan & Cetak</button>
          </section>
        </main>
      )}

      {tab === "history" && (
        <section>
          <h3>Riwayat Transaksi</h3>
          <table border={1} cellPadding={4}>
            <thead><tr><th>Waktu</th><th>Total</th><th>Kasir</th></tr></thead>
            <tbody>{sales.map((s) => <tr key={s.id}><td>{s.time}</td><td>{IDR(s.total)}</td><td>{s.cashier}</td></tr>)}</tbody>
          </table>
        </section>
      )}
    </div>
  );
}

