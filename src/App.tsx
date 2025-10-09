// src/App.tsx — CHAFU MATCHA POS ✨ SUPER FINAL (one-file)
// ===================================================================================
// Fitur besar (tanpa lib tambahan):
// - POS: Tunai + E-Wallet (QR otomatis) + print struk 80mm
// - Inventory + Resep (auto deduct saat transaksi)
// - Loyalty (earn/redeem), katalog pelanggan, QR loyalty optional
// - Riwayat realtime, Export CSV
// - Owner Dashboard (mobile-friendly): KPI, tren harian, top produk, stok kritis
// - Offline-first: queue transaksi saat offline, auto-sync saat online
// - Integrasi Google Sheets (opsional via VITE_SHEETS_WEBHOOK)
// - Multi-outlet: selector outlet, filter dashboard per outlet
//
// Kebutuhan file:
// - public/qr-qris.png   → QR E-Wallet
// - src/lib/firebase.ts  → sudah versi yang kita pakai sebelumnya (Firestore ready)
//
// ENV (Vercel):
// - VITE_FIREBASE_* (semua yang sudah kamu pakai)
// - (opsional) VITE_SHEETS_WEBHOOK → URL Apps Script/Webhook untuk log transaksi & stok
//
// Catatan: Demi ringkas & stabil di mobile, chart menggunakan <canvas> sederhana.
// ===================================================================================

import React, { useEffect, useMemo, useRef, useState } from "react";
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

// ----------------------- Utils -----------------------
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

const SHEETS_WEBHOOK = (import.meta as any).env?.VITE_SHEETS_WEBHOOK || "";

