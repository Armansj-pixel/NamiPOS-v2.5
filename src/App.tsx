// src/App.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  addDoc, arrayUnion, collection, deleteDoc, doc, getDoc, getDocs,
  limit, onSnapshot, orderBy, query, serverTimestamp, setDoc, startAfter,
  Timestamp, updateDoc, where
} from "firebase/firestore";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { auth, db } from "./lib/firebase";

/**
 * ========================= FIRESTORE INDEX NOTE =========================
 * Buat index2 berikut jika muncul error "The query requires an index":
 * 1) shifts : outlet(ASC) , isOpen(ASC) , openAt(DESC)
 * 2) sales  : outlet(ASC) , time(DESC)
 * 3) sales  : outlet(ASC) , shiftId(ASC)
 * 4) products / ingredients / recipes biasanya tidak perlu, single-field sudah cukup.
 * =======================================================================
 */

/** ======================== KONFIGURASI ======================== */
const OUTLET = "MTHaryono";
const OWNER_EMAILS = new Set([
  "antonius.arman123@gmail.com",
  "ayuismaalabibbah@gmail.com",
]);
const LOGO_URL = "/logo-chafu.png";            // letakkan di /public
const QRIS_IMG_SRC = "/qris.png";               // letakkan di /public
const LOW_STOCK_THRESHOLD = 5;                  // peringatan stok menipis

/** ======================== TIPE DATA ======================== */
type Product = {
  id: string;
  name: string;
  price: number;
  category?: string;
  active?: boolean;
  imageUrl?: string;
  outlet?: string;
};

type Ingredient = {
  id: string;
  name: string;
  unit: string; // gram | ml | pcs
  stock: number;
  min?: number;
  outlet?: string;
};

type RecipeItem = { ingredientId: string; qty: number; unit: string };
type RecipeDoc = { productId: string; outlet: string; items: RecipeItem[] };

type CartItem = { id: string; productId: string; name: string; price: number; qty: number; note?: string };

type Shift = {
  id: string;
  outlet: string;
  openBy: string;
  openAt: Timestamp;
  closeAt?: Timestamp | null;
  openCash?: number;
  isOpen: boolean;
};

type Sale = {
  id?: string;
  outlet: string;
  shiftId: string | null;
  cashierEmail: string;
  customerPhone: string | null;
  customerName?: string | null;
  time: Timestamp | null;
  items: { name: string; price: number; qty: number; note?: string }[];
  subtotal: number;
  discount: number;
  tax: number;
  service: number;
  total: number;
  payMethod: "cash" | "ewallet" | "qris";
  cash?: number;
  change?: number;
};

/** ======================== UTIL ======================== */
const uid = () => Math.random().toString(36).slice(2, 10);
const IDR = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n || 0);

const startOfDay = (d = new Date()) => {
  const x = new Date(d); x.setHours(0, 0, 0, 0); return x;
};
const endOfDay = (d = new Date()) => {
  const x = new Date(d); x.setHours(23, 59, 59, 999); return x;
};

