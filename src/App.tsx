/* App.tsx — NamiPOS v2.5.6 (Full Stable + Elegant UI)
   Semua fitur: POS, Shift, Produk, Inventori, Resep (auto stock), Loyalty (15k=1poin, 10 poin = 1 gratis),
   Riwayat, Dashboard, Orders admin, Public Order (/order)
*/

import React, { useEffect, useMemo, useState } from "react";
import {
  addDoc, collection, deleteDoc, doc, getDoc, getDocs, onSnapshot,
  orderBy, query, serverTimestamp, setDoc, Timestamp, updateDoc,
  where, limit, startAfter
} from "firebase/firestore";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { auth, db } from "./lib/firebase";

/* ==========================
   KONFIG
========================== */
const OUTLET = "MTHaryono";
const OWNER_EMAILS = new Set([
  "antonius.arman123@gmail.com",
  "ayuismaalabibbah@gmail.com",
]);

// logo & QR
const BRAND_LOGO = "https://ibb.co.com/2YvxkpnJ";
const QRIS_IMG_SRC = "/qris.png";

// loyalty & ongkir
const POINT_PER_RP = 15000;
const FREE_DRINK_POINTS = 10;
const SHIPPING_PER_KM = 2000;

/* ==========================
   TYPES
========================== */
type Product = { id: string; name: string; price: number; imageUrl?: string; category?: string; active?: boolean; outlet?: string; };
type Ingredient = { id: string; name: string; unit: string; stock: number; min?: number; outlet?: string; };
type RecipeItem = { ingredientId: string; qty: number; };
type RecipeDoc = { id: string; items: RecipeItem[]; };
type CartItem = { id: string; productId: string; name: string; price: number; qty: number; note?: string; };
type Shift = { id: string; outlet: string; openBy: string; openAt: Timestamp; closeAt?: Timestamp | null; openCash?: number; isOpen: boolean; };
type Sale = {
  id?: string; outlet: string; shiftId: string | null; cashierEmail: string;
  customerPhone: string | null; customerName?: string | null; time: Timestamp | null;
  items: { name: string; price: number; qty: number; note?: string }[];
  subtotal: number; discount: number; tax: number; service: number;
  total: number; payMethod: "cash" | "ewallet" | "qris"; cash?: number; change?: number;
  pointsEarned?: number; usedFreeDrink?: boolean;
};
type PublicOrderDoc = {
  id: string; outlet: string; source: "public"; customerName: string;
  customerPhone: string; address: string; distance: number; method: "qris" | "cod";
  time: Timestamp | null; items: { productId?: string; name: string; price: number; qty: number; note?: string }[];
  subtotal: number; shipping: number; total: number; status: "pending" | "accepted" | "rejected" | "done"; saleId?: string;
};

/* ==========================
   UTILITIES
========================== */
const uid = () => Math.random().toString(36).slice(2, 10);
const IDR = (n: number) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n || 0);
const calcShipping = (km: number) => Math.ceil(Math.max(0, km - 1)) * SHIPPING_PER_KM;
const param = (k: string, def = "") => { try { return new URLSearchParams(window.location.search).get(k) || def; } catch { return def; } };

/* ==========================
   RECIPE & STOCK HELPERS
========================== */
async function fetchRecipe(productId: string): Promise<RecipeDoc | null> {
  const r = await getDoc(doc(db, "recipes", productId));
  if (!r.exists()) return null;
  const x = r.data() as any;
  return { id: r.id, items: Array.isArray(x.items) ? x.items : [] };
}
async function checkShortageForCart(cartPairs: { productId: string; qty: number }[]) {
  const ingNeeds = new Map<string, number>();
  for (const pair of cartPairs) {
    const recipe = await fetchRecipe(pair.productId);
    if (!recipe) continue;
    for (const it of recipe.items) ingNeeds.set(it.ingredientId, (ingNeeds.get(it.ingredientId) || 0) + (it.qty * pair.qty));
  }
  if (ingNeeds.size === 0) return { ok: true as const };
  const shortages: { name: string; need: number; have: number; unit: string }[] = [];
  for (const ingId of ingNeeds.keys()) {
    const snap = await getDoc(doc(db, "ingredients", ingId));
    if (!snap.exists()) continue;
    const d = snap.data() as any;
    const need = ingNeeds.get(ingId) || 0;
    const have = Number(d.stock || 0);
    const unit = d.unit || "-";
    if (have < need) shortages.push({ name: d.name || ingId, need, have, unit });
  }
  if (shortages.length) return { ok: false as const, shortages };
  return { ok: true as const };
}
async function deductStockForCart(cartPairs: { productId: string; qty: number }[]) {
  for (const pair of cartPairs) {
    const recipe = await fetchRecipe(pair.productId);
    if (!recipe) continue;
    for (const it of recipe.items) {
      const ref = doc(db, "ingredients", it.ingredientId);
      const snap = await getDoc(ref);
      if (!snap.exists()) continue;
      const cur = snap.data() as any;
      const newStock = Math.max(0, Number(cur.stock || 0) - (it.qty * pair.qty));
      await updateDoc(ref, { stock: newStock });
    }
  }
}

/* ==========================
   APP STATE (lanjut di Part 2)
========================== */
export default function App() {
  const isPublicOrder = typeof window !== "undefined" && window.location.pathname === "/order";
  if (isPublicOrder) return <PublicOrder />;

  const [user, setUser] = useState<null | { email: string }>(null);
  const [tab, setTab] = useState<"dashboard"|"pos"|"history"|"products"|"inventory"|"orders">("pos");
  const [email, setEmail] = useState(""); 
  const [password, setPassword] = useState("");
  const [authLoading, setAuthLoading] = useState(false);

  const [products, setProducts] = useState<Product[]>([]);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [recipes, setRecipes] = useState<Record<string, RecipeItem[]>>({});
  const [orders, setOrders] = useState<PublicOrderDoc[]>([]);

  const [cart, setCart] = useState<CartItem[]>([]);
  const [discount, setDiscount] = useState(0);
  const [payMethod, setPayMethod] = useState<"cash"|"ewallet"|"qris">("cash");
  const [cash, setCash] = useState(0);

  const [customerPhone, setCustomerPhone] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPoints, setCustomerPoints] = useState<number|null>(null);
  const [useFreeDrink, setUseFreeDrink] = useState(false);

  // === PART 2 starts ===