// Draw simple line chart to canvas (no external lib)
function drawLineChart(canvas: HTMLCanvasElement, labels: string[], data: number[]) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const w = (canvas.width = canvas.clientWidth * (devicePixelRatio || 1));
  const h = (canvas.height = canvas.clientHeight * (devicePixelRatio || 1));

  ctx.clearRect(0, 0, w, h);
  ctx.scale(devicePixelRatio || 1, devicePixelRatio || 1);

  const pad = 20;
  const innerW = canvas.clientWidth - pad * 2;
  const innerH = canvas.clientHeight - pad * 2;

  const max = Math.max(1, Math.max(...data, 0));
  const stepX = data.length > 1 ? innerW / (data.length - 1) : 0;

  // grid
  ctx.strokeStyle = "#eee";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad + (innerH / 4) * i;
    ctx.beginPath();
    ctx.moveTo(pad, y);
    ctx.lineTo(pad + innerW, y);
    ctx.stroke();
  }

  // line
  ctx.strokeStyle = "#2e7d32";
  ctx.lineWidth = 2;
  ctx.beginPath();
  data.forEach((v, idx) => {
    const x = pad + stepX * idx;
    const y = pad + innerH - (v / max) * innerH;
    if (idx === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // dots
  ctx.fillStyle = "#2e7d32";
  data.forEach((v, idx) => {
    const x = pad + stepX * idx;
    const y = pad + innerH - (v / max) * innerH;
    ctx.beginPath();
    ctx.arc(x, y, 2.5, 0, Math.PI * 2);
    ctx.fill();
  });
}

// -------------- Types --------------
type Product = { id: number; name: string; price: number; active?: boolean; category?: string };
type CartItem = { id: string; productId: number; name: string; price: number; qty: number };

type SaleRow = {
  id?: string;
  time: string;
  timeMs: number;
  cashier: string;
  outletId?: string;
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
  outletId?: string;
  closedAt?: number | null;
  closedBy?: string | null;
  cashOpen?: number;
  cashClose?: number;
  totals?: Record<string, number>;
  trxCount?: number;
};

type SettingsDoc = {
  pointEarnPerRp: number;
  pointValueRp: number;
  maxRedeemPoints?: number;
  pointExpiryDays?: number;
  lowStockThreshold?: number;
};

// -------------- Defaults --------------
const DEFAULT_PRODUCTS: Product[] = [
  { id: 1, name: "Matcha OG", price: 15000, active: true, category: "Signature" },
  { id: 2, name: "Matcha Cloud", price: 18000, active: true, category: "Signature" },
  { id: 3, name: "Strawberry Cream Matcha", price: 17000, active: true, category: "Signature" },
  { id: 4, name: "Choco Matcha", price: 17000, active: true, category: "Signature" },
  { id: 5, name: "Matcha Cookies", price: 17000, active: true, category: "Signature" },
  { id: 6, name: "Honey Matcha", price: 18000, active: true, category: "Signature" },
  { id: 7, name: "Coconut Matcha", price: 18000, active: true, category: "Signature" },
  { id: 8, name: "Orange Matcha", price: 17000, active: true, category: "Signature" },
];

const DEFAULT_SETTINGS: SettingsDoc = {
  pointEarnPerRp: 10000,
  pointValueRp: 100,
  maxRedeemPoints: 0,
  pointExpiryDays: 0,
  lowStockThreshold: 10,
};

// -------------- Offline Queue Keys --------------
const K_PENDING_SALES = "pos.pendingSales.v1"; // antrian transaksi offline
const K_OUTLET = "pos.outlet.v1";

// ===================================================================================
// MAIN APP
// ===================================================================================
export default function App() {
  const auth = getAuth();

  // Auth
  const [user, setUser] = useState<User | null>(null);
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");

  // Tabs
  const [tab, setTab] = useState<"pos" | "produk" | "inventori" | "resep" | "riwayat" | "laporan" | "dashboard" | "loyalty">("pos");

  // Outlet
  const [outletId, setOutletId] = useState<string>(() => localStorage.getItem(K_OUTLET) || "OUTLET-01");
  useEffect(() => localStorage.setItem(K_OUTLET, outletId), [outletId]);

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
  const [report, setReport] = useState<{ omzet: number; trx: number; aov: number; top: { name: string; qty: number }[], trend: { d: string; amt: number }[] }>({
    omzet: 0, trx: 0, aov: 0, top: [], trend: []
  });

  // Online state
  const [online, setOnline] = useState<boolean>(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);

  // ---------- Auth lifecycle ----------
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        await ensureUserProfile(u);
        await loadSettings();
        await loadData();
        subscribeSales(); // realtime riwayat
        hydratePendingQueue(); // coba sync jika ada antrian
      }
    });
    return () => unsub();
  }, []);

  // ---------- Subscribe Riwayat ----------
  function subscribeSales() {
    const mail = user?.email || "";
    const isAdmin = isAdminEmail(mail);
    // admin melihat semua outlet, kasir melihat outlet aktif
    const base = collection(db, "sales");
    const qSales = isAdmin
      ? query(base, orderBy("createdAt", "desc"))
      : query(base, where("outletId", "==", outletId), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(qSales, (snap) => {
      const rows: SaleRow[] = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
      setSales(rows);
    });
    return unsub;
  }

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
      await setDoc(ref, { email: mail, role, createdAt: Date.now(), outletId });
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
      name: customerName || base.name || "",
      points: (base.points || 0) + earned,
      visits: (base.visits || 0) + 1,
      lastVisit: Date.now()
    }, { merge: true });
    await addDoc(collection(db, "loyalty_logs"), {
      phone, pointsChange: earned, type: "earn", saleId, at: Date.now(), outletId
    });
  }

  async function redeemLoyaltyPoints(phone: string, usePts: number, saleId: string) {
    if (!phone || usePts <= 0) return;
    const ref = doc(db, "customers", phone);
    const snap = await getDoc(ref);
    const current = snap.exists() ? ((snap.data() as any).points || 0) : 0;
    const newPts = Math.max(0, current - usePts);
    await setDoc(ref, { points: newPts }, { merge: true });
    await addDoc(collection(db, "loyalty_logs"), {
      phone, pointsChange: -usePts, type: "redeem", saleId, at: Date.now(), outletId
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

  // ---------- Offline queue ----------
  function pushPending(rec: any) {
    const arr = JSON.parse(localStorage.getItem(K_PENDING_SALES) || "[]");
    arr.unshift(rec);
    localStorage.setItem(K_PENDING_SALES, JSON.stringify(arr));
  }
  async function hydratePendingQueue() {
    if (!navigator.onLine) return;
    const arr: any[] = JSON.parse(localStorage.getItem(K_PENDING_SALES) || "[]");
    if (!arr.length) return;
    for (const rec of [...arr].reverse()) {
      try {
        await addDoc(collection(db, "sales"), rec);
        arr.shift();
      } catch {}
    }
    localStorage.setItem(K_PENDING_SALES, JSON.stringify([]));
  }
  useEffect(() => { if (online) hydratePendingQueue(); }, [online]);

  // ---------- Finalize ----------
  async function finalizeSale() {
    if (!cart.length) return alert("Keranjang kosong!");
    if (usePoints > redeemCap) return alert("Poin yang digunakan melebihi batas.");
    if (payMethod === "Tunai" && cash < finalTotal) return alert("Uang kurang!");

    const saleId = Date.now().toString();
    const earned = calcEarnedPoints(finalTotal);

    if (customerPhone && customerName.trim()) {
      await setDoc(doc(db, "customers", customerPhone), { name: customerName.trim() }, { merge: true });
    }

    const rec: SaleRow = {
      time: new Date().toLocaleString("id-ID", { hour12: false }),
      timeMs: Date.now(),
      cashier: user?.email || "-",
      outletId,
      items: cart.map((i) => ({ name: i.name, qty: i.qty, price: i.price })),
      subtotal,
      discount: redeemValueRp,
      taxRate: 0, serviceRate: 0, taxValue: 0, serviceValue: 0,
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

    try {
      if (navigator.onLine) {
        await addDoc(collection(db, "sales"), rec);
      } else {
        pushPending(rec);
      }

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

      // optional push to Google Sheets / webhook
      if (SHEETS_WEBHOOK) {
        try {
          fetch(SHEETS_WEBHOOK, { method: "POST", body: JSON.stringify({ type: "sale", outletId, ...rec }) });
        } catch {}
      }

      printReceipt80mm({
        ...rec,
        subtotal,
        total: finalTotal,
        cash: rec.cash,
        change: rec.change,
      });

      clearCart();
      alert("Transaksi selesai ✅");
    } catch (e: any) {
      alert("Gagal menyimpan transaksi, disimpan ke antrian offline.");
      pushPending(rec);
    }
  }

  // ---------- Shift ----------
  async function openShift() {
    if (activeShift && !activeShift.closedAt) return alert("Shift masih aktif.");
    const cashOpen = Number(prompt("Cash Drawer Awal (opsional)?") || 0);
    const sh: ShiftDoc = { openedAt: Date.now(), openedBy: user?.email || "-", cashOpen, outletId };
    const ref = await addDoc(collection(db, "shifts"), { ...sh, closedAt: null });
    setActiveShift({ ...sh, id: ref.id, closedAt: null });

    if (SHEETS_WEBHOOK) {
      try { fetch(SHEETS_WEBHOOK, { method: "POST", body: JSON.stringify({ type: "shift_open", ...sh }) }); } catch {}
    }
    alert("Shift dibuka ✅");
  }

  async function closeShift() {
    if (!activeShift || activeShift.closedAt) return alert("Tidak ada shift aktif.");
    const rows = await getSalesRange(activeShift.openedAt, Date.now(), outletId);
    const totals: Record<string, number> = {};
    let trx = 0;
    for (const r of rows) {
      totals[r.payMethod] = (totals[r.payMethod] || 0) + (r.total || 0);
      trx++;
    }
    const cashClose = Number(prompt("Cash Drawer Akhir (opsional)?") || 0);
    const closed = { closedAt: Date.now(), closedBy: user?.email || "-", totals, trxCount: trx, cashClose };
    await updateDoc(doc(db, "shifts", activeShift.id!), closed);
    exportShiftCSV({ ...activeShift, ...closed });

    if (SHEETS_WEBHOOK) {
      try { fetch(SHEETS_WEBHOOK, { method: "POST", body: JSON.stringify({ type: "shift_close", outletId, ...activeShift, ...closed }) }); } catch {}
    }

    setActiveShift(null);
    alert("Shift ditutup ✅ dan CSV diunduh.");
  }

  function exportShiftCSV(sh: ShiftDoc) {
    const hdr = ["outlet", "openedAt", "openedBy", "closedAt", "closedBy", "trxCount", "cashOpen", "cashClose", "method", "amount"];
    const lines = [hdr.join(",")];
    const rows = Object.entries(sh.totals || { Unknown: 0 }).map(([m, a]) => [
      outletId, sh.openedAt, sh.openedBy, sh.closedAt, sh.closedBy, sh.trxCount ?? 0, sh.cashOpen ?? 0, sh.cashClose ?? 0, m, a
    ]);
    for (const r of rows) lines.push(r.join(","));
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `shift_${outletId}_${sh.openedAt}_${sh.closedAt}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  // ---------- Laporan & Dashboard ----------
  function ymdToMs(ymd: string) {
    const [y, m, d] = ymd.split("-").map(Number);
    return new Date(y, (m - 1), d, 0, 0, 0, 0).getTime();
  }

  async function getSalesRange(startMs: number, endMs: number, outlet?: string) {
    const base = collection(db, "sales");
    const qy = outlet
      ? query(base, where("outletId", "==", outlet), where("deviceDate", ">=", startMs), where("deviceDate", "<", endMs), orderBy("deviceDate", "desc"))
      : query(base, where("deviceDate", ">=", startMs), where("deviceDate", "<", endMs), orderBy("deviceDate", "desc"));
    const snap = await getDocs(qy);
    return snap.docs.map(d => ({ id: d.id, ...d.data() })) as any[];
  }

  function summarizeSales(rows: any[]) {
    const omzet = rows.reduce((s, r) => s + (r.total || 0), 0);
    const trx = rows.length;
    const aov = trx ? Math.round(omzet / trx) : 0;

    const productCount: Record<string, number> = {};
    const dayMap: Record<string, number> = {};
    for (const r of rows) {
      const date = new Date(r.deviceDate || r.timeMs).toISOString().slice(0, 10);
      dayMap[date] = (dayMap[date] || 0) + (r.total || 0);
      for (const it of (r.items || [])) {
        productCount[it.name] = (productCount[it.name] || 0) + (it.qty || 0);
      }
    }
    const top = Object.entries(productCount)
      .sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([name, qty]) => ({ name, qty }));
    const trend = Object.entries(dayMap).sort((a, b) => a[0].localeCompare(b[0])).map(([d, amt]) => ({ d, amt }));
    return { omzet, trx, aov, top, trend };
  }

  async function loadReport() {
    if (!from || !to) return alert("Pilih tanggal dari & sampai");
    const start = ymdToMs(from);
    const end = ymdToMs(to) + 24 * 60 * 60 * 1000;
    const rows = await getSalesRange(start, end, outletId);
    setReport(summarizeSales(rows));
  }

  // ---------- Export ----------
  function exportSalesCSV() {
    if (!sales.length) return alert("Tidak ada data.");
    const hdr = ["time","outlet","payMethod","total","items"];
    const lines = [hdr.join(",")];
    for (const s of sales) {
      const items = (s.items || []).map(it => `${it.name} x${it.qty}`).join("; ");
      lines.push([s.time, s.outletId || "", s.payMethod, s.total, `"${String(items).replace(/"/g, '""')}"`].join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `sales_${outletId}_${Date.now()}.csv`; a.click();
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
    const a = document.createElement("a"); a.href = url; a.download = `report_${outletId}_${from}_${to}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  // ---------- Auth UI ----------
  async function login() {
    try {
      await signInWithEmailAndPassword(getAuth(), email, pass);
    } catch (e: any) {
      alert("Login gagal: " + e.message);
    }
  }
  async function logout() { await signOut(getAuth()); }

  // ---------- Loyalty QR (optional, pakai layanan QR publik) ----------
  const loyaltyUrl = customerPhone ? `https://loyalty.chafumatcha.app/p/${encodeURIComponent(customerPhone)}` : "";
  const loyaltyQR = customerPhone
    ? `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(loyaltyUrl)}`
    : "";

  // ---------- UI: Login ----------
  if (!user)
    return (
      <div style={{ padding: 20, maxWidth: 420, margin: "0 auto" }}>
        <h2>CHAFU MATCHA POS — Login</h2>
        <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
          <label>Outlet</label>
          <select value={outletId} onChange={(e)=>setOutletId(e.target.value)}>
            <option value="OUTLET-01">OUTLET-01</option>
            <option value="OUTLET-02">OUTLET-02</option>
            <option value="OUTLET-03">OUTLET-03</option>
          </select>
          <input placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input type="password" placeholder="Password" value={pass} onChange={(e) => setPass(e.target.value)} />
          <button onClick={login} style={{ background: "#2e7d32", color: "#fff", padding: 10, borderRadius: 8 }}>Login</button>
        </div>
        <p style={{ fontSize: 12, opacity: .7, marginTop: 6 }}>Status: {online ? "Online" : "Offline (akan sync otomatis)"}</p>
      </div>
    );

  // ---------- UI: Main ----------
  return (
    <div style={{ padding: 10, maxWidth: 1100, margin: "0 auto" }}>
      <header style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: 0 }}>CHAFU MATCHA POS</h1>
          <small>Outlet: </small>
          <select value={outletId} onChange={(e)=>setOutletId(e.target.value)}>
            <option value="OUTLET-01">OUTLET-01</option>
            <option value="OUTLET-02">OUTLET-02</option>
            <option value="OUTLET-03">OUTLET-03</option>
          </select>
          <small style={{ marginLeft: 8, color: online ? "#2e7d32" : "#c62828" }}>
            {online ? "Online" : "Offline — transaksi akan diantrikan"}
          </small>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button onClick={() => setTab("pos")}>POS</button>
          {isAdmin && (
            <>
              <button onClick={() => setTab("produk")}>Produk</button>
              <button onClick={() => setTab("inventori")}>Inventory</button>
              <button onClick={() => setTab("resep")}>Resep</button>
              <button onClick={() => setTab("riwayat")}>Riwayat</button>
              <button onClick={() => setTab("laporan")}>Laporan</button>
              <button onClick={() => setTab("dashboard")}>Dashboard</button>
              <button onClick={() => setTab("loyalty")}>Loyalty</button>
              <button onClick={openShift}>Buka Shift</button>
              <button onClick={closeShift} style={{ background: "#263238", color: "#fff" }}>
                Tutup Shift {activeShift ? "(aktif)" : ""}
              </button>
            </>
          )}
          <button onClick={logout} style={{ background: "#e53935", color: "#fff" }}>Logout</button>
        </div>
      </header>

      {/* POS */}
      {tab === "pos" && (
        <main style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {/* Menu */}
          <section style={{ border: "1px solid #ddd", borderRadius: 8, padding: 10 }}>
            <h2>Menu</h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(140px,1fr))", gap: 8 }}>
              {products.filter(p => p.active !== false).map((p) => (
                <button key={p.id} onClick={() => addToCart(p)} style={{ textAlign: "left", border: "1px solid #eee", borderRadius: 10, padding: 10 }}>
                  <div>{p.name}</div>
                  <small>{IDR(p.price)}</small>
                </button>
              ))}
            </div>
          </section>

          {/* Keranjang */}
          <section style={{ border: "1px solid #ddd", borderRadius: 8, padding: 10 }}>
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

            {cart.length === 0 && <p style={{ marginTop: 8 }}>Belum ada item.</p>}
            {cart.map((c) => (
              <div key={c.id} style={{ display: "grid", gridTemplateColumns: "1fr auto auto auto", gap: 8, alignItems: "center", margin: "6px 0" }}>
                <div>{c.name} <small>x{c.qty}</small></div>
                <div>{IDR(c.price * c.qty)}</div>
                <div>
                  <button onClick={() => dec(c)}>-</button>
                  <button onClick={() => inc(c)}>+</button>
                </div>
                <button onClick={() => rm(c)}>Hapus</button>
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
                  <img src={walletQR[payMethod]} alt="QR" style={{ maxWidth: 240 }} />
                  <p>Scan untuk bayar ({payMethod})</p>
                </div>
              )}

              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={clearCart}>Bersihkan</button>
                <button style={{ background: "#2e7d32", color: "#fff", flex: 1 }} onClick={finalizeSale}>
                  Selesaikan & Cetak
                </button>
              </div>
            </div>
          </section>
        </main>
      )}

      {/* Produk */}
      {tab === "produk" && isAdmin && (
        <main style={{ marginTop: 12 }}>
          <h2>Manajemen Produk</h2>
          <ProductManager products={products} onChange={setProducts} />
        </main>
      )}

      {/* Inventory */}
      {tab === "inventori" && isAdmin && (
        <main style={{ marginTop: 12 }}>
          <h2>Inventory Bahan</h2>
          <InventoryManager ingredients={ingredients} onChange={setIngredients} outletId={outletId} />
        </main>
      )}

      {/* Resep */}
      {tab === "resep" && isAdmin && (
        <main style={{ marginTop: 12 }}>
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
        <main style={{ marginTop: 12 }}>
          <div style={{display:"flex", justifyContent:"space-between", alignItems:"center"}}>
            <h2>Riwayat Transaksi</h2>
            <button onClick={exportSalesCSV}>Export CSV</button>
          </div>
          {sales.length === 0 ? (
            <p>Belum ada transaksi.</p>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>Waktu</th>
                  <th style={{ textAlign: "left" }}>Outlet</th>
                  <th style={{ textAlign: "left" }}>Item</th>
                  <th style={{ textAlign: "right" }}>Total</th>
                  <th style={{ textAlign: "center" }}>Metode</th>
                </tr>
              </thead>
              <tbody>
                {sales.map((s) => (
                  <tr key={s.id}>
                    <td>{s.time}</td>
                    <td>{s.outletId || "-"}</td>
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

      {/* Laporan (range & summary) */}
      {tab === "laporan" && isAdmin && (
        <main style={{ marginTop: 12 }}>
          <div style={{display:"flex", justifyContent:"space-between", alignItems:"center"}}>
            <h2>Laporan ({outletId})</h2>
            <div style={{display:"flex", gap:8}}>
              <button onClick={exportReportCSV}>Export CSV</button>
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
            <label>Dari:</label>
            <input type="date" value={from} onChange={e => setFrom(e.target.value)} />
            <label>Sampai:</label>
            <input type="date" value={to} onChange={e => setTo(e.target.value)} />
            <button onClick={loadReport}>Terapkan</button>
            <button onClick={() => {
              const t = new Date();
              const yyyy = t.getFullYear();
              const mm = String(t.getMonth() + 1).padStart(2, "0");
              const dd = String(t.getDate()).padStart(2, "0");
              setFrom(`${yyyy}-${mm}-${dd}`); setTo(`${yyyy}-${mm}-${dd}`);
            }}>Hari ini</button>
            <button onClick={() => {
              const end = new Date();
              const start = new Date(end); start.setDate(end.getDate() - 6);
              const f = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
              setFrom(f(start)); setTo(f(end));
            }}>7 hari</button>
            <button onClick={() => {
              const t = new Date();
              const f = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-01`;
              const toStr = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
              setFrom(f); setTo(toStr);
            }}>Bulan ini</button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginTop: 12 }}>
            <div style={{ padding: 10, border: "1px solid #eee", borderRadius: 8 }}><b>Omzet</b><br />{IDR(report.omzet)}</div>
            <div style={{ padding: 10, border: "1px solid #eee", borderRadius: 8 }}><b>Transaksi</b><br />{report.trx}</div>
            <div style={{ padding: 10, border: "1px solid #eee", borderRadius: 8 }}><b>AOV</b><br />{IDR(report.aov)}</div>
          </div>

          <h3 style={{ marginTop: 16 }}>Top Produk</h3>
          {report.top.length === 0 ? <p>-</p> : (
            <ul>
              {report.top.map(t => <li key={t.name}>{t.name} — {t.qty} cup</li>)}
            </ul>
          )}
        </main>
      )}

      {/* Owner Dashboard (tren + stok kritis) */}
      {tab === "dashboard" && isAdmin && (
        <DashboardView outletId={outletId} report={report} from={from} to={to} onRefresh={loadReport} ingredients={ingredients} />
      )}

      {/* Loyalty page (QR pelanggan) */}
      {tab === "loyalty" && isAdmin && (
        <main style={{ marginTop: 12 }}>
          <h2>Digital Loyalty Card (Preview)</h2>
          <p>Masukkan nomor HP pelanggan di tab POS → bagian loyalty. Halaman pelanggan:</p>
          <code style={{ display:"block", wordBreak:"break-all", background:"#f8f8f8", padding:8, borderRadius:6 }}>
            {customerPhone ? loyaltyUrl : "(isi No HP dulu di POS)"}
          </code>
          {customerPhone && (
            <div style={{ marginTop: 10 }}>
              <img src={loyaltyQR} alt="QR Pelanggan" />
              <p style={{ fontSize:12, opacity:.7 }}>*QR ini menggunakan generator publik. Kamu bisa ganti ke generator lokal nanti.</p>
            </div>
          )}
        </main>
      )}
    </div>
  );
}

// ===================================================================================
// Sub-Komponen
// ===================================================================================

function ProductManager({ products, onChange }: { products: Product[]; onChange: (x: Product[]) => void }) {
  const [form, setForm] = useState<Product>({ id: 0, name: "", price: 0, active: true, category: "Signature" });

  async function save() {
    if (!form.id || !form.name || !form.price) return alert("ID, Nama, dan Harga wajib diisi!");
    await upsertProduct(form);
    onChange(await fetchProducts());
    setForm({ id: 0, name: "", price: 0, active: true, category: "Signature" });
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
        <input placeholder="Kategori" value={form.category || ""} onChange={(e) => setForm({ ...form, category: e.target.value })} />
        <input placeholder="Harga" type="number" value={form.price || 0} onChange={(e) => setForm({ ...form, price: Number(e.target.value) })} />
        <button onClick={save}>Simpan</button>
      </div>
      {products.map((p) => (
        <div key={p.id} style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
          <span>{p.name} — {IDR(p.price)}</span>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setForm(p)}>Edit</button>
            <button onClick={() => del(p)}>Hapus</button>
          </div>
        </div>
      ))}
    </div>
  );
}

function InventoryManager({ ingredients, onChange, outletId }: { ingredients: InvIngredient[]; onChange: (x: InvIngredient[]) => void; outletId: string }) {
  const [form, setForm] = useState<InvIngredient>({ name: "", unit: "", stock: 0 });
  const webhook = (import.meta as any).env?.VITE_SHEETS_WEBHOOK || "";

  async function save() {
    if (!form.name) return alert("Nama bahan wajib diisi!");
    await upsertIngredient(form);
    onChange(await fetchIngredients());
    if (webhook) { try { fetch(webhook, { method: "POST", body: JSON.stringify({ type:"stock_upsert", outletId, ...form }) }); } catch {} }
    setForm({ name: "", unit: "", stock: 0 });
  }

  async function del(i: InvIngredient) {
    if (!confirm(`Hapus ${i.name}?`)) return;
    await deleteIngredient(i.id!);
    onChange(await fetchIngredients());
    if (webhook) { try { fetch(webhook, { method: "POST", body: JSON.stringify({ type:"stock_delete", outletId, id:i.id }) }); } catch {} }
  }

  async function adjustItem(i: InvIngredient, delta: number) {
    const current = Number(i.stock || 0);
    const newStock = current + delta;
    await adjustStock([{ ingredientId: String(i.id), newStock, note: delta > 0 ? `+${delta}` : `${delta}` }]);
    onChange(await fetchIngredients());
    if (webhook) { try { fetch(webhook, { method: "POST", body: JSON.stringify({ type:"stock_adjust", outletId, id:i.id, delta }) }); } catch {} }
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <input placeholder="Nama bahan" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input placeholder="Satuan (ml/gr/pcs)" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} />
        <input placeholder="Stok awal" type="number" value={form.stock || 0} onChange={(e) => setForm({ ...form, stock: Number(e.target.value) })} />
        <button onClick={save}>Simpan</button>
      </div>

      {ingredients.map((i) => (
        <div key={i.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <span>{i.name} ({i.stock} {i.unit})</span>
          <div style={{ display: "flex", gap: 6 }}>
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
          <button onClick={saveRecipe}>Simpan Resep</button>
        </>
      )}
    </div>
  );
}

function DashboardView({
  outletId, report, from, to, onRefresh, ingredients
}: {
  outletId: string;
  report: { omzet: number; trx: number; aov: number; top: { name: string; qty: number }[], trend: { d: string; amt: number }[] };
  from: string; to: string; onRefresh: () => void;
  ingredients: InvIngredient[];
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const labels = report.trend.map(t => t.d.slice(5)); // MM-DD
    const data = report.trend.map(t => t.amt);
    drawLineChart(ref.current, labels, data);
  }, [report]);

  return (
    <main style={{ marginTop: 12 }}>
      <div style={{display:"flex", justifyContent:"space-between", alignItems:"center"}}>
        <h2>Owner Dashboard — {outletId}</h2>
        <button onClick={onRefresh}>Refresh</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginTop: 12 }}>
        <div style={{ padding: 10, border: "1px solid #eee", borderRadius: 8 }}><b>Omzet</b><br />{IDR(report.omzet)}</div>
        <div style={{ padding: 10, border: "1px solid #eee", borderRadius: 8 }}><b>Transaksi</b><br />{report.trx}</div>
        <div style={{ padding: 10, border: "1px solid #eee", borderRadius: 8 }}><b>AOV</b><br />{IDR(report.aov)}</div>
      </div>

      <h3 style={{ marginTop: 16 }}>Tren Harian</h3>
      <div style={{ width: "100%", height: 180, border: "1px solid #eee", borderRadius: 8, padding: 6 }}>
        <canvas ref={ref} style={{ width: "100%", height: 160 }} />
      </div>

      <h3 style={{ marginTop: 16 }}>Top Produk</h3>
      {report.top.length === 0 ? <p>-</p> : (
        <ol>
          {report.top.map(t => <li key={t.name}>{t.name} — {t.qty} cup</li>)}
        </ol>
      )}

      <h3 style={{ marginTop: 16 }}>Stok Kritis</h3>
      <ul>
        {ingredients.filter(i => (i.stock || 0) <= 10).map(i => (
          <li key={i.id}>{i.name}: {i.stock} {i.unit}</li>
        ))}
      </ul>

      <p style={{ fontSize: 12, opacity:.7 }}>Periode: {from || "(pilih)"} s/d {to || "(pilih)"} — gunakan tab <b>Laporan</b> untuk set tanggal</p>
    </main>
  );
}

// ---------------- Print 80mm ----------------
function printReceipt80mm(rec: {
  time: string; cashier: string;
  items: { name: string; qty: number; price: number }[];
  subtotal: number; discount: number;
  taxRate: number; serviceRate: number;
  taxValue: number; serviceValue: number;
  total: number; cash: number; change: number;
}) {
  const w = window.open("", "_blank", "width=420,height=700");
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
  @media print { @page { size: 80mm auto; margin: 0; } body { margin:0; } }
  body { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  .wrap { width: 76mm; margin: 0 auto; padding: 3mm; }
  h2 { margin: 4px 0; text-align: center; font-size: 14px; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 2px 0; font-size: 12px; border-bottom: 1px dashed #ddd; }
  .tot td { border-bottom: none; font-weight: 700; }
  .meta { font-size: 11px; text-align: center; opacity: .8; }
</style></head>
<body>
  <div class="wrap">
    <h2>CHAFU MATCHA</h2>
    <div class="meta">${new Date().toLocaleString("id-ID", { hour12:false })}<br/>Kasir: ${rec.cashier}</div>
    <hr/>
    <table>
      ${rows}
      <tr class="tot"><td>Subtotal</td><td></td><td style="text-align:right">${rec.subtotal.toLocaleString("id-ID")}</td></tr>
      ${rec.discount ? `<tr class="tot"><td>Potongan</td><td></td><td style="text-align:right">-${rec.discount.toLocaleString("id-ID")}</td></tr>` : ""}
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
