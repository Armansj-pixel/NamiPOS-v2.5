/* App.tsx — NamiPOS v2.5.6 (Full)
   Fitur: POS, Produk, Inventori, Resep (auto stock)
   Shift, Dashboard, Riwayat, Loyalty (15k=1p, 10p=1 gratis)
   Public Order (/order) + Admin Orders (pending/accept/reject/done)
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
const BRAND_LOGO = "/brand-logo.png";
const QRIS_IMG_SRC = "/qris.png";
const POINT_PER_RP = 15000;      // 15k = 1 poin
const FREE_DRINK_POINTS = 10;    // 10 poin = 1 gratis
const SHIPPING_PER_KM = 2000;    // 1km pertama gratis

/* ==========================
   TYPES
========================== */
type Product = {
  id: string; name: string; price: number; imageUrl?: string;
  category?: string; active?: boolean; outlet?: string;
};
type Ingredient = {
  id: string; name: string; unit: string; stock: number;
  min?: number; outlet?: string;
};
type RecipeItem = { ingredientId: string; qty: number };
type RecipeDoc = { id: string; items: RecipeItem[] };
type CartItem = { productId: string; name: string; price: number; qty: number; note?: string };
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
  id: string;
  outlet: string;
  source: "public";
  customerName: string;
  customerPhone: string;
  address: string;
  distance: number;
  method: "qris" | "cod";
  time: Timestamp | null;
  items: { productId?: string; name: string; price: number; qty: number; note?: string }[];
  subtotal: number;
  shipping: number;
  total: number;
  status: "pending" | "accepted" | "rejected" | "done";
  saleId?: string;
};