// (hapus 2 baris placeholder di Part 1: `/* placeholder sementara */` dan `return <div ... />; }`)

  /* ===== derived ===== */
  const isOwner = !!(user?.email && OWNER_EMAILS.has(user.email));

  /* ===== POS & UI states ===== */
  const [queryText, setQueryText] = useState("");
  const [noteInput, setNoteInput] = useState("");
  const [taxPct, setTaxPct] = useState(0);
  const [svcPct, setSvcPct] = useState(0);
  const [showQR, setShowQR] = useState(false);

  /* ===== shift ===== */
  const [activeShift, setActiveShift] = useState<Shift | null>(null);
  const [openCash, setOpenCash] = useState<number>(0);

  /* ===== history ===== */
  const [historyRows, setHistoryRows] = useState<Sale[]>([]);
  const [histCursor, setHistCursor] = useState<any>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  /* ===== dashboard ===== */
  const [dashLoading, setDashLoading] = useState(false);
  const [todayStats, setTodayStats] = useState({
    omzet: 0, trx: 0, avg: 0, cash: 0, ewallet: 0, qris: 0,
    topItems: [] as { name: string; qty: number }[],
  });
  const [last7, setLast7] = useState<{ date: string; omzet: number; trx: number }[]>([]);

  /* ===== computed totals ===== */
  const filteredProducts = useMemo(
    () =>
      products.filter(
        (p) => (p.active !== false) && p.name.toLowerCase().includes(queryText.toLowerCase())
      ),
    [products, queryText]
  );
  const subtotal = useMemo(
    () => cart.reduce((s, i) => s + i.price * i.qty, 0),
    [cart]
  );
  const taxVal = Math.round(subtotal * (taxPct / 100));
  const svcVal = Math.round(subtotal * (svcPct / 100));
  const totalBeforeLoyalty = Math.max(0, subtotal + taxVal + svcVal - (discount || 0));
  const cheapest = cart.length ? Math.min(...cart.map((c) => c.price)) : 0;
  const loyaltyDiscount = useFreeDrink ? Math.min(cheapest, totalBeforeLoyalty) : 0;
  const total = Math.max(0, totalBeforeLoyalty - loyaltyDiscount);
  const change = Math.max(0, (cash || 0) - total);

  /* ==========================
     AUTH WATCH
  =========================== */
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u?.email ? { email: u.email } : null);
    });
    return () => unsub();
  }, []);

  /* ==========================
     LOAD DATA AFTER LOGIN
  =========================== */
  useEffect(() => {
    if (!user) return;

    // products
    const qProd = query(collection(db, "products"), where("outlet", "==", OUTLET));
    const unsubProd = onSnapshot(qProd, (snap) => {
      const rows: Product[] = snap.docs.map((d) => {
        const x = d.data() as any;
        return {
          id: d.id,
          name: x.name,
          price: x.price,
          imageUrl: x.imageUrl,
          category: x.category,
          active: x.active,
          outlet: x.outlet,
        };
      });
      setProducts(rows);
    });

    // ingredients
    const qIng = query(collection(db, "ingredients"), where("outlet", "==", OUTLET));
    const unsubIng = onSnapshot(qIng, (snap) => {
      const rows: Ingredient[] = snap.docs.map((d) => {
        const x = d.data() as any;
        return {
          id: d.id,
          name: x.name,
          unit: x.unit,
          stock: x.stock ?? 0,
          min: x.min ?? 0,
          outlet: x.outlet,
        };
      });
      setIngredients(rows);
    });

    // recipes (preload agar finalize cepat)
    const unsubRecipes = onSnapshot(collection(db, "recipes"), (snap) => {
      const map: Record<string, RecipeItem[]> = {};
      snap.docs.forEach((d) => {
        const x = d.data() as any;
        map[d.id] = Array.isArray(x.items) ? x.items : [];
      });
      setRecipes(map);
    });

    // orders (pending & accepted)
    const qOrd = query(
      collection(db, "orders"),
      where("outlet", "==", OUTLET),
      where("status", "in", ["pending", "accepted"]),
      orderBy("time", "desc")
    );
    const unsubOrd = onSnapshot(qOrd, (snap) => {
      const rows: PublicOrderDoc[] = snap.docs.map((d) => {
        const x = d.data() as any;
        return {
          id: d.id,
          outlet: x.outlet,
          source: "public",
          customerName: x.customerName,
          customerPhone: x.customerPhone,
          address: x.address,
          distance: x.distance || 0,
          method: x.method,
          time: x.time ?? null,
          items: x.items || [],
          subtotal: x.subtotal || 0,
          shipping: x.shipping || 0,
          total: x.total || 0,
          status: x.status,
          saleId: x.saleId,
        };
      });
      setOrders(rows);
    });

    // shift & dashboard awal
    checkActiveShift().catch(() => {});
    loadDashboard().catch(() => {});

    return () => {
      unsubProd();
      unsubIng();
      unsubRecipes();
      unsubOrd();
    };
    // eslint-disable-next-line
  }, [user?.email]);

  /* ==========================
     AUTH handlers
  =========================== */
  async function doLogin(e?: React.FormEvent) {
    e?.preventDefault();
    try {
      setAuthLoading(true);
      await signInWithEmailAndPassword(auth, email.trim(), password);
      setEmail("");
      setPassword("");
      setTab("pos");
    } catch (err: any) {
      alert("Login gagal: " + (err?.message || err));
    } finally {
      setAuthLoading(false);
    }
  }
  async function doLogout() {
    await signOut(auth);
  }

  /* ==========================
     SHIFT
  =========================== */
  async function checkActiveShift() {
    const qShift = query(
      collection(db, "shifts"),
      where("outlet", "==", OUTLET),
      where("isOpen", "==", true),
      orderBy("openAt", "desc"),
      limit(1)
    );
    const snap = await getDocs(qShift);
    if (snap.empty) {
      setActiveShift(null);
      return;
    }
    const d = snap.docs[0];
    const x = d.data() as any;
    setActiveShift({
      id: d.id,
      outlet: x.outlet,
      openBy: x.openBy,
      openAt: x.openAt,
      closeAt: x.closeAt ?? null,
      openCash: x.openCash ?? 0,
      isOpen: true,
    });
  }
  async function openShiftAction() {
    if (!user?.email) return alert("Belum login.");
    const id = `SHIFT-${Date.now()}`;
    await setDoc(doc(db, "shifts", id), {
      outlet: OUTLET,
      openBy: user.email,
      openAt: serverTimestamp(),
      closeAt: null,
      isOpen: true,
      openCash,
    });
    setOpenCash(0);
    await checkActiveShift();
  }
  async function closeShiftAction() {
    if (!activeShift?.id) return;
    await updateDoc(doc(db, "shifts", activeShift.id), {
      isOpen: false,
      closeAt: serverTimestamp(),
    });
    setActiveShift(null);
    alert("Shift ditutup.");
    loadDashboard().catch(() => {});
  }

  /* ==========================
     LOYALTY
  =========================== */
  async function fetchCustomerPoints(phone: string) {
    if (!phone.trim()) {
      setCustomerPoints(null);
      return;
    }
    const ref = doc(db, "customers", phone);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      setCustomerPoints(0);
      return;
    }
    const d = snap.data() as any;
    setCustomerPoints(d.points ?? 0);
    setCustomerName(d.name ?? "");
  }
  useEffect(() => {
    if (customerPhone) fetchCustomerPoints(customerPhone);
  }, [customerPhone]);

  async function updateCustomerPoints(phone: string, name: string, add: number) {
    if (!phone.trim()) return;
    const ref = doc(db, "customers", phone);
    const snap = await getDoc(ref);
    const prev = snap.exists() ? (snap.data() as any).points || 0 : 0;
    await setDoc(
      ref,
      { name, phone, points: Math.max(0, prev + add), lastVisit: serverTimestamp() },
      { merge: true }
    );
  }

  /* ==========================
     FINALIZE TRANSACTION (POS)
  =========================== */
  async function finalizeSale() {
    if (!activeShift?.id) return alert("Shift belum dibuka.");
    if (cart.length === 0) return alert("Keranjang kosong.");
    if (payMethod === "cash" && cash < total) return alert("Tunai kurang.");

    // cek stok bahan berdasar resep
    const shortage = await checkShortageForCart(
      cart.map((c) => ({ productId: c.productId, qty: c.qty }))
    );
    if (!shortage.ok) {
      return alert(
        "Stok tidak mencukupi:\n" +
          shortage.shortages
            .map((s) => `${s.name}: butuh ${s.need}${s.unit}, sisa ${s.have}`)
            .join("\n")
      );
    }
    await deductStockForCart(cart.map((c) => ({ productId: c.productId, qty: c.qty })));

    const pointsEarned = Math.floor(total / POINT_PER_RP);
    const usedFreeDrink = useFreeDrink;

    const saleData: Sale = {
      outlet: OUTLET,
      shiftId: activeShift.id,
      cashierEmail: user?.email || "",
      customerPhone: customerPhone || null,
      customerName: customerName || null,
      time: serverTimestamp() as any,
      items: cart.map((c) => ({
        name: c.name,
        price: c.price,
        qty: c.qty,
        ...(c.note ? { note: c.note } : {}),
      })),
      subtotal,
      discount,
      tax: taxVal,
      service: svcVal,
      total,
      payMethod,
      cash,
      change,
      pointsEarned,
      usedFreeDrink,
    };

    // cetak dulu (pakai state sekarang)
    printReceipt();

    // simpan ke Firestore
    await addDoc(collection(db, "sales"), saleData);

    // loyalty adjust
    if (customerPhone) {
      const adj = usedFreeDrink ? -FREE_DRINK_POINTS + pointsEarned : pointsEarned;
      await updateCustomerPoints(customerPhone, customerName || "Member", adj);
    }

    alert("Transaksi berhasil ✅");

    // reset POS
    setCart([]);
    setDiscount(0);
    setTaxPct(0);
    setSvcPct(0);
    setCash(0);
    setCustomerPhone("");
    setCustomerName("");
    setCustomerPoints(null);
    setUseFreeDrink(false);

    // refresh
    loadHistory(false).catch(() => {});
    loadDashboard().catch(() => {});
  }

  /* ==========================
     CETAK 80mm
  =========================== */
  function printReceipt() {
    const win = window.open("", "_blank", "width=400,height=600");
    if (!win) return;

    const totalBefore = Math.max(0, subtotal + taxVal + svcVal - (discount || 0));
    const freeCut = useFreeDrink ? (cart.length ? Math.min(...cart.map((c) => c.price)) : 0) : 0;
    const totalNow = Math.max(0, totalBefore - freeCut);
    const changeNow = Math.max(0, (cash || 0) - totalNow);

    win.document.write(`
      <html><head><title>Struk</title>
      <style>
        body{font-family:ui-monospace,Consolas,monospace;font-size:12px}
        .wrap{width:300px;margin:0 auto}
        h2{margin:6px 0;text-align:center}
        td{padding:4px 0;border-bottom:1px dashed #ccc;font-size:12px}
        .tot td{border-bottom:none;font-weight:700}
        .meta{font-size:12px;text-align:center;opacity:.8}
        img.logo{display:block;margin:0 auto 6px;height:42px}
      </style></head><body>
      <div class="wrap">
        <img class="logo" src="${BRAND_LOGO}" onerror="this.style.display='none'"/>
        <h2>NamiPOS — ${OUTLET}</h2>
        <div class="meta">${new Date().toLocaleString("id-ID",{hour12:false})}</div>
        <hr/>
        <table style="width:100%;border-collapse:collapse">
          ${cart.map(i=>`<tr><td>${i.name}${i.note?`<div style='font-size:10px;opacity:.7'>${i.note}</div>`:""}</td><td style='text-align:center'>${i.qty}x</td><td style='text-align:right'>${IDR(i.price*i.qty)}</td></tr>`).join("")}
          <tr class="tot"><td>Subtotal</td><td></td><td style="text-align:right">${IDR(subtotal)}</td></tr>
          ${taxVal?`<tr class="tot"><td>Pajak</td><td></td><td style="text-align:right">${IDR(taxVal)}</td></tr>`:""}
          ${svcVal?`<tr class="tot"><td>Service</td><td></td><td style="text-align:right">${IDR(svcVal)}</td></tr>`:""}
          ${discount?`<tr class="tot"><td>Diskon</td><td></td><td style="text-align:right">-${IDR(discount)}</td></tr>`:""}
          ${useFreeDrink?`<tr class="tot"><td>Tukar Poin</td><td></td><td style="text-align:right">-${IDR(freeCut)}</td></tr>`:""}
          <tr class="tot"><td>Total</td><td></td><td style="text-align:right">${IDR(totalNow)}</td></tr>
          ${payMethod==="cash"
            ? `<tr><td>Tunai</td><td></td><td style='text-align:right'>${IDR(cash||0)}</td></tr>
               <tr><td>Kembali</td><td></td><td style='text-align:right'>${IDR(changeNow||0)}</td></tr>`
            : `<tr><td>Metode</td><td></td><td style='text-align:right'>${payMethod.toUpperCase()}</td></tr>`
          }
        </table>
        ${payMethod!=="cash" ? `<div class="meta" style="margin-top:6px"><img src="${QRIS_IMG_SRC}" style="height:120px"/></div>` : ""}
        <p class="meta">Terima kasih! • Modern Ritual, Hembusan Ketenangan 🍵</p>
      </div>
      <script>window.print();</script>
      </body></html>
    `);
    win.document.close();
  }

  /* ==========================
     HISTORY
  =========================== */
  async function loadHistory(next:boolean){
    setHistoryLoading(true);
    try{
      const base = query(
        collection(db,"sales"),
        where("outlet","==",OUTLET),
        orderBy("time","desc"),
        limit(20)
      );
      const qHist = next && histCursor ? query(base, startAfter(histCursor)) : base;
      const snap = await getDocs(qHist);
      const rows: Sale[] = snap.docs.map(d=>{
        const x = d.data() as any;
        return {
          id:d.id, outlet:x.outlet, shiftId:x.shiftId??null, cashierEmail:x.cashierEmail,
          customerPhone:x.customerPhone??null, customerName:x.customerName??null,
          time:x.time??null, items:x.items||[],
          subtotal:x.subtotal??0, discount:x.discount??0, tax:x.tax??0, service:x.service??0,
          total:x.total??0, payMethod:x.payMethod??"cash", cash:x.cash??0, change:x.change??0
        };
      });
      setHistoryRows(prev=> next? [...prev, ...rows] : rows);
      setHistCursor(snap.docs.length? snap.docs[snap.docs.length-1] : null);
    }catch(e:any){
      alert("Gagal memuat riwayat: "+(e?.message||e));
    }finally{
      setHistoryLoading(false);
    }
  }
  async function deleteSale(id: string) {
    if (!isOwner) return alert("Hanya owner yang dapat menghapus transaksi.");
    if (!window.confirm("Hapus transaksi ini?")) return;
    await deleteDoc(doc(db, "sales", id));
    setHistoryRows(prev => prev.filter(x => x.id !== id));
  }

  /* ==========================
     DASHBOARD
  =========================== */
  const startOfDay = (d = new Date()) => { const x = new Date(d); x.setHours(0,0,0,0); return x; };
  const endOfDay   = (d = new Date()) => { const x = new Date(d); x.setHours(23,59,59,999); return x; };
  const daysAgo    = (n: number) => { const x = new Date(); x.setDate(x.getDate()-n); return x; };

  async function loadDashboard(){
    setDashLoading(true);
    try{
      // hari ini
      const qToday = query(
        collection(db,"sales"),
        where("outlet","==",OUTLET),
        where("time", ">=", Timestamp.fromDate(startOfDay())),
        where("time", "<=", Timestamp.fromDate(endOfDay()))
      );
      const sToday = await getDocs(qToday);
      let omzet=0, trx=0, cashSum=0, ew=0, qr=0;
      const counter: Record<string, number> = {};
      sToday.forEach(d=>{
        const x = d.data() as any;
        omzet += x.total||0; trx += 1;
        if(x.payMethod==="cash")   cashSum += x.total||0;
        if(x.payMethod==="ewallet") ew += x.total||0;
        if(x.payMethod==="qris")    qr += x.total||0;
        (x.items||[]).forEach((it:any)=>{
          counter[it.name] = (counter[it.name]||0) + (it.qty||0);
        });
      });
      const avg = trx? Math.round(omzet/trx) : 0;
      const topItems = Object.entries(counter)
        .map(([name,qty])=>({name,qty}))
        .sort((a,b)=>b.qty-a.qty)
        .slice(0,5);
      setTodayStats({ omzet, trx, avg, cash:cashSum, ewallet:ew, qris:qr, topItems });

      // 7 hari
      const arr: {date:string; omzet:number; trx:number}[] = [];
      for(let i=6;i>=0;i--){
        const start = Timestamp.fromDate(startOfDay(daysAgo(i)));
        const end = Timestamp.fromDate(endOfDay(daysAgo(i)));
        const qs = query(
          collection(db,"sales"),
          where("outlet","==",OUTLET),
          where("time",">=",start),
          where("time","<=",end)
        );
        const sn = await getDocs(qs);
        let o=0,t=0;
        sn.forEach(d=>{ const x=d.data() as any; o+=x.total||0; t++; });
        arr.push({date: daysAgo(i).toLocaleDateString("id-ID",{weekday:"short"}), omzet:o, trx:t});
      }
      setLast7(arr);
    }catch(e){ console.error(e); }
    setDashLoading(false);
  }

