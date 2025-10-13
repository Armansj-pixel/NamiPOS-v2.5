import React, { useEffect, useMemo, useState } from "react";
import {
  addDoc, collection, deleteDoc, doc, getDoc, getDocs, limit, onSnapshot,
  orderBy, query, serverTimestamp, setDoc, startAfter, Timestamp,
  updateDoc, where
} from "firebase/firestore";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { auth, db } from "./lib/firebase";

/* ===========================================
   KONFIGURASI APLIKASI
=========================================== */
const APP_NAME = "NamiPOS";
const OUTLET   = "MTHaryono";
const OWNER_EMAILS = new Set([
  "antonius.arman123@gmail.com",
  "ayuismaalabibbah@gmail.com",
]);
const LOGO_SRC = "/logo.png";  // letakkan di public/logo.png
const QRIS_IMG = "/qris.png";  // letakkan di public/qris.png

/* ===========================================
   TIPE DATA
=========================================== */
type Product = { id: string; name: string; price: number; category?: string; active?: boolean; outlet?: string };
type Ingredient = { id: string; name: string; unit: string; stock: number; min?: number; outlet?: string };
type RecipeItem = { ingredientId: string; qty: number };
type CartItem = { id: string; productId: string; name: string; price: number; qty: number; note?: string };
type Shift = { id: string; outlet: string; openBy: string; openAt: Timestamp; closeAt?: Timestamp|null; openCash?: number; isOpen: boolean };

type Sale = {
  id?: string;
  outlet: string;
  shiftId: string|null;
  cashierEmail: string;
  customerPhone: string|null;
  customerName?: string|null;
  time: Timestamp|null;
  items: { name: string; price: number; qty: number; note?: string }[];
  subtotal: number; discount: number; tax: number; service: number; total: number;
  payMethod: "cash"|"ewallet"|"qris";
  cash?: number; change?: number;
};

/* ===========================================
   UTIL
=========================================== */
const uid = ()=> Math.random().toString(36).slice(2,10);
const IDR = (n:number)=> new Intl.NumberFormat("id-ID", { style:"currency", currency:"IDR", maximumFractionDigits:0 }).format(n||0);
const todayKey = (d=new Date()) => d.toISOString().slice(0,10);
const startOfDay = (d = new Date()) => { const x = new Date(d); x.setHours(0,0,0,0); return x; };
const endOfDay   = (d = new Date()) => { const x = new Date(d); x.setHours(23,59,59,999); return x; };
const daysAgo = (n:number)=>{ const x=new Date(); x.setDate(x.getDate()-n); return x; };

