// src/App.tsx — NamiPOS v2.5 (single-file)
// ================================================================
// Fitur:
// - Auth email/password (owner/staff)
// - Shift buka/tutup + ringkas di dashboard
// - POS: cart, pajak, service, diskon, cash/eWallet/QRIS, cetak struk (logo+QR)
// - Loyalty sederhana (poin total/10k) -> koleksi 'customers'
// - Produk: tambah/edit/aktif/nonaktif, gambar URL opsional
// - Inventori: tambah/edit/hapus, peringatan stok minim (min)
// - Resep: ikat produk->bahan, qty+unit, pemotongan stok otomatis saat transaksi final
// - Riwayat: daftar transaksi (hapus transaksi oleh owner)
// - Order Publik (tanpa login): daftar menu, cart, checkout (COD/QRIS); masuk ke koleksi 'orders'
// - Link Order Publik tersedia di topbar (untuk dibagikan)
// ================================================================

import React, { useEffect, useMemo, useState } from "react";
import {
  addDoc, collection, deleteDoc, doc, getDoc, getDocs, onSnapshot, orderBy, query,
  serverTimestamp, setDoc, Timestamp, updateDoc, where, limit, startAfter
} from "firebase/firestore";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { auth, db } from "./lib/firebase";

/* ==========================
   KONFIGURASI
========================== */
const OUTLET = "MTHaryono";
const OWNER_EMAILS = new Set([
  "antonius.arman123@gmail.com",
  "ayuismaalabibbah@gmail.com",
]);
const LOGO_SRC = "/logo.png";
const QRIS_IMG_SRC = "/qris.png";

/* ==========================
   TYPES
========================== */
type Product = { id: string; name: string; price: number; category?: string; active?: boolean; outlet?: string; imgUrl?: string };
type Ingredient = { id: string; name: string; unit: string; stock: number; min?: number; outlet?: string };
type Recipe = { productId: string; items: { name: string; qty: number; unit: string }[] };
type CartItem = { id: string; productId: string; name: string; price: number; qty: number; note?: string };
type Shift = { id: string; outlet: string; openBy: string; openAt: Timestamp; closeAt?: Timestamp | null; openCash?: number; isOpen: boolean };
type Sale = {
  id?: string;
  outlet: string;
  shiftId: string | null;
  cashierEmail: string;
  customerPhone: string | null;
  customerName?: string | null;
  time: Timestamp | null;
  items: { name: string; price: number; qty: number; note?: string }[];
  subtotal: number; discount: number; tax: number; service: number; total: number;
  payMethod: "cash" | "ewallet" | "qris";
  cash?: number; change?: number;
};
type PublicOrder = {
  id?: string;
  outlet: string;
  name: string;
  phone: string;
  address: string;
  distanceKm?: number;
  items: { name: string; price: number; qty: number; note?: string }[];
  subtotal: number; discount: number; tax: number; service: number; total: number;
  payMethod: "cod" | "qris";
  status: "pending" | "accepted" | "rejected" | "done";
  createdAt: Timestamp | null;
};

/* ==========================
   UTIL
========================== */
const uid = () => Math.random().toString(36).slice(2, 10);
const IDR = (n: number) => new Intl.NumberFormat("id-ID",{style:"currency",currency:"IDR",maximumFractionDigits:0}).format(n||0);
const startOfDay = (d = new Date()) => { const x = new Date(d); x.setHours(0,0,0,0); return x; };
const endOfDay   = (d = new Date()) => { const x = new Date(d); x.setHours(23,59,59,999); return x; };
const daysAgo = (n:number) => { const x=new Date(); x.setDate(x.getDate()-n); return x; };