// === PART 2 ends ===
// (lanjutkan PART 3/4 untuk UI/return JSX & modals)
// === PART 3 starts ===
// State UI khusus modal & resep (tidak ada di Part 2)
const [showProdModal, setShowProdModal] = useState(false);
const [prodForm, setProdForm] = useState<Partial<Product & { id?: string }>>({});

const [showIngModal, setShowIngModal] = useState(false);
const [ingForm, setIngForm] = useState<Partial<Ingredient & { id?: string }>>({});

const [showRecipeModal, setShowRecipeModal] = useState(false);
const [recipeProduct, setRecipeProduct] = useState<Product | null>(null);
const [recipeRows, setRecipeRows] = useState<RecipeItem[]>([]);

/* ==========================
   ORDERS ADMIN handlers
========================== */
async function acceptOrder(o: PublicOrderDoc) {
  await updateDoc(doc(db, "orders", o.id), { status: "accepted" });
}
async function rejectOrder(o: PublicOrderDoc) {
  if (!confirm("Tolak pesanan ini?")) return;
  await updateDoc(doc(db, "orders", o.id), { status: "rejected" });
}
async function finishOrder(o: PublicOrderDoc) {
  // Opsional: kurangi stok jika item memiliki productId & ada resep
  const pairs = (o.items || [])
    .map((it) => (it.productId ? { productId: it.productId, qty: Number(it.qty || 0) } : null))
    .filter(Boolean) as { productId: string; qty: number }[];
  if (pairs.length) {
    const shortage = await checkShortageForCart(pairs);
    if (!shortage.ok) {
      alert(
        "Stok tidak mencukupi untuk menyelesaikan order:\n" +
          shortage.shortages.map((s) => `${s.name}: butuh ${s.need}${s.unit}, sisa ${s.have}`).join("\n")
      );
      return;
    }
    await deductStockForCart(pairs);
  }

  // Simpan sebagai sales (tanpa shift / kasir)
  const saleData: Sale = {
    outlet: o.outlet,
    shiftId: activeShift?.id ?? null,
    cashierEmail: user?.email || "online",
    customerPhone: o.customerPhone || null,
    customerName: o.customerName || null,
    time: serverTimestamp() as any,
    items: o.items?.map((i) => ({ name: i.name, price: i.price, qty: i.qty })) || [],
    subtotal: o.subtotal,
    discount: 0,
    tax: 0,
    service: 0,
    total: o.total,
    payMethod: o.method === "qris" ? "qris" : "cash",
    cash: o.method === "cod" ? o.total : 0,
    change: 0,
  };
  const ref = await addDoc(collection(db, "sales"), saleData);
  await updateDoc(doc(db, "orders", o.id), { status: "done", saleId: ref.id });
  alert("Order diselesaikan ✅");
}

