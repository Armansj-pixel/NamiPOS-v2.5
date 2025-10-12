import React, { useEffect, useMemo, useState } from "react";
import { auth, db, IDR } from "./lib/firebase";
import {
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
  User,
} from "firebase/auth";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";

/* ================== KONFIG ================== */
const SHOP_NAME = "CHAFU MATCHA";
const OUTLET = "@MTHaryono";
const ADMIN_EMAILS = [
  "antonius.arman123@gmail.com",
  "ayuismaalabibbah@gmail.com",
];

/* ================== TYPES ================== */
type RecipeItem = { ingredientId: string; qty: number };
type Product = {
  id?: string;
  name: string;
  price: number;
  category: string;
  active?: boolean;
  recipe?: RecipeItem[]; // per 1 cup
};
type Ingredient = {
  id?: string;
  name: string;
  unit: string; // gr/ml/pcs
  stock: number;
  low?: number;
};
type CartItem = {
  productId: string;
  name: string;
  price: number;
  qty: number;
  note?: string; // undefined di state, nanti dipetakan ke null saat simpan
};
type Sale = {
  id?: string;
  time: string;
  cashier: string;
  shiftId?: string | null;
  items: CartItem[];
  subtotal: number;
  discount: number;
  taxRate: number;
  serviceRate: number;
  taxValue: number;
  serviceValue: number;
  total: number;
  method: "cash" | "ewallet";
  cash: number;
  change: number;
  outlet: string;
  customerPhone?: string | null;
  customerName?: string | null;
  pointsEarned?: number;
  loyaltyUrl?: string | null;
};

type Shift = {
  id?: string;
  outlet: string;
  open: boolean;
  openedBy: string;
  openTime: string; // ISO
  openingCash: number;
  closedBy?: string | null;
  closeTime?: string | null; // ISO
  closingCash?: number | null;
  totals?: {
    cash: number;
    ewallet: number;
    salesCount: number;
    revenue: number;
    expectedCash: number; // openingCash + cash - payout (payout belum dipakai)
    difference: number;   // closingCash - expectedCash
  };
  note?: string | null;
};

/* ========== Helper: sanitasi Firestore ========== */
function cleanForFirestore<T>(value: T): T {
  if (value === undefined) return null as T;
  if (typeof value === "number" && !Number.isFinite(value)) return 0 as T;
  if (Array.isArray(value)) {
    return value.map((v) => cleanForFirestore(v)) as unknown as T;
  }
  if (value && typeof value === "object") {
    const out: any = {};
    for (const [k, v] of Object.entries(value as any)) {
      if (v === undefined) continue;
      if (typeof v === "number" && !Number.isFinite(v)) continue;
      out[k] = cleanForFirestore(v as any);
    }
    return out;
  }
  return value as T;
}

/* ================== LOYALTY ================== */
const ORIGIN = typeof window !== "undefined" ? window.location.origin : "";
const loyaltyUrlFor = (phone: string) =>
  `${ORIGIN}/loyalty/?uid=${encodeURIComponent(phone.replace(/\D/g, ""))}`;