/* ==========================
   UTILITIES
========================== */
const uid = () => Math.random().toString(36).slice(2, 10);
const IDR = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n || 0);
const calcShipping = (km: number) => {
  const afterFree = Math.max(0, (Number.isFinite(km) ? km : 1) - 1);
  return Math.ceil(afterFree) * SHIPPING_PER_KM;
};

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
    for (const it of recipe.items) {
      ingNeeds.set(it.ingredientId, (ingNeeds.get(it.ingredientId) || 0) + (it.qty * pair.qty));
    }
  }
  if (ingNeeds.size === 0) return { ok: true as const };
  const shortages: { name: string; need: number; have: number; unit: string }[] = [];
  for (const ingId of Array.from(ingNeeds.keys())) {
    const snap = await getDoc(doc(db, "ingredients", ingId));
    if (!snap.exists()) {
      shortages.push({ name: `#${ingId}`, need: ingNeeds.get(ingId) || 0, have: 0, unit: "-" });
      continue;
    }
    const d = snap.data() as any;
    const need = ingNeeds.get(ingId) || 0;
    const have = Number(d.stock || 0);
    const unit = d.unit || "-";
    if (have < need) shortages.push({ name: d.name || `#${ingId}`, need, have, unit });
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
   APP START
========================== */
export default function App() {
  const isPublicOrder = typeof window !== "undefined" && window.location.pathname === "/order";
  if (isPublicOrder) return <PublicOrder />;

  const [user, setUser] = useState<null | { email: string }>(null);
  const [tab, setTab] = useState<"dashboard"|"pos"|"history"|"products"|"inventory"|"orders">("pos");
  const isOwner = !!(user?.email && OWNER_EMAILS.has(user.email));

  /* LOGIN */
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authLoading, setAuthLoading] = useState(false);

  /* DATA */
  const [products, setProducts] = useState<Product[]>([]);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [recipes, setRecipes] = useState<Record<string, RecipeItem[]>>({});

/* ===== POS state ===== */
  const [queryText, setQueryText] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [noteInput, setNoteInput] = useState("");
  const [discount, setDiscount] = useState(0);
  const [taxPct, setTaxPct] = useState(0);
  const [svcPct, setSvcPct] = useState(0);
  const [payMethod, setPayMethod] = useState<"cash"|"ewallet"|"qris">("cash");
  const [cash, setCash] = useState<number>(0);
  const [showQR, setShowQR] = useState(false);

  /* ===== Loyalty ===== */
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPoints, setCustomerPoints] = useState<number|null>(null);
  const [useFreeDrink, setUseFreeDrink] = useState(false);

  /* ===== Shift ===== */
  const [activeShift, setActiveShift] = useState<Shift|null>(null);
  const [openCash, setOpenCash] = useState<number>(0);

  /* ===== History ===== */
  const [historyRows, setHistoryRows] = useState<Sale[]>([]);
  const [histCursor, setHistCursor] = useState<any>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  /* ===== Dashboard ===== */
  const [dashLoading, setDashLoading] = useState(false);
  const [todayStats, setTodayStats] = useState({
    omzet:0, trx:0, avg:0, cash:0, ewallet:0, qris:0,
    topItems: [] as {name:string;qty:number}[]
  });
  const [last7, setLast7] = useState<{date:string; omzet:number; trx:number}[]>([]);

  /* ===== Orders (Admin) ===== */
  const [orders, setOrders] = useState<PublicOrderDoc[]>([]);
  const [ordersLoading] = useState(false);

  /* ===== Derivatives ===== */
  const filteredProducts = useMemo(
    () => products.filter(p => (p.active!==false) && p.name.toLowerCase().includes(queryText.toLowerCase())),
    [products, queryText]
  );
  const subtotal = useMemo(()=> cart.reduce((s,i)=> s + i.price*i.qty, 0), [cart]);
  const taxVal = Math.round(subtotal * (taxPct/100));
  const svcVal = Math.round(subtotal * (svcPct/100));
  const totalBeforeLoyalty = Math.max(0, subtotal + taxVal + svcVal - (discount||0));
  const cheapest = cart.length ? Math.min(...cart.map(c=>c.price)) : 0;
  const loyaltyDiscount = useFreeDrink ? Math.min(cheapest, totalBeforeLoyalty) : 0;
  const total = Math.max(0, totalBeforeLoyalty - loyaltyDiscount);
  const change = Math.max(0, (cash||0) - total);

  /* ==========================
     AUTH WATCH
  =========================== */
  useEffect(()=>{
    const unsub = onAuthStateChanged(auth, u=>{
      setUser(u?.email? {email:u.email}: null);
    });
    return () => unsub();
  },[]);

  /* ==========================
     LOAD DATA AFTER LOGIN
  =========================== */
  useEffect(()=>{
    if(!user) return;

    // Products
    const qProd = query(collection(db,"products"), where("outlet","==",OUTLET));
    const unsubProd = onSnapshot(qProd, snap=>{
      const rows: Product[] = snap.docs.map(d=>{
        const x = d.data() as any;
        return { id:d.id, name:x.name, price:x.price, imageUrl:x.imageUrl, category:x.category, active:x.active, outlet:x.outlet };
      });
      setProducts(rows);
    });

    // Ingredients
    const qIng = query(collection(db,"ingredients"), where("outlet","==",OUTLET));
    const unsubIng = onSnapshot(qIng, snap=>{
      const rows: Ingredient[] = snap.docs.map(d=>{
        const x = d.data() as any;
        return { id:d.id, name:x.name, unit:x.unit, stock:x.stock??0, min:x.min??0, outlet:x.outlet };
      });
      setIngredients(rows);
    });

    // Recipes (preload)
    const unsubRecipes = onSnapshot(collection(db,"recipes"), snap=>{
      const map: Record<string, RecipeItem[]> = {};
      snap.docs.forEach(d=>{
        const x = d.data() as any;
        map[d.id] = Array.isArray(x.items)? x.items : [];
      });
      setRecipes(map);
    });

    // Orders (pending & accepted)
    const qOrd = query(
      collection(db,"orders"),
      where("outlet","==",OUTLET),
      where("status","in",["pending","accepted"]),
      orderBy("time","desc")
    );
    const unsubOrd = onSnapshot(qOrd, snap=>{
      const rows: PublicOrderDoc[] = snap.docs.map(d=>{
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
          saleId: x.saleId
        };
      });
      setOrders(rows);
    });

    // Shift & Dashboard
    checkActiveShift().catch(()=>{});
    loadDashboard().catch(()=>{});

    return ()=>{ unsubProd(); unsubIng(); unsubRecipes(); unsubOrd(); };
    // eslint-disable-next-line
  },[user?.email]);

  /* ==========================
     AUTH handlers
  =========================== */
  async function doLogin(e?: React.FormEvent){
    e?.preventDefault();
    try{
      setAuthLoading(true);
      await signInWithEmailAndPassword(auth, email.trim(), password);
      setEmail(""); setPassword("");
      setTab("pos");
    }catch(err:any){
      alert("Login gagal: "+(err?.message||err));
    }finally{ setAuthLoading(false); }
  }
  async function doLogout(){ await signOut(auth); }

  /* ==========================
     SHIFT
  =========================== */
  async function checkActiveShift(){
    const qShift = query(
      collection(db,"shifts"),
      where("outlet","==",OUTLET),
      where("isOpen","==",true),
      orderBy("openAt","desc"),
      limit(1)
    );
    const snap = await getDocs(qShift);
    if(snap.empty){ setActiveShift(null); return; }
    const d = snap.docs[0];
    const x = d.data() as any;
    setActiveShift({
      id:d.id, outlet:x.outlet, openBy:x.openBy,
      openAt:x.openAt, closeAt:x.closeAt??null, openCash:x.openCash??0, isOpen:true
    });
  }
  async function openShiftAction(){
    if(!user?.email) return alert("Belum login.");
    const id = `SHIFT-${Date.now()}`;
    await setDoc(doc(db,"shifts", id), {
      outlet: OUTLET, openBy: user.email, openAt: serverTimestamp(),
      closeAt: null, isOpen: true, openCash
    });
    setOpenCash(0);
    await checkActiveShift();
  }
  async function closeShiftAction(){
    if(!activeShift?.id) return;
    await updateDoc(doc(db,"shifts", activeShift.id), { isOpen:false, closeAt: serverTimestamp() });
    setActiveShift(null);
    alert("Shift ditutup.");
    loadDashboard().catch(()=>{});
  }

  /* ==========================
     LOYALTY
  =========================== */
  async function fetchCustomerPoints(phone: string) {
    if (!phone.trim()) { setCustomerPoints(null); return; }
    const ref = doc(db,"customers", phone);
    const snap = await getDoc(ref);
    if (!snap.exists()) { setCustomerPoints(0); return; }
    const d = snap.data() as any;
    setCustomerPoints(d.points ?? 0);
    setCustomerName(d.name ?? "");
  }
  useEffect(()=>{ if(customerPhone) fetchCustomerPoints(customerPhone); }, [customerPhone]);

  async function updateCustomerPoints(phone: string, name: string, add: number) {
    if (!phone.trim()) return;
    const ref = doc(db,"customers", phone);
    const snap = await getDoc(ref);
    const prev = snap.exists() ? (snap.data() as any).points || 0 : 0;
    await setDoc(ref, { name, phone, points: Math.max(0, prev + add), lastVisit: serverTimestamp() }, { merge: true });
  }

  /* ==========================
     FINALIZE TRANSACTION (POS)
  =========================== */
  async function finalizeSale() {
    if (!activeShift?.id) return alert("Shift belum dibuka.");
    if (cart.length === 0) return alert("Keranjang kosong.");
    if (payMethod==="cash" && cash < total) return alert("Tunai kurang.");

    // cek stok
    const shortage = await checkShortageForCart(cart.map(c => ({ productId: c.productId, qty: c.qty })));
    if (!shortage.ok) {
      return alert("Stok tidak mencukupi:\n" +
        shortage.shortages.map(s => `${s.name}: butuh ${s.need}${s.unit}, sisa ${s.have}`).join("\n"));
    }
    await deductStockForCart(cart.map(c => ({ productId: c.productId, qty: c.qty })));

    // loyalty
    const pointsEarned = Math.floor(total / POINT_PER_RP);
    const usedFreeDrink = useFreeDrink;

    // simpan sale
    const saleData: Sale = {
      outlet: OUTLET,
      shiftId: activeShift.id,
      cashierEmail: user?.email || "",
      customerPhone: customerPhone || null,
      customerName: customerName || null,
      time: serverTimestamp() as any,
      items: cart.map(c => ({ name: c.name, price: c.price, qty: c.qty, ...(c.note?{note:c.note}:{}) })),
      subtotal, discount, tax: taxVal, service: svcVal,
      total, payMethod, cash, change,
      pointsEarned, usedFreeDrink
    };

    printReceipt(); // cetak dulu
    await addDoc(collection(db,"sales"), saleData);

    if (customerPhone) {
      const adj = usedFreeDrink ? -FREE_DRINK_POINTS + pointsEarned : pointsEarned;
      await updateCustomerPoints(customerPhone, customerName || "Member", adj);
    }

    alert("Transaksi berhasil ✅");
    // reset
    setCart([]); setDiscount(0); setTaxPct(0); setSvcPct(0);
    setCash(0); setCustomerPhone(""); setCustomerName(""); setCustomerPoints(null);
    setUseFreeDrink(false);
    // refresh
    loadHistory(false).catch(()=>{});
    loadDashboard().catch(()=>{});
  }

  /* ==========================
     CETAK 80mm
  =========================== */
  function printReceipt() {
    const win = window.open("", "_blank", "width=400,height=600");
    if (!win) return;
    const loyaltyCut = useFreeDrink ? (cart.length ? Math.min(...cart.map(c=>c.price)) : 0) : 0;
    const totalNow = Math.max(0, subtotal + taxVal + svcVal - (discount||0) - loyaltyCut);
    const changeNow = Math.max(0, (cash||0) - totalNow);
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
          ${useFreeDrink?`<tr class="tot"><td>Tukar Poin</td><td></td><td style="text-align:right">-${IDR(loyaltyCut)}</td></tr>`:""}
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
    if (!(user?.email && OWNER_EMAILS.has(user.email))) return alert("Hanya owner yang dapat menghapus transaksi.");
    if (!window.confirm("Hapus transaksi ini?")) return;
    await deleteDoc(doc(db, "sales", id));
    setHistoryRows(prev => prev.filter(x => x.id !== id));
  }

  /* ==========================
     DASHBOARD
  =========================== */
  async function loadDashboard(){
    setDashLoading(true);
    try{
      // Today
      const qToday = query(
        collection(db,"sales"),
        where("outlet","==",OUTLET),
        where("time", ">=", Timestamp.fromDate(new Date(new Date().setHours(0,0,0,0)))),
        where("time", "<=", Timestamp.fromDate(new Date(new Date().setHours(23,59,59,999))))
      );
      const sToday = await getDocs(qToday);
      let omzet=0, trx=0, cashSum=0, ew=0, qr=0;
      const counter: Record<string, number> = {};
      sToday.forEach(d=>{
        const x = d.data() as any;
        omzet += x.total||0; trx += 1;
        if(x.payMethod==="cash") cashSum += x.total||0;
        if(x.payMethod==="ewallet") ew += x.total||0;
        if(x.payMethod==="qris") qr += x.total||0;
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

      // last 7 days
      const arr: {date:string; omzet:number; trx:number}[] = [];
      for(let i=6;i>=0;i--){
        const day = new Date(); day.setDate(day.getDate()-i);
        const start = Timestamp.fromDate(new Date(day.setHours(0,0,0,0)));
        const end   = Timestamp.fromDate(new Date(day.setHours(23,59,59,999)));
        const qs = query(
          collection(db,"sales"),
          where("outlet","==",OUTLET),
          where("time",">=",start),
          where("time","<=",end)
        );
        const sn = await getDocs(qs);
        let o=0,t=0;
        sn.forEach(d=>{ const x=d.data() as any; o+=x.total||0; t++; });
        const label = new Date(day).toLocaleDateString("id-ID",{weekday:"short"});
        arr.push({date: label, omzet:o, trx:t});
      }
      setLast7(arr);
    }catch(e){ console.error(e); }
    setDashLoading(false);
  }

  /* ==========================
     ADMIN ORDERS — terima / tolak / selesai
  =========================== */
  async function acceptOrder(o: PublicOrderDoc){
    if(o.status!=="pending") return;
    await updateDoc(doc(db,"orders", o.id), { status: "accepted" });
  }
  async function rejectOrder(o: PublicOrderDoc){
    if(o.status!=="pending") return;
    await updateDoc(doc(db,"orders", o.id), { status: "rejected" });
  }
  async function completeOrder(o: PublicOrderDoc){
    if(o.status!=="accepted") return alert("Order harus diterima dulu.");
    if(!activeShift?.id) return alert("Shift belum dibuka.");
    // Cek & kurangi stok berdasarkan nama produk (jika match dengan master)
    const pairList: { productId: string; qty: number }[] = [];
    for(const it of o.items){
      const prod = products.find(p=> p.name===it.name || p.id===it.productId);
      if(prod) pairList.push({ productId: prod.id, qty: it.qty });
    }
    const shortage = await checkShortageForCart(pairList);
    if(!shortage.ok){
      return alert("Stok tidak cukup untuk menyelesaikan order:\n" +
        shortage.shortages.map(s => `${s.name}: butuh ${s.need}${s.unit}, sisa ${s.have}`).join("\n"));
    }
    await deductStockForCart(pairList);

    // Simpan ke sales
    const sale: Sale = {
      outlet: OUTLET,
      shiftId: activeShift.id,
      cashierEmail: user?.email || "",
      customerPhone: o.customerPhone || null,
      customerName: o.customerName || null,
      time: serverTimestamp() as any,
      items: o.items.map(i=>({name:i.name, price:i.price, qty:i.qty})),
      subtotal: o.subtotal,
      discount: 0,
      tax: 0,
      service: 0,
      total: o.total,
      payMethod: o.method==="cod" ? "cash" : "qris",
      cash: o.method==="cod" ? o.total : 0,
      change: 0
    };
    const saleRef = await addDoc(collection(db,"sales"), sale);
    await updateDoc(doc(db,"orders", o.id), { status:"done", saleId: saleRef.id });
    alert("Order selesai dan masuk riwayat penjualan.");
    loadDashboard().catch(()=>{});
  }

/* ====== Part 3/4 (UI) menyusul di bawah ====== */
/* ==========================
     UI RENDER (login, header, POS, history, products, inventory, orders)
  =========================== */

  // ====== Modal states ======
  const [showProdModal, setShowProdModal] = useState(false);
  const [prodForm, setProdForm] = useState<Partial<Product>>({});
  const [showIngModal, setShowIngModal] = useState(false);
  const [ingForm, setIngForm] = useState<Partial<Ingredient>>({});
  const [showRecipeModal, setShowRecipeModal] = useState(false);
  const [recipeProduct, setRecipeProduct] = useState<Product|null>(null);
  const [recipeRows, setRecipeRows] = useState<RecipeItem[]>([]);

  // ====== LOGIN SCREEN ======
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

  // ====== MAIN ======
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
          <nav className="flex gap-2">
            {isOwner && (
              <button onClick={()=>{ setTab("dashboard"); loadDashboard(); }} className={`px-3 py-1.5 rounded-lg border ${tab==="dashboard"?"bg-emerald-50 border-emerald-200":"bg-white"}`}>
                Dashboard
              </button>
            )}
            <button onClick={()=>setTab("pos")} className={`px-3 py-1.5 rounded-lg border ${tab==="pos"?"bg-emerald-50 border-emerald-200":"bg-white"}`}>Kasir</button>
            <button onClick={()=>{ setTab("history"); loadHistory(false); }} className={`px-3 py-1.5 rounded-lg border ${tab==="history"?"bg-emerald-50 border-emerald-200":"bg-white"}`}>Riwayat</button>
            {isOwner && (
              <>
                <button onClick={()=>setTab("products")} className={`px-3 py-1.5 rounded-lg border ${tab==="products"?"bg-emerald-50 border-emerald-200":"bg-white"}`}>Produk</button>
                <button onClick={()=>setTab("inventory")} className={`px-3 py-1.5 rounded-lg border ${tab==="inventory"?"bg-emerald-50 border-emerald-200":"bg-white"}`}>Inventori</button>
                <button onClick={()=>setTab("orders")} className={`px-3 py-1.5 rounded-lg border ${tab==="orders"?"bg-emerald-50 border-emerald-200":"bg-white"}`}>Orders</button>
              </>
            )}
            <button onClick={doLogout} className="px-3 py-1.5 rounded-lg border bg-rose-50">Keluar</button>
          </nav>
        </div>
      </header>

      {/* konten utama */}
      <main className="max-w-7xl mx-auto px-3 sm:px-4 md:px-6 py-4">
        {/* Badge Shift */}
        <div className="mb-3">
          <div className="inline-flex items-center gap-2 text-xs px-3 py-1 rounded-full border bg-white">
            {activeShift?.isOpen
              ? <>Shift <b>OPEN</b> • {new Date(activeShift.openAt?.toDate?.()||new Date()).toLocaleTimeString("id-ID",{hour12:false})} • {activeShift.openBy}</>
              : <>Belum ada shift aktif</>}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {!activeShift?.isOpen ? (
              <>
                <input type="number" className="border rounded-lg px-3 py-2 w-40" placeholder="Kas awal (Rp)" value={openCash} onChange={e=>setOpenCash(Number(e.target.value)||0)} />
                <button className="px-3 py-2 rounded-lg bg-emerald-600 text-white" onClick={openShiftAction}>Buka Shift</button>
              </>
            ) : (
              <button className="px-3 py-2 rounded-lg bg-rose-600 text-white" onClick={closeShiftAction}>Tutup Shift</button>
            )}
          </div>
        </div>

        {/* Dashboard */}
        {tab==="dashboard" && isOwner && (
          <section className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <KPI title="Omzet Hari Ini" value={IDR(todayStats.omzet)} />
              <KPI title="Transaksi" value={String(todayStats.trx)} />
              <KPI title="Avg Ticket" value={IDR(todayStats.avg)} />
              <KPI title="Cash" value={IDR(todayStats.cash)} />
              <KPI title="eWallet/QRIS" value={IDR(todayStats.ewallet + todayStats.qris)} />
            </div>
          </section>
        )}

        {/* POS, History, Products, Inventory, Orders ada di Part 3 penuh */}
      </main>
    </div>
  );
}