/* ===========================================
   APLIKASI
=========================================== */
export default function App(){
  /* ---- route sederhana: /order = halaman pelanggan ---- */
  const [route, setRoute] = useState<"order"|"app">(location.pathname.startsWith("/order") ? "order" : "app");
  useEffect(()=>{
    const onPop = ()=> setRoute(location.pathname.startsWith("/order") ? "order":"app");
    window.addEventListener("popstate", onPop);
    return ()=> window.removeEventListener("popstate", onPop);
  }, []);
  if(route==="order") return <CustomerOrderPage />;

  /* ---- auth ---- */
  const [user, setUser] = useState<null | { email: string }>(null);
  const isOwner = !!(user?.email && OWNER_EMAILS.has(user.email));

  /* ---- tabs ---- */
  const [tab, setTab] = useState<"dashboard"|"pos"|"history"|"products"|"inventory"|"orders">("pos");

  /* ---- login form ---- */
  const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [authLoading, setAuthLoading] = useState(false);

  /* ---- master ---- */
  const [products, setProducts] = useState<Product[]>([]);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [recipes, setRecipes] = useState<Record<string, RecipeItem[]>>({}); // productId -> items

  /* ---- POS state ---- */
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

  /* ---- V2.4 orders ---- */
  const [incomingOrders, setIncomingOrders] = useState<any[]>([]); // public_orders
  const [incomingLoading, setIncomingLoading] = useState(false);

  /* ---- computed ---- */
  const filteredProducts = useMemo(()=> products.filter(p=>(p.active!==false) && p.name.toLowerCase().includes(queryText.toLowerCase())), [products, queryText]);
  const subtotal = useMemo(()=> cart.reduce((s,i)=> s + i.price*i.qty, 0), [cart]);
  const taxVal = Math.round(subtotal * (taxPct/100));
  const svcVal = Math.round(subtotal * (svcPct/100));
  const total = Math.max(0, subtotal + taxVal + svcVal - (discount||0));
  const change = Math.max(0, (cash||0) - total);

  /* ===========================================
     AUTH WATCH
  =========================================== */
  useEffect(()=>{
    const unsub = onAuthStateChanged(auth, u => setUser(u?.email? {email:u.email} : null));
    return ()=>unsub();
  }, []);

  /* ===========================================
     LOAD DATA AFTER LOGIN
  =========================================== */
  useEffect(()=>{
    if(!user) return;

    // products
    const qProd = query(collection(db,"products"), where("outlet","==",OUTLET));
    const unsubProd = onSnapshot(qProd, snap=>{
      setProducts(snap.docs.map(d=>({ id:d.id, ...(d.data() as any) })));
    });

    // ingredients
    const qIng = query(collection(db,"ingredients"), where("outlet","==",OUTLET));
    const unsubIng = onSnapshot(qIng, snap=>{
      setIngredients(snap.docs.map(d=>({ id:d.id, ...(d.data() as any) })));
    });

    // recipes (cache ringan, on demand saat open Products tab juga boleh)
    const unsubRec = onSnapshot(collection(db,"recipes"), (snap)=>{
      const m: Record<string, RecipeItem[]> = {};
      snap.docs.forEach(d=>{
        const x = d.data() as any;
        if(x.productId && Array.isArray(x.items)) m[x.productId] = x.items;
      });
      setRecipes(m);
    });

    // active shift
    checkActiveShift().catch(()=>{});

    // dashboard awal
    loadDashboard().catch(()=>{});

    // incoming public orders (V2.4)
    const qOrders = query(collection(db,"public_orders"), where("outlet","==",OUTLET), orderBy("time","desc"), limit(50));
    const unsubOrders = onSnapshot(qOrders, (snap)=>{
      setIncomingOrders(snap.docs.map(d=>({ id:d.id, ...(d.data() as any) })));
    });

    return ()=>{ unsubProd(); unsubIng(); unsubRec(); unsubOrders(); };
    // eslint-disable-next-line
  }, [user?.email]);

  /* ===========================================
     AUTH handlers
  =========================================== */
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

  /* ===========================================
     SHIFT
  =========================================== */
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
    const d = snap.docs[0]; const x = d.data() as any;
    setActiveShift({ id:d.id, outlet:x.outlet, openBy:x.openBy, openAt:x.openAt, closeAt:x.closeAt??null, openCash:x.openCash??0, isOpen:true });
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
    if(!activeShift?.id) return alert("Belum ada shift aktif.");

    // 1) tutup shift
    await updateDoc(doc(db,"shifts", activeShift.id), { isOpen:false, closeAt: serverTimestamp() });

    // 2) rekap harian otomatis
    await makeDailyReport(activeShift.id);

    setActiveShift(null);
    alert("Shift ditutup & rekap harian tersimpan.");
    await loadDashboard();
  }

  async function makeDailyReport(shiftId: string){
    // tarik semua penjualan hari ini di outlet & shift tsb
    const qSales = query(
      collection(db,"sales"),
      where("outlet","==",OUTLET),
      where("shiftId","==",shiftId),
      where("time", ">=", Timestamp.fromDate(startOfDay())),
      where("time", "<=", Timestamp.fromDate(endOfDay()))
    );
    const snap = await getDocs(qSales);
    let omzet=0, trx=0, cashSum=0, ewallet=0, qris=0;
    const counter = new Map<string,number>();
    snap.docs.forEach(d=>{
      const x = d.data() as any;
      const t = x.total||0;
      omzet += t; trx += 1;
      if(x.payMethod==="cash") cashSum+=t;
      if(x.payMethod==="ewallet") ewallet+=t;
      if(x.payMethod==="qris") qris+=t;
      (x.items||[]).forEach((it:any) => counter.set(it.name, (counter.get(it.name)||0)+(it.qty||0)));
    });
    const avg = trx? Math.round(omzet/trx) : 0;
    const topItems = Array.from(counter.entries())
      .map(([name,qty])=>({name, qty}))
      .sort((a,b)=> b.qty-a.qty)
      .slice(0,10);

    const docId = `${todayKey()}_${OUTLET}`;
    await setDoc(doc(db,"daily_reports", docId), {
      outlet: OUTLET, date: todayKey(), shiftId, omzet, trx, avg, cash:cashSum, ewallet, qris, topItems, updatedAt: serverTimestamp()
    }, { merge:true });
  }

  /* ===========================================
     POS
  =========================================== */
  function addToCart(p: Product){
    setCart(prev=>{
      const same = prev.find(ci=> ci.productId===p.id && (ci.note||"")===(noteInput||""));
      if(same) return prev.map(ci=> ci===same ? {...ci, qty:ci.qty+1} : ci );
      return [...prev, { id: uid(), productId:p.id, name:p.name, price:p.price, qty:1, note: noteInput||undefined }];
    });
  }
  const inc = (id:string)=> setCart(prev=> prev.map(ci=> ci.id===id? {...ci, qty:ci.qty+1} : ci));
  const dec = (id:string)=> setCart(prev=> prev.map(ci=> ci.id===id? {...ci, qty:Math.max(1, ci.qty-1)} : ci));
  const rm  = (id:string)=> setCart(prev=> prev.filter(ci=> ci.id!==id));
  const clearCart = ()=> { setCart([]); setDiscount(0); setTaxPct(0); setSvcPct(0); setPayMethod("cash"); setCash(0); setNoteInput(""); setCustomerPhone(""); setCustomerName(""); setCustomerPoints(null); };

  // loyalty lookup
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

  // print 80mm
  function printReceipt(rec: Omit<Sale,"id">, saleId?: string, orderIndexToday?: number){
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
img.qr{display:block;margin:8px auto 0;height:120px}
</style></head><body>
<div class="wrap">
  <img src="${LOGO_SRC}" class="logo" onerror="this.style.display='none'"/>
  <h2>${APP_NAME} — ${OUTLET}</h2>
  <div class="meta">${saleId||"DRAFT"} ${orderIndexToday?`<br/>Pesanan ke-${orderIndexToday} (hari ini)`:''}<br/>${new Date().toLocaleString("id-ID",{hour12:false})}</div>
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
  ${rec.payMethod!=="cash" ? `<img class="qr" src="${QRIS_IMG}" onerror="this.style.display='none'"/>` : ""}
  ${rec.customerPhone ? `<div class="meta" style="margin-top:8px">Member: ${rec.customerPhone}</div>`:""}
  <p class="meta">Terima kasih!</p>
</div>
<script>window.print();</script>
</body></html>`;
    w.document.write(html); w.document.close();
  }

  async function nextOrderIndexForToday(): Promise<number> {
    const qx = query(
      collection(db,"sales"),
      where("outlet","==",OUTLET),
      where("time", ">=", Timestamp.fromDate(startOfDay())),
      where("time", "<=", Timestamp.fromDate(endOfDay()))
    );
    const s = await getDocs(qx);
    return s.size + 1;
  }

  async function deductStockByRecipes(items: {productId?:string; qty:number}[]) {
    // kurangi stok sesuai resep (jika ada)
    const updates: Record<string, number> = {}; // ingredientId -> delta(-)
    for(const it of items){
      const rid = it.productId || "";
      const r = recipes[rid];
      if(!r) continue;
      r.forEach((ri)=> {
        updates[ri.ingredientId] = (updates[ri.ingredientId]||0) - (ri.qty * it.qty);
      });
    }
    const ent = Object.entries(updates);
    for(const [ingId, delta] of ent){
      const ref = doc(db,"ingredients", ingId);
      const snap = await getDoc(ref);
      if(snap.exists()){
        const cur = (snap.data() as any).stock || 0;
        await updateDoc(ref, { stock: Math.max(0, cur + delta) });
      }
    }
  }

  async function finalize(){
    if(!user?.email) return alert("Belum login.");
    if(!activeShift?.id) return alert("Buka shift dahulu.");
    if(cart.length===0) return alert("Keranjang kosong.");
    if(payMethod==="cash" && cash<total) return alert("Uang tunai kurang.");

    const orderIndex = await nextOrderIndexForToday();

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
        const pts = Math.floor(total/10000); // 10rb = 1 poin
        if(s.exists()){
          const c = s.data() as any;
          await updateDoc(cref, { points:(c.points||0)+pts, name: customerName||c.name||"", lastVisit: serverTimestamp() });
        }else{
          await setDoc(cref, { phone: customerPhone.trim(), name: customerName||"Member", points: pts, lastVisit: serverTimestamp() });
        }
      }

      // inventory deduct
      await deductStockByRecipes(cart.map(ci=>({productId: ci.productId, qty: ci.qty})));

      printReceipt(payload, ref.id, orderIndex);
      clearCart();
      if(tab==="history") loadHistory(false);
      if(isOwner && tab==="dashboard") loadDashboard().catch(()=>{});

    }catch(err:any){
      alert("Transaksi gagal disimpan: "+(err?.message||err));
    }
  }

  /* ===========================================
     HISTORY
  =========================================== */
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
        alert("Riwayat butuh Firestore index: sales → outlet(ASC), time(DESC)");
      }else{
        alert("Gagal memuat riwayat: "+(e?.message||e));
      }
    }finally{ setHistoryLoading(false); }
  }

  async function deleteSale(saleId: string) {
    if (!isOwner) return alert("Fitur ini khusus owner.");
    const ok = confirm("Hapus transaksi ini secara permanen? Tidak bisa dibatalkan.");
    if (!ok) return;
    try {
      await deleteDoc(doc(db, "sales", saleId));
      await loadHistory(false);
      alert("Transaksi dihapus.");
    } catch (e: any) {
      alert("Gagal menghapus: " + (e?.message || e));
    }
  }

  /* ===========================================
     DASHBOARD OWNER
  =========================================== */
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

      // 7 hari
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

  /* ===========================================
     OWNER: PRODUCTS, INVENTORY & RECIPES
  =========================================== */
  async function upsertProduct(p: Partial<Product> & { id?: string }){
    if(!isOwner) return alert("Akses khusus owner.");
    const id = p.id || uid();
    await setDoc(doc(db,"products", id), {
      outlet: OUTLET, name: p.name||"Produk", price: Number(p.price)||0,
      category: p.category||"Signature", active: p.active!==false
    }, { merge:true });
  }
  async function deactivateProduct(id:string){
    if(!isOwner) return alert("Akses khusus owner.");
    await updateDoc(doc(db,"products", id), { active:false });
  }
  async function deleteIngredient(id:string){
    if(!isOwner) return alert("Akses khusus owner.");
    await deleteDoc(doc(db,"ingredients", id));
  }
  async function upsertIngredient(i: Partial<Ingredient> & { id?: string }){
    if(!isOwner) return alert("Akses khusus owner.");
    const id = i.id || uid();
    await setDoc(doc(db,"ingredients", id), {
      outlet: OUTLET, name:i.name||"Bahan", unit:i.unit||"pcs",
      stock: Number(i.stock)||0, min: Number(i.min)||0
    }, { merge:true });
  }
  async function setRecipe(productId: string, items: RecipeItem[]){
    if(!isOwner) return alert("Akses khusus owner.");
    await setDoc(doc(db,"recipes", productId), { productId, items }, { merge:true });
  }

  /* ===========================================
     V2.4: PESANAN MASUK (PUBLIC ORDERS)
  =========================================== */
  function formatPhone(p: string){ return p.replace(/[^\d+]/g,""); }
  async function acceptOrder(orderId:string){
    await updateDoc(doc(db,"public_orders", orderId), { status: "processing" });
  }
  async function completeOrder(orderId:string){
    await updateDoc(doc(db,"public_orders", orderId), { status: "ready" });
  }
  async function pushToDelivery(order:any){
    const id = `DLV-${Date.now()}`;
    await setDoc(doc(db,"deliveries", id), {
      outlet: OUTLET,
      orderId: order.id,
      customerName: order.name,
      phone: order.phone,
      address: order.address,
      notes: order.notes||"",
      total: order.total||0,
      time: serverTimestamp(),
      status: "dispatch"
    });
    await updateDoc(doc(db,"public_orders", order.id), { status: "dispatch" });
  }

  /* ===========================================
     UI - LOGIN
  =========================================== */
  if(!user){
    return (
      <div className="min-h-screen bg-gradient-to-br from-emerald-50 to-white flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-6 border">
          <div className="flex items-center gap-3 mb-4">
            <img src={LOGO_SRC} onError={(e)=>((e.target as HTMLImageElement).style.display="none")} className="h-10 w-10 rounded-2xl" />
            <div>
              <h1 className="text-2xl font-bold">{APP_NAME} — POS</h1>
              <p className="text-xs text-neutral-500">@{OUTLET}</p>
            </div>
          </div>
          <form onSubmit={doLogin} className="space-y-3">
            <input className="w-full border rounded-lg p-3" placeholder="Email" value={email} onChange={e=>setEmail(e.target.value)} />
            <input className="w-full border rounded-lg p-3" type="password" placeholder="Password" value={password} onChange={e=>setPassword(e.target.value)} />
            <button disabled={authLoading} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg p-3">{authLoading?"Masuk...":"Masuk"}</button>
          </form>
          <p className="text-xs text-neutral-500 mt-3">Hanya staf & owner yang diizinkan.</p>
        </div>
      </div>
    );
  }

  /* ===========================================
     UI - APP SHELL
  =========================================== */
  return (
    <div className="min-h-screen bg-neutral-50">
      {/* Topbar */}
      <header className="sticky top-0 z-30 bg-white/80 backdrop-blur border-b">
        <div className="max-w-7xl mx-auto px-3 sm:px-4 md:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src={LOGO_SRC} onError={(e)=>((e.target as HTMLImageElement).style.display="none")} className="h-8 w-8 rounded-xl" />
            <div>
              <div className="font-bold">{APP_NAME} — {OUTLET}</div>
              <div className="text-[11px] text-neutral-500">Masuk: {user.email}{isOwner?" · owner":" · staff"}</div>
            </div>
          </div>
          <nav className="flex gap-2">
            {isOwner && <button onClick={()=>{ setTab("dashboard"); loadDashboard(); }} className={`px-3 py-1.5 rounded-lg border ${tab==="dashboard"?"bg-emerald-50 border-emerald-200":"bg-white"}`}>Dashboard</button>}
            <button onClick={()=>setTab("pos")} className={`px-3 py-1.5 rounded-lg border ${tab==="pos"?"bg-emerald-50 border-emerald-200":"bg-white"}`}>Kasir</button>
            <button onClick={()=>{ setTab("history"); loadHistory(false); }} className={`px-3 py-1.5 rounded-lg border ${tab==="history"?"bg-emerald-50 border-emerald-200":"bg-white"}`}>Riwayat</button>
            {isOwner && <button onClick={()=>setTab("products")} className={`px-3 py-1.5 rounded-lg border ${tab==="products"?"bg-emerald-50 border-emerald-200":"bg-white"}`}>Produk</button>}
            {isOwner && <button onClick={()=>setTab("inventory")} className={`px-3 py-1.5 rounded-lg border ${tab==="inventory"?"bg-emerald-50 border-emerald-200":"bg-white"}`}>Inventori</button>}
            <button onClick={()=>setTab("orders")} className={`px-3 py-1.5 rounded-lg border ${tab==="orders"?"bg-emerald-50 border-emerald-200":"bg-white"}`}>Pesanan</button>
            <button onClick={doLogout} className="px-3 py-1.5 rounded-lg border bg-rose-50">Keluar</button>
          </nav>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-3 sm:px-4 md:px-6 py-4">
        {/* Shift bar */}
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
                <button className="px-3 py-2 rounded-lg bg-emerald-600 text-white" onClick={openShiftAction}>Buka Shift</button>
              </>
            ) : (
              <button className="px-3 py-2 rounded-lg bg-rose-600 text-white" onClick={closeShiftAction}>Tutup Shift</button>
            )}
          </div>
        </div>

        {/* DASHBOARD */}
        {tab==="dashboard" && isOwner && (
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
                    {todayStats.topItems.map((t,i)=>(
                      <tr key={i} className="border-b"><td className="py-2">{t.name}</td><td className="text-right">{t.qty}</td></tr>
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
                        <div className="h-2 rounded bg-emerald-500" style={{width: `${Math.min(100, (d.omzet / Math.max(1, Math.max(...last7.map(x=>x.omzet))))) * 100}%`}} />
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
                <input className="border rounded-lg px-3 py-2 w-full" placeholder="Cari menu…" value={queryText} onChange={e=>setQueryText(e.target.value)} />
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {filteredProducts.map(p=>(
                  <button key={p.id} onClick={()=>addToCart(p)} className="bg-white rounded-2xl border p-3 text-left hover:shadow">
                    <div className="h-20 rounded-xl bg-gradient-to-br from-emerald-50 to-emerald-100 mb-2" />
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
                    <option value="ewallet">eWallet / QRIS</option>
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
                      <img src={QRIS_IMG} alt="QRIS" className="w-40" onClick={()=>setShowQR(true)} />
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
                    {isOwner && <th className="text-right">Aksi</th>}
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
                      {isOwner && (
                        <td className="text-right">
                          <button className="px-2 py-1 rounded border text-rose-600 hover:bg-rose-50" onClick={()=> s.id && deleteSale(s.id)}>Hapus</button>
                        </td>
                      )}
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
                <thead><tr className="text-left border-b"><th>Nama</th><th>Kategori</th><th className="text-right">Harga</th><th className="text-right">Aksi</th></tr></thead>
                <tbody>
                  {products.map(p=>(
                    <tr key={p.id} className="border-b">
                      <td className="py-2">{p.name}</td>
                      <td>{p.category||"-"}</td>
                      <td className="text-right">{IDR(p.price)}</td>
                      <td className="text-right">
                        <button className="px-2 py-1 border rounded mr-2" onClick={()=>upsertProduct({ id:p.id, name:prompt("Nama?", p.name)||p.name, price:Number(prompt("Harga?", String(p.price))||p.price), category:prompt("Kategori?", p.category||"Signature")||p.category, active:p.active })}>Edit</button>
                        <button className="px-2 py-1 border rounded" onClick={()=>deactivateProduct(p.id)}>Nonaktifkan</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {products.length===0 && <div className="text-sm text-neutral-500">Belum ada produk.</div>}
            </div>
          </section>
        )}

        {/* INVENTORY & RECIPES */}
        {tab==="inventory" && isOwner && (
          <section className="bg-white rounded-2xl border p-3 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Inventori</h2>
              <button className="px-3 py-2 rounded-lg border" onClick={()=>upsertIngredient({ name:"Bahan Baru", unit:"pcs", stock:0, min:0 })}>+ Tambah</button>
            </div>
            <div className="overflow-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left border-b"><th>Nama</th><th>Satuan</th><th className="text-right">Stok</th><th className="text-right">Min</th><th className="text-right">Aksi</th></tr></thead>
                <tbody>
                  {ingredients.map(i=>(
                    <tr key={i.id} className="border-b">
                      <td className="py-2">{i.name}</td>
                      <td>{i.unit}</td>
                      <td className="text-right">{i.stock}</td>
                      <td className="text-right">{i.min||0}</td>
                      <td className="text-right">
                        <button className="px-2 py-1 border rounded mr-2" onClick={()=>upsertIngredient({
                          id:i.id,
                          name: prompt("Nama bahan?", i.name) || i.name,
                          unit: prompt("Satuan?", i.unit) || i.unit,
                          stock: Number(prompt("Stok?", String(i.stock)) || i.stock),
                          min: Number(prompt("Min?", String(i.min||0)) || (i.min||0)),
                        })}>Edit</button>
                        <button className="px-2 py-1 border rounded text-rose-600" onClick={()=>deleteIngredient(i.id)}>Hapus</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {ingredients.length===0 && <div className="text-sm text-neutral-500">Belum ada data inventori.</div>}
            </div>

            <div className="border-t pt-3">
              <h3 className="font-semibold mb-2">Resep per Produk</h3>
              <div className="overflow-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-left border-b"><th>Produk</th><th>Resep (ingredient x qty)</th><th className="text-right">Aksi</th></tr></thead>
                  <tbody>
                    {products.map(p=>{
                      const r = recipes[p.id] || [];
                      return (
                        <tr key={p.id} className="border-b">
                          <td className="py-2">{p.name}</td>
                          <td>
                            {r.length===0 ? <span className="text-neutral-500">Belum ada</span>
                              : r.map((ri,idx)=>{
                                  const ing = ingredients.find(x=>x.id===ri.ingredientId);
                                  return <span key={idx} className="mr-2 inline-block">{ing?ing.name:ri.ingredientId} x {ri.qty}</span>
                                })}
                          </td>
                          <td className="text-right">
                            <button className="px-2 py-1 border rounded" onClick={async ()=>{
                              // editor sederhana via prompt: masukkan "ingredientId:qty,ingredientId:qty"
                              const raw = prompt(`Resep untuk ${p.name}\nFormat: ingredientId:qty,ingredientId:qty`, r.map(x=>`${x.ingredientId}:${x.qty}`).join(","));
                              if(raw==null) return;
                              const items = raw.split(",").map(s=>s.trim()).filter(Boolean).map(pair=>{
                                const [id, q] = pair.split(":").map(z=>z.trim());
                                return { ingredientId:id, qty:Number(q)||0 };
                              }).filter(x=>x.ingredientId && x.qty>0);
                              await setRecipe(p.id, items);
                            }}>Atur Resep</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}

        {/* V2.4: PESANAN MASUK */}
        {tab==="orders" && (
          <section className="bg-white rounded-2xl border p-3">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-lg font-semibold">Pesanan Masuk (Online)</h2>
              <button className="px-3 py-2 rounded-lg border" onClick={()=>setIncomingLoading(!incomingLoading)} disabled>Realtime</button>
            </div>
            <div className="overflow-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left border-b">
                  <th>Waktu</th><th>Nama</th><th>HP</th><th>Alamat</th><th>Item</th><th className="text-right">Total</th><th className="text-right">Status</th><th className="text-right">Aksi</th>
                </tr></thead>
                <tbody>
                  {incomingOrders.map(o=>(
                    <tr key={o.id} className="border-b">
                      <td className="py-2">{o.time? new Date(o.time.toDate()).toLocaleString("id-ID",{hour12:false}) : "-"}</td>
                      <td>{o.name}</td>
                      <td>{o.phone}</td>
                      <td className="truncate max-w-[220px]">{o.address||"-"}</td>
                      <td className="truncate">{(o.items||[]).map((i:any)=>`${i.name}x${i.qty}`).join(", ")}</td>
                      <td className="text-right">{IDR(o.total||0)}</td>
                      <td className="text-right">{o.status||"new"}</td>
                      <td className="text-right space-x-2">
                        {o.status==="new" && <button className="px-2 py-1 border rounded" onClick={()=>acceptOrder(o.id)}>Terima</button>}
                        {o.status==="processing" && <button className="px-2 py-1 border rounded" onClick={()=>completeOrder(o.id)}>Siap</button>}
                        {(o.status==="processing" || o.status==="ready") && <button className="px-2 py-1 border rounded" onClick={()=>pushToDelivery(o)}>Kirim</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {incomingOrders.length===0 && <div className="text-sm text-neutral-500">Belum ada pesanan online.</div>}
            </div>
          </section>
        )}

      </main>

      {/* Modal QR */}
      {showQR && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={()=>setShowQR(false)}>
          <div className="bg-white rounded-2xl p-4" onClick={e=>e.stopPropagation()}>
            <img src={QRIS_IMG} alt="QRIS" className="w-72" />
            <div className="text-center mt-2 text-sm">Scan untuk bayar • {IDR(total)}</div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ===== Komponen Kecil ===== */
function KPI({title, value}:{title:string; value:string}) {
  return (
    <div className="bg-white border rounded-2xl p-4">
      <div className="text-[12px] text-neutral-500">{title}</div>
      <div className="text-xl font-bold mt-1">{value}</div>
    </div>
  );
}

/* ===========================================
   V2.4: CUSTOMER ORDER PAGE (PUBLIC /order)
=========================================== */
function CustomerOrderPage(){
  const [menu, setMenu] = useState<Product[]>([]);
  const [cart, setCart] = useState<{id:string; name:string; price:number; qty:number}[]>([]);
  const [name, setName] = useState(""); const [phone, setPhone] = useState("");
  const [address, setAddress] = useState(""); const [notes, setNotes] = useState("");
  const subtotal = cart.reduce((s,i)=>s+i.price*i.qty,0);

  useEffect(()=>{
    const qProd = query(collection(db,"products"), where("outlet","==",OUTLET), where("active","==",true));
    const unsub = onSnapshot(qProd, snap=>{
      setMenu(snap.docs.map(d=>({ id:d.id, ...(d.data() as any) })));
    });
    return ()=>unsub();
  },[]);

  function add(p:Product){
    setCart(prev=>{
      const f = prev.find(x=>x.id===p.id);
      if(f) return prev.map(x=> x.id===p.id ? {...x, qty:x.qty+1} : x);
      return [...prev, { id:p.id, name:p.name, price:p.price, qty:1 }];
    });
  }
  const inc = (id:string)=> setCart(prev=> prev.map(x=> x.id===id ? {...x, qty:x.qty+1} : x));
  const dec = (id:string)=> setCart(prev=> prev.map(x=> x.id===id ? {...x, qty:Math.max(1, x.qty-1)} : x));
  const rm  = (id:string)=> setCart(prev=> prev.filter(x=> x.id!==id));

  async function submitOrder(){
    if(!name.trim() || (phone.trim().length<8)) return alert("Isi nama & nomor HP yang valid.");
    if(cart.length===0) return alert("Keranjang kosong.");
    try{
      await addDoc(collection(db,"public_orders"), {
        outlet: OUTLET,
        name, phone, address, notes,
        items: cart.map(i=>({ name:i.name, price:i.price, qty:i.qty })),
        subtotal, total: subtotal, status: "new", time: serverTimestamp()
      });
      alert("Pesanan kamu sudah terkirim. Kasir akan memproses segera. Terima kasih!");
      setCart([]); setName(""); setPhone(""); setAddress(""); setNotes("");
    }catch(e:any){
      alert("Gagal mengirim pesanan: "+(e?.message||e));
    }
  }

  return (
    <div className="min-h-screen bg-neutral-50">
      <header className="sticky top-0 bg-white/80 backdrop-blur border-b">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <img src="/logo.png" className="h-8 w-8 rounded" onError={(e)=>((e.target as HTMLImageElement).style.display='none')} />
            <div className="font-bold">{APP_NAME} — {OUTLET}</div>
          </div>
          <div className="text-xs text-neutral-500">Online Order</div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-4 grid grid-cols-1 md:grid-cols-12 gap-4">
        <section className="md:col-span-7">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {menu.map(p=>(
              <button key={p.id} onClick={()=>add(p)} className="bg-white rounded-2xl border p-3 text-left hover:shadow">
                <div className="h-20 rounded-xl bg-gradient-to-br from-emerald-50 to-emerald-100 mb-2" />
                <div className="font-medium leading-tight">{p.name}</div>
                <div className="text-xs text-neutral-500">{p.category||"Signature"}</div>
                <div className="font-semibold mt-1">{IDR(p.price)}</div>
              </button>
            ))}
          </div>
        </section>

        <aside className="md:col-span-5">
          <div className="bg-white rounded-2xl border p-3 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input className="border rounded-lg px-3 py-2" placeholder="Nama" value={name} onChange={e=>setName(e.target.value)} />
              <input className="border rounded-lg px-3 py-2" placeholder="Nomor HP" value={phone} onChange={e=>setPhone(e.target.value)} />
            </div>
            <input className="border rounded-lg px-3 py-2 w-full" placeholder="Alamat (opsional)" value={address} onChange={e=>setAddress(e.target.value)} />
            <input className="border rounded-lg px-3 py-2 w-full" placeholder="Catatan (opsional)" value={notes} onChange={e=>setNotes(e.target.value)} />

            <div className="border-t pt-3">
              {cart.length===0 ? <div className="text-sm text-neutral-500">Belum ada item.</div> : (
                <div className="space-y-2">
                  {cart.map(ci=>(
                    <div key={ci.id} className="grid grid-cols-12 items-center gap-2 border rounded-xl p-2">
                      <div className="col-span-6">
                        <div className="font-medium leading-tight">{ci.name}</div>
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
                  <div className="flex items-center justify-between text-lg font-semibold pt-2">
                    <span>Total</span><span>{IDR(subtotal)}</span>
                  </div>
                </div>
              )}
            </div>

            <button disabled={cart.length===0} className="w-full px-3 py-3 rounded-lg bg-emerald-600 text-white disabled:opacity-50" onClick={submitOrder}>
              Kirim Pesanan
            </button>

            <div className="text-xs text-neutral-500">Catatan: Pesanan kamu akan masuk ke kasir {OUTLET} dan diproses realtime.</div>
          </div>
        </aside>
      </main>
    </div>
  );
}