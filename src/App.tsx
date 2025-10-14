import React, { useEffect, useMemo, useState } from "react";
import {
  addDoc, collection, deleteDoc, doc, getDoc, getDocs, limit,
  onSnapshot, orderBy, query, serverTimestamp, setDoc, startAfter, updateDoc,
  where, Timestamp
} from "firebase/firestore";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { auth, db } from "./lib/firebase";

/* ==========================
   KONFIGURASI
========================== */
const APP_NAME = "NamiPOS";
const OUTLET = "MTHaryono";
const OWNER_EMAILS = new Set([
  "antonius.arman123@gmail.com",
  "ayuismaalabibbah@gmail.com",
]);
const LOGO_SRC = "/logo.png";
const QRIS_IMG_SRC = "/qris.png";
const SHIPPING_FEE_PER_KM = 3000; // 3k/km

/* ==========================
   TIPE DATA
========================== */
type Product = {
  id: string;
  outlet: string;
  name: string;
  price: number;
  category?: string;
  active?: boolean;
  imageUrl?: string;
};
type Ingredient = { id: string; name: string; unit: string; stock: number; min?: number; outlet: string };
type RecipeItem = { ingredientId: string; qty: number }; // pengurangan stok per 1 porsi
type Recipe = { productId: string; items: RecipeItem[] };
type CartItem = { id: string; productId: string; name: string; price: number; qty: number; note?: string };

type Shift = {
  id: string;
  outlet: string;
  openBy: string;
  openAt: Timestamp | null;
  closeAt?: Timestamp | null;
  isOpen: boolean;
  openCash?: number;
  recap?: {
    omzet: number; trx: number; cash: number; qris: number;
  }
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
  subtotal: number; discount: number; tax: number; service: number; total: number;
  payMethod: "cash" | "ewallet" | "qris";
  cash?: number; change?: number;
};

type DeliveryOrder = {
  id?: string;
  outlet: string;
  createdAt: Timestamp | null;
  customer: { name: string; phone: string; address: string; distanceKm?: number };
  items: { name: string; price: number; qty: number }[];
  subtotal: number; discount: number; total: number;
  payMethod: "qris" | "cod";
  status: "new" | "accepted" | "preparing" | "on_delivery" | "done" | "canceled";
  note?: string;
  // v2.5.2
  shippingFee?: number;
  paid?: boolean;
  linkedSaleId?: string;
};

/* ==========================
   UTIL
========================== */
const uid = () => Math.random().toString(36).slice(2, 10);
const IDR = (n: number) => new Intl.NumberFormat("id-ID",{style:"currency",currency:"IDR",maximumFractionDigits:0}).format(n||0);
const startOfDay = (d = new Date()) => { const x = new Date(d); x.setHours(0,0,0,0); return x; };
const endOfDay   = (d = new Date()) => { const x = new Date(d); x.setHours(23,59,59,999); return x; };
const daysAgo = (n:number) => { const x=new Date(); x.setDate(x.getDate()-n); return x; };
const computeShippingFee = (distanceKm?: number) => (!distanceKm || distanceKm<=0) ? 0 : Math.round(distanceKm * SHIPPING_FEE_PER_KM);