/* ===== Small helpers ===== */
function igFormSafe<T extends string|number|undefined>(v:T, fallback:any=""){return v??fallback;}
function KPI({title,value}:{title:string;value:string}) {
  return <div className="bg-white border rounded-2xl p-4"><div className="text-[12px] text-neutral-500">{title}</div><div className="text-xl font-bold mt-1">{value}</div></div>;
}
/* ===========================================================
   PUBLIC ORDER PAGE (tanpa login) — /order
   =========================================================== */
// Pelanggan bisa pesan via URL:
//   https://namipos.vercel.app/order?outlet=MTHaryono
// Admin memproses di tab "Orders" (pending/accepted/done) real-time.

function PublicOrder() {
  const outlet = param("outlet", OUTLET);
  const [loading, setLoading] = useState(true);
  const [menu, setMenu] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [custName, setCustName] = useState("");
  const [custPhone, setCustPhone] = useState("");
  const [custAddr, setCustAddr] = useState("");
  const [distance, setDistance] = useState<number>(0);
  const [method, setMethod] = useState<"qris"|"cod">("qris");
  const [sending, setSending] = useState(false);

  const subtotal = useMemo(()=>cart.reduce((s,i)=>s+i.price*i.qty,0),[cart]);
  const shipping = useMemo(()=>calcShipping(distance),[distance]);
  const total = subtotal+shipping;

  useEffect(()=>{
    (async()=>{
      const qProd = query(
        collection(db,"products"),
        where("outlet","==",outlet),
        where("active","==",true)
      );
      const snap = await getDocs(qProd);
      const rows:Product[] = snap.docs.map(d=>({ id:d.id, ...(d.data() as any) }));
      setMenu(rows);
      setLoading(false);
    })();
  },[outlet]);

  async function submitOrder(){
    if(cart.length===0) return alert("Pilih menu terlebih dahulu.");
    if(!custName || !custPhone || !custAddr) return alert("Lengkapi nama, HP, dan alamat.");
    setSending(true);
    try{
      const orderDoc = {
        outlet,
        source:"public" as const,
        customerName:custName,
        customerPhone:custPhone,
        address:custAddr,
        distance:Number(distance)||0,
        method,
        time: serverTimestamp(),
        items: cart.map(c=>({ name:c.name, price:c.price, qty:c.qty })),
        subtotal, shipping, total,
        status:"pending" as const
      };
      await addDoc(collection(db,"orders"), orderDoc);
      alert("Pesanan terkirim ✅\nSilakan tunggu konfirmasi admin.");
      // reset
      setCart([]);
      setCustName(""); setCustPhone(""); setCustAddr("");
      setDistance(0); setMethod("qris");
    }catch(e:any){
      alert("Gagal mengirim pesanan: "+(e?.message||e));
    }finally{
      setSending(false);
    }
  }

  if(loading) {
    return <div className="min-h-screen flex items-center justify-center text-sm text-neutral-500">Memuat menu…</div>;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 to-white p-4">
      <div className="max-w-3xl mx-auto bg-white rounded-2xl shadow p-4">
        <h1 className="text-2xl font-bold mb-3 text-center">Pesan Online — {outlet}</h1>

        {/* Data pelanggan */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
          <input className="border rounded-lg px-3 py-2" placeholder="Nama lengkap" value={custName} onChange={e=>setCustName(e.target.value)} />
          <input className="border rounded-lg px-3 py-2" placeholder="No HP" value={custPhone} onChange={e=>setCustPhone(e.target.value)} />
        </div>
        <textarea className="border rounded-lg px-3 py-2 w-full mb-2" rows={2} placeholder="Alamat pengantaran" value={custAddr} onChange={e=>setCustAddr(e.target.value)} />
        <label className="flex items-center gap-2 mb-4 text-sm">
          <span>Jarak (km)</span>
          <input
            type="number"
            className="border rounded-lg px-2 py-1 w-24"
            value={distance}
            onChange={e=>setDistance(Number(e.target.value)||0)}
          />
          <span className="text-neutral-500 text-xs">1 km pertama gratis • Ongkir: {IDR(calcShipping(distance))}</span>
        </label>

        {/* Menu list */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 mb-4">
          {menu.map(p=>(
            <button
              key={p.id}
              onClick={()=>setCart(prev=>{
                const same=prev.find(ci=>ci.productId===p.id);
                if(same) return prev.map(ci=>ci.productId===p.id?{...ci,qty:ci.qty+1}:ci);
                return [...prev,{id:uid(),productId:p.id,name:p.name,price:p.price,qty:1}];
              })}
              className="bg-white border rounded-2xl p-3 text-left hover:shadow">
              <div className="h-20 rounded-xl bg-gradient-to-br from-emerald-50 to-emerald-100 mb-2 overflow-hidden">
                {p.imageUrl && <img src={p.imageUrl} alt={p.name} className="w-full h-20 object-cover"/>}
              </div>
              <div className="font-medium">{p.name}</div>
              <div className="text-xs text-neutral-500">{p.category||"Signature"}</div>
              <div className="font-semibold mt-1">{IDR(p.price)}</div>
            </button>
          ))}
        </div>

        {/* Cart */}
        <div className="bg-neutral-50 border rounded-2xl p-3 mb-4">
          {cart.length===0 ? (
            <div className="text-sm text-neutral-500">Belum ada item dipilih.</div>
          ):(
            <div className="space-y-2">
              {cart.map(ci=>(
                <div key={ci.id} className="flex items-center justify-between border rounded-xl p-2">
                  <div>
                    <div className="font-medium">{ci.name}</div>
                    <div className="text-xs text-neutral-500">{ci.qty} × {IDR(ci.price)}</div>
                  </div>
                  <button className="px-2 py-1 border rounded" onClick={()=>setCart(prev=>prev.filter(x=>x.id!==ci.id))}>x</button>
                </div>
              ))}
            </div>
          )}
          {cart.length>0 && (
            <div className="mt-3 space-y-1 text-sm">
              <div className="flex justify-between"><span>Subtotal</span><span>{IDR(subtotal)}</span></div>
              <div className="flex justify-between"><span>Ongkir</span><span>{IDR(shipping)}</span></div>
              <div className="flex justify-between font-semibold"><span>Total</span><span>{IDR(total)}</span></div>
            </div>
          )}
        </div>

        {/* Metode bayar */}
        <div className="mb-4">
          <label className="block mb-1 text-sm font-medium">Metode pembayaran</label>
          <select className="border rounded-lg px-3 py-2" value={method} onChange={e=>setMethod(e.target.value as any)}>
            <option value="qris">QRIS (online)</option>
            <option value="cod">Bayar di Tempat (COD)</option>
          </select>
          {method==="qris" && <img src={QRIS_IMG_SRC} alt="QRIS" className="mt-2 w-40" />}
        </div>

        <button
          disabled={sending}
          className="w-full bg-emerald-600 text-white rounded-lg py-3 text-lg font-semibold disabled:opacity-50"
          onClick={submitOrder}>
          {sending?"Mengirim...":"Kirim Pesanan"}
        </button>
      </div>
    </div>
  );
}