/** ======================== APLIKASI ======================== */
export default function App() {
  /** ---------- detect halaman /order (public ordering) ---------- */
  const isPublicOrder = typeof window !== "undefined" && window.location.pathname.startsWith("/order");

  /** ---------- auth ---------- */
  const [user, setUser] = useState<null | { email: string }>(null);
  const isOwner = !!(user?.email && OWNER_EMAILS.has(user.email));
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUser(u?.email ? { email: u.email } : null));
    return () => unsub();
  }, []);

  /** ---------- tab ---------- */
  const [tab, setTab] = useState<"dashboard" | "pos" | "history" | "products" | "inventory" | "recipes" | "links" | "public">(
    isPublicOrder ? "public" : "pos"
  );

  /** ---------- login form ---------- */
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  async function doLogin(e?: React.FormEvent) {
    e?.preventDefault();
    try {
      setAuthLoading(true);
      await signInWithEmailAndPassword(auth, email.trim(), password);
      setEmail(""); setPassword("");
      setTab("pos");
    } catch (err: any) {
      alert("Login gagal: " + (err?.message || err));
    } finally {
      setAuthLoading(false);
    }
  }
  async function doLogout() { await signOut(auth); }

  /** ---------- master data ---------- */
  const [products, setProducts] = useState<Product[]>([]);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [recipes, setRecipes] = useState<Record<string, RecipeDoc>>({}); // key by productId

  /** ---------- POS state ---------- */
  const [queryText, setQueryText] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [noteInput, setNoteInput] = useState("");
  const [discount, setDiscount] = useState(0);
  const [taxPct, setTaxPct] = useState(0);
  const [svcPct, setSvcPct] = useState(0);
  const [payMethod, setPayMethod] = useState<"cash" | "ewallet" | "qris">("cash");
  const [cash, setCash] = useState<number>(0);
  const [showQR, setShowQR] = useState(false);

  /** ---------- loyalty ---------- */
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPoints, setCustomerPoints] = useState<number | null>(null);

  /** ---------- shift ---------- */
  const [activeShift, setActiveShift] = useState<Shift | null>(null);
  const [openCash, setOpenCash] = useState<number>(0);

  /** ---------- history ---------- */
  const [historyRows, setHistoryRows] = useState<Sale[]>([]);
  const [histCursor, setHistCursor] = useState<any>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  /** ---------- public order (tanpa login) ---------- */
  const [pubCart, setPubCart] = useState<CartItem[]>([]);
  const [pubName, setPubName] = useState("");
  const [pubPhone, setPubPhone] = useState("");
  const [pubAddress, setPubAddress] = useState("");

  /** ---------- computed ---------- */
  const filteredProducts = useMemo(
    () => products.filter(p => (p.active !== false) && p.name.toLowerCase().includes(queryText.toLowerCase())),
    [products, queryText]
  );
  const subtotal = useMemo(() => cart.reduce((s, i) => s + i.price * i.qty, 0), [cart]);
  const taxVal = Math.round(subtotal * (taxPct / 100));
  const svcVal = Math.round(subtotal * (svcPct / 100));
  const total = Math.max(0, subtotal + taxVal + svcVal - (discount || 0));
  const change = Math.max(0, (payMethod === "cash" ? (cash || 0) - total : 0));

  /** ---------- data loader setelah login ---------- */
  useEffect(() => {
    if (!user && !isPublicOrder) return;

    // products
    const qProd = query(collection(db, "products"), where("outlet", "==", OUTLET));
    const unsubProd = onSnapshot(qProd, snap => {
      const rows: Product[] = snap.docs.map(d => {
        const x = d.data() as any;
        return {
          id: d.id,
          name: x.name, price: x.price, category: x.category, active: x.active,
          imageUrl: x.imageUrl, outlet: x.outlet
        };
      });
      setProducts(rows);
    }, err => alert("Memuat produk gagal.\n" + (err.message || err)));

    // ingredients
    const qIng = query(collection(db, "ingredients"), where("outlet", "==", OUTLET));
    const unsubIng = onSnapshot(qIng, snap => {
      const rows: Ingredient[] = snap.docs.map(d => {
        const x = d.data() as any;
        return { id: d.id, name: x.name, unit: x.unit, stock: x.stock ?? 0, min: x.min ?? 0, outlet: x.outlet };
      });
      setIngredients(rows);
    }, err => alert("Memuat inventori gagal.\n" + (err.message || err)));

    // recipes (snapshot sekali cukup)
    const qRec = query(collection(db, "recipes"), where("outlet", "==", OUTLET));
    const unsubRec = onSnapshot(qRec, snap => {
      const map: Record<string, RecipeDoc> = {};
      snap.docs.forEach(d => {
        const x = d.data() as any;
        const doc: RecipeDoc = { productId: x.productId, outlet: x.outlet, items: x.items || [] };
        map[x.productId] = doc;
      });
      setRecipes(map);
    }, err => alert("Memuat resep gagal.\n" + (err.message || err)));

    // shift
    if (!isPublicOrder) checkActiveShift().catch(() => { });

    return () => { unsubProd(); unsubIng(); unsubRec(); };
    // eslint-disable-next-line
  }, [user?.email, isPublicOrder]);

  /** ---------- loyalty: lookup otomatis by phone ---------- */
  useEffect(() => {
    if (!user) return;
    const phone = customerPhone.trim();
    if (phone.length < 8) { setCustomerPoints(null); return; }
    (async () => {
      try {
        const ref = doc(db, "customers", phone);
        const s = await getDoc(ref);
        if (s.exists()) {
          const c = s.data() as any;
          setCustomerName(c.name || ""); setCustomerPoints(c.points || 0);
        } else {
          setCustomerPoints(0);
        }
      } catch (e: any) { console.warn("Lookup customer:", e?.message || e); }
    })();
  }, [customerPhone, user]);

  /** ======================== SHIFT ======================== */
  async function checkActiveShift() {
    const qShift = query(
      collection(db, "shifts"),
      where("outlet", "==", OUTLET),
      where("isOpen", "==", true),
      orderBy("openAt", "desc"),
      limit(1)
    );
    const snap = await getDocs(qShift);
    if (snap.empty) { setActiveShift(null); return; }
    const d = snap.docs[0]; const x = d.data() as any;
    setActiveShift({ id: d.id, outlet: x.outlet, openBy: x.openBy, openAt: x.openAt, closeAt: x.closeAt ?? null, openCash: x.openCash ?? 0, isOpen: true });
  }
  async function openShiftAction() {
    if (!user?.email) return alert("Belum login.");
    const id = `SHIFT-${Date.now()}`;
    await setDoc(doc(db, "shifts", id), {
      outlet: OUTLET, openBy: user.email, openAt: serverTimestamp(),
      closeAt: null, isOpen: true, openCash
    });
    setOpenCash(0);
    await checkActiveShift();
  }
  async function closeShiftAction() {
    if (!activeShift?.id) return;
    try {
      // rekap cepat: total by shift
      const qSales = query(collection(db, "sales"),
        where("outlet", "==", OUTLET),
        where("shiftId", "==", activeShift.id)
      );
      const s = await getDocs(qSales);
      let total = 0, trx = 0; let cashSum = 0, nonCash = 0;
      s.docs.forEach(d => {
        const x = d.data() as any;
        total += x.total || 0; trx++;
        if (x.payMethod === "cash") cashSum += x.total || 0; else nonCash += x.total || 0;
      });
      await updateDoc(doc(db, "shifts", activeShift.id), {
        isOpen: false, closeAt: serverTimestamp(),
        summary: { total, trx, cash: cashSum, nonCash }
      });
      setActiveShift(null);
      alert("Shift ditutup.");
    } catch (e: any) {
      if (String(e?.message || "").includes("index")) {
        alert("Tutup shift gagal.\nBuat index sales: outlet(ASC), shiftId(ASC)\n\n" + e.message);
      } else {
        alert("Tutup shift gagal.\n" + (e?.message || e));
      }
    }
  }

  /** ======================== RESEP & STOK ======================== */
  function checkStockForCart(items: CartItem[]): { ok: true; shortages?: never } | { ok: false; shortages: { name: string; need: number; have: number; unit: string }[] } {
    const needed = new Map<string, { need: number; unit: string; ingName: string }>();

    for (const ci of items) {
      const rec = recipes[ci.productId];
      if (!rec) continue; // tidak punya resep = tidak mengurangi stok
      for (const r of rec.items) {
        const totalNeed = (r.qty || 0) * ci.qty;
        const ing = ingredients.find(i => i.id === r.ingredientId);
        const key = r.ingredientId;
        if (!needed.has(key)) needed.set(key, { need: 0, unit: r.unit, ingName: ing?.name || "-" });
        const cur = needed.get(key)!;
        cur.need += totalNeed;
      }
    }

    const lack: { name: string; need: number; have: number; unit: string }[] = [];
    needed.forEach((v, ingId) => {
      const ing = ingredients.find(i => i.id === ingId);
      const have = ing?.stock ?? 0;
      if (have < v.need) lack.push({ name: v.ingName, need: v.need, have, unit: v.unit });
    });

    if (lack.length) return { ok: false, shortages: lack };
    return { ok: true };
  }

  async function deductStockAfterSale(items: CartItem[]) {
    // potong stok sesuai resep
    const batch: Array<Promise<any>> = [];
    for (const ci of items) {
      const rec = recipes[ci.productId];
      if (!rec) continue;
      for (const r of rec.items) {
        const need = (r.qty || 0) * ci.qty;
        const ing = ingredients.find(i => i.id === r.ingredientId);
        if (!ing) continue;
        batch.push(updateDoc(doc(db, "ingredients", ing.id), {
          stock: Math.max(0, (ing.stock || 0) - need)
        }));
      }
    }
    await Promise.all(batch);
  }

  /** ======================== POS ACTIONS ======================== */
  function addToCart(p: Product) {
    setCart(prev => {
      const same = prev.find(ci => ci.productId === p.id && (ci.note || "") === (noteInput || ""));
      if (same) return prev.map(ci => ci === same ? { ...ci, qty: ci.qty + 1 } : ci);
      return [...prev, { id: uid(), productId: p.id, name: p.name, price: p.price, qty: 1, note: noteInput || undefined }];
    });
  }
  const inc = (id: string) => setCart(prev => prev.map(ci => ci.id === id ? { ...ci, qty: ci.qty + 1 } : ci));
  const dec = (id: string) => setCart(prev => prev.map(ci => ci.id === id ? { ...ci, qty: Math.max(1, ci.qty - 1) } : ci));
  const rm = (id: string) => setCart(prev => prev.filter(ci => ci.id !== id));
  const clearCart = () => { setCart([]); setDiscount(0); setTaxPct(0); setSvcPct(0); setPayMethod("cash"); setCash(0); setNoteInput(""); setCustomerPhone(""); setCustomerName(""); setCustomerPoints(null); };

  function printReceipt(rec: Omit<Sale, "id">, saleId?: string) {
    const itemsHtml = rec.items.map(i => `<tr><td>${i.name}${i.note ? `<div style='font-size:10px;opacity:.7'>${i.note}</div>` : ""}</td><td style='text-align:center'>${i.qty}x</td><td style='text-align:right'>${IDR(i.price * i.qty)}</td></tr>`).join("");
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
  <img src="${LOGO_URL}" onerror="this.style.display='none'" />
  ${rec.payMethod!=="cash" ? `<img src="${QRIS_IMG_SRC}" onerror="this.style.display='none'"/>` : ""}
  <h2>NamiPOS — ${OUTLET}</h2>
  <div class="meta">${saleId || "DRAFT"}<br/>${new Date().toLocaleString("id-ID", { hour12: false })}</div>
  <hr/>
  <table style="width:100%;border-collapse:collapse">
    ${itemsHtml}
    <tr class="tot"><td>Subtotal</td><td></td><td style="text-align:right">${IDR(rec.subtotal)}</td></tr>
    ${rec.tax ? `<tr class="tot"><td>Pajak</td><td></td><td style="text-align:right">${IDR(rec.tax)}</td></tr>` : ""}
    ${rec.service ? `<tr class="tot"><td>Service</td><td></td><td style="text-align:right">${IDR(rec.service)}</td></tr>` : ""}
    ${rec.discount ? `<tr class="tot"><td>Diskon</td><td></td><td style="text-align:right">-${IDR(rec.discount)}</td></tr>` : ""}
    <tr class="tot"><td>Total</td><td></td><td style="text-align:right">${IDR(rec.total)}</td></tr>
    ${rec.payMethod==="cash"
      ? `<tr><td>Tunai</td><td></td><td style='text-align:right'>${IDR(rec.cash||0)}</td></tr>
         <tr><td>Kembali</td><td></td><td style='text-align:right'>${IDR(rec.change||0)}</td></tr>`
      : `<tr><td>Metode</td><td></td><td style='text-align:right'>${rec.payMethod.toUpperCase()}</td></tr>`
    }
  </table>
  <p class="meta">Terima kasih! • WhatsApp order: wa.me/62xxxxxxxxxx</p>
</div>
<script>window.print();</script>
</body></html>`;
    w.document.write(html); w.document.close();
  }

  async function finalize() {
    if (!user?.email) return alert("Belum login.");
    if (!activeShift?.id) return alert("Buka shift dahulu.");
    if (cart.length === 0) return alert("Keranjang kosong.");
    if (payMethod === "cash" && cash < total) return alert("Uang tunai kurang.");

    // cek stok
    const chk = checkStockForCart(cart);
    if (!chk.ok) {
      const msg = chk.shortages!.map(s => `• ${s.name}: butuh ${s.need} ${s.unit}, tersedia ${s.have}`).join("\n");
      return alert("Stok tidak mencukupi:\n" + msg);
    }

    const payload: Omit<Sale, "id"> = {
      outlet: OUTLET, shiftId: activeShift.id, cashierEmail: user.email,
      customerPhone: customerPhone?.trim() || null, customerName: customerName?.trim() || null,
      time: serverTimestamp() as any,
      items: cart.map(i => ({ name: i.name, price: i.price, qty: i.qty, ...(i.note ? { note: i.note } : {}) })),
      subtotal, discount: discount || 0, tax: taxVal, service: svcVal, total, payMethod,
      ...(payMethod === "cash" ? { cash, change } : {})
    };

    try {
      const ref = await addDoc(collection(db, "sales"), payload as any);

      // loyalty
      if ((customerPhone.trim().length) >= 8) {
        const cref = doc(db, "customers", customerPhone.trim());
        const s = await getDoc(cref);
        const pts = Math.floor(total / 10000);
        if (s.exists()) {
          const c = s.data() as any;
          await updateDoc(cref, { points: (c.points || 0) + pts, name: customerName || c.name || "", lastVisit: serverTimestamp() });
        } else {
          await setDoc(cref, { phone: customerPhone.trim(), name: customerName || "Member", points: pts, lastVisit: serverTimestamp() });
        }
      }

      // potong stok
      await deductStockAfterSale(cart);
      // peringatan stok rendah
      const low = ingredients.filter(i => i.stock <= (i.min ?? LOW_STOCK_THRESHOLD));
      if (low.length) alert("Peringatan stok rendah:\n" + low.map(i => `• ${i.name} (${i.stock} ${i.unit})`).join("\n"));

      printReceipt(payload, ref.id);
      clearCart();
      if (tab === "history") loadHistory(false);

    } catch (err: any) {
      alert("Transaksi gagal disimpan: " + (err?.message || err));
    }
  }

  /** ======================== HISTORY ======================== */
  async function loadHistory(append: boolean) {
    if (!user) return;
    setHistoryLoading(true);
    try {
      const cons: any[] = [where("outlet", "==", OUTLET), orderBy("time", "desc"), limit(50)];
      if (append && histCursor) cons.push(startAfter(histCursor));
      const qh = query(collection(db, "sales"), ...cons);
      const snap = await getDocs(qh);
      const rows: Sale[] = snap.docs.map(d => {
        const x = d.data() as any;
        return {
          id: d.id,
          outlet: x.outlet, shiftId: x.shiftId ?? null, cashierEmail: x.cashierEmail,
          customerPhone: x.customerPhone ?? null, customerName: x.customerName ?? null,
          time: x.time ?? null,
          items: x.items || [],
          subtotal: x.subtotal ?? 0, discount: x.discount ?? 0, tax: x.tax ?? 0, service: x.service ?? 0,
          total: x.total ?? 0, payMethod: x.payMethod ?? "cash", cash: x.cash ?? 0, change: x.change ?? 0
        };
      });
      setHistoryRows(prev => append ? [...prev, ...rows] : rows);
      setHistCursor(snap.docs.length ? snap.docs[snap.docs.length - 1] : null);
    } catch (e: any) {
      if (String(e?.message || "").includes("index")) {
        alert("Riwayat butuh index Firestore: sales → outlet(ASC), time(DESC)\n\n" + e.message);
      } else {
        alert("Gagal memuat riwayat: " + (e?.message || e));
      }
    } finally { setHistoryLoading(false); }
  }

  /** ======================== OWNER CRUD (PRODUCTS / INGREDIENTS / RECIPES) ======================== */
  async function upsertProduct(p: Partial<Product> & { id?: string }) {
    if (!isOwner) return alert("Akses khusus owner.");
    const id = p.id || uid();
    await setDoc(doc(db, "products", id), {
      outlet: OUTLET, name: p.name || "Produk", price: Number(p.price) || 0,
      category: p.category || "Signature", active: p.active !== false, imageUrl: p.imageUrl || ""
    }, { merge: true });
  }
  async function deactivateProduct(id: string, hide = true) {
    if (!isOwner) return alert("Akses khusus owner.");
    if (hide) await updateDoc(doc(db, "products", id), { active: false });
    else await deleteDoc(doc(db, "products", id));
  }

  async function upsertIngredient(i: Partial<Ingredient> & { id?: string }) {
    if (!isOwner) return alert("Akses khusus owner.");
    const id = i.id || uid();
    await setDoc(doc(db, "ingredients", id), {
      outlet: OUTLET, name: i.name || "Bahan", unit: i.unit || "pcs",
      stock: Number(i.stock) || 0, min: Number(i.min) || 0
    }, { merge: true });
  }
  async function deleteIngredient(id: string) {
    if (!isOwner) return alert("Akses khusus owner.");
    await deleteDoc(doc(db, "ingredients", id));
  }

  async function saveRecipe(productId: string, items: RecipeItem[]) {
    if (!isOwner) return alert("Akses khusus owner.");
    await setDoc(doc(db, "recipes", productId), {
      productId, outlet: OUTLET, items
    }, { merge: true });
  }

  /** ======================== PUBLIC ORDER ======================== */
  const pubSubtotal = useMemo(() => pubCart.reduce((s, i) => s + i.price * i.qty, 0), [pubCart]);
  function pubAdd(p: Product) {
    setPubCart(prev => {
      const same = prev.find(ci => ci.productId === p.id);
      if (same) return prev.map(ci => ci === same ? { ...ci, qty: ci.qty + 1 } : ci);
      return [...prev, { id: uid(), productId: p.id, name: p.name, price: p.price, qty: 1 }];
    });
  }
  const pubInc = (id: string) => setPubCart(prev => prev.map(ci => ci.id === id ? { ...ci, qty: ci.qty + 1 } : ci));
  const pubDec = (id: string) => setPubCart(prev => prev.map(ci => ci.id === id ? { ...ci, qty: Math.max(1, ci.qty - 1) } : ci));
  const pubRm = (id: string) => setPubCart(prev => prev.filter(ci => ci.id !== id));
  async function pubSubmit() {
    if (!pubName.trim() || !pubPhone.trim() || !pubAddress.trim() || pubCart.length === 0) {
      return alert("Lengkapi data & pilih menu.");
    }
    const payload = {
      outlet: OUTLET,
      name: pubName.trim(),
      phone: pubPhone.trim(),
      address: pubAddress.trim(),
      items: pubCart.map(i => ({ name: i.name, price: i.price, qty: i.qty })),
      subtotal: pubSubtotal,
      status: "pending",
      createdAt: serverTimestamp()
    };
    await addDoc(collection(db, "public_orders"), payload as any);
    alert("Pesanan terkirim! Kami akan menghubungi Anda via WhatsApp.");
    setPubCart([]); setPubName(""); setPubPhone(""); setPubAddress("");
  }

  /** ======================== UI RENDER ======================== */
  if (isPublicOrder) {
    // Halaman PUBLIC ORDER (tanpa login)
    return (
      <div className="min-h-screen bg-neutral-50">
        <header className="sticky top-0 bg-white border-b">
          <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-3">
            <img src={LOGO_URL} className="h-7" onError={(e: any) => e.currentTarget.style.display = "none"} />
            <div className="font-bold">NamiPOS — Order • {OUTLET}</div>
          </div>
        </header>
        <main className="max-w-5xl mx-auto px-4 py-4 grid grid-cols-1 md:grid-cols-12 gap-4">
          <div className="md:col-span-7">
            <input className="border rounded-lg px-3 py-2 w-full mb-3" placeholder="Cari menu…" onChange={e => setQueryText(e.target.value)} />
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {filteredProducts.map(p => (
                <button key={p.id} onClick={() => pubAdd(p)} className="bg-white rounded-xl border p-3 text-left hover:shadow">
                  <div className="h-20 rounded-xl bg-neutral-100 mb-2 overflow-hidden">
                    {p.imageUrl ? <img src={p.imageUrl} className="w-full h-20 object-cover" /> : null}
                  </div>
                  <div className="font-medium">{p.name}</div>
                  <div className="text-xs text-neutral-500">{p.category || "Signature"}</div>
                  <div className="font-semibold mt-1">{IDR(p.price)}</div>
                </button>
              ))}
            </div>
          </div>
          <div className="md:col-span-5">
            <div className="bg-white rounded-xl border p-3">
              <div className="font-semibold mb-2">Keranjang</div>
              {pubCart.length === 0 ? <div className="text-sm text-neutral-500">Belum ada item.</div> : (
                <div className="space-y-2">
                  {pubCart.map(ci => (
                    <div key={ci.id} className="grid grid-cols-12 items-center gap-2 border rounded-lg p-2">
                      <div className="col-span-6">
                        <div className="font-medium">{ci.name}</div>
                        <div className="text-xs opacity-70">{IDR(ci.price)}</div>
                      </div>
                      <div className="col-span-4 flex items-center justify-end gap-2">
                        <button className="px-2 py-1 border rounded" onClick={() => pubDec(ci.id)}>-</button>
                        <div className="w-8 text-center">{ci.qty}</div>
                        <button className="px-2 py-1 border rounded" onClick={() => pubInc(ci.id)}>+</button>
                      </div>
                      <div className="col-span-2 text-right">
                        <button className="px-2 py-1 border rounded" onClick={() => pubRm(ci.id)}>x</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="mt-3 border-t pt-3">
                <div className="flex items-center justify-between"><span>Subtotal</span><b>{IDR(pubSubtotal)}</b></div>
              </div>
              <div className="mt-3 grid grid-cols-1 gap-2">
                <input className="border rounded-lg px-3 py-2" placeholder="Nama" value={pubName} onChange={e => setPubName(e.target.value)} />
                <input className="border rounded-lg px-3 py-2" placeholder="No. HP (WhatsApp)" value={pubPhone} onChange={e => setPubPhone(e.target.value)} />
                <textarea className="border rounded-lg px-3 py-2" placeholder="Alamat lengkap" value={pubAddress} onChange={e => setPubAddress(e.target.value)} />
                <button className="px-3 py-2 rounded-lg bg-emerald-600 text-white" onClick={pubSubmit}>Kirim Pesanan</button>
              </div>
            </div>
          </div>
        </main>
        <footer className="text-center text-xs text-neutral-500 py-4">© {new Date().getFullYear()} NamiPOS</footer>
      </div>
    );
  }

  /** -------- jika bukan public order: butuh login -------- */
  if (!user) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-emerald-50 to-white flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-6 border">
          <div className="flex items-center gap-3 mb-4">
            <img src={LOGO_URL} className="h-10" onError={(e: any) => e.currentTarget.style.display = "none"} />
            <div>
              <h1 className="text-2xl font-bold">NamiPOS — POS</h1>
              <p className="text-xs text-neutral-500">@{OUTLET}</p>
            </div>
          </div>
          <form onSubmit={doLogin} className="space-y-3">
            <input className="w-full border rounded-lg p-3" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} />
            <input className="w-full border rounded-lg p-3" type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} />
            <button disabled={authLoading} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg p-3">{authLoading ? "Masuk..." : "Masuk"}</button>
          </form>
          <p className="text-xs text-neutral-500 mt-3">Hanya staf & owner yang diizinkan.</p>
        </div>
      </div>
    );
  }

  /** -------- MAIN APP (setelah login) -------- */
  return (
    <div className="min-h-screen bg-neutral-50">
      {/* Topbar */}
      <header className="sticky top-0 z-30 bg-white/80 backdrop-blur border-b">
        <div className="max-w-7xl mx-auto px-3 sm:px-4 md:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src={LOGO_URL} className="h-8" onError={(e: any) => e.currentTarget.style.display = "none"} />
            <div>
              <div className="font-bold">NamiPOS — {OUTLET}</div>
              <div className="text-[11px] text-neutral-500">Masuk: {user.email}{isOwner ? " · owner" : " · staff"}</div>
            </div>
          </div>
          <nav className="flex gap-2">
            {isOwner && <button onClick={() => setTab("dashboard")} className={`px-3 py-1.5 rounded-lg border ${tab === "dashboard" ? "bg-emerald-50 border-emerald-200" : "bg-white"}`}>Dashboard</button>}
            <button onClick={() => setTab("pos")} className={`px-3 py-1.5 rounded-lg border ${tab === "pos" ? "bg-emerald-50 border-emerald-200" : "bg-white"}`}>Kasir</button>
            <button onClick={() => { setTab("history"); loadHistory(false); }} className={`px-3 py-1.5 rounded-lg border ${tab === "history" ? "bg-emerald-50 border-emerald-200" : "bg-white"}`}>Riwayat</button>
            {isOwner && <button onClick={() => setTab("products")} className={`px-3 py-1.5 rounded-lg border ${tab === "products" ? "bg-emerald-50 border-emerald-200" : "bg-white"}`}>Produk</button>}
            {isOwner && <button onClick={() => setTab("inventory")} className={`px-3 py-1.5 rounded-lg border ${tab === "inventory" ? "bg-emerald-50 border-emerald-200" : "bg-white"}`}>Inventori</button>}
            {isOwner && <button onClick={() => setTab("recipes")} className={`px-3 py-1.5 rounded-lg border ${tab === "recipes" ? "bg-emerald-50 border-emerald-200" : "bg-white"}`}>Resep</button>}
            <button onClick={() => setTab("links")} className={`px-3 py-1.5 rounded-lg border ${tab === "links" ? "bg-emerald-50 border-emerald-200" : "bg-white"}`}>Link</button>
            <button onClick={doLogout} className="px-3 py-1.5 rounded-lg border bg-rose-50">Keluar</button>
          </nav>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-3 sm:px-4 md:px-6 py-4">
        {/* Shift badge */}
        <div className="mb-3">
          <div className="inline-flex items-center gap-2 text-xs px-3 py-1 rounded-full border bg-white">
            {activeShift?.isOpen
              ? <>Shift <b>OPEN</b> • {new Date(activeShift.openAt?.toDate?.() || new Date()).toLocaleTimeString("id-ID", { hour12: false })} • {activeShift.openBy}</>
              : <>Belum ada shift aktif</>}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {!activeShift?.isOpen ? (
              <>
                <input type="number" className="border rounded-lg px-3 py-2 w-40" placeholder="Kas awal (Rp)" value={openCash} onChange={e => setOpenCash(Number(e.target.value) || 0)} />
                <button className="px-3 py-2 rounded-lg bg-emerald-600 text-white" onClick={openShiftAction}>Buka Shift</button>
              </>
            ) : (
              <button className="px-3 py-2 rounded-lg bg-rose-600 text-white" onClick={closeShiftAction}>Tutup Shift</button>
            )}
          </div>
        </div>

        {/* POS */}
        {tab === "pos" && (
          <section className="grid grid-cols-1 md:grid-cols-12 gap-4">
            {/* Products */}
            <div className="md:col-span-7">
              <div className="bg-white rounded-2xl border p-3 mb-2">
                <input className="border rounded-lg px-3 py-2 w-full" placeholder="Cari menu…" value={queryText} onChange={e => setQueryText(e.target.value)} />
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {filteredProducts.map(p => (
                  <button key={p.id} onClick={() => addToCart(p)} className="bg-white rounded-2xl border p-3 text-left hover:shadow">
                    <div className="h-20 rounded-xl bg-neutral-100 mb-2 overflow-hidden">
                      {p.imageUrl ? <img src={p.imageUrl} className="w-full h-20 object-cover" /> : null}
                    </div>
                    <div className="font-medium leading-tight">{p.name}</div>
                    <div className="text-xs text-neutral-500">{p.category || "Signature"}</div>
                    <div className="font-semibold mt-1">{IDR(p.price)}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Cart */}
            <div className="md:col-span-5">
              <div className="bg-white rounded-2xl border p-3">
                {/* Customer */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-2">
                  <input className="border rounded-lg px-3 py-2" placeholder="No HP pelanggan" value={customerPhone} onChange={e => setCustomerPhone(e.target.value)} />
                  <input className="border rounded-lg px-3 py-2" placeholder="Nama pelanggan (baru)" value={customerName} onChange={e => setCustomerName(e.target.value)} />
                </div>
                {!!customerPhone && (
                  <div className="text-xs text-neutral-600 mb-2">
                    {customerPoints === null ? "Mencari pelanggan…" :
                      customerPoints === 0 && !customerName ? "Belum terdaftar — isi nama untuk dibuat otomatis saat transaksi." :
                        <>Poin: <b>{customerPoints}</b> {customerName ? `— ${customerName}` : ""}</>}
                  </div>
                )}

                <div className="flex items-center gap-2 mb-2">
                  <input className="border rounded-lg px-3 py-2 flex-1" placeholder="Catatan item (less sugar / no ice)" value={noteInput} onChange={e => setNoteInput(e.target.value)} />
                  <button className="px-3 py-2 rounded-lg border" onClick={() => setNoteInput("")}>Clear</button>
                </div>

                {cart.length === 0 ? (
                  <div className="text-sm text-neutral-500">Belum ada item. Klik menu untuk menambahkan.</div>
                ) : (
                  <div className="space-y-2">
                    {cart.map(ci => (
                      <div key={ci.id} className="grid grid-cols-12 items-center gap-2 border rounded-xl p-2">
                        <div className="col-span-6">
                          <div className="font-medium leading-tight">{ci.name}</div>
                          {ci.note && <div className="text-xs text-neutral-500">{ci.note}</div>}
                        </div>
                        <div className="col-span-2 text-right text-sm">{IDR(ci.price)}</div>
                        <div className="col-span-3 flex items-center justify-end gap-2">
                          <button className="px-2 py-1 border rounded" onClick={() => dec(ci.id)}>-</button>
                          <div className="w-8 text-center font-medium">{ci.qty}</div>
                          <button className="px-2 py-1 border rounded" onClick={() => inc(ci.id)}>+</button>
                        </div>
                        <div className="col-span-1 text-right">
                          <button className="px-2 py-1 rounded border" onClick={() => rm(ci.id)}>x</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* totals */}
                <div className="my-3 border-t pt-3 space-y-2">
                  <div className="flex items-center justify-between text-sm"><span>Subtotal</span><span className="font-medium">{IDR(subtotal)}</span></div>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="flex items-center gap-2 text-sm">
                      <span className="w-20">Pajak %</span>
                      <input type="number" className="border rounded-lg px-2 py-1 w-24" value={taxPct} onChange={e => setTaxPct(Number(e.target.value) || 0)} />
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <span className="w-20">Service %</span>
                      <input type="number" className="border rounded-lg px-2 py-1 w-24" value={svcPct} onChange={e => setSvcPct(Number(e.target.value) || 0)} />
                    </label>
                  </div>
                  <label className="flex items-center justify-between text-sm">
                    <span>Diskon (Rp)</span>
                    <input type="number" className="border rounded-lg px-2 py-1 w-28" value={discount} onChange={e => setDiscount(Number(e.target.value) || 0)} />
                  </label>
                  <div className="flex items-center justify-between text-lg font-semibold">
                    <span>Total</span><span>{IDR(total)}</span>
                  </div>
                </div>

                {/* payment */}
                <div className="grid grid-cols-1 gap-2 mb-2">
                  <select className="border rounded-lg px-3 py-2" value={payMethod} onChange={e => setPayMethod(e.target.value as any)}>
                    <option value="cash">Cash</option>
                    <option value="ewallet">eWallet / QRIS</option>
                    <option value="qris">QRIS Static</option>
                  </select>
                  {payMethod === "cash" && (
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        className="border rounded-lg px-3 py-2 w-40"
                        placeholder="Tunai diterima"
                        value={cash}
                        onChange={e => setCash(Number(e.target.value) || 0)}
                      />
                      <div className="text-sm">Kembali: <b>{IDR(change)}</b></div>
                    </div>
                  )}
                  {(payMethod === "ewallet" || payMethod === "qris") && (
                    <div className="border rounded-xl p-2 bg-emerald-50">
                      <div className="text-sm mb-1">Scan untuk bayar:</div>
                      <img src={QRIS_IMG_SRC} alt="QRIS" className="w-40" onClick={() => setShowQR(true)} />
                      <div className="text-xs text-neutral-500 mt-1">* Setelah sukses, tekan “Selesai & Cetak”.</div>
                    </div>
                  )}
                </div>

                {/* actions */}
                <div className="flex justify-between gap-2">
                  <button className="px-3 py-2 rounded-lg border" onClick={clearCart}>Bersihkan</button>
                  <div className="flex gap-2">
                    <button
                      className="px-3 py-2 rounded-lg border"
                      disabled={cart.length === 0}
                      onClick={() => printReceipt({
                        outlet: OUTLET, shiftId: activeShift?.id || null, cashierEmail: user.email, customerPhone: customerPhone || null, customerName,
                        time: null, items: cart.map(i => ({ name: i.name, price: i.price, qty: i.qty, ...(i.note ? { note: i.note } : {}) })),
                        subtotal, discount, tax: taxVal, service: svcVal, total, payMethod, cash, change
                      })}
                    >Print Draf</button>
                    <button className="px-3 py-2 rounded-lg bg-emerald-600 text-white disabled:opacity-50" disabled={cart.length === 0} onClick={finalize}>Selesai & Cetak</button>
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* HISTORY */}
        {tab === "history" && (
          <section className="bg-white rounded-2xl border p-3">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-lg font-semibold">Riwayat Transaksi</h2>
              <div className="flex gap-2">
                <button className="px-3 py-2 rounded-lg border" onClick={() => loadHistory(false)} disabled={historyLoading}>Muat Ulang</button>
                <button className="px-3 py-2 rounded-lg border" onClick={() => loadHistory(true)} disabled={historyLoading || !histCursor}>Muat Lagi</button>
              </div>
            </div>
            <div className="overflow-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left border-b">
                  <th className="py-2">Waktu</th><th>Kasir</th><th>Pelanggan</th><th>Item</th><th className="text-right">Total</th>
                </tr></thead>
                <tbody>
                  {historyRows.map(s => (
                    <tr key={s.id} className="border-b hover:bg-emerald-50/40">
                      <td className="py-2">{s.time ? new Date(s.time.toDate()).toLocaleString("id-ID", { hour12: false }) : "-"}</td>
                      <td>{s.cashierEmail}</td>
                      <td>{s.customerPhone || "-"}</td>
                      <td className="truncate">{s.items.map(i => `${i.name}x${i.qty}`).join(", ")}</td>
                      <td className="text-right font-medium">{IDR(s.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {historyRows.length === 0 && <div className="text-sm text-neutral-500">Belum ada transaksi.</div>}
            </div>
          </section>
        )}

        {/* PRODUCTS */}
        {tab === "products" && isOwner && (
          <section className="bg-white rounded-2xl border p-3">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-lg font-semibold">Manajemen Produk</h2>
              <button className="px-3 py-2 rounded-lg border" onClick={() => upsertProduct({ name: "Produk Baru", price: 10000, category: "Signature", active: true })}>+ Tambah</button>
            </div>
            <div className="overflow-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left border-b"><th>Nama</th><th>Kategori</th><th className="text-right">Harga</th><th>Gambar (URL)</th><th className="text-right">Aksi</th></tr></thead>
                <tbody>
                  {products.map(p => (
                    <tr key={p.id} className="border-b">
                      <td className="py-2"><input className="border rounded px-2 py-1 w-44" defaultValue={p.name} onBlur={(e) => upsertProduct({ id: p.id, name: e.target.value })} /></td>
                      <td><input className="border rounded px-2 py-1 w-32" defaultValue={p.category || ""} onBlur={(e) => upsertProduct({ id: p.id, category: e.target.value })} /></td>
                      <td className="text-right"><input type="number" className="border rounded px-2 py-1 w-28 text-right" defaultValue={p.price} onBlur={(e) => upsertProduct({ id: p.id, price: Number(e.target.value) || 0 })} /></td>
                      <td className="w-[240px]"><input className="border rounded px-2 py-1 w-full" defaultValue={p.imageUrl || ""} onBlur={(e) => upsertProduct({ id: p.id, imageUrl: e.target.value })} /></td>
                      <td className="text-right">
                        <button className="px-2 py-1 border rounded mr-2" onClick={() => upsertProduct({ id: p.id, active: !(p.active === false) ? false : true })}>{p.active === false ? "Aktifkan" : "Nonaktifkan"}</button>
                        <button className="px-2 py-1 border rounded" onClick={() => deactivateProduct(p.id, false)}>Hapus</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {products.length === 0 && <div className="text-sm text-neutral-500">Belum ada produk.</div>}
            </div>
          </section>
        )}

        {/* INVENTORY */}
        {tab === "inventory" && isOwner && (
          <section className="bg-white rounded-2xl border p-3">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-lg font-semibold">Inventori</h2>
              <button className="px-3 py-2 rounded-lg border" onClick={() => upsertIngredient({ name: "Bahan Baru", unit: "pcs", stock: 0, min: 0 })}>+ Tambah</button>
            </div>
            <div className="overflow-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left border-b"><th>Nama</th><th>Satuan</th><th className="text-right">Stok</th><th className="text-right">Min</th><th className="text-right">Aksi</th></tr></thead>
                <tbody>
                  {ingredients.map(i => (
                    <tr key={i.id} className={`border-b ${i.stock <= (i.min ?? LOW_STOCK_THRESHOLD) ? "bg-amber-50" : ""}`}>
                      <td className="py-2"><input className="border rounded px-2 py-1 w-44" defaultValue={i.name} onBlur={(e) => upsertIngredient({ id: i.id, name: e.target.value })} /></td>
                      <td><input className="border rounded px-2 py-1 w-20" defaultValue={i.unit} onBlur={(e) => upsertIngredient({ id: i.id, unit: e.target.value })} /></td>
                      <td className="text-right"><input type="number" className="border rounded px-2 py-1 w-24 text-right" defaultValue={i.stock} onBlur={(e) => upsertIngredient({ id: i.id, stock: Number(e.target.value) || 0 })} /></td>
                      <td className="text-right"><input type="number" className="border rounded px-2 py-1 w-20 text-right" defaultValue={i.min ?? 0} onBlur={(e) => upsertIngredient({ id: i.id, min: Number(e.target.value) || 0 })} /></td>
                      <td className="text-right">
                        <button className="px-2 py-1 border rounded" onClick={() => deleteIngredient(i.id)}>Hapus</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {ingredients.length === 0 && <div className="text-sm text-neutral-500">Belum ada data inventori.</div>}
            </div>
          </section>
        )}

        {/* RECIPES */}
        {tab === "recipes" && isOwner && (
          <section className="bg-white rounded-2xl border p-3 space-y-4">
            <h2 className="text-lg font-semibold">Resep per Produk</h2>
            {products.map(p => (
              <RecipeEditor
                key={p.id}
                product={p}
                ingredients={ingredients}
                initial={recipes[p.id]?.items || []}
                onSave={(items) => saveRecipe(p.id, items)}
              />
            ))}
            {products.length === 0 && <div className="text-sm text-neutral-500">Belum ada produk.</div>}
          </section>
        )}

        {/* LINKS */}
        {tab === "links" && (
          <section className="bg-white rounded-2xl border p-3">
            <h2 className="text-lg font-semibold mb-2">Link Penting</h2>
            <ul className="list-disc pl-5 space-y-1 text-sm">
              <li>Halaman Order Publik: <code>{window.location.origin}/order</code></li>
              <li>Logo: <code>/logo-chafu.png</code> • QRIS: <code>/qris.png</code></li>
            </ul>
          </section>
        )}
      </main>

      {/* Modal QR */}
      {showQR && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setShowQR(false)}>
          <div className="bg-white rounded-2xl p-4" onClick={e => e.stopPropagation()}>
            <img src={QRIS_IMG_SRC} alt="QRIS" className="w-72" />
            <div className="text-center mt-2 text-sm">Scan untuk bayar • {IDR(total)}</div>
          </div>
        </div>
      )}
    </div>
  );
}

/** =============== Komponen Editor Resep =============== */
function RecipeEditor({
  product,
  ingredients,
  initial,
  onSave
}: {
  product: Product;
  ingredients: Ingredient[];
  initial: RecipeItem[];
  onSave: (items: RecipeItem[]) => void | Promise<void>;
}) {
  const [rows, setRows] = useState<RecipeItem[]>(initial.length ? initial : [{ ingredientId: "", qty: 0, unit: "pcs" }]);
  useEffect(() => { setRows(initial.length ? initial : [{ ingredientId: "", qty: 0, unit: "pcs" }]); }, [initial]);

  const addRow = () => setRows(r => [...r, { ingredientId: "", qty: 0, unit: "pcs" }]);
  const rmRow = (idx: number) => setRows(r => r.filter((_, i) => i !== idx));
  const patch = (idx: number, patch: Partial<RecipeItem>) => setRows(r => r.map((x, i) => i === idx ? { ...x, ...patch } : x));

  return (
    <div className="border rounded-xl p-3">
      <div className="font-semibold mb-2">{product.name}</div>
      {rows.map((r, i) => (
        <div key={i} className="grid grid-cols-12 gap-2 items-center mb-2">
          <select className="col-span-5 border rounded px-2 py-1" value={r.ingredientId} onChange={e => patch(i, { ingredientId: e.target.value })}>
            <option value="">— Pilih Bahan —</option>
            {ingredients.map(ing => <option key={ing.id} value={ing.id}>{ing.name}</option>)}
          </select>
          <input className="col-span-3 border rounded px-2 py-1" type="number" placeholder="Qty" value={r.qty} onChange={e => patch(i, { qty: Number(e.target.value) || 0 })} />
          <input className="col-span-2 border rounded px-2 py-1" placeholder="Unit" value={r.unit} onChange={e => patch(i, { unit: e.target.value })} />
          <div className="col-span-2 text-right">
            <button className="px-2 py-1 border rounded" onClick={() => rmRow(i)}>Hapus</button>
          </div>
        </div>
      ))}
      <div className="flex justify-between">
        <button className="px-3 py-2 border rounded" onClick={addRow}>+ Tambah baris</button>
        <button className="px-3 py-2 rounded bg-emerald-600 text-white" onClick={() => onSave(rows)}>Simpan Resep</button>
      </div>
    </div>
  );
}