/* ==========================
   APP
========================== */
export default function App() {
  /* ---- auth ---- */
  const [user, setUser] = useState<null | { email: string }>(null);
  const isOwner = !!(user?.email && OWNER_EMAILS.has(user.email));

  /* ---- tabs ---- */
  const [tab, setTab] = useState<"dashboard"|"pos"|"history"|"products"|"inventory">("pos");
  const [deliveryTab, setDeliveryTab] = useState<"admin"|"public">("admin");
  const [publicOrderMode, setPublicOrderMode] = useState(false);

  /* ---- login form ---- */
  const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [authLoading, setAuthLoading] = useState(false);

  /* ---- master ---- */
  const [products, setProducts] = useState<Product[]>([]);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [recipes, setRecipes] = useState<Recipe[]>([]);

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

  /* ---- delivery ---- */
  const [orders, setOrders] = useState<DeliveryOrder[]>([]);
  // public order form
  const [ordName, setOrdName] = useState("");
  const [ordPhone, setOrdPhone] = useState("");
  const [ordAddress, setOrdAddress] = useState("");
  const [ordDistance, setOrdDistance] = useState<number | undefined>(undefined);
  const [ordPay, setOrdPay] = useState<"qris"|"cod">("qris");
  const [ordNote, setOrdNote] = useState("");

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
     PUBLIC ORDER DETECT
  =========================== */
  useEffect(() => {
    const u = new URL(window.location.href);
    const q = u.searchParams.get("order");
    const hash = window.location.hash.replace("#", "");
    if (q === "1" || hash === "order" || u.pathname.endsWith("/order")) {
      setPublicOrderMode(true);
      setTab("pos");
      setDeliveryTab("public");
    }
  }, []);

  /* ==========================
     LOAD DATA AFTER LOGIN
  =========================== */
  useEffect(()=>{
    if(!user) return;

    const qProd = query(collection(db,"products"), where("outlet","==",OUTLET), orderBy("name","asc"));
    const unsubProd = onSnapshot(qProd, snap=>{
      const rows: Product[] = snap.docs.map(d=>{
        const x = d.data() as any;
        return { id:d.id, outlet:x.outlet, name:x.name, price:x.price, category:x.category, active:x.active, imageUrl:x.imageUrl };
      });
      setProducts(rows);
    }, err=>alert("Memuat produk gagal.\n"+(err.message||err)));

    const qIng = query(collection(db,"ingredients"), where("outlet","==",OUTLET), orderBy("name","asc"));
    const unsubIng = onSnapshot(qIng, snap=>{
      const rows: Ingredient[] = snap.docs.map(d=>{
        const x = d.data() as any;
        return { id:d.id, name:x.name, unit:x.unit, stock:x.stock??0, min:x.min??0, outlet:x.outlet };
      });
      setIngredients(rows);
    }, err=>alert("Memuat inventori gagal.\n"+(err.message||err)));

    const qRec = query(collection(db,"recipes"), where("outlet","==",OUTLET));
    const unsubRec = onSnapshot(qRec, s=>{
      const list = s.docs.map(d=> d.data() as Recipe);
      setRecipes(list);
    });

    checkActiveShift().catch(e=>console.warn(e));
    loadDashboard().catch(()=>{});

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
      openAt:x.openAt, closeAt:x.closeAt??null, openCash:x.openCash??0, isOpen:true,
      recap:x.recap
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
    // hitung recap
    const qS = query(
      collection(db,"sales"),
      where("outlet","==",OUTLET),
      where("time", ">=", activeShift.openAt || Timestamp.fromDate(new Date(Date.now()-12*3600*1000))),
      orderBy("time","desc")
    );
    const s = await getDocs(qS);
    let omzet=0, trx=0, cashSum=0, qrisSum=0;
    s.docs.forEach(d=>{
      const x=d.data() as any;
      omzet += x.total||0; trx++;
      if(x.payMethod==="cash") cashSum += x.total||0;
      if(x.payMethod==="qris" || x.payMethod==="ewallet") qrisSum += x.total||0;
    });
    await updateDoc(doc(db,"shifts", activeShift.id), {
      isOpen:false, closeAt: serverTimestamp(),
      recap: { omzet, trx, cash:cashSum, qris:qrisSum }
    });
    setActiveShift(null);
    alert("Shift ditutup & rekap disimpan.");
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
          setCustomerPoints(0); // pelanggan baru
        }
      }catch(e:any){ console.warn("Lookup customer:", e?.message||e); }
    })();
  },[customerPhone, user]);

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
img.logo{display:block;margin:0 auto 6px;height:42px}
</style></head><body>
<div class="wrap">
  <img src="${LOGO_SRC}" class="logo" onerror="this.style.display='none'"/>
  <h2>${APP_NAME} — ${OUTLET}</h2>
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
  <p class="meta">Terima kasih! Follow @namipos</p>