/* ==========================
   LOGIN SCREEN (jika belum login)
========================== */
if (!user) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 to-white flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-6 border">
        <div className="flex items-center gap-3 mb-4">
          <img src={BRAND_LOGO} alt="Logo" className="h-10 w-10 rounded-2xl object-cover"/>
          <div>
            <h1 className="text-2xl font-bold">NamiPOS</h1>
            <p className="text-xs text-neutral-500">@{OUTLET}</p>
          </div>
        </div>
        <form onSubmit={doLogin} className="space-y-3">
          <input className="w-full border rounded-lg p-3" placeholder="Email" value={email} onChange={e=>setEmail(e.target.value)} />
          <input className="w-full border rounded-lg p-3" type="password" placeholder="Password" value={password} onChange={e=>setPassword(e.target.value)} />
          <button disabled={authLoading} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg p-3">
            {authLoading?"Masuk...":"Masuk"}
          </button>
        </form>
        <p className="text-xs text-neutral-500 mt-3 text-center">Modern Ritual, Hembusan Ketenangan 🍵</p>
      </div>
    </div>
  );
}

/* ==========================
   MAIN UI (dashboard/pos/history/products/inventory/orders)
========================== */
return (
  <div className="min-h-screen bg-neutral-50">
    {/* Topbar */}
    <header className="sticky top-0 z-30 bg-white/80 backdrop-blur border-b">
      <div className="max-w-7xl mx-auto px-3 sm:px-4 md:px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <img src={BRAND_LOGO} alt="Logo" className="h-8 w-8 rounded-xl object-cover"/>
          <div>
            <div className="font-bold">NamiPOS — {OUTLET}</div>
            <div className="text-[11px] text-neutral-500">Masuk: {user.email}{isOwner?" · owner":" · staff"}</div>
          </div>
        </div>
        <nav className="flex flex-wrap gap-2">
          {isOwner && (
            <button
              onClick={()=>{ setTab("dashboard"); loadDashboard(); }}
              className={`px-3 py-1.5 rounded-lg border ${tab==="dashboard"?"bg-emerald-50 border-emerald-200":"bg-white"}`}>
              Dashboard
            </button>
          )}
          <button
            onClick={()=>setTab("pos")}
            className={`px-3 py-1.5 rounded-lg border ${tab==="pos"?"bg-emerald-50 border-emerald-200":"bg-white"}`}>
            Kasir
          </button>
          <button
            onClick={()=>{ setTab("history"); loadHistory(false); }}
            className={`px-3 py-1.5 rounded-lg border ${tab==="history"?"bg-emerald-50 border-emerald-200":"bg-white"}`}>
            Riwayat
          </button>
          {isOwner && (
            <button
              onClick={()=>setTab("products")}
              className={`px-3 py-1.5 rounded-lg border ${tab==="products"?"bg-emerald-50 border-emerald-200":"bg-white"}`}>
              Produk
            </button>
          )}
          {isOwner && (
            <button
              onClick={()=>setTab("inventory")}
              className={`px-3 py-1.5 rounded-lg border ${tab==="inventory"?"bg-emerald-50 border-emerald-200":"bg-white"}`}>
              Inventori
            </button>
          )}
          {isOwner && (
            <button
              onClick={()=>setTab("orders")}
              className={`px-3 py-1.5 rounded-lg border ${tab==="orders"?"bg-emerald-50 border-emerald-200":"bg-white"}`}>
              Orders
            </button>
          )}
          <button onClick={doLogout} className="px-3 py-1.5 rounded-lg border bg-rose-50">Keluar</button>
        </nav>
      </div>
    </header>

    <main className="max-w-7xl mx-auto px-3 sm:px-4 md:px-6 py-4">
      {/* Shift badge */}
      <div className="mb-3">
        <div className="inline-flex items-center gap-2 text-xs px-3 py-1 rounded-full border bg-white">
          {activeShift?.isOpen
            ? <>Shift <b>OPEN</b> • {new Date(activeShift.openAt?.toDate?.() || new Date()).toLocaleTimeString("id-ID",{hour12:false})} • {activeShift.openBy}</>
            : <>Belum ada shift aktif</>}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {!activeShift?.isOpen ? (
            <>
              <input
                type="number"
                className="border rounded-lg px-3 py-2 w-40"
                placeholder="Kas awal (Rp)"
                value={openCash}
                onChange={e=>setOpenCash(Number(e.target.value)||0)}
              />
              <button className="px-3 py-2 rounded-lg bg-emerald-600 text-white" onClick={openShiftAction}>
                Buka Shift
              </button>
            </>
          ) : (
            <button className="px-3 py-2 rounded-lg bg-rose-600 text-white" onClick={closeShiftAction}>
              Tutup Shift
            </button>
          )}
        </div>
      </div>

      {/* DASHBOARD */}
      {tab==="dashboard" && isOwner && (
        <section className="space-y-4">
          {/* KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <KPI title="Omzet Hari Ini" value={IDR(todayStats.omzet)} />
            <KPI title="Transaksi" value={String(todayStats.trx)} />
            <KPI title="Avg Ticket" value={IDR(todayStats.avg)} />
            <KPI title="Cash" value={IDR(todayStats.cash)} />
            <KPI title="eWallet/QRIS" value={IDR(todayStats.ewallet + todayStats.qris)} />
          </div>

          {/* Top items + 7-day trend */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-white border rounded-2xl p-4">
              <div className="font-semibold mb-2">5 Menu Terlaris (Hari Ini)</div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left"><th className="py-2">Menu</th><th className="text-right">Qty</th></tr>
                </thead>
                <tbody>
                  {todayStats.topItems.length===0 && (
                    <tr><td className="py-2 text-neutral-500" colSpan={2}>Belum ada data.</td></tr>
                  )}
                  {todayStats.topItems.map((t,i)=>(
                    <tr key={i} className="border-b">
                      <td className="py-2">{t.name}</td>
                      <td className="text-right">{t.qty}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="bg-white border rounded-2xl p-4">
              <div className="font-semibold mb-2">7 Hari Terakhir</div>
              <div className="space-y-1">
                {dashLoading && <div className="text-sm text-neutral-500">Memuat…</div>}
                {!dashLoading && last7.map((d)=>(
                  <div key={d.date} className="flex items-center gap-3">
                    <div className="w-24 text-xs text-neutral-600">{d.date}</div>
                    <div className="flex-1 h-2 rounded bg-neutral-100 overflow-hidden">
                      <div
                        className="h-2 rounded bg-emerald-500"
                        style={{width: `${Math.min(100, (d.omzet / Math.max(1, Math.max(...last7.map(x=>x.omzet))))) * 100}%`}} />
                    </div>
                    <div className="w-28 text-right text-xs">{IDR(d.omzet)}</div>
                    <div className="w-10 text-right text-xs">{d.trx}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* POS */}
      {tab==="pos" && (
        <section className="grid grid-cols-1 md:grid-cols-12 gap-4">
          {/* Products */}
          <div className="md:col-span-7">
            <div className="bg-white rounded-2xl border p-3 mb-2">
              <input
                className="border rounded-lg px-3 py-2 w-full"
                placeholder="Cari menu…"
                value={queryText}
                onChange={e=>setQueryText(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {filteredProducts.map(p=>(
                <button
                  key={p.id}
                  onClick={()=>setCart(prev=>{
                    const same = prev.find(ci=> ci.productId===p.id && (ci.note||"")===(noteInput||""));
                    if(same) return prev.map(ci=> ci===same? {...ci, qty:ci.qty+1 } : ci);
                    return [...prev, { id: uid(), productId:p.id, name:p.name, price:p.price, qty:1, note: noteInput||undefined }];
                  })}
                  className="bg-white rounded-2xl border p-3 text-left hover:shadow">
                  <div className="h-20 rounded-xl bg-gradient-to-br from-emerald-50 to-emerald-100 mb-2 overflow-hidden">
                    {p.imageUrl ? <img src={p.imageUrl} alt={p.name} className="w-full h-20 object-cover"/> : null}
                  </div>
                  <div className="font-medium leading-tight">{p.name}</div>
                  <div className="text-xs text-neutral-500">{p.category||"Signature"}</div>
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
                <input className="border rounded-lg px-3 py-2" placeholder="No HP pelanggan" value={customerPhone} onChange={e=>setCustomerPhone(e.target.value)} />
                <input className="border rounded-lg px-3 py-2" placeholder="Nama pelanggan (baru)" value={customerName} onChange={e=>setCustomerName(e.target.value)} />
              </div>
              {!!customerPhone && (
                <div className="text-xs text-neutral-600 mb-2">
                  {customerPoints===null ? "Mencari pelanggan…" :
                    customerPoints===0 && !customerName ? "Belum terdaftar — isi nama untuk dibuat otomatis saat transaksi." :
                    <>Poin: <b>{customerPoints}</b> {customerName?`— ${customerName}`:""}</>}
                </div>
              )}
              <div className="mb-2">
                <label className="inline-flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={useFreeDrink}
                    onChange={e=>setUseFreeDrink(e.target.checked)}
                    disabled={!customerPoints || customerPoints<FREE_DRINK_POINTS}/>
                  Tukar {FREE_DRINK_POINTS} poin untuk 1 minuman gratis
                </label>
              </div>

              <div className="flex items-center gap-2 mb-2">
                <input className="border rounded-lg px-3 py-2 flex-1" placeholder="Catatan item (less sugar / no ice)" value={noteInput} onChange={e=>setNoteInput(e.target.value)} />
                <button className="px-3 py-2 rounded-lg border" onClick={()=>setNoteInput("")}>Clear</button>
              </div>

              {cart.length===0 ? (
                <div className="text-sm text-neutral-500">Belum ada item. Klik menu untuk menambahkan.</div>
              ) : (
                <div className="space-y-2">
                  {cart.map(ci=>(
                    <div key={ci.id} className="grid grid-cols-12 items-center gap-2 border rounded-xl p-2">
                      <div className="col-span-6">
                        <div className="font-medium leading-tight">{ci.name}</div>
                        {ci.note && <div className="text-xs text-neutral-500">{ci.note}</div>}
                      </div>
                      <div className="col-span-2 text-right text-sm">{IDR(ci.price)}</div>
                      <div className="col-span-3 flex items-center justify-end gap-2">
                        <button className="px-2 py-1 border rounded" onClick={()=>setCart(prev=>prev.map(x=>x.id===ci.id?{...x, qty:Math.max(1,x.qty-1)}:x))}>-</button>
                        <div className="w-8 text-center font-medium">{ci.qty}</div>
                        <button className="px-2 py-1 border rounded" onClick={()=>setCart(prev=>prev.map(x=>x.id===ci.id?{...x, qty:x.qty+1}:x))}>+</button>
                      </div>
                      <div className="col-span-1 text-right">
                        <button className="px-2 py-1 rounded border" onClick={()=>setCart(prev=>prev.filter(x=>x.id!==ci.id))}>x</button>
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
                    <input type="number" className="border rounded-lg px-2 py-1 w-24" value={taxPct} onChange={e=>setTaxPct(Number(e.target.value)||0)} />
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <span className="w-20">Service %</span>
                    <input type="number" className="border rounded-lg px-2 py-1 w-24" value={svcPct} onChange={e=>setSvcPct(Number(e.target.value)||0)} />
                  </label>
                </div>
                <label className="flex items-center justify-between text-sm">
                  <span>Diskon (Rp)</span>
                  <input type="number" className="border rounded-lg px-2 py-1 w-28" value={discount} onChange={e=>setDiscount(Number(e.target.value)||0)} />
                </label>
                {useFreeDrink && <div className="text-xs text-emerald-600">Tukar poin: -{IDR(loyaltyDiscount)}</div>}
                <div className="flex items-center justify-between text-lg font-semibold">
                  <span>Total</span><span>{IDR(total)}</span>
                </div>
              </div>

              {/* payment */}
              <div className="grid grid-cols-1 gap-2 mb-2">
                <select className="border rounded-lg px-3 py-2" value={payMethod} onChange={e=>setPayMethod(e.target.value as any)}>
                  <option value="cash">Cash</option>
                  <option value="ewallet">eWallet</option>
                  <option value="qris">QRIS</option>
                </select>
                {payMethod==="cash" && (
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      className="border rounded-lg px-3 py-2 w-40"
                      placeholder="Tunai diterima"
                      value={cash}
                      onChange={e=>setCash(Number(e.target.value)||0)}
                    />
                    <div className="text-sm">Kembali: <b>{IDR(Math.max(0,(cash||0)-total))}</b></div>
                  </div>
                )}
                {payMethod==="qris" && (
                  <div className="border rounded-xl p-2 bg-emerald-50">
                    <div className="text-sm mb-1">Scan untuk bayar:</div>
                    <img src={QRIS_IMG_SRC} alt="QRIS" className="w-40" onClick={()=>setShowQR(true)} />
                    <div className="text-xs text-neutral-500 mt-1">* Setelah sukses, tekan “Selesai & Cetak”.</div>
                  </div>
                )}
              </div>

              {/* actions */}
              <div className="flex justify-between gap-2">
                <button
                  className="px-3 py-2 rounded-lg border"
                  onClick={()=>{
                    setCart([]); setDiscount(0); setTaxPct(0); setSvcPct(0); setCash(0);
                    setCustomerPhone(""); setCustomerName(""); setCustomerPoints(null); setUseFreeDrink(false);
                  }}>
                  Bersihkan
                </button>
                <div className="flex gap-2">
                  <button className="px-3 py-2 rounded-lg border" disabled={cart.length===0} onClick={printReceipt}>Print Draf</button>
                  <button
                    className="px-3 py-2 rounded-lg bg-emerald-600 text-white disabled:opacity-50"
                    disabled={cart.length===0}
                    onClick={finalizeSale}>
                    Selesai & Cetak
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* HISTORY */}
      {tab==="history" && (
        <section className="bg-white rounded-2xl border p-3">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-lg font-semibold">Riwayat Transaksi</h2>
            <div className="flex gap-2">
              <button className="px-3 py-2 rounded-lg border" onClick={()=>loadHistory(false)} disabled={historyLoading}>Muat Ulang</button>
              <button className="px-3 py-2 rounded-lg border" onClick={()=>loadHistory(true)} disabled={historyLoading || !histCursor}>Muat Lagi</button>
            </div>
          </div>
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b">
                  <th className="py-2">Waktu</th>
                  <th>Kasir</th>
                  <th>Pelanggan</th>
                  <th>Item</th>
                  <th className="text-right">Total</th>
                  <th>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {historyRows.map(s=>(
                  <tr key={s.id} className="border-b hover:bg-emerald-50/40">
                    <td className="py-2">{s.time? new Date(s.time.toDate()).toLocaleString("id-ID",{hour12:false}) : "-"}</td>
                    <td>{s.cashierEmail}</td>
                    <td>{s.customerPhone || "-"}</td>
                    <td className="truncate">{s.items.map(i=>`${i.name}x${i.qty}`).join(", ")}</td>
                    <td className="text-right font-medium">{IDR(s.total)}</td>
                    <td className="text-right">
                      {isOwner && <button className="px-2 py-1 border rounded" onClick={()=> s.id && deleteSale(s.id!)}>Hapus</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {historyRows.length===0 && <div className="text-sm text-neutral-500">Belum ada transaksi.</div>}
          </div>
        </section>
      )}

      {/* PRODUCTS */}
      {tab==="products" && isOwner && (
        <section className="bg-white rounded-2xl border p-3">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-lg font-semibold">Manajemen Produk</h2>
            <button className="px-3 py-2 rounded-lg border" onClick={()=>{ setShowProdModal(true); setProdForm({ id: undefined, name:"", price:0, imageUrl:"", category:"Signature", active:true }); }}>
              + Tambah
            </button>
          </div>
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b"><th>Nama</th><th>Kategori</th><th className="text-right">Harga</th><th className="text-right">Aksi</th></tr>
              </thead>
              <tbody>
                {products.map(p=>(
                  <tr key={p.id} className="border-b">
                    <td className="py-2">{p.name}</td>
                    <td>{p.category||"-"}</td>
                    <td className="text-right">{IDR(p.price)}</td>
                    <td className="text-right space-x-2">
                      <button className="px-2 py-1 border rounded" onClick={()=>{ setProdForm({...p}); setShowProdModal(true); }}>Edit</button>
                      <button className="px-2 py-1 border rounded" onClick={()=>{ setRecipeProduct(p); setRecipeRows(recipes[p.id]||[]); setShowRecipeModal(true); }}>Resep</button>
                      <button className="px-2 py-1 border rounded" onClick={async ()=>{
                        await updateDoc(doc(db,"products", p.id), { active: !(p.active!==false) });
                      }}>{p.active!==false?"Nonaktif":"Aktifkan"}</button>
                      <button className="px-2 py-1 border rounded text-rose-600" onClick={async ()=>{
                        if(!confirm("Hapus produk ini permanen?")) return;
                        await deleteDoc(doc(db,"products", p.id));
                      }}>Hapus</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {products.length===0 && <div className="text-sm text-neutral-500">Belum ada produk.</div>}
          </div>
        </section>
      )}

      {/* INVENTORY */}
      {tab==="inventory" && isOwner && (
        <section className="bg-white rounded-2xl border p-3">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-lg font-semibold">Inventori</h2>
            <div className="flex gap-2">
              <button className="px-3 py-2 rounded-lg border" onClick={()=>{
                setIngForm({ id: undefined, name:"", unit:"pcs", stock:0, min:0 });
                setShowIngModal(true);
              }}>+ Tambah</button>
            </div>
          </div>
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b"><th>Nama</th><th>Satuan</th><th className="text-right">Stok</th><th className="text-right">Minimal</th><th className="text-right">Aksi</th></tr>
              </thead>
              <tbody>
                {ingredients.map(i=>(
                  <tr key={i.id} className={`border-b ${i.min && i.stock<=i.min ? "bg-amber-50" : ""}`}>
                    <td className="py-2">{i.name}</td>
                    <td>{i.unit}</td>
                    <td className="text-right">{i.stock}</td>
                    <td className="text-right">{i.min||0}</td>
                    <td className="text-right">
                      <button className="px-2 py-1 border rounded mr-2" onClick={()=>{
                        setIngForm({...i});
                        setShowIngModal(true);
                      }}>Edit</button>
                      <button className="px-2 py-1 border rounded text-rose-600" onClick={async ()=>{
                        if(!confirm("Hapus bahan ini permanen?")) return;
                        await deleteDoc(doc(db,"ingredients", i.id));
                      }}>Hapus</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {ingredients.length===0 && (
              <div className="text-sm text-neutral-500">Belum ada data inventori.</div>
            )}
          </div>
        </section>
      )}

      {/* ORDERS (Public Orders) */}
      {tab==="orders" && isOwner && (
        <section className="bg-white rounded-2xl border p-3">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-lg font-semibold">Orders Online</h2>
            <div className="text-xs text-neutral-500">Menampilkan status: pending & accepted</div>
          </div>
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b">
                  <th className="py-2">Waktu</th>
                  <th>Pelanggan</th>
                  <th>Alamat</th>
                  <th>Metode</th>
                  <th>Item</th>
                  <th className="text-right">Subtotal</th>
                  <th className="text-right">Ongkir</th>
                  <th className="text-right">Total</th>
                  <th>Status</th>
                  <th className="text-right">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {orders.map(o=>(
                  <tr key={o.id} className="border-b align-top">
                    <td className="py-2">{o.time? new Date(o.time.toDate()).toLocaleString("id-ID",{hour12:false}) : "-"}</td>
                    <td>
                      <div className="font-medium">{o.customerName}</div>
                      <div className="text-xs text-neutral-500">{o.customerPhone}</div>
                    </td>
                    <td className="max-w-[220px]">
                      <div className="truncate">{o.address}</div>
                      {o.distance ? <div className="text-xs text-neutral-500">{o.distance} km</div> : null}
                    </td>
                    <td className="uppercase">{o.method}</td>
                    <td className="max-w-[260px]">
                      <div className="truncate">{o.items.map(i=>`${i.name}x${i.qty}`).join(", ")}</div>
                    </td>
                    <td className="text-right">{IDR(o.subtotal)}</td>
                    <td className="text-right">{IDR(o.shipping)}</td>
                    <td className="text-right font-semibold">{IDR(o.total)}</td>
                    <td className="capitalize">{o.status}</td>
                    <td className="text-right space-x-2">
                      {o.status==="pending" && (
                        <>
                          <button className="px-2 py-1 border rounded" onClick={()=>acceptOrder(o)}>Terima</button>
                          <button className="px-2 py-1 border rounded text-rose-600" onClick={()=>rejectOrder(o)}>Tolak</button>
                        </>
                      )}
                      {o.status==="accepted" && (
                        <button className="px-2 py-1 border rounded bg-emerald-50" onClick={()=>finishOrder(o)}>Selesai</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {orders.length===0 && <div className="text-sm text-neutral-500">Belum ada order.</div>}
          </div>
        </section>
      )}
    </main>

    {/* Modal QR */}
    {showQR && (
      <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={()=>setShowQR(false)}>
        <div className="bg-white rounded-2xl p-4" onClick={e=>e.stopPropagation()}>
          <img src={QRIS_IMG_SRC} alt="QRIS" className="w-72" />
          <div className="text-center mt-2 text-sm">Scan untuk bayar • {IDR(total)}</div>
        </div>
      </div>
    )}

    {/* Modal QR */}
{showQR && (
  <div
    className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
    onClick={() => setShowQR(false)}
  >
    <div className="bg-white rounded-2xl p-4" onClick={(e) => e.stopPropagation()}>
      <img src={QRIS_IMG_SRC} alt="QRIS" className="w-72" />
      <div className="text-center mt-2 text-sm">Scan untuk bayar • {IDR(total)}</div>
    </div>
  </div>
)}

{/* Product Modal */}
{showProdModal && (
  <div
    className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
    onClick={() => setShowProdModal(false)}
  >
    <div className="bg-white rounded-2xl p-4 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
      <h3 className="font-semibold mb-2">{prodForm.id ? "Edit Produk" : "Tambah Produk"}</h3>
      <div className="space-y-2">
        <input
          className="border rounded-lg px-3 py-2 w-full"
          placeholder="Nama"
          value={igFormSafe(prodForm.name)}
          onChange={(e) => setProdForm({ ...prodForm, name: e.target.value })}
        />
        <input
          type="number"
          className="border rounded-lg px-3 py-2 w-full"
          placeholder="Harga"
          value={Number(prodForm.price || 0)}
          onChange={(e) => setProdForm({ ...prodForm, price: Number(e.target.value) || 0 })}
        />
        <input
          className="border rounded-lg px-3 py-2 w-full"
          placeholder="Kategori (opsional)"
          value={igFormSafe(prodForm.category, "Signature")}
          onChange={(e) => setProdForm({ ...prodForm, category: e.target.value })}
        />
        <input
          className="border rounded-lg px-3 py-2 w-full"
          placeholder="URL Gambar (opsional)"
          value={igFormSafe(prodForm.imageUrl)}
          onChange={(e) => setProdForm({ ...prodForm, imageUrl: e.target.value })}
        />
        <label className="inline-flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={prodForm.active !== false}
            onChange={(e) => setProdForm({ ...prodForm, active: e.target.checked })}
          />
          Aktif
        </label>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <button className="px-3 py-2 border rounded" onClick={() => setShowProdModal(false)}>
          Batal
        </button>
        <button
          className="px-3 py-2 bg-emerald-600 text-white rounded"
          onClick={async () => {
            if (!isOwner) return alert("Hanya owner.");
            if (!prodForm.name || (prodForm.price ?? 0) <= 0) return alert("Nama & harga wajib diisi.");
            const id = (prodForm.id as string) || uid();
            await setDoc(
              doc(db, "products", id),
              {
                outlet: OUTLET,
                name: prodForm.name,
                price: Number(prodForm.price || 0),
                imageUrl: prodForm.imageUrl || "",
                category: prodForm.category || "Signature",
                active: prodForm.active !== false,
              },
              { merge: true }
            );
            setShowProdModal(false);
          }}
        >
          Simpan
        </button>
      </div>
    </div>
  </div>
)}

{/* Ingredient Modal */}
{showIngModal && (
  <div
    className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
    onClick={() => setShowIngModal(false)}
  >
    <div className="bg-white rounded-2xl p-4 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
      <h3 className="font-semibold mb-2">{ingForm.id ? "Edit Bahan" : "Tambah Bahan"}</h3>
      <div className="space-y-2">
        <input
          className="border rounded-lg px-3 py-2 w-full"
          placeholder="Nama bahan"
          value={igFormSafe(ingForm.name)}
          onChange={(e) => setIngForm({ ...ingForm, name: e.target.value })}
        />
        <input
          className="border rounded-lg px-3 py-2 w-full"
          placeholder="Satuan (ml, gr, pcs...)"
          value={igFormSafe(ingForm.unit, "pcs")}
          onChange={(e) => setIngForm({ ...ingForm, unit: e.target.value })}
        />
        <input
          type="number"
          className="border rounded-lg px-3 py-2 w-full"
          placeholder="Stok"
          value={Number(ingForm.stock || 0)}
          onChange={(e) => setIngForm({ ...ingForm, stock: Number(e.target.value) || 0 })}
        />
        <input
          type="number"
          className="border rounded-lg px-3 py-2 w-full"
          placeholder="Minimal stok (peringatan)"
          value={Number(ingForm.min || 0)}
          onChange={(e) => setIngForm({ ...ingForm, min: Number(e.target.value) || 0 })}
        />
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <button className="px-3 py-2 border rounded" onClick={() => setShowIngModal(false)}>
          Batal
        </button>
        <button
          className="px-3 py-2 bg-emerald-600 text-white rounded"
          onClick={async () => {
            if (!isOwner) return alert("Hanya owner.");
            if (!ingForm.name) return alert("Nama bahan wajib diisi.");
            const id = (ingForm.id as string) || uid();
            await setDoc(
              doc(db, "ingredients", id),
              {
                outlet: OUTLET,
                name: ingForm.name,
                unit: ingForm.unit || "pcs",
                stock: Number(ingForm.stock || 0),
                min: Number(ingForm.min || 0),
              },
              { merge: true }
            );
            setShowIngModal(false);
          }}
        >
          Simpan
        </button>
      </div>
    </div>
  </div>
)}

{/* Recipe Modal */}
{showRecipeModal && recipeProduct && (
  <div
    className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
    onClick={() => setShowRecipeModal(false)}
  >
    <div className="bg-white rounded-2xl p-4 w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
      <h3 className="font-semibold mb-2">Resep: {recipeProduct.name}</h3>
      <div className="space-y-2">
        {recipeRows.map((r, idx) => (
          <div key={idx} className="grid grid-cols-6 gap-2">
            <select
              className="col-span-4 border rounded-lg px-2 py-2"
              value={r.ingredientId}
              onChange={(e) =>
                setRecipeRows((prev) => prev.map((x, i) => (i === idx ? { ...x, ingredientId: e.target.value } : x)))
              }
            >
              {ingredients.map((ing) => (
                <option key={ing.id} value={ing.id}>
                  {ing.name} ({ing.unit})
                </option>
              ))}
            </select>
            <input
              type="number"
              className="col-span-1 border rounded-lg px-2 py-2"
              value={r.qty}
              onChange={(e) =>
                setRecipeRows((prev) => prev.map((x, i) => (i === idx ? { ...x, qty: Number(e.target.value) || 0 } : x)))
              }
            />
            <button
              className="col-span-1 border rounded"
              onClick={() => setRecipeRows((prev) => prev.filter((_, i) => i !== idx))}
            >
              x
            </button>
          </div>
        ))}
        <button
          className="px-3 py-2 border rounded"
          onClick={() => setRecipeRows((prev) => [...prev, { ingredientId: ingredients[0]?.id || "", qty: 1 }])}
        >
          + Tambah baris
        </button>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <button className="px-3 py-2 border rounded" onClick={() => setShowRecipeModal(false)}>
          Batal
        </button>
        <button
          className="px-3 py-2 bg-emerald-600 text-white rounded"
          onClick={async () => {
            if (!isOwner) return alert("Hanya owner.");
            const clean = recipeRows.filter((r) => r.ingredientId && r.qty > 0);
            await setDoc(doc(db, "recipes", recipeProduct.id), { items: clean }, { merge: true });
            setShowRecipeModal(false);
          }}
        >
          Simpan Resep
        </button>
      </div>
    </div>
  </div>
)}

</div>
); // end return
} // ==== END function App ====



/* ==========================
   HELPERS kecil (ui)
========================== */
function igFormSafe<T extends string | number | undefined>(v: T, fallback: any = "") {
  return v === undefined || v === null ? fallback : v;
}
function KPI({ title, value }: { title: string; value: string }) {
  return (
    <div className="bg-white border rounded-2xl p-4">
      <div className="text-[12px] text-neutral-500">{title}</div>
      <div className="text-xl font-bold mt-1">{value}</div>
    </div>
  );
}


/* ==========================
   PUBLIC ORDER (tanpa login) – /order
========================== */
export function PublicOrder() {
  const outlet = param("outlet", OUTLET);
  const [loading, setLoading] = useState(true);
  const [menu, setMenu] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [custName, setCustName] = useState("");
  const [custPhone, setCustPhone] = useState("");
  const [custAddr, setCustAddr] = useState("");
  const [distanceKm, setDistanceKm] = useState<number>(0);
  const [method, setMethod] = useState<"qris" | "cod">("qris");
  const [sending, setSending] = useState(false);

  const subtotal = useMemo(() => cart.reduce((s, i) => s + i.price * i.qty, 0), [cart]);
  const shipping = useMemo(() => calcShipping(distanceKm), [distanceKm]);
  const total = subtotal + shipping;

  useEffect(() => {
    (async () => {
      const qProd = query(
        collection(db, "products"),
        where("outlet", "==", outlet),
        where("active", "==", true)
      );
      const snap = await getDocs(qProd);
      const rows: Product[] = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
      setMenu(rows);
      setLoading(false);
    })();
  }, [outlet]);

  async function submitOrder(){
  if(cart.length===0) return alert("Pilih menu terlebih dahulu.");
  if(!custName || !custPhone || !custAddr) return alert("Lengkapi identitas & alamat.");

  setSending(true);
  const data = {
    outlet,
    source:"public",
    customerName:custName,
    customerPhone:custPhone,
    address:custAddr,
    distance: distanceKm,
    method,
    time: serverTimestamp(),
    items: cart.map(c=>({productId:c.productId, name:c.name, price:c.price, qty:c.qty})),
    subtotal, shipping, total, status:"pending"
  };

  // simpan order
  const ref = await addDoc(collection(db,"orders"), data);

  // panggil serverless function (token tetap aman di server)
  try {
    await fetch("/api/notify", {
      method: "POST",
      headers: { "Content-Type":"application/json" },
      body: JSON.stringify({
        orderId: ref.id,
        outlet,
        customerName: custName,
        customerPhone: custPhone,
        address: custAddr,
        distance: distanceKm,
        method,
        items: cart.map(c=>({ name:c.name, qty:c.qty, price:c.price })),
        subtotal, shipping, total,
        timeISO: new Date().toLocaleString("id-ID", { hour12:false })
      })
    });
  } catch {}

  setSending(false);
  alert("Pesanan terkirim ✅ Silakan tunggu konfirmasi admin.");
  setCart([]); setCustName(""); setCustPhone(""); setCustAddr(""); setDistanceKm(0);
}