/* ==========================
   APP
========================== */
export default function App() {
  /* ---- URL router sederhana: /order -> public order ---- */
  const isPublicOrder = typeof window !== "undefined" && window.location.pathname.startsWith("/order");

  if (isPublicOrder) {
    return <PublicOrderPage/>;
  }

  /* ---- auth ---- */
  const [user, setUser] = useState<null | { email: string }>(null);
  const isOwner = !!(user?.email && OWNER_EMAILS.has(user.email));

  /* ---- tabs ---- */
  const [tab, setTab] = useState<"dashboard"|"pos"|"history"|"products"|"inventory"|"recipes"|"orders">("pos");

  /* ---- login form ---- */
  const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [authLoading, setAuthLoading] = useState(false);

  /* ---- master ---- */
  const [products, setProducts] = useState<Product[]>([]);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [recipes, setRecipes] = useState<Record<string, Recipe>>({}); // keyed by productId

  /* ---- POS ---- */
  const [queryText, setQueryText] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [noteInput, setNoteInput] = useState("");
  const [discount, setDiscount] = useState(0);
  const [taxPct, setTaxPct] = useState(0);
  const [svcPct, setSvcPct] = useState(0);
  const [payMethod, setPayMethod] = useState<"cash"|"ewallet"|"qris">("cash");
  const [cash, setCash] = useState<number>(0);
  const [showQR, setShowQR] = useState(false);

  /* ---- loyalty ---- */
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPoints, setCustomerPoints] = useState<number|null>(null);

  /* ---- shift ---- */
  const [activeShift, setActiveShift] = useState<Shift|null>(null);
  const [openCash, setOpenCash] = useState<number>(0);

  /* ---- history ---- */
  const [historyRows, setHistoryRows] = useState<Sale[]>([]);
  const [histCursor, setHistCursor] = useState<any>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  /* ---- dashboard ---- */
  const [dashLoading, setDashLoading] = useState(false);
  const [todayStats, setTodayStats] = useState({ omzet:0, trx:0, avg:0, cash:0, ewallet:0, qris:0, topItems: [] as {name:string;qty:number}[] });
  const [last7, setLast7] = useState<{date:string; omzet:number; trx:number}[]>([]);

  /* ---- orders (public) for admin view ---- */
  const [orders, setOrders] = useState<PublicOrder[]>([]);

  /* ---- computed ---- */
  const filteredProducts = useMemo(
    () => products.filter(p => (p.active!==false) && p.name.toLowerCase().includes(queryText.toLowerCase())),
    [products, queryText]
  );
  const subtotal = useMemo(()=> cart.reduce((s,i)=> s + i.price*i.qty, 0), [cart]);
  const taxVal = Math.round(subtotal * (taxPct/100));
  const svcVal = Math.round(subtotal * (svcPct/100));
  const total = Math.max(0, subtotal + taxVal + svcVal - (discount||0));
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

    // products
    const qProd = query(collection(db,"products"), where("outlet","==",OUTLET));
    const unsubProd = onSnapshot(qProd, snap=>{
      const rows: Product[] = snap.docs.map(d=>{
        const x = d.data() as any;
        return { id:d.id, name:x.name, price:x.price, category:x.category, active:x.active, outlet:x.outlet, imgUrl:x.imgUrl };
      });
      setProducts(rows);
    }, err=>alert("Memuat produk gagal.\n"+(err.message||err)));

    // ingredients
    const qIng = query(collection(db,"inventory"), where("outlet","==",OUTLET));
    const unsubIng = onSnapshot(qIng, snap=>{
      const rows: Ingredient[] = snap.docs.map(d=>{
        const x = d.data() as any;
        return { id:d.id, name:x.name, unit:x.unit, stock:x.stock??0, min:x.min??0, outlet:x.outlet };
      });
      setIngredients(rows);
    }, err=>alert("Memuat inventori gagal.\n"+(err.message||err)));

    // recipes (cache semua)
    const qRec = query(collection(db,"recipes"), where("outlet","==",OUTLET));
    const unsubRec = onSnapshot(qRec, snap=>{
      const map: Record<string, Recipe> = {};
      snap.docs.forEach(d=>{
        const x = d.data() as any;
        map[x.productId] = { productId:x.productId, items:x.items||[] };
      });
      setRecipes(map);
    }, err=>alert("Memuat resep gagal.\n"+(err.message||err)));

    // shift
    checkActiveShift().catch(e=>console.warn(e));

    // dashboard & orders
    loadDashboard().catch(()=>{});
    if (isOwner) {
      const qOrd = query(collection(db,"orders"), where("outlet","==",OUTLET), orderBy("createdAt","desc"), limit(50));
      const unsubOrd = onSnapshot(qOrd, snap=>{
        const rows: PublicOrder[] = snap.docs.map(d=>{
          const x = d.data() as any;
          return { id:d.id, ...x };
        });
        setOrders(rows);
      });
      return ()=>{ unsubProd(); unsubIng(); unsubRec(); unsubOrd(); };
    }

    return ()=>{ unsubProd(); unsubIng(); unsubRec(); };
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
     POS
  =========================== */
  function addToCart(p: Product){
    setCart(prev=>{
      const same = prev.find(ci=> ci.productId===p.id && (ci.note||"")===(noteInput||""));
      if(same) return prev.map(ci=> ci===same? {...ci, qty:ci.qty+1 } : ci);
      return [...prev, { id: uid(), productId:p.id, name:p.name, price:p.price, qty:1, note: noteInput||undefined }];
    });
  }
  const inc = (id:string)=> setCart(prev=> prev.map(ci=> ci.id===id? {...ci, qty:ci.qty+1 } : ci));
  const dec = (id:string)=> setCart(prev=> prev.map(ci=> ci.id===id? {...ci, qty:Math.max(1, ci.qty-1) } : ci));
  const rm  = (id:string)=> setCart(prev=> prev.filter(ci=> ci.id!==id));
  const clearCart = ()=> { setCart([]); setDiscount(0); setTaxPct(0); setSvcPct(0); setPayMethod("cash"); setCash(0); setNoteInput(""); setCustomerPhone(""); setCustomerName(""); setCustomerPoints(null); };

  /* loyalty: auto lookup by phone */
  useEffect(()=>{
    if(!user) return;
    const phone = customerPhone.trim();
    if(phone.length<8){ setCustomerPoints(null); return; }
    (async()=>{
      try{
        const ref = doc(db,"customers", phone);
        const s = await getDoc(ref);
        if(s.exists()){
          const c = s.data() as any;
          setCustomerName(c.name||""); setCustomerPoints(c.points||0);
        }else{
          setCustomerPoints(0);
        }
      }catch(e:any){ console.warn("Lookup customer:", e?.message||e); }
    })();
  },[customerPhone, user]);

  /* pemotongan stok: cek ketersediaan */
  function checkStockForCart(): { ok:true } | { ok:false; shortages:{name:string; need:number; have:number; unit:string}[]} {
    const needMap = new Map<string, {qty:number; unit:string}>();
    for(const ci of cart){
      const rec = recipes[ci.productId];
      if(!rec) continue;
      for(const r of rec.items||[]){
        const key = r.name.toLowerCase();
        const exist = needMap.get(key);
        if(exist) needMap.set(key,{qty: exist.qty + (r.qty*ci.qty), unit:r.unit});
        else needMap.set(key,{qty: r.qty*ci.qty, unit:r.unit});
      }
    }
    const shortages: {name:string; need:number; have:number; unit:string}[] = [];
    for(const [name, need] of Array.from(needMap.entries())){
      const ing = ingredients.find(i=> i.name.toLowerCase()===name);
      const have = ing?.stock ?? 0;
      if(have < need.qty){
        shortages.push({ name: ing?.name || name, need: need.qty, have, unit: need.unit });
      }
    }
    if(shortages.length>0) return { ok:false, shortages };
    return { ok:true };
  }

  /* print 80mm */
  function printReceipt(rec: Omit<Sale,"id">, saleId?: string){
    const itemsHtml = rec.items.map(i=>`<tr><td>${i.name}${i.note?`<div style='font-size:10px;opacity:.7'>${i.note}</div>`:""}</td><td style='text-align:center'>${i.qty}x</td><td style='text-align:right'>${IDR(i.price*i.qty)}</td></tr>`).join("");
    const w = window.open("", "_blank", "width=380,height=600");
    if(!w) return;
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Struk</title>
<style>
body{font-family:ui-monospace,Consolas,monospace}
.wrap{width:300px;margin:0 auto}
h2{margin:6px 0;text-align:center}
td{padding:4px 0;border-bottom:1px dashed #ccc;font-size:12px}
.tot td{border-bottom:none;font-weight:700}
.meta{font-size:12px;text-align:center;opacity:.8}
img.logo{display:block;margin:0 auto 6px;height:40px}
img.qr{display:block;margin:6px auto 0;height:42px}
</style></head><body>
<div class="wrap">
  <img class="logo" src="${LOGO_SRC}" onerror="this.style.display='none'"/>
  <h2>NamiPOS — ${OUTLET}</h2>
  <div class="meta">${saleId||"DRAFT"}<br/>${new Date().toLocaleString("id-ID",{hour12:false})}</div>
  <hr/>
  <table style="width:100%;border-collapse:collapse">
    ${itemsHtml}
    <tr class="tot"><td>Subtotal</td><td></td><td style="text-align:right">${IDR(rec.subtotal)}</td></tr>
    ${rec.tax?`<tr class="tot"><td>Pajak</td><td></td><td style="text-align:right">${IDR(rec.tax)}</td></tr>`:""}
    ${rec.service?`<tr class="tot"><td>Service</td><td></td><td style="text-align:right">${IDR(rec.service)}</td></tr>`:""}
    ${rec.discount?`<tr class="tot"><td>Diskon</td><td></td><td style="text-align:right">-${IDR(rec.discount)}</td></tr>`:""}
    <tr class="tot"><td>Total</td><td></td><td style="text-align:right">${IDR(rec.total)}</td></tr>
    ${rec.payMethod==="cash"
      ? `<tr><td>Tunai</td><td></td><td style='text-align:right'>${IDR(rec.cash||0)}</td></tr>
         <tr><td>Kembali</td><td></td><td style='text-align:right'>${IDR(rec.change||0)}</td></tr>`
      : `<tr><td>Metode</td><td></td><td style='text-align:right'>${rec.payMethod.toUpperCase()}</td></tr>`
    }
  </table>
  ${rec.payMethod!=="cash" ? `<img class="qr" src="${QRIS_IMG_SRC}" onerror="this.style.display='none'"/>` : ""}
  <p class="meta">Terima kasih!</p>
</div>
<script>window.print();</script>
</body></html>`;
    w.document.write(html); w.document.close();
  }

  /* finalize */
  async function finalize(){
    if(!user?.email) return alert("Belum login.");
    if(!activeShift?.id) return alert("Buka shift dahulu.");
    if(cart.length===0) return alert("Keranjang kosong.");
    if(payMethod==="cash" && cash<total) return alert("Uang tunai kurang.");

    // cek stok berdasar resep
    const check = checkStockForCart();
    if (check.ok === false) {
      const msg = check.shortages.map(s=>`${s.name} (butuh ${s.need} ${s.unit}, ada ${s.have})`).join("\n");
      if(!confirm("Stok tidak cukup:\n\n"+msg+"\n\nLanjutkan tanpa pemotongan stok?")) return;
    }

    const payload: Omit<Sale,"id"> = {
      outlet: OUTLET, shiftId: activeShift.id, cashierEmail: user.email,
      customerPhone: customerPhone?.trim()||null, customerName: customerName?.trim()||null,
      time: serverTimestamp() as any,
      items: cart.map(i=> ({ name:i.name, price:i.price, qty:i.qty, ...(i.note?{note:i.note}:{}) })),
      subtotal, discount: discount||0, tax: taxVal, service: svcVal, total, payMethod,
      ...(payMethod==="cash" ? { cash, change } : {})
    };

    try{
      const ref = await addDoc(collection(db,"sales"), payload as any);

      // loyalty
      if((customerPhone.trim().length)>=8){
        const cref = doc(db,"customers", customerPhone.trim());
        const s = await getDoc(cref);
        const pts = Math.floor(total/10000);
        if(s.exists()){
          const c = s.data() as any;
          await updateDoc(cref, { points:(c.points||0)+pts, name: customerName||c.name||"", lastVisit: serverTimestamp() });
        }else{
          await setDoc(cref, { phone: customerPhone.trim(), name: customerName||"Member", points: pts, lastVisit: serverTimestamp() });
        }
      }

      // Pemotongan stok (jika tersedia resep & stok cukup)
      if (check.ok === true) {
        const useMap = new Map<string, number>(); // name(lower) -> qty to deduct
        for (const ci of cart) {
          const rec = recipes[ci.productId];
          if (!rec) continue;
          for(const r of rec.items||[]){
            const key = r.name.toLowerCase();
            useMap.set(key, (useMap.get(key)||0) + (r.qty * ci.qty));
          }
        }
        // apply
        for (const [nameLower, qty] of Array.from(useMap.entries())) {
          const ing = ingredients.find(i=> i.name.toLowerCase()===nameLower);
          if (!ing) continue;
          await updateDoc(doc(db,"inventory", ing.id), { stock: Math.max(0, (ing.stock||0) - qty) });
        }
      }

      printReceipt(payload, ref.id);
      clearCart();
      if(tab==="history") loadHistory(false);
      if(isOwner && tab==="dashboard") loadDashboard().catch(()=>{});

    }catch(err:any){
      alert("Transaksi gagal disimpan: "+(err?.message||err));
    }
  }

  /* ==========================
     HISTORY
  =========================== */
  async function loadHistory(append:boolean){
    if(!user) return;
    setHistoryLoading(true);
    try{
      const cons:any[] = [ where("outlet","==",OUTLET), orderBy("time","desc"), limit(50) ];
      if(append && histCursor) cons.push(startAfter(histCursor));
      const qh = query(collection(db,"sales"), ...cons);
      const snap = await getDocs(qh);
      const rows: Sale[] = snap.docs.map(d=>{
        const x = d.data() as any;
        return {
          id:d.id,
          outlet:x.outlet, shiftId:x.shiftId??null, cashierEmail:x.cashierEmail,
          customerPhone:x.customerPhone??null, customerName:x.customerName??null,
          time:x.time??null,
          items:x.items||[],
          subtotal:x.subtotal??0, discount:x.discount??0, tax:x.tax??0, service:x.service??0,
          total:x.total??0, payMethod:x.payMethod??"cash", cash:x.cash??0, change:x.change??0
        };
      });
      setHistoryRows(prev=> append? [...prev, ...rows] : rows);
      setHistCursor(snap.docs.length? snap.docs[snap.docs.length-1] : null);
    }catch(e:any){
      if(String(e?.message||"").includes("index")){
        alert("Riwayat butuh Firestore index.\nBuat index: sales → outlet(ASC), time(DESC)\n\n"+e.message);
      }else{
        alert("Gagal memuat riwayat: "+(e?.message||e));
      }
    }finally{ setHistoryLoading(false); }
  }
  async function deleteSale(id:string){
    if(!isOwner) return alert("Akses khusus owner.");
    if(!confirm("Hapus transaksi ini? Data tidak bisa dikembalikan.")) return;
    await deleteDoc(doc(db,"sales", id));
    setHistoryRows(rows=> rows.filter(r=> r.id!==id));
  }

  /* ==========================
     DASHBOARD OWNER
  =========================== */
  async function loadDashboard(){
    if(!isOwner) return;
    setDashLoading(true);
    try {
      // Hari ini
      const qToday = query(
        collection(db,"sales"),
        where("outlet","==",OUTLET),
        where("time", ">=", Timestamp.fromDate(startOfDay())),
        where("time", "<=", Timestamp.fromDate(endOfDay())),
        orderBy("time","desc")
      );
      const sToday = await getDocs(qToday);
      let omzet=0, trx=0, cashSum=0, ew=0, qr=0;
      const counter = new Map<string, number>();
      sToday.docs.forEach(d=>{
        const x = d.data() as any;
        omzet += x.total||0; trx += 1;
        if(x.payMethod==="cash") cashSum += x.total||0;
        if(x.payMethod==="ewallet") ew += x.total||0;
        if(x.payMethod==="qris") qr += x.total||0;
        (x.items||[]).forEach((it:any)=>{
          counter.set(it.name, (counter.get(it.name)||0) + (it.qty||0));
        });
      });
      const avg = trx? Math.round(omzet/trx) : 0;
      const topItems = Array.from(counter.entries())
        .map(([name,qty])=>({name,qty}))
        .sort((a,b)=>b.qty-a.qty)
        .slice(0,5);

      setTodayStats({ omzet, trx, avg, cash:cashSum, ewallet:ew, qris:qr, topItems });

      // 7 hari terakhir
      const from7 = startOfDay(daysAgo(6));
      const q7 = query(
        collection(db,"sales"),
        where("outlet","==",OUTLET),
        where("time", ">=", Timestamp.fromDate(from7)),
        where("time", "<=", Timestamp.fromDate(endOfDay())),
        orderBy("time","asc")
      );
      const s7 = await getDocs(q7);
      const bucket = new Map<string, {omzet:number; trx:number}>();
      for(let i=6;i>=0;i--){
        const d = startOfDay(daysAgo(i)); const key = d.toISOString().slice(0,10);
        bucket.set(key,{omzet:0,trx:0});
      }
      s7.docs.forEach(d=>{
        const x=d.data() as any;
        const key = new Date(x.time?.toDate?.() || Date.now()).toISOString().slice(0,10);
        if(!bucket.has(key)) bucket.set(key,{omzet:0,trx:0});
        const cur = bucket.get(key)!;
        cur.omzet += x.total||0; cur.trx += 1;
      });
      const arr = Array.from(bucket.entries()).map(([date,v])=>({date, ...v}));
      setLast7(arr);
    } finally {
      setDashLoading(false);
    }
  }

  /* ==========================
     OWNER: PRODUCTS / INVENTORY / RECIPES
  =========================== */
  async function upsertProduct(p: Partial<Product> & { id?: string }){
    if(!isOwner) return alert("Akses khusus owner.");
    const id = p.id || uid();
    await setDoc(doc(db,"products", id), {
      outlet: OUTLET, name: p.name||"Produk", price: Number(p.price)||0,
      category: p.category||"Signature", active: p.active!==false, imgUrl: p.imgUrl||""
    }, { merge:true });
  }
  async function deactivateProduct(id:string, to:boolean){
    if(!isOwner) return alert("Akses khusus owner.");
    await updateDoc(doc(db,"products", id), { active: to });
  }
  async function deleteProduct(id:string){
    if(!isOwner) return alert("Akses khusus owner.");
    if(!confirm("Sembunyikan produk ini (active=false)?")) return;
    await updateDoc(doc(db,"products", id), { active:false });
  }

  async function upsertIngredient(i: Partial<Ingredient> & { id?: string }){
    if(!isOwner) return alert("Akses khusus owner.");
    const id = i.id || uid();
    await setDoc(doc(db,"inventory", id), {
      outlet: OUTLET, name:i.name||"Bahan", unit:i.unit||"pcs",
      stock: Number(i.stock)||0, min: Number(i.min)||0
    }, { merge:true });
  }
  async function removeIngredient(id:string){
    if(!isOwner) return alert("Akses khusus owner.");
    if(!confirm("Hapus bahan ini?")) return;
    await deleteDoc(doc(db,"inventory", id));
  }

  async function saveRecipe(productId:string, items: Recipe["items"]){
    if(!isOwner) return alert("Akses khusus owner.");
    await setDoc(doc(db,"recipes", productId), {
      outlet: OUTLET, productId, items, updatedAt: serverTimestamp()
    });
  }

  /* ==========================
     UI
  =========================== */
  if(!user){
    return (
      <LoginScreen
        email={email} setEmail={setEmail}
        password={password} setPassword={setPassword}
        loading={authLoading} onSubmit={doLogin}
      />
    );
  }

  return (
    <div className="min-h-screen bg-neutral-50">
      {/* Topbar */}
      <header className="sticky top-0 z-30 bg-white/80 backdrop-blur border-b">
        <div className="max-w-7xl mx-auto px-3 sm:px-4 md:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src={LOGO_SRC} onError={(e)=>((e.target as HTMLImageElement).style.display='none')} className="h-8 w-8 rounded-xl object-contain" />
            <div>
              <div className="font-bold">NamiPOS — {OUTLET}</div>
              <div className="text-[11px] text-neutral-500">Masuk: {user.email}{isOwner?" · owner":" · staff"}</div>
            </div>
          </div>
          <nav className="flex gap-2">
            {isOwner && <Btn active={tab==="dashboard"} onClick={()=>{ setTab("dashboard"); loadDashboard(); }}>Dashboard</Btn>}
            <Btn active={tab==="pos"} onClick={()=>setTab("pos")}>Kasir</Btn>
            <Btn active={tab==="history"} onClick={()=>{ setTab("history"); loadHistory(false); }}>Riwayat</Btn>
            {isOwner && <Btn active={tab==="products"} onClick={()=>setTab("products")}>Produk</Btn>}
            {isOwner && <Btn active={tab==="inventory"} onClick={()=>setTab("inventory")}>Inventori</Btn>}
            {isOwner && <Btn active={tab==="recipes"} onClick={()=>setTab("recipes")}>Resep</Btn>}
            {isOwner && <Btn active={tab==="orders"} onClick={()=>setTab("orders")}>Pesanan</Btn>}
            <a className="px-3 py-1.5 rounded-lg border bg-emerald-50" href="/order" target="_blank" rel="noreferrer">Link</a>
            <button onClick={doLogout} className="px-3 py-1.5 rounded-lg border bg-rose-50">Keluar</button>
          </nav>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-3 sm:px-4 md:px-6 py-4">
        {/* Shift badge */}
        <ShiftPanel
          activeShift={activeShift}
          openCash={openCash}
          setOpenCash={setOpenCash}
          onOpen={openShiftAction}
          onClose={closeShiftAction}
        />

        {/* DASHBOARD */}
        {tab==="dashboard" && isOwner && <Dashboard todayStats={todayStats} last7={last7} loading={dashLoading} />}

        {/* POS */}
        {tab==="pos" && (
          <section className="grid grid-cols-1 md:grid-cols-12 gap-4">
            {/* Products */}
            <div className="md:col-span-7">
              <div className="bg-white rounded-2xl border p-3 mb-2">
                <input className="border rounded-lg px-3 py-2 w-full" placeholder="Cari menu…" value={queryText} onChange={e=>setQueryText(e.target.value)} />
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {filteredProducts.map(p=>(
                  <button key={p.id} onClick={()=>addToCart(p)} className="bg-white rounded-2xl border p-3 text-left hover:shadow">
                    <div className="h-20 rounded-xl bg-gradient-to-br from-emerald-50 to-emerald-100 mb-2 overflow-hidden">
                      {p.imgUrl ? <img src={p.imgUrl} className="w-full h-full object-cover" /> : null}
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
                          <button className="px-2 py-1 border rounded" onClick={()=>dec(ci.id)}>-</button>
                          <div className="w-8 text-center font-medium">{ci.qty}</div>
                          <button className="px-2 py-1 border rounded" onClick={()=>inc(ci.id)}>+</button>
                        </div>
                        <div className="col-span-1 text-right">
                          <button className="px-2 py-1 rounded border" onClick={()=>rm(ci.id)}>x</button>
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
                  <div className="flex items-center justify-between text-lg font-semibold">
                    <span>Total</span><span>{IDR(total)}</span>
                  </div>
                </div>

                {/* payment */}
                <div className="grid grid-cols-1 gap-2 mb-2">
                  <select className="border rounded-lg px-3 py-2" value={payMethod} onChange={e=>setPayMethod(e.target.value as any)}>
                    <option value="cash">Cash</option>
                    <option value="ewallet">eWallet / Transfer</option>
                    <option value="qris">QRIS Static</option>
                  </select>
                  {payMethod==="cash" && (
                    <div className="flex items-center gap-2">
                      <input type="number" className="border rounded-lg px-3 py-2 w-40" placeholder="Tunai diterima" value={cash} onChange={e=>setCash(Number(e.target.value)||0)} />
                      <div className="text-sm">Kembali: <b>{IDR(change)}</b></div>
                    </div>
                  )}
                  {(payMethod==="ewallet" || payMethod==="qris") && (
                    <div className="border rounded-xl p-2 bg-emerald-50">
                      <div className="text-sm mb-1">Scan untuk bayar:</div>
                      <img src={QRIS_IMG_SRC} alt="QRIS" className="w-40" onClick={()=>setShowQR(true)} />
                      <div className="text-xs text-neutral-500 mt-1">* Setelah sukses, tekan “Selesai & Cetak”.</div>
                    </div>
                  )}
                </div>

                {/* actions */}
                <div className="flex justify-between gap-2">
                  <button className="px-3 py-2 rounded-lg border" onClick={clearCart}>Bersihkan</button>
                  <div className="flex gap-2">
                    <button className="px-3 py-2 rounded-lg border" disabled={cart.length===0} onClick={()=>printReceipt({
                      outlet: OUTLET, shiftId: activeShift?.id||null, cashierEmail: user.email, customerPhone: customerPhone||null, customerName,
                      time: null, items: cart.map(i=>({ name:i.name, price:i.price, qty:i.qty, ...(i.note?{note:i.note}:{}) })),
                      subtotal, discount, tax: taxVal, service: svcVal, total, payMethod, cash, change
                    })}>Print Draf</button>
                    <button className="px-3 py-2 rounded-lg bg-emerald-600 text-white disabled:opacity-50" disabled={cart.length===0} onClick={finalize}>Selesai & Cetak</button>
                  </div>
                </div>

                {/* low stock alert */}
                <LowStockHint ingredients={ingredients} recipes={recipes} cart={cart} />
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
                <thead><tr className="text-left border-b">
                  <th className="py-2">Waktu</th><th>Kasir</th><th>Pelanggan</th><th>Item</th><th className="text-right">Total</th><th></th>
                </tr></thead>
                <tbody>
                  {historyRows.map(s=>(
                    <tr key={s.id} className="border-b hover:bg-emerald-50/40">
                      <td className="py-2">{s.time? new Date(s.time.toDate()).toLocaleString("id-ID",{hour12:false}) : "-"}</td>
                      <td>{s.cashierEmail}</td>
                      <td>{s.customerPhone || "-"}</td>
                      <td className="truncate">{s.items.map(i=>`${i.name}x${i.qty}`).join(", ")}</td>
                      <td className="text-right font-medium">{IDR(s.total)}</td>
                      <td className="text-right">{isOwner && <button className="px-2 py-1 text-rose-600" onClick={()=>s.id && deleteSale(s.id)}>Hapus</button>}</td>
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
              <button className="px-3 py-2 rounded-lg border" onClick={()=>upsertProduct({ name:"Produk Baru", price:10000, category:"Signature", active:true })}>+ Tambah</button>
            </div>
            <div className="overflow-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left border-b"><th>Nama</th><th>Kategori</th><th>Harga</th><th>Gambar</th><th className="text-right">Aksi</th></tr></thead>
                <tbody>
                  {products.map(p=>(
                    <tr key={p.id} className="border-b">
                      <td className="py-2">
                        <input className="border rounded px-2 py-1 w-44" defaultValue={p.name} onBlur={(e)=>upsertProduct({ id:p.id, name:e.currentTarget.value })} />
                      </td>
                      <td><input className="border rounded px-2 py-1 w-28" defaultValue={p.category||""} onBlur={(e)=>upsertProduct({ id:p.id, category:e.currentTarget.value })} /></td>
                      <td><input className="border rounded px-2 py-1 w-24 text-right" defaultValue={p.price} onBlur={(e)=>upsertProduct({ id:p.id, price:Number(e.currentTarget.value)||0 })} /></td>
                      <td><input className="border rounded px-2 py-1 w-56" placeholder="/img/file.jpg atau https://..." defaultValue={p.imgUrl||""} onBlur={(e)=>upsertProduct({ id:p.id, imgUrl:e.currentTarget.value })} /></td>
                      <td className="text-right">
                        <button className="px-2 py-1 border rounded mr-2" onClick={()=>deactivateProduct(p.id, !(p.active===false))}>{p.active===false? "Aktifkan":"Nonaktifkan"}</button>
                        <button className="px-2 py-1 border rounded" onClick={()=>deleteProduct(p.id)}>Sembunyikan</button>
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
              <button className="px-3 py-2 rounded-lg border" onClick={()=>upsertIngredient({ name:"Bahan Baru", unit:"pcs", stock:0, min:0 })}>+ Tambah</button>
            </div>
            <div className="overflow-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left border-b"><th>Nama</th><th>Satuan</th><th>Stok</th><th>Min</th><th className="text-right">Aksi</th></tr></thead>
                <tbody>
                  {ingredients.map(i=>(
                    <tr key={i.id} className="border-b">
                      <td className="py-2"><input className="border rounded px-2 py-1 w-40" defaultValue={i.name} onBlur={(e)=>upsertIngredient({ id:i.id, name:e.currentTarget.value })} /></td>
                      <td><input className="border rounded px-2 py-1 w-20" defaultValue={i.unit} onBlur={(e)=>upsertIngredient({ id:i.id, unit:e.currentTarget.value })} /></td>
                      <td><input type="number" className="border rounded px-2 py-1 w-24 text-right" defaultValue={i.stock} onBlur={(e)=>upsertIngredient({ id:i.id, stock:Number(e.currentTarget.value)||0 })} /></td>
                      <td><input type="number" className="border rounded px-2 py-1 w-20 text-right" defaultValue={i.min||0} onBlur={(e)=>upsertIngredient({ id:i.id, min:Number(e.currentTarget.value)||0 })} /></td>
                      <td className="text-right"><button className="px-2 py-1 text-rose-600" onClick={()=>removeIngredient(i.id)}>Hapus</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {ingredients.length===0 && <div className="text-sm text-neutral-500">Belum ada data inventori.</div>}
            </div>
          </section>
        )}

        {/* RECIPES */}
        {tab==="recipes" && isOwner && (
          <section className="bg-white rounded-2xl border p-3">
            <h2 className="text-lg font-semibold mb-3">Resep Produk</h2>
            <div className="grid md:grid-cols-2 gap-4">
              {products.filter(p=>p.active!==false).map(p=>{
                const rec = recipes[p.id]?.items || [];
                const [rows, setRows] = React.useState<{name:string; qty:number; unit:string}[]>(rec.length? [...rec]: [{name:"",qty:0,unit:""}]);
                // keep in sync if firestore updates
                useEffect(()=>{ setRows(rec.length? [...rec]: [{name:"",qty:0,unit:""}]); /* eslint-disable-next-line */}, [recipes[p.id]?.items?.length]);

                return (
                  <div key={p.id} className="border rounded-xl p-3">
                    <div className="font-medium mb-2">{p.name}</div>
                    <div className="space-y-2">
                      {rows.map((r,idx)=>(
                        <div key={idx} className="grid grid-cols-12 gap-2">
                          <div className="col-span-6">
                            <select className="border rounded px-2 py-1 w-full" value={r.name} onChange={(e)=>setRows(rs=> rs.map((v,i)=> i===idx? {...v, name:e.target.value } : v))}>
                              <option value="">— pilih bahan —</option>
                              {ingredients.map(ing=> <option key={ing.id} value={ing.name}>{ing.name}</option>)}
                            </select>
                          </div>
                          <div className="col-span-3"><input type="number" className="border rounded px-2 py-1 w-full" value={r.qty} onChange={(e)=>setRows(rs=> rs.map((v,i)=> i===idx? {...v, qty:Number(e.target.value)||0 } : v))} /></div>
                          <div className="col-span-2"><input className="border rounded px-2 py-1 w-full" value={r.unit} onChange={(e)=>setRows(rs=> rs.map((v,i)=> i===idx? {...v, unit:e.target.value } : v))} /></div>
                          <div className="col-span-1 text-right"><button className="px-2 py-1 border rounded" onClick={()=>setRows(rs=> rs.filter((_,i)=>i!==idx))}>Hapus</button></div>
                        </div>
                      ))}
                      <div className="flex justify-between">
                        <button className="px-3 py-1.5 border rounded" onClick={()=>setRows(rs=> [...rs, {name:"",qty:0,unit:""}])}>+ Tambah baris</button>
                        <button className="px-3 py-1.5 bg-emerald-600 text-white rounded" onClick={()=>saveRecipe(p.id, rows.filter(r=>r.name && r.qty>0 && r.unit))}>Simpan Resep</button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* ORDERS (ADMIN) */}
        {tab==="orders" && isOwner && (
          <section className="bg-white rounded-2xl border p-3">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-lg font-semibold">Pesanan Online</h2>
              <a className="px-3 py-1.5 rounded-lg border bg-emerald-50" href="/order" target="_blank" rel="noreferrer">Buka Halaman Publik</a>
            </div>
            <div className="overflow-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left border-b"><th>Waktu</th><th>Nama</th><th>HP</th><th>Alamat</th><th>Metode</th><th>Total</th><th>Status</th><th></th></tr></thead>
                <tbody>
                  {orders.map(o=>(
                    <tr key={o.id} className="border-b">
                      <td className="py-2">{o.createdAt? new Date(o.createdAt.toDate()).toLocaleString("id-ID",{hour12:false}) : "-"}</td>
                      <td>{o.name}</td>
                      <td>{o.phone}</td>
                      <td className="truncate max-w-[220px]">{o.address}</td>
                      <td>{o.payMethod.toUpperCase()}</td>
                      <td className="text-right">{IDR(o.total)}</td>
                      <td>{o.status}</td>
                      <td className="text-right">
                        <button className="px-2 py-1 border rounded mr-2" onClick={()=>o.id && updateDoc(doc(db,"orders",o.id), { status:"accepted" })}>Terima</button>
                        <button className="px-2 py-1 border rounded" onClick={()=>o.id && updateDoc(doc(db,"orders",o.id), { status:"rejected" })}>Tolak</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {orders.length===0 && <div className="text-sm text-neutral-500">Belum ada pesanan.</div>}
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
    </div>
  );
}

/* ==========================
   PUBLIC ORDER PAGE (no auth)
========================== */
function PublicOrderPage(){
  const [products, setProducts] = useState<Product[]>([]);
  const [queryText, setQueryText] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [distanceKm, setDistanceKm] = useState<number>(0);
  const [payMethod, setPayMethod] = useState<"cod"|"qris">("cod");

  useEffect(()=>{
    const qProd = query(collection(db,"products"), where("outlet","==",OUTLET), where("active","==",true));
    const unsub = onSnapshot(qProd, snap=>{
      const rows: Product[] = snap.docs.map(d=>({ id:d.id, ...(d.data() as any)}));
      setProducts(rows);
    }, err=>alert("Memuat produk gagal: "+(err.message||err)));
    return ()=>unsub();
  },[]);

  const filtered = products.filter(p=> p.name.toLowerCase().includes(queryText.toLowerCase()));
  const subtotal = cart.reduce((s,i)=> s + i.price*i.qty, 0);
  const deliveryFee = Math.round((distanceKm||0) * 2000); // contoh ongkir 2.000/km
  const total = subtotal + deliveryFee;

  function add(p:Product){ setCart(prev=>{
    const ex = prev.find(ci=>ci.productId===p.id);
    if(ex) return prev.map(ci=> ci===ex? {...ci, qty:ci.qty+1 } : ci);
    return [...prev, { id: uid(), productId:p.id, name:p.name, price:p.price, qty:1 }];
  });}
  const inc=(id:string)=> setCart(prev=> prev.map(ci=> ci.id===id? {...ci, qty:ci.qty+1 }:ci));
  const dec=(id:string)=> setCart(prev=> prev.map(ci=> ci.id===id? {...ci, qty:Math.max(1,ci.qty-1)}:ci));
  const rm =(id:string)=> setCart(prev=> prev.filter(ci=>ci.id!==id));
  const clear=()=> setCart([]);

  async function checkout(){
    if(!name || !phone || !address) return alert("Lengkapi nama/HP/alamat.");
    if(cart.length===0) return alert("Keranjang kosong.");

    const payload: PublicOrder = {
      outlet: OUTLET, name, phone, address, distanceKm,
      items: cart.map(i=> ({ name:i.name, price:i.price, qty:i.qty })),
      subtotal, discount:0, tax:0, service:0, total, payMethod, status:"pending", createdAt: serverTimestamp() as any
    };
    try{
      const ref = await addDoc(collection(db,"orders"), payload as any);
      alert("Pesanan terkirim! Kode: "+ref.id+"\nKasir akan menghubungi Anda.");
      clear(); setName(""); setPhone(""); setAddress(""); setDistanceKm(0); setPayMethod("cod");
    }catch(e:any){ alert("Gagal membuat pesanan: "+(e?.message||e)); }
  }

  return (
    <div className="min-h-screen bg-emerald-50">
      <div className="max-w-4xl mx-auto p-3">
        <h1 className="text-2xl font-bold mb-2">🧋 Pesan di {OUTLET}</h1>

        <div className="grid md:grid-cols-3 gap-4">
          {/* menu */}
          <div className="md:col-span-2">
            <input className="border rounded px-3 py-2 w-full mb-2" placeholder="Cari menu…" value={queryText} onChange={e=>setQueryText(e.target.value)} />
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {filtered.map(p=>(
                <button key={p.id} onClick={()=>add(p)} className="bg-white border rounded-xl p-3 text-left">
                  <div className="h-20 rounded-lg bg-white overflow-hidden mb-2">{p.imgUrl && <img src={p.imgUrl} className="w-full h-full object-cover" />}</div>
                  <div className="font-medium">{p.name}</div>
                  <div className="text-xs text-neutral-500">{p.category||"Signature"}</div>
                  <div className="font-semibold">{IDR(p.price)}</div>
                </button>
              ))}
            </div>
          </div>

          {/* cart */}
          <div className="md:col-span-1 bg-white border rounded-xl p-3">
            <div className="font-semibold mb-2">Keranjang</div>
            {cart.length===0? <div className="text-sm text-neutral-500">Belum ada item.</div> : (
              <div className="space-y-2">
                {cart.map(ci=>(
                  <div key={ci.id} className="grid grid-cols-12 items-center gap-2 border rounded p-2">
                    <div className="col-span-6">{ci.name}</div>
                    <div className="col-span-2 text-right text-sm">{IDR(ci.price)}</div>
                    <div className="col-span-3 flex items-center justify-end gap-2">
                      <button className="px-2 py-1 border rounded" onClick={()=>dec(ci.id)}>-</button>
                      <div className="w-8 text-center font-medium">{ci.qty}</div>
                      <button className="px-2 py-1 border rounded" onClick={()=>inc(ci.id)}>+</button>
                    </div>
                    <div className="col-span-1 text-right">
                      <button className="px-2 py-1 rounded border" onClick={()=>rm(ci.id)}>x</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="my-3 border-t pt-3 space-y-2">
              <div className="flex items-center justify-between text-sm"><span>Subtotal</span><span className="font-medium">{IDR(subtotal)}</span></div>
              <label className="flex items-center justify-between text-sm">
                <span>Jarak (km)</span>
                <input type="number" className="border rounded px-2 py-1 w-20 text-right" value={distanceKm} onChange={(e)=>setDistanceKm(Number(e.target.value)||0)} />
              </label>
              <div className="flex items-center justify-between text-sm"><span>Ongkir</span><span className="font-medium">{IDR(deliveryFee)}</span></div>
              <div className="flex items-center justify-between text-lg font-semibold"><span>Total</span><span>{IDR(total)}</span></div>
            </div>

            <div className="space-y-2">
              <input className="border rounded px-3 py-2 w-full" placeholder="Nama lengkap" value={name} onChange={e=>setName(e.target.value)} />
              <input className="border rounded px-3 py-2 w-full" placeholder="No HP (WA)" value={phone} onChange={e=>setPhone(e.target.value)} />
              <textarea className="border rounded px-3 py-2 w-full" placeholder="Alamat lengkap" value={address} onChange={e=>setAddress(e.target.value)} />
              <select className="border rounded px-3 py-2 w-full" value={payMethod} onChange={e=>setPayMethod(e.target.value as any)}>
                <option value="cod">Bayar di tempat (COD)</option>
                <option value="qris">QRIS Online</option>
              </select>
              <div className="flex justify-between">
                <button className="px-3 py-2 border rounded" onClick={clear}>Bersihkan</button>
                <button className="px-3 py-2 bg-emerald-600 text-white rounded" onClick={checkout}>Kirim Pesanan</button>
              </div>
              <div className="text-[11px] text-neutral-500">Dengan mengirim pesanan, Anda menyetujui pemrosesan data untuk keperluan pengantaran.</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ===== Small UI helpers ===== */
function Btn({active, onClick, children}:{active?:boolean; onClick:()=>void; children:React.ReactNode}) {
  return <button onClick={onClick} className={`px-3 py-1.5 rounded-lg border ${active?"bg-emerald-50 border-emerald-200":"bg-white"}`}>{children}</button>;
}
function LoginScreen({email,setEmail,password,setPassword,loading,onSubmit}:{email:string;setEmail:(v:string)=>void;password:string;setPassword:(v:string)=>void;loading:boolean;onSubmit:(e?:React.FormEvent)=>void;}){
  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 to-white flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-6 border">
        <div className="flex items-center gap-3 mb-4">
          <img src={LOGO_SRC} className="h-10 w-10 rounded-2xl object-contain" onError={(e)=>((e.target as HTMLImageElement).style.display='none')}/>
          <div>
            <h1 className="text-2xl font-bold">NamiPOS — POS</h1>
            <p className="text-xs text-neutral-500">@{OUTLET}</p>
          </div>
        </div>
        <form onSubmit={onSubmit} className="space-y-3">
          <input className="w-full border rounded-lg p-3" placeholder="Email" value={email} onChange={e=>setEmail(e.target.value)} />
          <input className="w-full border rounded-lg p-3" type="password" placeholder="Password" value={password} onChange={e=>setPassword(e.target.value)} />
          <button disabled={loading} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg p-3">{loading?"Masuk...":"Masuk"}</button>
        </form>
        <p className="text-xs text-neutral-500 mt-3">Hanya staf & owner yang diizinkan.</p>
      </div>
    </div>
  );
}
function ShiftPanel({activeShift,openCash,setOpenCash,onOpen,onClose}:{activeShift:Shift|null;openCash:number;setOpenCash:(n:number)=>void;onOpen:()=>void;onClose:()=>void;}){
  return (
    <div className="mb-3">
      <div className="inline-flex items-center gap-2 text-xs px-3 py-1 rounded-full border bg-white">
        {activeShift?.isOpen
          ? <>Shift <b>OPEN</b> • {new Date(activeShift.openAt?.toDate?.() || new Date()).toLocaleTimeString("id-ID",{hour12:false})} • {activeShift.openBy}</>
          : <>Belum ada shift aktif</>}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {!activeShift?.isOpen ? (
          <>
            <input type="number" className="border rounded-lg px-3 py-2 w-40" placeholder="Kas awal (Rp)" value={openCash} onChange={e=>setOpenCash(Number(e.target.value)||0)} />
            <button className="px-3 py-2 rounded-lg bg-emerald-600 text-white" onClick={onOpen}>Buka Shift</button>
          </>
        ) : (
          <button className="px-3 py-2 rounded-lg bg-rose-600 text-white" onClick={onClose}>Tutup Shift</button>
        )}
      </div>
    </div>
  );
}
function Dashboard({todayStats,last7,loading}:{todayStats:any;last7:any[];loading:boolean}){
  const maxOmzet = Math.max(1, ...last7.map(x=>x.omzet));
  return (
    <section className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <KPI title="Omzet Hari Ini" value={IDR(todayStats.omzet)} />
        <KPI title="Transaksi" value={String(todayStats.trx)} />
        <KPI title="Avg Ticket" value={IDR(todayStats.avg)} />
        <KPI title="Cash" value={IDR(todayStats.cash)} />
        <KPI title="eWallet/QRIS" value={IDR(todayStats.ewallet + todayStats.qris)} />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white border rounded-2xl p-4">
          <div className="font-semibold mb-2">5 Menu Terlaris (Hari Ini)</div>
          <table className="w-full text-sm">
            <thead><tr className="border-b text-left"><th className="py-2">Menu</th><th className="text-right">Qty</th></tr></thead>
            <tbody>
              {todayStats.topItems.length===0 && <tr><td className="py-2 text-neutral-500" colSpan={2}>Belum ada data.</td></tr>}
              {todayStats.topItems.map((t:any,i:number)=>(
                <tr key={i} className="border-b"><td className="py-2">{t.name}</td><td className="text-right">{t.qty}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="bg-white border rounded-2xl p-4">
          <div className="font-semibold mb-2">7 Hari Terakhir</div>
          <div className="space-y-1">
            {loading && <div className="text-sm text-neutral-500">Memuat…</div>}
            {!loading && last7.map((d)=>(
              <div key={d.date} className="flex items-center gap-3">
                <div className="w-24 text-xs text-neutral-600">{d.date}</div>
                <div className="flex-1 h-2 rounded bg-neutral-100 overflow-hidden">
                  <div className="h-2 rounded bg-emerald-500" style={{width: `${Math.min(100, (d.omzet / maxOmzet) * 100)}%`}} />
                </div>
                <div className="w-28 text-right text-xs">{IDR(d.omzet)}</div>
                <div className="w-10 text-right text-xs">{d.trx}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
function KPI({title, value}:{title:string; value:string}) {
  return (
    <div className="bg-white border rounded-2xl p-4">
      <div className="text-[12px] text-neutral-500">{title}</div>
      <div className="text-xl font-bold mt-1">{value}</div>
    </div>
  );
}
function LowStockHint({ingredients,recipes,cart}:{ingredients:Ingredient[];recipes:Record<string,Recipe>;cart:CartItem[];}){
  // kalkulasi kebutuhan dari cart dan bandingkan stok-min
  const needMap = new Map<string, number>();
  cart.forEach(ci=>{
    const rec = recipes[ci.productId];
    (rec?.items||[]).forEach(r=>{
      const key = r.name.toLowerCase();
      needMap.set(key, (needMap.get(key)||0) + (r.qty*ci.qty));
    });
  });
  const warnings = ingredients.filter(ing=>{
    const need = needMap.get(ing.name.toLowerCase()) || 0;
    return (ing.stock - need) <= (ing.min||0);
  });
  if(warnings.length===0) return null;
  return (
    <div className="mt-3 p-2 rounded-lg bg-amber-50 border border-amber-200 text-[12px]">
      <div className="font-semibold mb-1">Peringatan Stok Menipis (setelah transaksi ini):</div>
      {warnings.map(w=> <div key={w.id}>• {w.name}: sisa ± {Math.max(0, (w.stock - (needMap.get(w.name.toLowerCase())||0)))} {w.unit} (min {w.min})</div>)}
    </div>
  );
}

/* =========================================================
   Firestore Index hints (buat jika ada error 'requires an index'):
   - sales: outlet(ASC), time(DESC)
   - shifts: outlet(ASC), isOpen(ASC), openAt(DESC)
   - orders: outlet(ASC), createdAt(DESC)
   (Bisa klik link otomatis saat error popup muncul di console)
========================================================= */