async function fetchCustomerByPhone(phone: string) {
  const id = phone.replace(/\D/g, "");
  const ref = doc(collection(db, "customers"), id);
  const snap = await getDoc(ref);
  return { id, ref, data: snap.exists() ? (snap.data() as any) : null };
}
async function createCustomer(phone: string, name: string) {
  const id = phone.replace(/\D/g, "");
  const ref = doc(collection(db, "customers"), id);
  await setDoc(ref, {
    phone,
    name,
    points: 0,
    visits: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return { id, ref };
}
async function addLoyalty(phone: string, addPoints: number, plusVisit = true) {
  const { ref } = await fetchCustomerByPhone(phone);
  await updateDoc(ref, {
    points: increment(addPoints),
    ...(plusVisit ? { visits: increment(1) } : {}),
    updatedAt: serverTimestamp(),
  });
}

/* ================== APP ================== */
export default function App() {
  /* Auth */
  const [user, setUser] = useState<User | null>(null);
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  useEffect(() => onAuthStateChanged(auth, setUser), []);
  const isAdmin = useMemo(
    () => !!user?.email && ADMIN_EMAILS.includes(String(user.email).toLowerCase()),
    [user]
  );

  /* Master data */
  const [products, setProducts] = useState<Product[]>([]);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);

  /* Tabs (Dashboard ditambahkan) */
  const [tab, setTab] = useState<
    "pos" | "history" | "products" | "inventory" | "settings" | "dashboard"
  >("pos");

  /* POS State */
  const [cart, setCart] = useState<CartItem[]>([]);
  const [discount, setDiscount] = useState(0);
  const [taxRate, setTaxRate] = useState(0);
  const [serviceRate, setServiceRate] = useState(0);
  const [method, setMethod] = useState<"cash" | "ewallet">("cash");
  const [cash, setCash] = useState(0);
  const [note, setNote] = useState("");

  /* Loyalty form */
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPoints, setCustomerPoints] = useState(0);
  const [customerKnown, setCustomerKnown] = useState(false);
  const [lookingUp, setLookingUp] = useState(false);

  /* History & Dashboard data */
  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(false);

  /* Shift */
  const [activeShift, setActiveShift] = useState<Shift | null>(null);

  /* Derived totals */
  const subtotal = cart.reduce((s, i) => s + i.price * i.qty, 0);
  const taxValue = Math.round(subtotal * (taxRate / 100));
  const serviceValue = Math.round(subtotal * (serviceRate / 100));
  const total = Math.max(0, subtotal + taxValue + serviceValue - (discount || 0));
  const change = Math.max(0, (cash || 0) - total);

  /* Load master */
  async function loadProducts() {
    const snap = await getDocs(query(collection(db, "products"), orderBy("name", "asc")));
    setProducts(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as Product[]);
  }
  async function loadIngredients() {
    const snap = await getDocs(query(collection(db, "ingredients"), orderBy("name", "asc")));
    setIngredients(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as Ingredient[]);
  }
  async function loadSales() {
    setLoading(true);
    try {
      const snap = await getDocs(
        query(collection(db, "sales"), where("outlet", "==", OUTLET), orderBy("time", "desc"))
      );
      setSales(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as Sale[]);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    loadProducts();
    loadIngredients();
    loadActiveShift();
  }, []);

  /* Helpers tanggal & loader khusus Dashboard */
  function startOfDay(d = new Date()) {
    const x = new Date(d); x.setHours(0,0,0,0); return x;
  }
  function startOfWeek(d = new Date()) {
    const x = startOfDay(d);
    const day = x.getDay(); // 0 Minggu
    const diff = (day + 6) % 7; // Senin awal
    x.setDate(x.getDate() - diff);
    return x;
  }
  function startOfMonth(d = new Date()) {
    const x = startOfDay(d); x.setDate(1); return x;
  }
  async function loadSalesLastNDays(days: number) {
    setLoading(true);
    try {
      const since = new Date();
      since.setDate(since.getDate() - days);
      const qy = query(
        collection(db, "sales"),
        where("outlet", "==", OUTLET),
        where("time", ">=", since.toISOString()),
        orderBy("time", "desc")
      );
      const snap = await getDocs(qy);
      setSales(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as Sale[]);
    } finally {
      setLoading(false);
    }
  }
  function lastNDates(n: number) {
    const out: string[] = [];
    const d = new Date();
    for (let i = n - 1; i >= 0; i--) {
      const x = new Date(d);
      x.setDate(d.getDate() - i);
      x.setHours(0, 0, 0, 0);
      out.push(x.toISOString().slice(0, 10));
    }
    return out;
  }
  function buildDailySeries(data: Sale[], days = 14) {
    const keys = lastNDates(days);
    const revenueMap: Record<string, number> = {};
    const cupsMap: Record<string, number> = {};
    for (const k of keys) { revenueMap[k] = 0; cupsMap[k] = 0; }
    for (const s of data) {
      const day = (s.time || "").slice(0, 10);
      if (!revenueMap.hasOwnProperty(day)) continue;
      revenueMap[day] += Number(s.total || 0);
      cupsMap[day] += s.items?.reduce((sum, i) => sum + (i.qty || 0), 0) || 0;
    }
    return {
      labels: keys.map((k) => k.slice(5)),
      revenue: keys.map((k) => revenueMap[k]),
      cups: keys.map((k) => cupsMap[k]),
    };
  }

  /* Loyalty lookup (debounce) */
  useEffect(() => {
    const t = setTimeout(async () => {
      const phone = customerPhone.trim();
      if (!/\d{6,}/.test(phone)) {
        setCustomerKnown(false);
        setCustomerName("");
        setCustomerPoints(0);
        return;
      }
      setLookingUp(true);
      try {
        const { data } = await fetchCustomerByPhone(phone);
        if (data) {
          setCustomerKnown(true);
          setCustomerName(data.name || "");
          setCustomerPoints(Number(data.points || 0));
        } else {
          setCustomerKnown(false);
          setCustomerName("");
          setCustomerPoints(0);
        }
      } finally {
        setLookingUp(false);
      }
    }, 400);
    return () => clearTimeout(t);
  }, [customerPhone]);

  /* Shift helpers */
  async function loadActiveShift() {
    const qy = query(collection(db, "shifts"), where("outlet", "==", OUTLET), where("open", "==", true));
    const snap = await getDocs(qy);
    const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as Shift[];
    setActiveShift(list[0] || null);
  }
  async function openShift() {
    if (activeShift) return alert("Shift masih terbuka.");
    const input = prompt("Kas awal (Rp) untuk membuka shift:", "0");
    if (input === null) return;
    const openingCash = Number(input) || 0;
    const payload: Shift = {
      outlet: OUTLET,
      open: true,
      openedBy: user?.email || "-",
      openTime: new Date().toISOString(),
      openingCash,
      closedBy: null,
      closeTime: null,
      closingCash: null,
      note: null,
    };
    const ref = await addDoc(collection(db, "shifts"), cleanForFirestore(payload));
    setActiveShift({ ...payload, id: ref.id });
    alert("Shift dibuka ✅");
  }
  function sum(arr: number[]) { return arr.reduce((a, b) => a + b, 0); }
  async function closeShift() {
    if (!activeShift) return alert("Belum ada shift aktif.");
    // Ambil semua sales di shift ini (pakai time range)
    const startISO = activeShift.openTime;
    const snap = await getDocs(
      query(
        collection(db, "sales"),
        where("outlet", "==", OUTLET),
        where("time", ">=", startISO),
        orderBy("time", "asc")
      )
    );
    const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as Sale[];
    const cashSum = sum(list.filter(s => s.method === "cash").map(s => s.total || 0));
    const ewalletSum = sum(list.filter(s => s.method === "ewallet").map(s => s.total || 0));
    const revenue = sum(list.map(s => s.total || 0));
    const expectedCash = (activeShift.openingCash || 0) + cashSum; // payout belum dihitung
    const closingStr = prompt(
      `Kas akhir (Rp)?\nKas awal: ${IDR(activeShift.openingCash || 0)}\nPenjualan cash: ${IDR(cashSum)}\nPerkiraan kas: ${IDR(expectedCash)}`,
      String(expectedCash)
    );
    if (closingStr === null) return;
    const closingCash = Number(closingStr) || 0;
    const note = prompt("Catatan penutupan (opsional):", "") || "";

    const update: Partial<Shift> = {
      open: false,
      closedBy: user?.email || "-",
      closeTime: new Date().toISOString(),
      closingCash,
      note,
      totals: {
        cash: cashSum,
        ewallet: ewalletSum,
        salesCount: list.length,
        revenue,
        expectedCash,
        difference: closingCash - expectedCash,
      },
    };
    // simpan
    await setDoc(doc(db, "shifts", activeShift.id!), cleanForFirestore(update), { merge: true });
    // cetak Z report
    printShiftReport({ ...activeShift, ...update } as Shift);
    setActiveShift(null);
    alert("Shift ditutup ✅");
  }

  function printShiftReport(s: Shift) {
    const w = window.open("", "_blank", "width=420,height=700");
    if (!w) return;
    const openTimeStr = new Date(s.openTime).toLocaleString("id-ID", { hour12:false });
    const closeTimeStr = s.closeTime ? new Date(s.closeTime).toLocaleString("id-ID", { hour12:false }) : "-";
    const t = s.totals || { cash:0, ewallet:0, salesCount:0, revenue:0, expectedCash:0, difference:0 };
    const html = `
<!doctype html><html><head><meta charset="utf-8"><title>Shift Z Report</title>
<style>
  @media print { @page { size: 80mm auto; margin: 0; } body{margin:0} }
  body { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  .wrap { width: 76mm; margin: 0 auto; padding: 3mm; }
  h2 { margin: 4px 0; text-align: center; font-size: 14px; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 3px 0; font-size: 12px; }
  .meta { font-size: 11px; text-align: center; opacity: .8; }
  .logo { display:block;margin:0 auto 6px auto;width:36mm;height:auto;image-rendering:pixelated; }
  .line { border-top:1px dashed #ccc; margin:6px 0}
  .row { display:flex; justify-content:space-between; font-size:12px; }
</style></head>
<body>
  <div class="wrap">
    <img src="/logo.png" class="logo" onerror="this.style.display='none'"/>
    <h2>${SHOP_NAME} — Shift Report</h2>
    <div class="meta">${OUTLET}</div>
    <div class="line"></div>
    <div class="row"><span>Opened by</span><b>${s.openedBy}</b></div>
    <div class="row"><span>Open</span><b>${openTimeStr}</b></div>
    <div class="row"><span>Kas Awal</span><b>${IDR(s.openingCash || 0)}</b></div>
    <div class="line"></div>
    <div class="row"><span>Closed by</span><b>${s.closedBy || "-"}</b></div>
    <div class="row"><span>Close</span><b>${closeTimeStr}</b></div>
    <div class="row"><span>Kas Akhir</span><b>${IDR(s.closingCash || 0)}</b></div>
    <div class="line"></div>
    <div class="row"><span>Penjualan (Cash)</span><b>${IDR(t.cash)}</b></div>
    <div class="row"><span>Penjualan (E-Wallet)</span><b>${IDR(t.ewallet)}</b></div>
    <div class="row"><span>Transaksi</span><b>${t.salesCount}</b></div>
    <div class="row"><span>Total Revenue</span><b>${IDR(t.revenue)}</b></div>
    <div class="line"></div>
    <div class="row"><span>Perkiraan Kas</span><b>${IDR(t.expectedCash)}</b></div>
    <div class="row"><span>Selisih</span><b>${IDR(t.difference)}</b></div>
    ${s.note ? `<div class="line"></div><div style="font-size:11px">Catatan: ${s.note}</div>` : ""}
    <p class="meta" style="margin-top:6px">Terima kasih — ${SHOP_NAME}</p>
  </div>
  <script>window.print()</script>
</body></html>`;
    w.document.write(html);
    w.document.close();
  }

  /* POS helpers */
  function addToCart(p: Product) {
    setCart((prev) => {
      const f = prev.find((x) => x.productId === p.id && (x.note || "") === (note || ""));
      if (f) return prev.map((x) => (x === f ? { ...x, qty: x.qty + 1 } : x));
      return [
        ...prev,
        { productId: p.id!, name: p.name, price: p.price, qty: 1, note: note || undefined },
      ];
    });
  }
  function inc(i: number) {
    setCart((prev) => prev.map((x, idx) => (idx === i ? { ...x, qty: x.qty + 1 } : x)));
  }
  function dec(i: number) {
    setCart((prev) => prev.map((x, idx) => (idx === i ? { ...x, qty: Math.max(1, x.qty - 1) } : x)));
  }
  function rm(i: number) {
    setCart((prev) => prev.filter((_, idx) => idx !== i));
  }
  function clearCartAll() {
    setCart([]);
    setDiscount(0);
    setTaxRate(0);
    setServiceRate(0);
    setCash(0);
    setNote("");
    setCustomerPhone("");
    setCustomerName("");
    setCustomerPoints(0);
    setCustomerKnown(false);
  }

  /* Inventory deduction by recipe */
  async function deductInventoryForCart(cartItems: CartItem[]) {
    const need: Record<string, number> = {};
    for (const ci of cartItems) {
      const p = products.find((pp) => pp.id === ci.productId);
      if (!p?.recipe) continue;
      for (const r of p.recipe) {
        if (!r.ingredientId) continue;
        need[r.ingredientId] = (need[r.ingredientId] || 0) + Number(r.qty || 0) * ci.qty;
      }
    }
    for (const [ingId, qty] of Object.entries(need)) {
      const ref = doc(db, "ingredients", ingId);
      const snap = await getDoc(ref);
      if (!snap.exists()) continue;
      const cur = Number((snap.data() as any).stock || 0);
      await updateDoc(ref, {
        stock: Math.max(0, cur - Number(qty || 0)),
        updatedAt: serverTimestamp(),
      });
    }
  }

  /* Printer 80mm — logo + QR loyalty */
  function printReceipt80mm(s: Sale) {
    const w = window.open("", "_blank", "width=420,height=700");
    if (!w) return;
    const rows = s.items
      .map(
        (i) => `
      <tr>
        <td>${i.name}${i.note ? `<div style="font-size:10px;opacity:.7">${i.note}</div>` : ""}</td>
        <td style="text-align:center">${i.qty}x</td>
        <td style="text-align:right">${(i.price * i.qty).toLocaleString("id-ID")}</td>
      </tr>`
      )
      .join("");

    const qr = s.loyaltyUrl
      ? `https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(
          s.loyaltyUrl
        )}`
      : "";

    const html = `
<!doctype html><html><head><meta charset="utf-8"><title>Struk</title>
<style>
  @media print { @page { size: 80mm auto; margin: 0; } body{margin:0} }
  body { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  .wrap { width: 76mm; margin: 0 auto; padding: 3mm; }
  h2 { margin: 4px 0; text-align: center; font-size: 14px; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 2px 0; font-size: 12px; border-bottom: 1px dashed #ddd; }
  .tot td { border-bottom: none; font-weight: 700; }
  .meta { font-size: 11px; text-align: center; opacity: .8; }
  .logo { display:block;margin:0 auto 6px auto;width:36mm;height:auto;image-rendering:pixelated; }
</style></head>
<body>
  <div class="wrap">
    <img src="/logo.png" class="logo" onerror="this.style.display='none'"/>
    <h2>${SHOP_NAME}</h2>
    <div class="meta">${OUTLET}<br/>Kasir: ${s.cashier}<br/>${new Date(s.time).toLocaleString(
      "id-ID",
      { hour12: false }
    )}</div>
    <hr/>
    <table>${rows}
      <tr class="tot"><td>Subtotal</td><td></td><td style="text-align:right">${s.subtotal.toLocaleString(
        "id-ID"
      )}</td></tr>
      ${
        s.discount
          ? `<tr class="tot"><td>Diskon</td><td></td><td style="text-align:right">-${s.discount.toLocaleString(
              "id-ID"
            )}</td></tr>`
          : ""
      }
      ${
        s.taxValue
          ? `<tr class="tot"><td>Pajak (${s.taxRate}%)</td><td></td><td style="text-align:right">${s.taxValue.toLocaleString(
              "id-ID"
            )}</td></tr>`
          : ""
      }
      ${
        s.serviceValue
          ? `<tr class="tot"><td>Service (${s.serviceRate}%)</td><td></td><td style="text-align:right">${s.serviceValue.toLocaleString(
              "id-ID"
            )}</td></tr>`
          : ""
      }
      <tr class="tot"><td>Total</td><td></td><td style="text-align:right">${s.total.toLocaleString(
        "id-ID"
      )}</td></tr>
      ${
        s.method === "cash"
          ? `<tr><td>Tunai</td><td></td><td style="text-align:right">${s.cash.toLocaleString(
              "id-ID"
            )}</td></tr>
             <tr><td>Kembali</td><td></td><td style="text-align:right">${s.change.toLocaleString(
               "id-ID"
             )}</td></tr>`
          : `<tr><td>Pembayaran</td><td></td><td style="text-align:right">E-Wallet</td></tr>`
      }
    </table>
    ${
      qr
        ? `<div class="meta" style="margin:8px 0 2px">Scan untuk cek poin loyalty</div>
           <img src="${qr}" style="display:block;margin:0 auto 4px auto"/>
           <div class="meta" style="word-break:break-all;font-size:10px">${s.loyaltyUrl}</div>`
        : ""
    }
    <p class="meta">Terima kasih! Follow @chafumatcha</p>
  </div>
  <script>window.print()</script>
</body></html>`;
    w.document.write(html);
    w.document.close();
  }

  /* FINALIZE — print dulu baru simpan (hindari popup blocked) */
  const finalize = async () => {
    if (!activeShift) return alert("Buka shift dulu sebelum transaksi.");
    if (cart.length === 0) return alert("Keranjang kosong.");
    if (method === "cash" && cash < total) return alert("Uang tunai kurang.");

    const useLoyalty = /\d{6,}/.test(customerPhone.trim());
    if (useLoyalty && !customerKnown && !customerName.trim()) {
      return alert("Nama pelanggan wajib diisi untuk nomor baru.");
    }
    const pointsEarned = useLoyalty ? cart.reduce((s, i) => s + i.qty, 0) : 0;

    const itemsSafe: CartItem[] = cart.map((ci) => ({
      productId: ci.productId,
      name: ci.name,
      price: Number(ci.price || 0),
      qty: Number(ci.qty || 0),
      note: ci.note ?? undefined,
    }));

    const s: Sale = {
      time: new Date().toISOString(),
      cashier: user?.email || "-",
      shiftId: activeShift?.id || null,
      items: itemsSafe,
      subtotal,
      discount,
      taxRate,
      serviceRate,
      taxValue,
      serviceValue,
      total,
      method,
      cash: method === "cash" ? cash : 0,
      change: method === "cash" ? change : 0,
      outlet: OUTLET,
      customerPhone: useLoyalty ? customerPhone.trim() : null,
      customerName: useLoyalty
        ? customerKnown
          ? customerName
          : customerName.trim()
        : null,
      pointsEarned: pointsEarned || 0,
      loyaltyUrl: useLoyalty ? loyaltyUrlFor(customerPhone) : null,
    };

    // cetak dulu supaya popup tidak diblok
    printReceipt80mm(s);

    // simpan
    try {
      const payload = cleanForFirestore({
        ...s,
        items: s.items.map((i) => ({ ...i, note: i.note ?? null })),
        createdAt: serverTimestamp(),
      });
      const ref = await addDoc(collection(db, "sales"), payload);
      s.id = ref.id;

      if (useLoyalty) {
        if (!customerKnown)
          await createCustomer(customerPhone.trim(), customerName.trim());
        await addLoyalty(customerPhone.trim(), pointsEarned, true);
      }

      await deductInventoryForCart(cart);

      setSales((prev) => [s, ...prev]);
      clearCartAll();
      alert("Transaksi tersimpan ✅");
    } catch (e: any) {
      console.error(e);
      alert("Transaksi tercetak, namun penyimpanan gagal: " + (e?.message || e));
    }
  };

  /* ================== UI ================== */
  if (!user) {
    return (
      <div style={wrap}>
        <InlineStyle />
        <h2 style={{ marginTop: 8 }}>{SHOP_NAME} — POS</h2>
        <div style={card}>
          <h3>Login</h3>
          <input
            placeholder="Email"
            style={input}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div style={card}>
          <input
            placeholder="Password"
            type="password"
            style={input}
            value={pass}
            onChange={(e) => setPass(e.target.value)}
          />
          <button
            style={btnPrimary}
            onClick={async () => {
              try {
                await signInWithEmailAndPassword(auth, email, pass);
              } catch (e: any) {
                alert(e.message);
              }
            }}
          >
            Masuk
          </button>
          <p style={{ fontSize: 12, opacity: 0.6, marginTop: 8 }}>
            Owner/admin: hanya email terdaftar yang bisa ubah produk & inventori.
          </p>
        </div>
      </div>
    );
  }

  /* ======= Dashboard data basis ======= */
  const now = new Date();
  const t0 = startOfDay(now).toISOString();
  const w0 = startOfWeek(now).toISOString();
  const m0 = startOfMonth(now).toISOString();
  const sumFast = (arr: number[]) => arr.reduce((a, b) => a + b, 0);

  const todaySales   = sales.filter((s) => s.time >= t0);
  const weekSales    = sales.filter((s) => s.time >= w0);
  const monthSales   = sales.filter((s) => s.time >= m0);

  const todayRevenue = sumFast(todaySales.map((s) => s.total || 0));
  const weekRevenue  = sumFast(weekSales.map((s) => s.total || 0));
  const monthRevenue = sumFast(monthSales.map((s) => s.total || 0));

  const todayCups = sumFast(todaySales.flatMap((s) => s.items.map((i) => i.qty || 0)));
  const weekCups  = sumFast(weekSales.flatMap((s) => s.items.map((i) => i.qty || 0)));
  const monthCups = sumFast(monthSales.flatMap((s) => s.items.map((i) => i.qty || 0)));

  /* Render */
  return (
    <div style={wrap}>
      <InlineStyle />
      {/* Header */}
      <div className="hdr">
        <div className="hdrL">
          <img
            src="/logo.png"
            alt="logo"
            className="logo"
            onError={(e: any) => (e.currentTarget.style.display = "none")}
          />
          <div>
            <h2 className="title">{SHOP_NAME} — Kasir</h2>
            <small>{OUTLET}</small>
          </div>
        </div>
        <div className="hdrR">
          {/* Shift status */}
          {activeShift ? (
            <span style={{ fontSize: 12, padding: "4px 8px", border: "1px solid #16a34a", borderRadius: 999, background: "#ecfdf5", color: "#065f46" }}>
              Shift OPEN — {new Date(activeShift.openTime).toLocaleTimeString("id-ID", { hour12:false })} by {activeShift.openedBy}
            </span>
          ) : (
            <span style={{ fontSize: 12, padding: "4px 8px", border: "1px solid #eab308", borderRadius: 999, background: "#fffbeb", color: "#854d0e" }}>
              Shift CLOSED
            </span>
          )}
          {/* Shift actions */}
          {!activeShift ? (
            <button onClick={openShift}>Buka Shift</button>
          ) : (
            <button onClick={closeShift}>Tutup Shift</button>
          )}

          <small>
            Masuk: {user.email} {isAdmin ? "(owner)" : "(staff)"}
          </small>
          <button onClick={() => setTab("pos")}>Kasir</button>
          <button
            onClick={() => {
              setTab("history");
              loadSales();
            }}
          >
            Riwayat
          </button>

          {/* 🔒 Dashboard hanya untuk admin */}
          {isAdmin && (
            <button
              onClick={() => {
                setTab("dashboard");
                loadSalesLastNDays(60);
              }}
            >
              Dashboard
            </button>
          )}

          <button onClick={() => setTab("products")}>Produk</button>
          <button onClick={() => setTab("inventory")}>Inventori</button>
          <button onClick={() => setTab("settings")}>Pengaturan</button>
          <button style={btnDanger} onClick={() => signOut(auth)}>
            Keluar
          </button>
        </div>
      </div>

      {/* POS */}
      {tab === "pos" && (
        <div className="grid-pos">
          {/* menu */}
          <div style={card}>
            <h3>Menu</h3>
            <div className="grid-menu">
              {products
                .filter((p) => p.active !== false)
                .map((p) => (
                  <button key={p.id} className="tile" onClick={() => addToCart(p)}>
                    <div className="tileName">{p.name}</div>
                    <div className="tileCat">{p.category}</div>
                    <div className="tilePrice">{IDR(p.price)}</div>
                  </button>
                ))}
            </div>
          </div>

          {/* cart */}
          <div style={card}>
            <h3>Keranjang</h3>
            {cart.length === 0 ? (
              <p style={{ opacity: 0.7 }}>Belum ada item.</p>
            ) : (
              <ul className="cartList">
                {cart.map((ci, idx) => (
                  <li key={idx} className="cartRow">
                    <div>
                      <div className="cartName">{ci.name}</div>
                      {ci.note && <div className="cartNote">{ci.note}</div>}
                    </div>
                    <div>{IDR(ci.price)}</div>
                    <div className="qtyCtl">
                      <button onClick={() => dec(idx)}>-</button>
                      <b>{ci.qty}</b>
                      <button onClick={() => inc(idx)}>+</button>
                      <button onClick={() => rm(idx)} className="xBtn">
                        ×
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <div className="vGap">
              <input
                placeholder="Catatan (opsional)"
                style={input}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />

              <div className="row">
                <span>Subtotal</span>
                <b>{IDR(subtotal)}</b>
              </div>
              <div className="row">
                <span>Pajak %</span>
                <input
                  type="number"
                  className="inpSm"
                  value={taxRate}
                  onChange={(e) => setTaxRate(Number(e.target.value) || 0)}
                />
              </div>
              <div className="row">
                <span>Service %</span>
                <input
                  type="number"
                  className="inpSm"
                  value={serviceRate}
                  onChange={(e) => setServiceRate(Number(e.target.value) || 0)}
                />
              </div>
              <div className="row">
                <span>Diskon (Rp)</span>
                <input
                  type="number"
                  className="inpSm"
                  value={discount}
                  onChange={(e) => setDiscount(Number(e.target.value) || 0)}
                />
              </div>
              <div className="row totalRow">
                <span>Total</span>
                <span>{IDR(total)}</span>
              </div>

              <div className="payGrid">
                <select
                  value={method}
                  onChange={(e) => setMethod(e.target.value as any)}
                  style={input}
                >
                  <option value="cash">Cash</option>
                  <option value="ewallet">E-Wallet</option>
                </select>
                {method === "cash" ? (
                  <input
                    type="number"
                    placeholder="Tunai (Rp)"
                    style={input}
                    value={cash}
                    onChange={(e) => setCash(Number(e.target.value) || 0)}
                  />
                ) : (
                  <div className="qrisRow">
                    <img
                      src="/qris.png"
                      alt="QRIS"
                      className="qris"
                      onError={(e: any) => (e.currentTarget.style.display = "none")}
                    />
                    <small>Scan QRIS untuk bayar.</small>
                  </div>
                )}
              </div>

              {/* Loyalty */}
              <div className="loyalBox">
                <div className="loyalGrid">
                  <input
                    placeholder="No HP (opsional)"
                    style={input}
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                  />
                  <div className="loyalRight">
                    <input
                      placeholder={
                        customerKnown ? "Nama otomatis" : "Nama (wajib jika baru)"
                      }
                      style={{
                        ...input,
                        flex: 1,
                        background: customerKnown ? "#f3f4f6" : "#fff",
                      }}
                      value={customerName}
                      disabled={customerKnown}
                      onChange={(e) => setCustomerName(e.target.value)}
                    />
                    <span className="pill">
                      {lookingUp ? "cek..." : `Poin: ${customerPoints}`}
                    </span>
                  </div>
                </div>
              </div>

              <div className="actions">
                <button onClick={clearCartAll}>Bersihkan</button>
                <button
                  style={btnPrimary}
                  disabled={cart.length === 0 || (method === "cash" && cash < total)}
                  onClick={finalize}
                >
                  Selesaikan & Cetak
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* History */}
      {tab === "history" && (
        <div style={{ ...card, marginTop: 12 }}>
          <div className="hdrTbl">
            <h3>Riwayat Transaksi</h3>
            <button onClick={loadSales}>{loading ? "Memuat..." : "Muat Ulang"}</button>
          </div>
          {sales.length === 0 ? (
            <p style={{ opacity: 0.7 }}>Belum ada transaksi.</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="tbl">
                <thead>
                  <tr>
                    <th className="thL">Waktu</th>
                    <th className="thL">ID</th>
                    <th className="thL">Item</th>
                    <th className="thR">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {sales.map((s) => (
                    <tr key={s.id}>
                      <td className="td">
                        {new Date(s.time).toLocaleString("id-ID", { hour12: false })}
                      </td>
                      <td className="td">{s.id}</td>
                      <td className="td">
                        {s.items.map((i) => `${i.name} x${i.qty}`).join(", ")}
                      </td>
                      <td className="tdR">{IDR(s.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* 🔒 Dashboard (hanya admin) */}
      {tab === "dashboard" && (
        isAdmin ? (
          <DashboardCard
            loading={loading}
            sales={sales}
            products={products}
            ingredients={ingredients}
            buildDailySeries={buildDailySeries}
          />
        ) : (
          <div style={{ ...card, marginTop: 12 }}>
            <h3>Akses Ditolak</h3>
            <p style={{ opacity: 0.7 }}>
              Dashboard hanya bisa diakses oleh owner atau admin terdaftar.
            </p>
          </div>
        )
      )}

      {/* Products */}
      {tab === "products" && (
        <ProductsCard
          isAdmin={isAdmin}
          products={products}
          ingredients={ingredients}
          onSave={async (p) => {
            if (!isAdmin) return alert("Hanya admin yang dapat menyimpan produk.");
            if (!p.name || p.price <= 0) return alert("Nama & harga wajib diisi.");
            if (p.id) {
              const ref = doc(db, "products", p.id);
              await setDoc(ref, cleanForFirestore(p), { merge: true });
            } else {
              await addDoc(collection(db, "products"), cleanForFirestore(p));
            }
            await loadProducts();
            alert("Produk tersimpan.");
          }}
          onDelete={async (id) => {
            if (!isAdmin) return alert("Hanya admin yang dapat menghapus produk.");
            if (!confirm("Hapus produk ini?")) return;
            await deleteDoc(doc(db, "products", id));
            await loadProducts();
          }}
        />
      )}

      {/* Inventory */}
      {tab === "inventory" && (
        <InventoryCard
          isAdmin={isAdmin}
          ingredients={ingredients}
          onSave={async (ing) => {
            if (!isAdmin) return alert("Hanya admin yang dapat menyimpan inventori.");
            if (!ing.name) return alert("Nama bahan wajib diisi.");
            if (ing.id) {
              const ref = doc(db, "ingredients", ing.id);
              await setDoc(ref, cleanForFirestore(ing), { merge: true });
            } else {
              await addDoc(collection(db, "ingredients"), cleanForFirestore(ing));
            }
            await loadIngredients();
            alert("Inventori tersimpan.");
          }}
          onDelete={async (id) => {
            if (!isAdmin) return alert("Hanya admin yang dapat menghapus inventori.");
            if (!confirm("Hapus bahan ini?")) return;
            await deleteDoc(doc(db, "ingredients", id));
            await loadIngredients();
          }}
        />
      )}

      {/* Settings */}
      {tab === "settings" && (
        <div style={{ ...card, marginTop: 12 }}>
          <h3>Pengaturan</h3>
          <p>• Nama toko: <b>{SHOP_NAME}</b></p>
          <p>• Outlet: <b>{OUTLET}</b></p>
          <p>• Owner/Admin:</p>
          <ul>{ADMIN_EMAILS.map((m) => <li key={m}>{m}</li>)}</ul>
          <p style={{ fontSize: 12, opacity: 0.7 }}>
            Logo: <code>public/logo.png</code>, QRIS: <code>public/qris.png</code>.
          </p>
        </div>
      )}
    </div>
  );
}

/* ============== Products Card ============== */
function ProductsCard({
  isAdmin,
  products,
  ingredients,
  onSave,
  onDelete,
}: {
  isAdmin: boolean;
  products: Product[];
  ingredients: Ingredient[];
  onSave: (p: Product) => void | Promise<void>;
  onDelete: (id: string) => void | Promise<void>;
}) {
  const empty: Product = {
    name: "",
    price: 0,
    category: "Signature",
    active: true,
    recipe: [],
  };
  const [form, setForm] = useState<Product>(empty);

  function addRecipeRow() {
    setForm((f) => ({
      ...f,
      recipe: [...(f.recipe || []), { ingredientId: ingredients[0]?.id || "", qty: 1 }],
    }));
  }
  function updateRecipe(idx: number, patch: Partial<RecipeItem>) {
    setForm((f) => {
      const r = [...(f.recipe || [])];
      r[idx] = { ...r[idx], ...patch } as any;
      return { ...f, recipe: r };
    });
  }
  function rmRecipe(idx: number) {
    setForm((f) => {
      const r = [...(f.recipe || [])];
      r.splice(idx, 1);
      return { ...f, recipe: r };
    });
  }

  return (
    <div style={{ ...card, marginTop: 12 }}>
      <div className="hdrTbl">
        <h3>Produk</h3>
        <button disabled={!isAdmin} onClick={() => setForm(empty)}>Produk Baru</button>
      </div>

      <div className="prodGrid">
        <input
          style={input}
          placeholder="Nama"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
        <input
          style={input}
          placeholder="Kategori"
          value={form.category}
          onChange={(e) => setForm({ ...form, category: e.target.value })}
        />
        <input
          style={input}
          type="number"
          placeholder="Harga"
          value={form.price}
          onChange={(e) => setForm({ ...form, price: Number(e.target.value) || 0 })}
        />
        <label className="chk">
          <input
            type="checkbox"
            checked={form.active !== false}
            onChange={(e) => setForm({ ...form, active: e.target.checked })}
          />{" "}
          Aktif
        </label>
      </div>

      <div className="recipeBox">
        <div className="hdrTbl">
          <b>Recipe (Inventori)</b>
          <button disabled={!isAdmin} onClick={addRecipeRow}>+ Bahan</button>
        </div>
        {(form.recipe || []).length === 0 ? (
          <p style={{ opacity: 0.7 }}>Belum ada bahan.</p>
        ) : (
          <div className="recipeGrid">
            {form.recipe!.map((r, idx) => (
              <React.Fragment key={idx}>
                <select
                  style={input}
                  value={r.ingredientId}
                  onChange={(e) => updateRecipe(idx, { ingredientId: e.target.value })}
                  disabled={!isAdmin}
                >
                  {ingredients.map((ing) => (
                    <option key={ing.id} value={ing.id}>
                      {ing.name} ({ing.unit})
                    </option>
                  ))}
                </select>
                <input
                  style={input}
                  type="number"
                  min={0}
                  step="0.01"
                  value={r.qty}
                  onChange={(e) => updateRecipe(idx, { qty: Number(e.target.value) || 0 })}
                  disabled={!isAdmin}
                />
                <button disabled={!isAdmin} onClick={() => rmRecipe(idx)}>Hapus</button>
              </React.Fragment>
            ))}
          </div>
        )}
      </div>

      <div className="actRow">
        <button style={btnPrimary} disabled={!isAdmin} onClick={() => onSave(form)}>
          {form.id ? "Simpan Perubahan" : "Tambah Produk"}
        </button>
        {form.id && (
          <button style={btnDanger} disabled={!isAdmin} onClick={() => onDelete(form.id!)}>
            Hapus
          </button>
        )}
      </div>

      <hr style={{ margin: "16px 0" }} />
      <div style={{ overflowX: "auto" }}>
        <table className="tbl">
          <thead>
            <tr>
              <th className="thL">Nama</th>
              <th className="thL">Kategori</th>
              <th className="thR">Harga</th>
              <th className="thL">Aktif</th>
              <th className="thR">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.id}>
                <td className="td">{p.name}</td>
                <td className="td">{p.category}</td>
                <td className="tdR">{IDR(p.price)}</td>
                <td className="td">{p.active !== false ? "Ya" : "Tidak"}</td>
                <td className="tdR">
                  <button disabled={!isAdmin} onClick={() => setForm(p)}>Edit</button>
                  <button disabled={!isAdmin} onClick={() => onDelete(p.id!)} style={{ marginLeft: 6 }}>
                    Hapus
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ============== Inventory Card ============== */
function InventoryCard({
  isAdmin,
  ingredients,
  onSave,
  onDelete,
}: {
  isAdmin: boolean;
  ingredients: Ingredient[];
  onSave: (i: Ingredient) => void | Promise<void>;
  onDelete: (id: string) => void | Promise<void>;
}) {
  const empty: Ingredient = { name: "", unit: "gr", stock: 0, low: 10 };
  const [form, setForm] = useState<Ingredient>(empty);

  return (
    <div style={{ ...card, marginTop: 12 }}>
      <div className="hdrTbl">
        <h3>Inventori</h3>
        <button disabled={!isAdmin} onClick={() => setForm(empty)}>Bahan Baru</button>
      </div>

      <div className="invGrid">
        <input
          style={input}
          placeholder="Nama bahan"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
        <input
          style={input}
          placeholder="Unit (gr/ml/pcs)"
          value={form.unit}
          onChange={(e) => setForm({ ...form, unit: e.target.value })}
        />
        <input
          style={input}
          type="number"
          placeholder="Stok"
          value={form.stock}
          onChange={(e) => setForm({ ...form, stock: Number(e.target.value) || 0 })}
        />
        <input
          style={input}
          type="number"
          placeholder="Ambang (low)"
          value={form.low || 0}
          onChange={(e) => setForm({ ...form, low: Number(e.target.value) || 0 })}
        />
        <button style={btnPrimary} disabled={!isAdmin} onClick={() => onSave(form)}>
          {form.id ? "Simpan" : "Tambah"}
        </button>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table className="tbl">
          <thead>
            <tr>
              <th className="thL">Nama</th>
              <th className="thL">Unit</th>
              <th className="thR">Stok</th>
              <th className="thR">Low</th>
              <th className="thR">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {ingredients.map((i) => (
              <tr
                key={i.id}
                style={{ background: i.stock <= (i.low || 0) ? "#fff7ed" : undefined }}
              >
                <td className="td">{i.name}</td>
                <td className="td">{i.unit}</td>
                <td className="tdR">{i.stock}</td>
                <td className="tdR">{i.low || 0}</td>
                <td className="tdR">
                  <button disabled={!isAdmin} onClick={() => setForm(i)}>Edit</button>
                  <button disabled={!isAdmin} onClick={() => onDelete(i.id!)} style={{ marginLeft: 6 }}>
                    Hapus
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ============== Dashboard Card + Chart & Export ============== */
function DashboardCard({
  loading,
  sales,
  products,
  ingredients,
  buildDailySeries,
}: {
  loading: boolean;
  sales: Sale[];
  products: Product[];
  ingredients: Ingredient[];
  buildDailySeries: (data: Sale[], days?: number) => { labels: string[]; revenue: number[]; cups: number[] };
}) {
  const now = new Date();
  const startOfDayIso = new Date(new Date(now).setHours(0,0,0,0)).toISOString();
  const startOfWeek = (() => { const d = new Date(now); d.setHours(0,0,0,0); const diff=(d.getDay()+6)%7; d.setDate(d.getDate()-diff); return d;})();
  const startOfMonth = (() => { const d=new Date(now); d.setHours(0,0,0,0); d.setDate(1); return d;})();
  const weekIso = startOfWeek.toISOString();
  const monthIso = startOfMonth.toISOString();
  const sum = (a:number[]) => a.reduce((x,y)=>x+y,0);

  const todaySales   = sales.filter(s=>s.time>=startOfDayIso);
  const weekSales    = sales.filter(s=>s.time>=weekIso);
  const monthSales   = sales.filter(s=>s.time>=monthIso);
  const todayRevenue = sum(todaySales.map(s=>s.total||0));
  const weekRevenue  = sum(weekSales.map(s=>s.total||0));
  const monthRevenue = sum(monthSales.map(s=>s.total||0));
  const todayCups    = sum(todaySales.flatMap(s=>s.items.map(i=>i.qty||0)));
  const weekCups     = sum(weekSales.flatMap(s=>s.items.map(i=>i.qty||0)));
  const monthCups    = sum(monthSales.flatMap(s=>s.items.map(i=>i.qty||0)));

  const labels = buildDailySeries(sales, 14);

  // Top Produk
  const qtyByProduct: Record<string, number> = {};
  for (const s of sales) for (const it of s.items) {
    qtyByProduct[it.name] = (qtyByProduct[it.name] || 0) + (it.qty || 0);
  }
  const topProducts = Object.entries(qtyByProduct).sort((a,b)=>b[1]-a[1]).slice(0,8);

  // Low Stock
  const lowList = [...ingredients].filter(i=>i.stock <= (i.low || 0)).sort((a,b)=>(a.stock-(a.low||0))-(b.stock-(b.low||0)));

  return (
    <div style={{ ...card, marginTop: 12 }}>
      <div className="hdrTbl">
        <h3>Dashboard Owner</h3>
        {loading ? <small>Memuat…</small> : <small>Terakhir: {new Date().toLocaleString("id-ID", { hour12:false })}</small>}
      </div>

      {/* KPI */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))", gap:12, marginTop:8 }}>
        <KPI title="Pendapatan Hari Ini" value={IDR(todayRevenue)} sub={`${todaySales.length} trx / ${todayCups} cup`} />
        <KPI title="Pendapatan Minggu Ini" value={IDR(weekRevenue)} sub={`${weekSales.length} trx / ${weekCups} cup`} />
        <KPI title="Pendapatan Bulan Ini" value={IDR(monthRevenue)} sub={`${monthSales.length} trx / ${monthCups} cup`} />
      </div>

      {/* Grafik harian */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginTop:12 }}>
        <MiniBarChart title="Pendapatan Harian (14 hari)" labels={labels.labels} values={labels.revenue} />
        <MiniBarChart title="Cup Terjual / Hari (14 hari)" labels={labels.labels} values={labels.cups} />
      </div>

      {/* Export */}
      <div style={{ marginTop:12 }}>
        <button onClick={() => exportDashboardCSV(labels)} style={{ border:"1px solid #2e7d32", background:"#2e7d32", color:"#fff", padding:"8px 12px", borderRadius:10 }}>
          Export Dashboard CSV
        </button>
      </div>

      {/* Top Produk & Low Stock */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginTop:12 }}>
        <div style={card}>
          <h4 style={{marginTop:0}}>Top Produk (by qty)</h4>
          {topProducts.length===0 ? (
            <p style={{opacity:.7}}>Belum ada data.</p>
          ) : (
            <table className="tbl">
              <thead>
                <tr><th className="thL">Produk</th><th className="thR">Qty</th></tr>
              </thead>
              <tbody>
                {topProducts.map(([name, qty]) => (
                  <tr key={name}>
                    <td className="td">{name}</td>
                    <td className="tdR">{qty}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div style={card}>
          <h4 style={{marginTop:0}}>Low Stock</h4>
          {lowList.length===0 ? (
            <p style={{opacity:.7}}>Aman. Tidak ada stok rendah.</p>
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th className="thL">Bahan</th>
                  <th className="thR">Stok</th>
                  <th className="thR">Ambang</th>
                </tr>
              </thead>
              <tbody>
                {lowList.map(i=>(
                  <tr key={i.id}>
                    <td className="td">{i.name} ({i.unit})</td>
                    <td className="tdR">{i.stock}</td>
                    <td className="tdR">{i.low || 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Ringkasan Transaksi Terbaru */}
      <div style={{ marginTop:12 }}>
        <h4 style={{marginTop:0}}>Transaksi Terbaru</h4>
        {sales.length===0 ? (
          <p style={{opacity:.7}}>Belum ada transaksi.</p>
        ) : (
          <div style={{ overflowX:"auto" }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th className="thL">Waktu</th>
                  <th className="thL">Metode</th>
                  <th className="thR">Total</th>
                </tr>
              </thead>
              <tbody>
                {sales.slice(0,10).map(s=>(
                  <tr key={s.id}>
                    <td className="td">{new Date(s.time).toLocaleString("id-ID",{hour12:false})}</td>
                    <td className="td">{s.method}</td>
                    <td className="tdR">{IDR(s.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function KPI({title, value, sub}:{title:string; value:string; sub?:string}) {
  return (
    <div style={{ border:"1px solid #e5e7eb", borderRadius:12, padding:12, background:"#fafafa" }}>
      <div style={{fontSize:12, opacity:.7}}>{title}</div>
      <div style={{fontSize:20, fontWeight:700, margin:"2px 0 4px"}}>{value}</div>
      {sub && <div style={{fontSize:12, opacity:.7}}>{sub}</div>}
    </div>
  );
}

function MiniBarChart({
  title,
  labels,
  values,
  height = 120,
}: {
  title: string;
  labels: string[];
  values: number[];
  height?: number;
}) {
  const max = Math.max(1, ...values);
  const barW = 20;
  const gap = 6;
  const width = values.length * (barW + gap) + gap;
  return (
    <div style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 12 }}>
      <div style={{ fontSize: 12, opacity: 0.7 }}>{title}</div>
      <svg width={width} height={height} style={{ display: "block", marginTop: 6 }}>
        <line x1={0} y1={height - 20} x2={width} y2={height - 20} stroke="#e5e7eb" />
        {values.map((v, i) => {
          const h = Math.round(((v || 0) / max) * (height - 40));
          const x = gap + i * (barW + gap);
          const y = height - 20 - h;
          return (
            <g key={i}>
              <rect x={x} y={y} width={barW} height={h} fill="#2e7d32" rx="4" />
            </g>
          );
        })}
        {labels.map((l, i) => {
          const x = gap + i * (barW + gap) + barW / 2;
          return (
            <text key={i} x={x} y={height - 6} fontSize="9" textAnchor="middle" fill="#6b7280">
              {l}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

/* ============== Styles & Responsive ============== */
function InlineStyle() {
  return (
    <style>{`
      .hdr{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap}
      .hdrL{display:flex;align-items:center;gap:10px}
      .hdrR{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
      .logo{width:36px;height:36px;object-fit:contain;border-radius:8px}
      .title{margin:4px 0}
      .grid-pos{display:grid;grid-template-columns:1fr;gap:12px}
      .grid-menu{display:grid;grid-template-columns:1fr 1fr;gap:8px}
      .tile{text-align:left;border:1px solid #e5e7eb;border-radius:12px;padding:10px;background:#fff}
      .tileName{font-weight:600}
      .tileCat{font-size:12px;opacity:.7}
      .tilePrice{margin-top:4px}
      .cartList{list-style:none;padding:0;margin:0;display:grid;gap:8px}
      .cartRow{border:1px solid #eee;border-radius:10px;padding:8px;display:grid;grid-template-columns:1fr auto auto;gap:10px;align-items:center}
      .cartName{font-weight:600}
      .cartNote{font-size:12px;opacity:.7}
      .qtyCtl{display:flex;gap:6px;align-items:center}
      .xBtn{margin-left:6px}
      .row{display:flex;justify-content:space-between;align-items:center;gap:8px}
      .inpSm{border:1px solid #e5e7eb;border-radius:8px;padding:8px 10px;width:140px}
      .totalRow{font-size:18px}
      .payGrid{display:grid;gap:8px}
      .qrisRow{display:flex;align-items:center;gap:8px}
      .qris{height:40px;object-fit:contain}
      .loyalBox{border-top:1px dashed #ddd;padding-top:8px}
      .loyalGrid{display:grid;gap:8px}
      .loyalRight{display:flex;gap:8px;align-items:center}
      .pill{border:1px solid #e5e7eb;border-radius:999px;padding:6px 10px;font-size:12px}
      .actions{display:flex;gap:8px;justify-content:space-between;flex-wrap:wrap}
      .hdrTbl{display:flex;justify-content:space-between;align-items:center}
      .tbl{width:100%;border-collapse:collapse}
      .thL{text-align:left;border-bottom:1px solid #e5e7eb;padding:10px 8px}
      .thR{text-align:right;border-bottom:1px solid #e5e7eb;padding:10px 8px}
      .td{border-bottom:1px solid #f3f4f6;padding:8px}
      .tdR{text-align:right;border-bottom:1px solid #f3f4f6;padding:8px}
      .prodGrid{display:grid;gap:8px;grid-template-columns:1fr 1fr 1fr auto;align-items:center}
      .recipeBox{border:1px dashed #ddd;border-radius:10px;padding:8px;margin:8px 0}
      .recipeGrid{display:grid;gap:8px;grid-template-columns:2fr 1fr auto}
      .chk{font-size:12px;display:flex;align-items:center;gap:6px}
      .actRow{display:flex;gap:8px}
      .invGrid{display:grid;gap:8px;grid-template-columns:2fr 1fr 1fr 1fr auto;align-items:center}
      @media (max-width:768px){
        .grid-menu{grid-template-columns:1fr}
        .recipeGrid{grid-template-columns:1fr 1fr auto}
        .prodGrid{grid-template-columns:1fr 1fr}
        .invGrid{grid-template-columns:1fr 1fr}
      }
      @media (min-width:769px){ .grid-pos{grid-template-columns:1fr 1fr} }
    `}</style>
  );
}

/* ============== Mini tokens ============== */
const wrap: React.CSSProperties = { padding: 12, maxWidth: 1100, margin: "0 auto" };
const card: React.CSSProperties = { border: "1px solid #e5e7eb", borderRadius: 12, padding: 12, background: "#fff" };
const input: React.CSSProperties = { border: "1px solid #e5e7eb", borderRadius: 8, padding: "10px 12px", width: "100%" };
const btnPrimary: React.CSSProperties = { border: "1px solid #2e7d32", background: "#2e7d32", color: "#fff", padding: "8px 12px", borderRadius: 10 };
const btnDanger: React.CSSProperties = { border: "1px solid #e53935", background: "#e53935", color: "#fff", padding: "8px 12px", borderRadius: 10 };

/* ============== Export CSV helper (Dashboard) ============== */
function exportDashboardCSV(daily: { labels: string[]; revenue: number[]; cups: number[] }) {
  const rows = [["Tanggal", "Pendapatan", "Cups"]];
  for (let i = 0; i < daily.labels.length; i++) {
    rows.push([daily.labels[i], String(daily.revenue[i]), String(daily.cups[i])]);
  }
  const csv = rows.map((r) => r.map((c) => `"${String(c).replaceAll(`"`, `""`)}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `dashboard_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}