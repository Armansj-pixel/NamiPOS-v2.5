// src/App.tsx
import React, { useEffect, useMemo, useState } from "react";
import {
  addDoc, collection, deleteDoc, doc, getDoc, getDocs, onSnapshot, orderBy, query,
  serverTimestamp, setDoc, Timestamp, updateDoc, where, limit, startAfter, writeBatch
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
const QRIS_IMG_SRC = "/qris.png"; // letakkan file di /public/qris.png

/* ==========================
   TYPES
========================== */
type Product = { id: string; name: string; price: number; category?: string; active?: boolean; outlet?: string };
type Ingredient = { id: string; name: string; unit: string; stock: number; min?: number; outlet?: string };
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
type RecipeItem = { ingredientId: string; qty: number; unit?: string };
type RecipeDoc = { productId: string; outlet: string; items: RecipeItem[] };

type InventoryLog = {
  id?: string;
  outlet: string;
  time: Timestamp | null;
  saleId: string;
  productId: string;
  ingredientId: string;
  qty: number; // keluar
  unit: string;
};
type AppUser = { email: string; role: "owner"|"staff"; outlet: string };

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
  /* ---- auth ---- */
  const [user, setUser] = useState<null | { email: string }>(null);
  const isOwner = !!(user?.email && OWNER_EMAILS.has(user.email));

  /* ---- tabs ---- */
  const [tab, setTab] = useState<"dashboard"|"pos"|"history"|"products"|"inventory"|"settings">("pos");

  /* ---- login form ---- */
  const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [authLoading, setAuthLoading] = useState(false);

  /* ---- master ---- */
  const [products, setProducts] = useState<Product[]>([]);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [recipeMap, setRecipeMap] = useState<Record<string, RecipeItem[]>>({}); // productId -> items

  /* ---- edit modals ---- */
  const [editProduct, setEditProduct] = useState<Partial<Product>|null>(null);
  const [editIngredient, setEditIngredient] = useState<Partial<Ingredient>|null>(null);
  const [editRecipeFor, setEditRecipeFor] = useState<Product|null>(null);
  const [recipeDraft, setRecipeDraft] = useState<RecipeItem[]>([]);

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
  const [redeemPts, setRedeemPts] = useState(0); // V2.1 redeem

  /* ---- shift ---- */
  const [activeShift, setActiveShift] = useState<Shift|null>(null);
  const [openCash, setOpenCash] = useState<number>(0);

  /* ---- history ---- */
  const [historyRows, setHistoryRows] = useState<Sale[]>([]);
  const [histCursor, setHistCursor] = useState<any>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  /* ---- dashboard ---- */
  const [dashLoading, setDashLoading] = useState(false);
  const [dateRange, setDateRange] = useState<"today"|"7d"|"30d">("today");
  const [todayStats, setTodayStats] = useState({ omzet:0, trx:0, avg:0, cash:0, ewallet:0, qris:0, topItems: [] as {name:string;qty:number}[] });
  const [last7, setLast7] = useState<{date:string; omzet:number; trx:number}[]>([]);

  /* ---- low stock ---- */
  const [lowStockList, setLowStockList] = useState<Ingredient[]>([]);

  /* ---- staff (whitelist display) ---- */
  const [staffList, setStaffList] = useState<AppUser[]>([]);

  /* ---- computed ---- */
  const filteredProducts = useMemo(
    () => products.filter(p => (p.active!==false) && p.name.toLowerCase().includes(queryText.toLowerCase())),
    [products, queryText]
  );
  const subtotal = useMemo(()=> cart.reduce((s,i)=> s + i.price*i.qty, 0), [cart]);
  const taxVal = Math.round(subtotal * (taxPct/100));
  const svcVal = Math.round(subtotal * (svcPct/100));
  const redeemValue = redeemPts * 1000; // contoh: 1 poin = Rp1.000
  const effectiveDiscount = Math.min(discount + redeemValue, subtotal + taxVal + svcVal);
  const total = Math.max(0, subtotal + taxVal + svcVal - (effectiveDiscount || 0));
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
        return { id:d.id, name:x.name, price:x.price, category:x.category, active:x.active, outlet:x.outlet };
      });
      setProducts(rows);
    }, err=>alert("Memuat produk gagal.\n"+(err.message||err)));

    // ingredients
    const qIng = query(collection(db,"ingredients"), where("outlet","==",OUTLET));
    const unsubIng = onSnapshot(qIng, snap=>{
      const rows: Ingredient[] = snap.docs.map(d=>{
        const x = d.data() as any;
        return { id:d.id, name:x.name, unit:x.unit, stock:x.stock??0, min:x.min??0, outlet:x.outlet };
      });
      setIngredients(rows);
    }, err=>alert("Memuat inventori gagal.\n"+(err.message||err)));

    // recipes (map)
    const qRec = query(collection(db,"recipes"), where("outlet","==",OUTLET));
    const unsubRec = onSnapshot(qRec, snap=>{
      const m: Record<string, RecipeItem[]> = {};
      snap.docs.forEach(d=>{
        const x = d.data() as any;
        m[x.productId] = Array.isArray(x.items) ? x.items : [];
      });
      setRecipeMap(m);
    });

    // users (whitelist tampilan)
    const qUsers = query(collection(db,"users"), where("outlet","==",OUTLET));
    const unsubUsers = onSnapshot(qUsers, snap=>{
      const rows: AppUser[] = snap.docs.map(d=>{
        const x = d.data() as any;
        return { email:x.email, role:(x.role||"staff"), outlet:(x.outlet||OUTLET) };
      });
      setStaffList(rows);
    });

    // shift
    checkActiveShift().catch(e=>console.warn(e));
    // dashboard awal
    loadDashboard().catch(()=>{});

    return ()=>{ unsubProd(); unsubIng(); unsubRec(); unsubUsers(); };
    // eslint-disable-next-line
  },[user?.email]);

  // low stock recalc
  useEffect(()=>{
    const lows = ingredients.filter(i => (i.stock||0) <= (i.min||0));
    setLowStockList(lows);
  },[ingredients]);

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
    // hitung rekap shift
    const qSales = query(collection(db,"sales"),
      where("outlet","==",OUTLET),
      where("shiftId","==",activeShift.id)
    );
    const s = await getDocs(qSales);
    let omzet=0, trx=0, cashSum=0, ew=0, qr=0;
    s.docs.forEach(d=>{
      const x = d.data() as any;
      omzet += x.total||0; trx += 1;
      if(x.payMethod==="cash") cashSum += x.total||0;
      if(x.payMethod==="ewallet") ew += x.total||0;
      if(x.payMethod==="qris") qr += x.total||0;
    });

    await updateDoc(doc(db,"shifts", activeShift.id), {
      isOpen:false, closeAt: serverTimestamp(),
      recap: { omzet, trx, cash: cashSum, ewallet: ew, qris: qr }
    });
    setActiveShift(null);
    alert("Shift ditutup. Rekap tersimpan di dokumen shift.");
    // refresh dashboard
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
  const clearCart = ()=> {
    setCart([]); setDiscount(0); setTaxPct(0); setSvcPct(0);
    setPayMethod("cash"); setCash(0); setNoteInput("");
    setCustomerPhone(""); setCustomerName(""); setCustomerPoints(null);
    setRedeemPts(0);
  };

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
img{display:block;margin:0 auto 6px;height:42px}
</style></head><body>
<div class="wrap">
  ${rec.payMethod!=="cash" ? `<img src="${QRIS_IMG_SRC}" onerror="this.style.display='none'"/>` : ""}
  <h2>CHAFU MATCHA — ${OUTLET}</h2>
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
  <p class="meta">Terima kasih! Follow @chafumatcha</p>
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

    // 1) Simpan sale
    const payload: Omit<Sale,"id"> = {
      outlet: OUTLET, shiftId: activeShift.id, cashierEmail: user.email,
      customerPhone: customerPhone?.trim()||null, customerName: customerName?.trim()||null,
      time: serverTimestamp() as any,
      items: cart.map(i=> ({ name:i.name, price:i.price, qty:i.qty, ...(i.note?{note:i.note}:{}) })),
      subtotal, discount: effectiveDiscount||0, tax: taxVal, service: svcVal, total, payMethod,
      ...(payMethod==="cash" ? { cash, change } : {})
    };

    try{
      const saleRef = await addDoc(collection(db,"sales"), payload as any);

      // 2) Loyalty (earn - redeem)
      if ((customerPhone.trim().length) >= 8) {
        const cref = doc(db,"customers", customerPhone.trim());
        const s = await getDoc(cref);
        const earnPts = Math.floor(total/10000); // earn dari net total
        const spendPts = redeemPts; // dipakai
        if (s.exists()) {
          const c = s.data() as any;
          const newPts = Math.max(0, (c.points||0) - spendPts + earnPts);
          await updateDoc(cref, { points:newPts, name: customerName||c.name||"", lastVisit: serverTimestamp() });
        } else {
          await setDoc(cref, { phone: customerPhone.trim(), name: customerName||"Member", points: Math.max(0, earnPts - spendPts), lastVisit: serverTimestamp() });
        }
      }

      // 3) Kurangi stok berdasarkan resep (jika ada) + log
      try {
        const b = writeBatch(db);
        const bLog = writeBatch(db);
        for (const ci of cart) {
          const rec = recipeMap[ci.productId] || [];
          for (const r of rec) {
            const ing = ingredients.find(i=>i.id===r.ingredientId);
            if (!ing) continue;
            const newStock = Math.max(0, (ing.stock||0) - (r.qty||0)*ci.qty);
            b.update(doc(db,"ingredients", ing.id), { stock: newStock });

            // log keluar
            const logId = `LOG-${Date.now()}-${uid()}`;
            bLog.set(doc(db,"inventory_logs", logId), {
              outlet: OUTLET,
              time: serverTimestamp(),
              saleId: saleRef.id,
              productId: ci.productId,
              ingredientId: r.ingredientId,
              qty: (r.qty||0) * ci.qty,
              unit: r.unit || ing.unit || ""
            } as InventoryLog);
          }
        }
        await b.commit();
        await bLog.commit();
      } catch (e) {
        console.warn("Pengurangan stok/log gagal:", e);
      }

      // 4) Cetak & bersih
      printReceipt(payload, saleRef.id);
      clearCart();
      if(tab==="history") loadHistory(false);
      if(isOwner && (tab==="dashboard")) loadDashboard().catch(()=>{});

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

  /* ==========================
     DASHBOARD OWNER
  =========================== */
  async function loadDashboard(){
    if(!isOwner) return;
    setDashLoading(true);
    try {
      // range
      let from = startOfDay();
      if(dateRange==="7d") from = startOfDay(daysAgo(6));
      if(dateRange==="30d") from = startOfDay(daysAgo(29));
      const to = endOfDay();

      // Aggre
      const qRange = query(
        collection(db,"sales"),
        where("outlet","==",OUTLET),
        where("time", ">=", Timestamp.fromDate(from)),
        where("time", "<=", Timestamp.fromDate(to)),
        orderBy("time","asc")
      );
      const snap = await getDocs(qRange);
      let omzet=0, trx=0, cashSum=0, ew=0, qr=0;
      const counter = new Map<string, number>();
      snap.docs.forEach(d=>{
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

      // bucketing untuk grafik (7d/30d)
      const span = dateRange==="today" ? 1 : dateRange==="7d" ? 7 : 30;
      const base = new Map<string, {omzet:number; trx:number}>();
      for(let i=span-1;i>=0;i--){
        const d = startOfDay(daysAgo(i)); const key = d.toISOString().slice(0,10);
        base.set(key,{omzet:0,trx:0});
      }
      snap.docs.forEach(d=>{
        const x=d.data() as any;
        const key = new Date(x.time?.toDate?.() || Date.now()).toISOString().slice(0,10);
        if(!base.has(key)) base.set(key,{omzet:0,trx:0});
        const cur = base.get(key)!;
        cur.omzet += x.total||0; cur.trx += 1;
      });
      const arr = Array.from(base.entries()).map(([date,v])=>({date, ...v}));
      setLast7(arr);
    } finally {
      setDashLoading(false);
    }
  }

  /* ==========================
     OWNER: PRODUCTS & INVENTORY & RECIPES
  =========================== */
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
  async function deleteProductHard(id:string){
    if(!isOwner) return alert("Akses khusus owner.");
    if(!confirm("Hapus produk ini permanen?")) return;
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
  async function deleteIngredientHard(id:string){
    if(!isOwner) return alert("Akses khusus owner.");
    if(!confirm("Hapus bahan ini permanen?")) return;
    await deleteDoc(doc(db,"ingredients", id));
  }

  // recipes
  function openRecipeEditor(p: Product){
    setEditRecipeFor(p);
    const items = recipeMap[p.id] || [];
    setRecipeDraft(items.map(x=>({ ...x })));
  }
  function addRecipeRow(){
    setRecipeDraft(prev=> [...prev, { ingredientId:"", qty:0, unit:"" }]);
  }
  function updateRecipeRow(idx:number, patch: Partial<RecipeItem>){
    setRecipeDraft(prev=> prev.map((r,i)=> i===idx? { ...r, ...patch } : r ));
  }
  function removeRecipeRow(idx:number){
    setRecipeDraft(prev=> prev.filter((_,i)=>i!==idx));
  }
  async function saveRecipe(){
    if(!isOwner || !editRecipeFor) return;
    const clean = recipeDraft.filter(r=> r.ingredientId && r.qty>0);
    await setDoc(doc(db,"recipes", editRecipeFor.id), {
      productId: editRecipeFor.id,
      outlet: OUTLET,
      items: clean.map(r=>({ ingredientId:r.ingredientId, qty:Number(r.qty)||0, unit:r.unit||"" }))
    } as RecipeDoc, { merge:true });
    setEditRecipeFor(null);
    alert("Resep disimpan.");
  }

  /* ==========================
     UI
  =========================== */
  if(!user){
    return (
      <div className="min-h-screen bg-gradient-to-br from-emerald-50 to-white flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-6 border">
          <div className="flex items-center gap-3 mb-4">
            <div className="h-10 w-10 rounded-2xl bg-emerald-600" />
            <div>
              <h1 className="text-2xl font-bold">CHAFU MATCHA — POS</h1>
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

  return (
    <div className="min-h-screen bg-neutral-50">
      {/* Topbar */}
      <header className="sticky top-0 z-30 bg-white/80 backdrop-blur border-b">
        <div className="max-w-7xl mx-auto px-3 sm:px-4 md:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-xl bg-emerald-600" />
            <div>
              <div className="font-bold">CHAFU MATCHA — {OUTLET}</div>
              <div className="text-[11px] text-neutral-500">Masuk: {user.email}{isOwner?" · owner":" · staff"}</div>
            </div>
          </div>
          <nav className="flex gap-2">
            {isOwner && <button onClick={()=>{ setTab("dashboard"); loadDashboard(); }} className={`px-3 py-1.5 rounded-lg border ${tab==="dashboard"?"bg-emerald-50 border-emerald-200":"bg-white"}`}>Dashboard</button>}
            <button onClick={()=>setTab("pos")} className={`px-3 py-1.5 rounded-lg border ${tab==="pos"?"bg-emerald-50 border-emerald-200":"bg-white"}`}>Kasir</button>
            <button onClick={()=>{ setTab("history"); loadHistory(false); }} className={`px-3 py-1.5 rounded-lg border ${tab==="history"?"bg-emerald-50 border-emerald-200":"bg-white"}`}>Riwayat</button>
            {isOwner && <button onClick={()=>setTab("products")} className={`px-3 py-1.5 rounded-lg border ${tab==="products"?"bg-emerald-50 border-emerald-200":"bg-white"}`}>Produk</button>}
            {isOwner && <button onClick={()=>setTab("inventory")} className={`px-3 py-1.5 rounded-lg border ${tab==="inventory"?"bg-emerald-50 border-emerald-200":"bg-white"}`}>Inventori</button>}
            {isOwner && <button onClick={()=>setTab("settings")} className={`px-3 py-1.5 rounded-lg border ${tab==="settings"?"bg-emerald-50 border-emerald-200":"bg-white"}`}>Pengaturan</button>}
            <button onClick={doLogout} className="px-3 py-1.5 rounded-lg border bg-rose-50">Keluar</button>
          </nav>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-3 sm:px-4 md:px-6 py-4">
        {/* Low stock banner */}
        {lowStockList.length > 0 && (
          <div className="mb-3 p-3 rounded-xl border bg-amber-50 text-sm">
            <div className="font-semibold mb-1">Stok menipis:</div>
            <div className="flex flex-wrap gap-2">
              {lowStockList.map(x=>(
                <span key={x.id} className="px-2 py-1 rounded bg-white border">
                  {x.name} • sisa {x.stock} {x.unit} {(x.min||0)>0 && `(min ${x.min})`}
                </span>
              ))}
            </div>
          </div>
        )}

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
            {/* KPIs + filter */}
            <div className="flex items-center justify-between gap-3">
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <KPI title="Omzet" value={IDR(todayStats.omzet)} />
                <KPI title="Transaksi" value={String(todayStats.trx)} />
                <KPI title="Avg Ticket" value={IDR(todayStats.avg)} />
                <KPI title="Cash" value={IDR(todayStats.cash)} />
                <KPI title="eWallet/QRIS" value={IDR(todayStats.ewallet + todayStats.qris)} />
              </div>
              <select className="border rounded-lg px-2 py-1"
                      value={dateRange}
                      onChange={e=>{ setDateRange(e.target.value as any); loadDashboard(); }}>
                <option value="today">Hari ini</option>
                <option value="7d">7 hari</option>
                <option value="30d">30 hari</option>
              </select>
            </div>

            {/* Top items + trend */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-white border rounded-2xl p-4">
                <div className="font-semibold mb-2">5 Menu Terlaris</div>
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
                <div className="font-semibold mb-2">Trend</div>
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

                  {/* redeem */}
                  <label className="flex items-center justify-between text-sm">
                    <span>Redeem Poin</span>
                    <input type="number" className="border rounded-lg px-2 py-1 w-28"
                      value={redeemPts}
                      onChange={(e)=>{
                        const v = Math.max(0, Number(e.target.value)||0);
                        const maxPts = (customerPoints||0);
                        setRedeemPts(Math.min(v, maxPts));
                      }} />
                  </label>
                  {redeemPts>0 && <div className="text-xs text-neutral-500">Redeem: {redeemPts} pts = {IDR(redeemValue)}</div>}

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
                      subtotal, discount: effectiveDiscount||0, tax: taxVal, service: svcVal, total, payMethod, cash, change
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
                <thead><tr className="text-left border-b">
                  <th className="py-2">Waktu</th><th>Kasir</th><th>Pelanggan</th><th>Item</th><th className="text-right">Total</th>
                </tr></thead>
                <tbody>
                  {historyRows.map(s=>(
                    <tr key={s.id} className="border-b hover:bg-emerald-50/40">
                      <td className="py-2">{s.time? new Date(s.time.toDate()).toLocaleString("id-ID",{hour12:false}) : "-"}</td>
                      <td>{s.cashierEmail}</td>
                      <td>{s.customerPhone || "-"}</td>
                      <td className="truncate">{s.items.map(i=>`${i.name}x${i.qty}`).join(", ")}</td>
                      <td className="text-right font-medium">{IDR(s.total)}</td>
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
              <button className="px-3 py-2 rounded-lg border" onClick={()=>setEditProduct({ id: uid(), name:"Produk Baru", price:10000, category:"Signature", active:true })}>+ Tambah</button>
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
                        <div className="flex justify-end gap-2">
                          <button className="px-2 py-1 border rounded" onClick={()=>setEditProduct({...p})}>Edit</button>
                          <button className="px-2 py-1 border rounded" onClick={()=>openRecipeEditor(p)}>Resep</button>
                          <button className="px-2 py-1 border rounded" onClick={()=>deactivateProduct(p.id)}>Nonaktifkan</button>
                          <button className="px-2 py-1 border rounded" onClick={()=>deleteProductHard(p.id)}>Hapus</button>
                        </div>
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
              <button className="px-3 py-2 rounded-lg border" onClick={()=>setEditIngredient({ id: uid(), name:"Bahan Baru", unit:"gr", stock:0, min:0 })}>+ Tambah</button>
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
                        <div className="flex justify-end gap-2">
                          <button className="px-2 py-1 border rounded" onClick={()=>setEditIngredient({...i})}>Edit</button>
                          <button className="px-2 py-1 border rounded" onClick={()=>deleteIngredientHard(i.id)}>Hapus</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {ingredients.length===0 && <div className="text-sm text-neutral-500">Belum ada data inventori.</div>}
            </div>
          </section>
        )}

        {/* SETTINGS (whitelist staf sederhana) */}
        {tab==="settings" && isOwner && (
          <section className="bg-white rounded-2xl border p-3 space-y-3">
            <h2 className="text-lg font-semibold">Pengaturan & Staf</h2>
            <div className="p-3 rounded-lg border bg-neutral-50">
              <div className="font-medium mb-2">Whitelist Staf (users)</div>
              <table className="w-full text-sm">
                <thead><tr className="text-left border-b"><th>Email</th><th>Role</th></tr></thead>
                <tbody>
                  {staffList.map(u=>(
                    <tr key={u.email} className="border-b">
                      <td className="py-2">{u.email}</td>
                      <td>{u.role}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-3 flex gap-2">
                <button className="px-3 py-2 rounded-lg border" onClick={async ()=>{
                  const em = prompt("Email staf baru:")?.trim();
                  if(!em) return;
                  await setDoc(doc(db,"users", em), { email: em, role:"staff", outlet: OUTLET }, { merge:true });
                  alert("Ditambahkan. Buat akun Auth via Firebase Console (Email/Password) dengan email yang sama.");
                }}>+ Tambah Staf</button>
              </div>
              <p className="text-xs text-neutral-500 mt-2">
                * Ini hanya whitelist tampilan. Pembuatan akun Auth tetap lewat Firebase Console agar tidak logout owner.
              </p>
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

      {/* Modal Edit Product */}
      {editProduct && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={()=>setEditProduct(null)}>
          <div className="bg-white rounded-2xl p-4 w-full max-w-md" onClick={e=>e.stopPropagation()}>
            <h3 className="font-semibold mb-3">{editProduct.id && products.find(p=>p.id===editProduct.id) ? "Edit Produk" : "Tambah Produk"}</h3>
            <div className="grid gap-2">
              <label className="text-sm">Nama
                <input className="border rounded-lg px-3 py-2 w-full" value={editProduct.name||""} onChange={e=>setEditProduct({...editProduct, name:e.target.value})}/>
              </label>
              <label className="text-sm">Kategori
                <input className="border rounded-lg px-3 py-2 w-full" value={editProduct.category||"Signature"} onChange={e=>setEditProduct({...editProduct, category:e.target.value})}/>
              </label>
              <label className="text-sm">Harga
                <input type="number" className="border rounded-lg px-3 py-2 w-full" value={Number(editProduct.price||0)} onChange={e=>setEditProduct({...editProduct, price:Number(e.target.value)||0})}/>
              </label>
              <label className="text-sm flex items-center gap-2">
                <input type="checkbox" checked={editProduct.active!==false} onChange={e=>setEditProduct({...editProduct, active:e.target.checked})}/>
                Aktif
              </label>
            </div>
            <div className="mt-3 flex gap-2 justify-end">
              <button className="px-3 py-2 rounded-lg border" onClick={()=>setEditProduct(null)}>Batal</button>
              <button className="px-3 py-2 rounded-lg bg-emerald-600 text-white" onClick={async ()=>{
                await upsertProduct(editProduct as any);
                setEditProduct(null);
              }}>Simpan</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Edit Ingredient */}
      {editIngredient && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={()=>setEditIngredient(null)}>
          <div className="bg-white rounded-2xl p-4 w-full max-w-md" onClick={e=>e.stopPropagation()}>
            <h3 className="font-semibold mb-3">{editIngredient.id && ingredients.find(i=>i.id===editIngredient.id) ? "Edit Bahan" : "Tambah Bahan"}</h3>
            <div className="grid gap-2">
              <label className="text-sm">Nama
                <input className="border rounded-lg px-3 py-2 w-full" value={editIngredient.name||""} onChange={e=>setEditIngredient({...editIngredient, name:e.target.value})}/>
              </label>
              <label className="text-sm">Satuan
                <input className="border rounded-lg px-3 py-2 w-full" value={editIngredient.unit||"gr"} onChange={e=>setEditIngredient({...editIngredient, unit:e.target.value})}/>
              </label>
              <label className="text-sm">Stok
                <input type="number" className="border rounded-lg px-3 py-2 w-full" value={Number(editIngredient.stock||0)} onChange={e=>setEditIngredient({...editIngredient, stock:Number(e.target.value)||0})}/>
              </label>
              <label className="text-sm">Min. Stok
                <input type="number" className="border rounded-lg px-3 py-2 w-full" value={Number(editIngredient.min||0)} onChange={e=>setEditIngredient({...editIngredient, min:Number(e.target.value)||0})}/>
              </label>
            </div>
            <div className="mt-3 flex gap-2 justify-end">
              <button className="px-3 py-2 rounded-lg border" onClick={()=>setEditIngredient(null)}>Batal</button>
              <button className="px-3 py-2 rounded-lg bg-emerald-600 text-white" onClick={async ()=>{
                await upsertIngredient(editIngredient as any);
                setEditIngredient(null);
              }}>Simpan</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Recipe Editor */}
      {editRecipeFor && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={()=>setEditRecipeFor(null)}>
          <div className="bg-white rounded-2xl p-4 w-full max-w-xl" onClick={e=>e.stopPropagation()}>
            <h3 className="font-semibold mb-3">Resep: {editRecipeFor.name}</h3>
            <div className="space-y-2">
              {recipeDraft.map((r,idx)=>(
                <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                  <select className="col-span-6 border rounded-lg px-2 py-2"
                    value={r.ingredientId}
                    onChange={e=>updateRecipeRow(idx,{ ingredientId: e.target.value })}>
                    <option value="">— pilih bahan —</option>
                    {ingredients.map(i=><option key={i.id} value={i.id}>{i.name}</option>)}
                  </select>
                  <input type="number" className="col-span-3 border rounded-lg px-2 py-2" placeholder="Qty" value={r.qty} onChange={e=>updateRecipeRow(idx,{ qty: Number(e.target.value)||0 })}/>
                  <input className="col-span-2 border rounded-lg px-2 py-2" placeholder="Unit" value={r.unit||""} onChange={e=>updateRecipeRow(idx,{ unit: e.target.value })}/>
                  <button className="col-span-1 border rounded-lg px-2 py-2" onClick={()=>removeRecipeRow(idx)}>x</button>
                </div>
              ))}
              <button className="px-3 py-2 rounded-lg border" onClick={addRecipeRow}>+ Tambah Bahan</button>
            </div>
            <div className="mt-3 flex gap-2 justify-end">
              <button className="px-3 py-2 rounded-lg border" onClick={()=>setEditRecipeFor(null)}>Batal</button>
              <button className="px-3 py-2 rounded-lg bg-emerald-600 text-white" onClick={saveRecipe}>Simpan Resep</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
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