</div>
<script>window.print();</script>
</body></html>`;
    w.document.write(html); w.document.close();
  }

  async function deductStockByRecipe(lineItems: {name:string; qty:number}[]) {
    for (const it of lineItems) {
      const prod = products.find(p => p.name === it.name);
      if (!prod) continue;
      const rec = recipes.find(r => r.productId === prod.id);
      if (!rec) continue;
      for (const ri of rec.items) {
        const ingRef = doc(db, "ingredients", ri.ingredientId);
        const ingSnap = await getDoc(ingRef);
        if (ingSnap.exists()) {
          const now = ingSnap.data() as any;
          const newStock = (now.stock || 0) - (ri.qty * it.qty);
          await updateDoc(ingRef, { stock: newStock });
        }
      }
    }
  }

  async function finalize(){
    if(!user?.email) return alert("Belum login.");
    if(!activeShift?.id) return alert("Buka shift dahulu.");
    if(cart.length===0) return alert("Keranjang kosong.");
    if(payMethod==="cash" && cash<total) return alert("Uang tunai kurang.");

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
        const pts = Math.floor(total/15000); // 15k = 1 poin
        if(s.exists()){
          const c = s.data() as any;
          const newPts = (c.points||0)+pts;
          if (newPts >= 10) {
            await setDoc(doc(db, "free_drinks", `FD-${ref.id}`), {
              phone: customerPhone.trim(),
              createdAt: serverTimestamp(),
              reason: "10 points reward",
              saleId: ref.id,
            });
            await updateDoc(cref, { points: newPts - 10 });
          } else {
            await updateDoc(cref, { points: newPts, lastVisit: serverTimestamp() });
          }
        }else{
          await setDoc(cref, { phone: customerPhone.trim(), name: customerName||"Member", points: pts, lastVisit: serverTimestamp() });
        }
      }

      // stock by recipe
      await deductStockByRecipe(cart.map(i=>({name:i.name, qty:i.qty})));

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
    if(!isOwner) return alert("Hanya owner yang bisa hapus transaksi.");
    if(!confirm("Hapus transaksi ini?")) return;
    try{
      await deleteDoc(doc(db,"sales", id));
      setHistoryRows(prev=> prev.filter(x=>x.id!==id));
      alert("Transaksi dihapus.");
    }catch(e:any){
      alert("Gagal hapus: "+(e?.message||e));
    }
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
     OWNER: PRODUCTS / INVENTORY / RECIPE
  =========================== */
  async function upsertProduct(p: Partial<Product> & { id?: string }){
    if(!isOwner) return alert("Akses khusus owner.");
    const id = p.id || uid();
    await setDoc(doc(db,"products", id), {
      outlet: OUTLET, name: p.name||"Produk", price: Number(p.price)||0,
      category: p.category||"Signature", active: p.active!==false, imageUrl: p.imageUrl||""
    }, { merge:true });
  }
  async function deactivateProduct(id:string){
    if(!isOwner) return alert("Akses khusus owner.");
    await updateDoc(doc(db,"products", id), { active:false });
  }
  async function removeProduct(id:string){
    if(!isOwner) return alert("Akses khusus owner.");
    if(!confirm("Hapus produk ini?")) return;
    await deleteDoc(doc(db,"products", id));
  }

  async function upsertIngredient(i: Partial<Ingredient> & { id?: string }){
    if(!isOwner) return alert("Akses khusus owner.");
    const id = i.id || uid();
    await setDoc(doc(db,"ingredients", id), {
      outlet: OUTLET, name:i.name||"Bahan", unit:i.unit||"pcs",
      stock: Number(i.stock)||0, min: Number(i.min)||0
    }, { merge:true });
  }
  async function removeIngredient(id:string){
    if(!isOwner) return alert("Akses khusus owner.");
    if(!confirm("Hapus bahan ini?")) return;
    await deleteDoc(doc(db,"ingredients", id));
  }

  async function setRecipeForProduct(productId: string, items: RecipeItem[]){
    if(!isOwner) return alert("Akses khusus owner.");
    await setDoc(doc(db,"recipes", productId), { outlet: OUTLET, productId, items }, { merge:true });
  }

  /* ==========================
     DELIVERY (Public & Admin)
  =========================== */
  useEffect(() => {
    if (!user || publicOrderMode) return;
    const unsub = onSnapshot(
      query(collection(db, "orders"), orderBy("createdAt", "desc"), limit(100)),
      (s) => setOrders(s.docs.map(d => ({ id: d.id, ...(d.data() as any) })))
    );
    return () => unsub();
  }, [user, publicOrderMode]);

  async function submitPublicOrder() {
    if (cart.length === 0) return alert("Keranjang kosong");
    if (!ordName || !ordPhone || !ordAddress) return alert("Nama/HP/Alamat wajib diisi");

    const subtotalPO = cart.reduce((s, i) => s + i.price * i.qty, 0);
    const discountPO = 0;
    const totalPO = subtotalPO;
    try {
      const payload: Omit<DeliveryOrder, "id"> = {
        outlet: OUTLET,
        createdAt: serverTimestamp() as any,
        customer: { name: ordName, phone: ordPhone, address: ordAddress, distanceKm: ordDistance },
        items: cart.map(i => ({ name: i.name, price: i.price, qty: i.qty })),
        subtotal: subtotalPO,
        discount: discountPO,
        total: totalPO,
        payMethod: ordPay,
        status: "new",
        note: ordNote || undefined,
      };
      await addDoc(collection(db, "orders"), payload as any);
      alert("Pesanan berhasil dikirim!");
      setCart([]); setOrdName(""); setOrdPhone(""); setOrdAddress("");
      setOrdDistance(undefined); setOrdPay("qris"); setOrdNote("");
    } catch (e: any) {
      alert("Gagal mengirim pesanan: " + (e?.message || e));
    }
  }

  async function setOrderStatus(id: string, status: DeliveryOrder["status"]) {
    try { await updateDoc(doc(db, "orders", id), { status }); }
    catch (e: any) { alert("Gagal update status: " + (e?.message || e)); }
  }
  async function deleteOrder(id: string) {
    if (!confirm("Hapus pesanan ini?")) return;
    try { await deleteDoc(doc(db, "orders", id)); }
    catch (e: any) { alert("Gagal hapus: " + (e?.message || e)); }
  }

  async function convertOrderToSale(order: DeliveryOrder) {
    if (!user?.email) return alert("Belum login.");
    if (order.status === "canceled") return alert("Pesanan dibatalkan.");
    if (order.linkedSaleId) return alert("Pesanan ini sudah dikonversi.");

    const shippingFee = order.shippingFee ?? computeShippingFee(order.customer?.distanceKm);
    const baseSubtotal = order.items.reduce((s, i) => s + i.price * i.qty, 0);
    const subtotalWithShipping = baseSubtotal + (shippingFee || 0);
    const discount = order.discount || 0;
    const tax = 0; const service = 0;
    const total = subtotalWithShipping - discount;

    const saleItems = [
      ...order.items.map(i => ({ name: i.name, price: i.price, qty: i.qty })),
      ...(shippingFee ? [{ name: "Ongkir", price: shippingFee, qty: 1 }] : [])
    ];

    const salePayload: Omit<Sale, "id"> = {
      outlet: OUTLET,
      shiftId: null,
      cashierEmail: user.email,
      customerPhone: order.customer?.phone || null,
      customerName: order.customer?.name || null,
      time: serverTimestamp() as any,
      items: saleItems,
      subtotal: subtotalWithShipping,
      discount,
      tax,
      service,
      total,
      payMethod: order.payMethod === "cod" ? "cash" : "qris",
      cash: undefined,
      change: undefined,
    };

    try {
      const sRef = await addDoc(collection(db, "sales"), salePayload as any);

      // loyalty
      if (order.customer?.phone) {
        const phone = order.customer.phone.trim();
        const cRef = doc(db, "customers", phone);
        const snap = await getDoc(cRef);
        const pts = Math.floor(total / 15000);
        if (snap.exists()) {
          const curr = snap.data() as any;
          const newPts = (curr.points || 0) + pts;
          if (newPts >= 10) {
            await setDoc(doc(db, "free_drinks", `FD-${sRef.id}`), {
              phone,
              createdAt: serverTimestamp(),
              reason: "10 points reward",
              saleId: sRef.id,
            });
            await updateDoc(cRef, { points: newPts - 10 });
          } else {
            await updateDoc(cRef, { points: newPts });
          }
        } else {
          await setDoc(cRef, { phone, name: order.customer.name || "Member", points: pts, lastVisit: serverTimestamp() });
        }
      }

      // potong stok berdasar resep
      await deductStockByRecipe(order.items.map(i=>({name:i.name, qty:i.qty})));

      // tandai order selesai
      await updateDoc(doc(db, "orders", order.id!), {
        status: "done",
        paid: order.payMethod === "qris" ? true : true,
        linkedSaleId: sRef.id,
        shippingFee,
      });

      // cetak
      try { printReceipt(salePayload, sRef.id); } catch(e){}

      alert("Order dikonversi menjadi transaksi & dicetak.");
    } catch (err: any) {
      alert("Gagal convert: " + (err?.message || err));
    }
  }

  /* ==========================
     UI: LOGIN
  =========================== */
  if(!user){
    return (
      <div className="min-h-screen bg-gradient-to-br from-emerald-50 to-white flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-6 border">
          <div className="flex items-center gap-3 mb-4">
            <img src={LOGO_SRC} className="h-10 w-10 rounded-xl" onError={(e)=>((e.target as HTMLImageElement).style.display='none')}/>
            <div>
              <h1 className="text-2xl font-bold">{APP_NAME}</h1>
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

  /* ==========================
     UI: TOPBAR
  =========================== */
  return (
    <div className="min-h-screen bg-neutral-50">
      <header className="sticky top-0 z-30 bg-white/80 backdrop-blur border-b">
        <div className="max-w-7xl mx-auto px-3 sm:px-4 md:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src={LOGO_SRC} className="h-8 w-8 rounded-lg" onError={(e)=>((e.target as HTMLImageElement).style.display='none')}/>
            <div>
              <div className="font-bold">{APP_NAME} — {OUTLET}</div>
              <div className="text-[11px] text-neutral-500">Masuk: {user.email}{isOwner?" · owner":" · staff"}</div>
            </div>
          </div>
          <nav className="flex gap-2">
            {isOwner && <button onClick={()=>{ setTab("dashboard"); loadDashboard(); }} className={`px-3 py-1.5 rounded-lg border ${tab==="dashboard"?"bg-emerald-50 border-emerald-200":"bg-white"}`}>Dashboard</button>}
            <button onClick={()=>setTab("pos")} className={`px-3 py-1.5 rounded-lg border ${tab==="pos"?"bg-emerald-50 border-emerald-200":"bg-white"}`}>Kasir</button>
            <button onClick={()=>{ setTab("history"); setDeliveryTab("admin"); loadHistory(false); }} className={`px-3 py-1.5 rounded-lg border ${tab==="history"?"bg-emerald-50 border-emerald-200":"bg-white"}`}>Riwayat</button>
            {isOwner && <button onClick={()=>setTab("products")} className={`px-3 py-1.5 rounded-lg border ${tab==="products"?"bg-emerald-50 border-emerald-200":"bg-white"}`}>Produk</button>}
            {isOwner && <button onClick={()=>setTab("inventory")} className={`px-3 py-1.5 rounded-lg border ${tab==="inventory"?"bg-emerald-50 border-emerald-200":"bg-white"}`}>Inventori</button>}
            {isOwner && <button onClick={()=>{ setTab("history"); setDeliveryTab("admin"); }} className={`px-3 py-1.5 rounded-lg border ${tab==="history"&&deliveryTab==="admin"?"bg-emerald-50 border-emerald-200":"bg-white"}`}>Delivery</button>}
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

        {/* POS (STAFF) */}
        {tab==="pos" && !publicOrderMode && (
          <section className="grid grid-cols-1 md:grid-cols-12 gap-4">
            {/* Products */}
            <div className="md:col-span-7">
              <div className="bg-white rounded-2xl border p-3 mb-2">
                <input className="border rounded-lg px-3 py-2 w-full" placeholder="Cari menu…" value={queryText} onChange={e=>setQueryText(e.target.value)} />
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {filteredProducts.map(p=>(
                  <button key={p.id} onClick={()=>addToCart(p)} className="bg-white rounded-2xl border p-3 text-left hover:shadow">
                    {p.imageUrl ? <img src={p.imageUrl} className="h-20 w-full object-cover rounded-xl mb-2"/> : <div className="h-20 rounded-xl bg-gradient-to-br from-emerald-50 to-emerald-100 mb-2" />}
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
                  <input className="border rounded-lg px-3 py-2" placeholder="Nama pelanggan (baru/opsional)" value={customerName} onChange={e=>setCustomerName(e.target.value)} />
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
              </div>
            </div>
          </section>
        )}

        {/* POS (PUBLIC ORDER) */}
        {tab==="pos" && publicOrderMode && (
          <section className="max-w-3xl mx-auto">
            <div className="bg-white rounded-2xl border p-3 mb-3">
              <div className="flex items-center gap-2">
                <img src={LOGO_SRC} className="h-8" />
                <div className="font-bold">{APP_NAME} — Order Online</div>
              </div>
              <p className="text-sm text-neutral-600">Silakan pilih menu dan isi data pengantaran.</p>
            </div>

            <div className="grid md:grid-cols-2 gap-3">
              {/* Produk katalog */}
              <div>
                <h3 className="font-semibold mb-2">Menu</h3>
                <div className="grid grid-cols-2 gap-2">
                  {products.filter(p=>p.active!==false).map(p=>(
                    <button key={p.id} onClick={()=>addToCart(p)} className="border p-2 rounded bg-white hover:bg-emerald-50 text-left">
                      {p.imageUrl && <img src={p.imageUrl} className="h-20 w-full object-cover rounded mb-1" />}
                      <div className="font-medium">{p.name}</div>
                      <div className="text-sm text-neutral-600">{IDR(p.price)}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Keranjang + data antar */}
              <div className="bg-white p-3 rounded border">
                <h3 className="font-semibold mb-2">Pesanan</h3>
                {cart.length===0 && <div className="text-sm text-neutral-500">Belum ada item.</div>}
                {cart.map((i,idx)=>(
                  <div key={idx} className="flex justify-between py-1 text-sm border-b">
                    <span>{i.name} × {i.qty}</span><span>{IDR(i.price*i.qty)}</span>
                  </div>
                ))}
                <div className="mt-3 text-sm border-t pt-2 flex justify-between">
                  <b>Total</b><b>{IDR(cart.reduce((s,i)=>s+i.price*i.qty,0))}</b>
                </div>

                <div className="mt-3 grid gap-2">
                  <input className="border p-2 rounded" placeholder="Nama" value={ordName} onChange={e=>setOrdName(e.target.value)} />
                  <input className="border p-2 rounded" placeholder="No HP" value={ordPhone} onChange={e=>setOrdPhone(e.target.value)} />
                  <textarea className="border p-2 rounded" placeholder="Alamat lengkap" value={ordAddress} onChange={e=>setOrdAddress(e.target.value)} />
                  <input className="border p-2 rounded" type="number" placeholder="Jarak (km, opsional)" value={ordDistance??""} onChange={e=>setOrdDistance(e.target.value?Number(e.target.value):undefined)} />
                  <select className="border p-2 rounded" value={ordPay} onChange={e=>setOrdPay(e.target.value as any)}>
                    <option value="qris">Bayar Online (QRIS)</option>
                    <option value="cod">Bayar di Tempat (COD)</option>
                  </select>
                  <textarea className="border p-2 rounded" placeholder="Catatan (opsional)" value={ordNote} onChange={e=>setOrdNote(e.target.value)} />
                  <button className="bg-emerald-600 text-white p-2 rounded" onClick={submitPublicOrder}>Kirim Pesanan</button>
                  <div className="text-xs text-neutral-500">* Dengan menekan “Kirim Pesanan”, Anda menyetujui pesanan diproses oleh outlet {OUTLET}.</div>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* HISTORY + DELIVERY ADMIN */}
        {tab==="history" && (
          <>
            {/* Riwayat Sales */}
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
                    <th className="py-2">Waktu</th><th>Kasir</th><th>Pelanggan</th><th>Item</th><th className="text-right">Total</th><th className="text-right">Aksi</th>
                  </tr></thead>
                  <tbody>
                    {historyRows.map(s=>(
                      <tr key={s.id} className="border-b hover:bg-emerald-50/40 align-top">
                        <td className="py-2">{s.time? new Date(s.time.toDate()).toLocaleString("id-ID",{hour12:false}) : "-"}</td>
                        <td>{s.cashierEmail}</td>
                        <td>{s.customerPhone || "-"}</td>
                        <td className="truncate">{s.items.map(i=>`${i.name}x${i.qty}`).join(", ")}</td>
                        <td className="text-right font-medium">{IDR(s.total)}</td>
                        <td className="text-right">
                          {isOwner && <button className="px-2 py-1 rounded border bg-rose-50" onClick={()=>deleteSale(s.id!)}>Hapus</button>}
                        </td>
                      </tr>
                    ))}
                    {historyRows.length===0 && <tr><td colSpan={6} className="py-3 text-neutral-500">Belum ada transaksi.</td></tr>}
                  </tbody>
                </table>
              </div>
            </section>

            {/* Delivery Admin */}
            {isOwner && deliveryTab==="admin" && !publicOrderMode && (
              <section className="bg-white rounded-2xl border p-3 mt-4">
                <div className="flex items-center justify-between mb-2">
                  <h2 className="text-lg font-semibold">Delivery Orders</h2>
                  <div className="text-xs text-neutral-600">Klik tombol status untuk mengubah</div>
                </div>
                <div className="overflow-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left border-b">
                        <th>Waktu</th><th>Pelanggan</th><th>Alamat</th>
                        <th>Item</th><th className="text-right">Total</th><th>Status</th><th>Bayar</th><th>Ongkir</th><th>Aksi</th>
                      </tr>
                    </thead>
                    <tbody>
                      {orders.map(o=>(
                        <tr key={o.id} className="border-b align-top">
                          <td className="py-2">{o.createdAt? new Date(o.createdAt.toDate()).toLocaleString("id-ID",{hour12:false}) : "-"}</td>
                          <td>{o.customer?.name} <div className="text-xs text-neutral-500">{o.customer?.phone}</div></td>
                          <td className="max-w-[280px]">
                            <div className="truncate">{o.customer?.address}</div>
                            {o.customer?.distanceKm ? <div className="text-[11px] text-neutral-500">{o.customer.distanceKm} km</div> : null}
                          </td>
                          <td className="max-w-[260px]">
                            <div className="truncate">{o.items.map(i=>`${i.name}×${i.qty}`).join(", ")}</div>
                            {o.note && <div className="text-[11px] text-neutral-500">Note: {o.note}</div>}
                          </td>
                          <td className="text-right">{IDR(o.total)}</td>
                          <td>
                            <div className="inline-flex flex-wrap gap-1">
                              {(["new","accepted","preparing","on_delivery","done","canceled"] as DeliveryOrder["status"][]).map(st=>(
                                <button
                                  key={st}
                                  className={`px-2 py-1 rounded border text-[11px] ${o.status===st ? "bg-emerald-50 border-emerald-200" : ""}`}
                                  onClick={()=>setOrderStatus(o.id!, st)}
                                >
                                  {st}
                                </button>
                              ))}
                            </div>
                          </td>
                          <td className="text-xs">{o.payMethod.toUpperCase()} {o.paid ? "• paid" : ""}</td>
                          <td className="text-right text-xs">{o.shippingFee ? IDR(o.shippingFee) : "-"}</td>
                          <td className="text-right">
                            {!o.linkedSaleId && o.status!=="canceled" && (
                              <button className="px-2 py-1 rounded border bg-emerald-600 text-white mr-2" onClick={()=>convertOrderToSale(o)}>
                                Convert to Sale & Print
                              </button>
                            )}
                            <button className="px-2 py-1 rounded border bg-rose-50" onClick={()=>deleteOrder(o.id!)}>Hapus</button>
                          </td>
                        </tr>
                      ))}
                      {orders.length===0 && <tr><td colSpan={9} className="py-3 text-neutral-500">Belum ada pesanan delivery.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
          </>
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
                <thead><tr className="text-left border-b"><th>Nama</th><th>Kategori</th><th className="text-right">Harga</th><th>Gambar URL</th><th className="text-right">Aksi</th></tr></thead>
                <tbody>
                  {products.map(p=>(
                    <tr key={p.id} className="border-b">
                      <td className="py-2">
                        <input className="border rounded px-2 py-1" defaultValue={p.name} onBlur={(e)=>upsertProduct({ id:p.id, name:e.currentTarget.value })}/>
                      </td>
                      <td>
                        <input className="border rounded px-2 py-1" defaultValue={p.category||""} onBlur={(e)=>upsertProduct({ id:p.id, category:e.currentTarget.value })}/>
                      </td>
                      <td className="text-right">
                        <input type="number" className="border rounded px-2 py-1 w-28 text-right" defaultValue={p.price} onBlur={(e)=>upsertProduct({ id:p.id, price:Number(e.currentTarget.value)||0 })}/>
                      </td>
                      <td>
                        <input className="border rounded px-2 py-1 w-64" placeholder="https://..." defaultValue={p.imageUrl||""} onBlur={(e)=>upsertProduct({ id:p.id, imageUrl:e.currentTarget.value })}/>
                      </td>
                      <td className="text-right">
                        <button className="px-2 py-1 border rounded mr-2" onClick={()=>upsertProduct({ id:p.id, active: !(p.active===false) ? false : true })}>
                          {(p.active!==false) ? "Nonaktifkan" : "Aktifkan"}
                        </button>
                        <button className="px-2 py-1 border rounded mr-2" onClick={()=>removeProduct(p.id)}>Hapus</button>
                        <button className="px-2 py-1 border rounded" onClick={()=>promptRecipe(p.id)}>Resep</button>
                      </td>
                    </tr>
                  ))}
                  {products.length===0 && <tr><td colSpan={5} className="py-3 text-neutral-500">Belum ada produk.</td></tr>}
                </tbody>
              </table>
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
                <thead><tr className="text-left border-b"><th>Nama</th><th>Satuan</th><th className="text-right">Stok</th><th className="text-right">Min</th><th className="text-right">Aksi</th></tr></thead>
                <tbody>
                  {ingredients.map(i=>(
                    <tr key={i.id} className="border-b">
                      <td className="py-2">
                        <input className="border rounded px-2 py-1" defaultValue={i.name} onBlur={(e)=>upsertIngredient({ id:i.id, name:e.currentTarget.value })}/>
                      </td>
                      <td>
                        <input className="border rounded px-2 py-1 w-24" defaultValue={i.unit} onBlur={(e)=>upsertIngredient({ id:i.id, unit:e.currentTarget.value })}/>
                      </td>
                      <td className="text-right">
                        <input type="number" className="border rounded px-2 py-1 w-24 text-right" defaultValue={i.stock} onBlur={(e)=>upsertIngredient({ id:i.id, stock:Number(e.currentTarget.value)||0 })}/>
                      </td>
                      <td className="text-right">
                        <input type="number" className="border rounded px-2 py-1 w-24 text-right" defaultValue={i.min||0} onBlur={(e)=>upsertIngredient({ id:i.id, min:Number(e.currentTarget.value)||0 })}/>
                      </td>
                      <td className="text-right">
                        <button className="px-2 py-1 border rounded" onClick={()=>removeIngredient(i.id)}>Hapus</button>
                      </td>
                    </tr>
                  ))}
                  {ingredients.length===0 && <tr><td colSpan={5} className="py-3 text-neutral-500">Belum ada data inventori.</td></tr>}
                </tbody>
              </table>
            </div>

            {/* Low stock warning */}
            <div className="mt-3">
              <div className="text-sm font-semibold mb-1">Peringatan Stok Menipis</div>
              <ul className="text-sm list-disc pl-5">
                {ingredients.filter(i=> i.min!>=0 && i.stock<= (i.min||0)).map(i=>(
                  <li key={i.id}>{i.name} — Stok: {i.stock} {i.unit} (min {i.min})</li>
                ))}
                {ingredients.filter(i=> i.min!>=0 && i.stock<= (i.min||0)).length===0 && <li className="text-neutral-500">Aman.</li>}
              </ul>
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

  /* ======= helper: edit recipe via prompt ======= */
  function promptRecipe(productId: string){
    const current = recipes.find(r=>r.productId===productId);
    const text = window.prompt(
      "Masukkan resep (format: ingredientId:qty per baris). Contoh:\nING_123:50\nING_456:10",
      current ? current.items.map(x=>`${x.ingredientId}:${x.qty}`).join("\n") : ""
    );
    if(text==null) return;
    const items: RecipeItem[] = [];
    text.split("\n").map(v=>v.trim()).filter(Boolean).forEach(line=>{
      const [id, qtyStr] = line.split(":");
      const qty = Number(qtyStr||"0");
      if(id && qty>0) items.push({ ingredientId:id.trim(), qty });
    });
    setRecipeForProduct(productId, items);
  }
}

/* ===== Small UI helpers ===== */
function KPI({title, value}:{title:string; value:string}) {
  return (
    <div className="bg-white border rounded-2xl p-4">
      <div className="text-[12px] text-neutral-500">{title}</div>
      <div className="text-xl font-bold mt-1">{value}</div>
    </div>
  );
}