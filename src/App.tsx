// src/App.tsx
// NamiPOS v2.5.2 (Stable) — Full features merged:
// POS, Dashboard, Products CRUD (imageUrl, activate/deactivate, delete), Inventory, Recipes (auto deduct),
// Shift open/close, History (admin delete), Loyalty (15k=1pt, 10pt free drink), Public Order (/order)
// Delivery fee: Rp2.000/km, first 1 km free

import React, { useEffect, useMemo, useState } from "react";
import {
  addDoc, collection, deleteDoc, doc, getDoc, getDocs, limit, onSnapshot, orderBy, query,
  serverTimestamp, setDoc, startAfter, Timestamp, updateDoc, where
} from "firebase/firestore";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { auth, db } from "./lib/firebase";

/* =========================
   CONFIG
========================= */
const OUTLET = "MTHaryono";
const OWNER_EMAILS = new Set<string>([
  "antonius.arman123@gmail.com",
  "ayuismaalabibbah@gmail.com"
]);

const LOGO_SRC = "/logo.png";          // letakkan di /public/logo.png
const QRIS_IMG_SRC = "/qris.png";      // opsional: /public/qris.png

// Delivery fee (2.000/km, first 1km free)
const DELIVERY_RATE_PER_KM = 2000;
const DELIVERY_FREE_FIRST_KM = 1;

// Loyalty: 15.000 = 1 poin; 10 poin = free 1 minuman
const LOYAL_POINT_VALUE = 15000;
const LOYAL_REDEEM_THRESHOLD = 10;

/* =========================
   TYPES
========================= */
type Product = {
  id: string; name: string; price: number;
  category?: string; active?: boolean; outlet?: string;
  imageUrl?: string;
};

type Ingredient = { id: string; name: string; unit: string; stock: number; min?: number; outlet?: string; };

type RecipeDoc = {
  id: string;
  productId: string;
  items: { ingredientId: string; qty: number }[];
};

type CartItem = { id: string; productId: string; name: string; price: number; qty: number; note?: string; };

type Shift = {
  id: string; outlet: string;
  openBy: string; openAt: Timestamp;
  closeAt?: Timestamp|null; isOpen: boolean; openCash?: number;
};

type Sale = {
  id?: string;
  outlet: string;
  shiftId: string|null;
  cashierEmail: string;
  time: any;
  items: { name: string; price: number; qty: number; note?: string }[];
  subtotal: number; discount: number; tax: number; service: number; total: number;
  payMethod: "cash"|"ewallet"|"qris";
  cash?: number; change?: number;
  customerPhone?: string|null; customerName?: string|null;
  pointsEarned?: number; pointsRedeemed?: number;
};

type PublicOrder = {
  id?: string;
  outlet: string;
  customerName: string;
  customerPhone: string;
  address: string;
  distanceKm: number;
  deliveryFee: number;
  items: { name: string; qty: number; price: number }[];
  subtotal: number;
  total: number;
  payMethod: "cod"|"qris";
  status: "pending"|"accepted"|"rejected"|"delivered";
  time: any;
};

/* =========================
   UTILS
========================= */
const IDR = (n:number)=> new Intl.NumberFormat("id-ID",{style:"currency",currency:"IDR",maximumFractionDigits:0}).format(n||0);
const uid = ()=> Math.random().toString(36).slice(2,10);
const round1 = (n:number)=> Math.round(n*10)/10;
function calcOngkir(distanceKm:number){
  const d = round1(Number(distanceKm||0));
  const billable = Math.max(0, d - DELIVERY_FREE_FIRST_KM);
  return Math.round(billable * DELIVERY_RATE_PER_KM);
}
const startOfDay = (d = new Date())=>{ const x = new Date(d); x.setHours(0,0,0,0); return x; };
const endOfDay   = (d = new Date())=>{ const x = new Date(d); x.setHours(23,59,59,999); return x; };

/* =========================
   PUBLIC ORDER PAGE (no auth)
========================= */
function PublicOrderPage({ products }: { products: Product[] }) {
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [address, setAddress] = useState("");
  const [distanceKm, setDistanceKm] = useState<number>(1);
  const [orderCart, setOrderCart] = useState<{id:string;name:string;price:number;qty:number}[]>([]);
  const [payMethod, setPayMethod] = useState<"cod"|"qris">("cod");

  const subtotal = orderCart.reduce((s,i)=>s+i.price*i.qty, 0);
  const deliveryFee = calcOngkir(distanceKm);
  const total = subtotal + deliveryFee;

  function add(p: Product){
    if(p.active===false) return;
    setOrderCart(prev=>{
      const f = prev.find(x=>x.id===p.id);
      if(f) return prev.map(x=>x.id===p.id?{...x, qty:x.qty+1}:x);
      return [...prev, { id:p.id, name:p.name, price:p.price, qty:1 }];
    });
  }
  function dec(id:string){ setOrderCart(prev=> prev.map(x=> x.id===id?{...x, qty: Math.max(1,x.qty-1)}:x)); }
  function rm(id:string){ setOrderCart(prev=> prev.filter(x=>x.id!==id)); }

  async function submit(){
    if(!customerName || !customerPhone || !address) return alert("Lengkapi data pelanggan.");
    if(orderCart.length===0) return alert("Keranjang kosong.");
    const payload: Omit<PublicOrder,"id"> = {
      outlet: OUTLET,
      customerName, customerPhone, address,
      distanceKm: round1(distanceKm),
      deliveryFee,
      items: orderCart.map(i=>({ name:i.name, qty:i.qty, price:i.price })),
      subtotal, total, payMethod,
      status: "pending",
      time: serverTimestamp()
    };
    await addDoc(collection(db,"public_orders"), payload as any);
    alert("Pesanan terkirim. Terima kasih!");
    setOrderCart([]); setCustomerName(""); setCustomerPhone(""); setAddress(""); setDistanceKm(1); setPayMethod("cod");
  }

  return (
    <div className="min-h-screen bg-white p-4 max-w-3xl mx-auto">
      <img src={LOGO_SRC} alt="Logo" className="w-16 mb-2" />
      <h1 className="text-xl font-bold mb-2">Order Antar — NamiPOS</h1>
      <p className="text-xs text-neutral-500 mb-3">Outlet: {OUTLET}</p>

      <div className="grid gap-2 mb-4">
        <input className="border rounded p-2" placeholder="Nama" value={customerName} onChange={e=>setCustomerName(e.target.value)} />
        <input className="border rounded p-2" placeholder="Nomor WA" value={customerPhone} onChange={e=>setCustomerPhone(e.target.value)} />
        <textarea className="border rounded p-2" placeholder="Alamat Lengkap" value={address} onChange={e=>setAddress(e.target.value)} />
        <input type="number" min={0} step={0.1} className="border rounded p-2" placeholder="Jarak (km)" value={distanceKm} onChange={e=>setDistanceKm(Number(e.target.value)||0)} />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-3">
        {products.filter(p=>p.active!==false).map(p=>(
          <button key={p.id} onClick={()=>add(p)} className="border rounded-xl p-3 text-left hover:shadow bg-white">
            <img src={p.imageUrl||LOGO_SRC} className="h-24 w-full object-cover rounded mb-1" />
            <div className="font-semibold leading-tight">{p.name}</div>
            <div className="text-sm">{IDR(p.price)}</div>
          </button>
        ))}
      </div>

      <div className="p-3 border rounded-xl bg-neutral-50 mb-3">
        <h3 className="font-semibold mb-2">Ringkasan</h3>
        {orderCart.length===0 && <div className="text-sm text-neutral-500">Belum ada item.</div>}
        {orderCart.map(i=>(
          <div key={i.id} className="text-sm flex justify-between items-center py-1">
            <div>{i.name} x{i.qty}</div>
            <div className="flex items-center gap-2">
              <button className="border rounded px-2" onClick={()=>dec(i.id)}>-</button>
              <button className="border rounded px-2" onClick={()=>rm(i.id)}>x</button>
              <span>{IDR(i.price*i.qty)}</span>
            </div>
          </div>
        ))}
        <div className="text-sm flex justify-between"><span>Ongkir</span><span>{IDR(deliveryFee)}</span></div>
        <div className="font-bold flex justify-between mt-1"><span>Total</span><span>{IDR(total)}</span></div>
      </div>

      <div className="mb-3">
        <label className="text-sm block mb-1">Metode Pembayaran</label>
        <select className="border rounded p-2 w-full" value={payMethod} onChange={e=>setPayMethod(e.target.value as any)}>
          <option value="cod">COD (Bayar di Tempat)</option>
          <option value="qris">QRIS</option>
        </select>
      </div>
      {payMethod==="qris" && <img src={QRIS_IMG_SRC} alt="QR" className="w-40 mb-2" />}

      <button onClick={submit} className="bg-emerald-600 text-white rounded p-3 w-full">Kirim Pesanan</button>
    </div>
  );
}

/* =========================
   MAIN APP (POS + Admin)
========================= */
export default function App(){
  // Routing minimal ke /order tanpa login
  const isPublicOrder = typeof window !== "undefined" && window.location.pathname.startsWith("/order");

  // Auth
  const [user, setUser] = useState<{email:string}|null>(null);
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [authLoading, setAuthLoading] = useState(false);
  const isOwner = !!(user?.email && OWNER_EMAILS.has(user.email));

  // Tabs
  const [tab, setTab] = useState<"pos"|"history"|"products"|"inventory"|"dashboard">("pos");

  // Master data
  const [products, setProducts] = useState<Product[]>([]);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [recipes, setRecipes] = useState<RecipeDoc[]>([]);

  // POS
  const [queryText, setQueryText] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [noteInput, setNoteInput] = useState("");
  const [discount, setDiscount] = useState(0);
  const [taxPct, setTaxPct] = useState(0);
  const [svcPct, setSvcPct] = useState(0);
  const [payMethod, setPayMethod] = useState<"cash"|"ewallet"|"qris">("cash");
  const [cash, setCash] = useState(0);

  // Loyalty
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPoints, setCustomerPoints] = useState<number|null>(null);
  const [redeemFree, setRedeemFree] = useState(false);

  // Shift
  const [activeShift, setActiveShift] = useState<Shift|null>(null);
  const [openCash, setOpenCash] = useState<number>(0);

  // History
  const [history, setHistory] = useState<Sale[]>([]);
  const [histCursor, setHistCursor] = useState<any>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Dashboard
  const [todayOmzet, setTodayOmzet] = useState(0);
  const [todayTrx, setTodayTrx] = useState(0);
  const [topToday, setTopToday] = useState<{name:string;qty:number}[]>([]);

  // Computed
  const filteredProducts = useMemo(()=> products.filter(p=> (p.active!==false) && p.name.toLowerCase().includes(queryText.toLowerCase())), [products, queryText]);
  const subtotal = useMemo(()=> cart.reduce((s,i)=> s + i.price*i.qty, 0), [cart]);
  const taxVal = Math.round(subtotal * (taxPct/100));
  const svcVal = Math.round(subtotal * (svcPct/100));
  const redeemValue = redeemFree ? Math.min(subtotal, Math.max(...cart.map(i=>i.price), 0)) : 0; // gratis 1 minuman = harga tertinggi di keranjang
  const total = Math.max(0, subtotal + taxVal + svcVal - (discount||0) - redeemValue);
  const change = Math.max(0, (cash||0) - total);

  // AUTH
  useEffect(()=>{
    const unsub = onAuthStateChanged(auth, u => setUser(u?.email ? {email:u.email}: null));
    return ()=>unsub();
  },[]);

  // DATA
  useEffect(()=>{
    // products
    const qp = query(collection(db,"products"), where("outlet","==",OUTLET));
    const unp = onSnapshot(qp, snap=>{
      const rows: Product[] = snap.docs.map(d=>{
        const x = d.data() as any;
        return {
          id:d.id,
          name:x.name, price:Number(x.price)||0,
          category:x.category||"Signature",
          active: x.active!==false,
          outlet: x.outlet||OUTLET,
          imageUrl: x.imageUrl || x.imgUrl || LOGO_SRC,
        };
      });
      setProducts(rows);
    });
    // ingredients
    const qi = query(collection(db,"ingredients"), where("outlet","==",OUTLET));
    const uni = onSnapshot(qi, snap=>{
      const rows: Ingredient[] = snap.docs.map(d=>({ id:d.id, ...(d.data() as any) }));
      setIngredients(rows);
    });
    // recipes
    const qr = query(collection(db,"recipes"), where("outlet","==",OUTLET));
    const unr = onSnapshot(qr, snap=>{
      const rows: RecipeDoc[] = snap.docs.map(d=>({ id:d.id, ...(d.data() as any) }));
      setRecipes(rows);
    });
    return ()=>{ unp(); uni(); unr(); };
  },[]);

  // Loyalty lookup by phone
  useEffect(()=>{
    const phone = customerPhone.trim();
    if(phone.length < 8){ setCustomerPoints(null); return; }
    (async ()=>{
      try{
        const ref = doc(db,"customers", phone);
        const s = await getDoc(ref);
        if(s.exists()){
          const c = s.data() as any;
          setCustomerName(c.name||""); setCustomerPoints(c.points||0);
        }else{
          setCustomerPoints(0);
        }
      }catch{}
    })();
  },[customerPhone]);

  // SHIFT helpers
  async function checkActiveShift(){
    const qs = query(collection(db,"shifts"),
      where("outlet","==",OUTLET),
      where("isOpen","==",true),
      orderBy("openAt","desc"),
      limit(1)
    );
    const s = await getDocs(qs);
    if(s.empty){ setActiveShift(null); return; }
    const d = s.docs[0]; const x = d.data() as any;
    setActiveShift({ id:d.id, outlet:x.outlet, openBy:x.openBy, openAt:x.openAt, closeAt:x.closeAt??null, isOpen:true, openCash:x.openCash??0 });
  }
  useEffect(()=>{ checkActiveShift().catch(()=>{}); },[]);

  async function openShiftAction(){
    if(!user?.email) return alert("Belum login.");
    const id = `SHIFT-${Date.now()}`;
    await setDoc(doc(db,"shifts", id), { outlet: OUTLET, openBy: user.email, openAt: serverTimestamp(), closeAt:null, isOpen:true, openCash });
    setOpenCash(0);
    await checkActiveShift();
  }
  async function closeShiftAction(){
    if(!activeShift?.id) return alert("Tidak ada shift aktif.");
    await updateDoc(doc(db,"shifts", activeShift.id), { isOpen:false, closeAt: serverTimestamp() });
    setActiveShift(null);
    alert("Shift ditutup.");
  }

  // POS handlers
  function addToCart(p: Product){
    setCart(prev=>{
      const f = prev.find(ci=> ci.productId===p.id && (ci.note||"")===(noteInput||""));
      if(f) return prev.map(ci=> ci===f? {...ci, qty:ci.qty+1 } : ci);
      return [...prev, { id: uid(), productId: p.id, name: p.name, price: p.price, qty: 1, note: noteInput||undefined }];
    });
  }
  const inc = (id:string)=> setCart(prev=> prev.map(ci=> ci.id===id? {...ci, qty:ci.qty+1 }:ci));
  const dec = (id:string)=> setCart(prev=> prev.map(ci=> ci.id===id? {...ci, qty:Math.max(1,ci.qty-1) }:ci));
  const rm  = (id:string)=> setCart(prev=> prev.filter(ci=> ci.id!==id));
  const clearCart = ()=> { setCart([]); setDiscount(0); setTaxPct(0); setSvcPct(0); setCash(0); setPayMethod("cash"); setNoteInput(""); setRedeemFree(false); setCustomerName(""); setCustomerPhone(""); setCustomerPoints(null); };

  // Inventory: check & deduct
  function getRecipeFor(productId:string){ return recipes.find(r=> r.productId===productId); }

  async function checkAndDeductStock(items: CartItem[]){
    // build requirements
    const needs: Record<string, number> = {};
    for(const it of items){
      const r = getRecipeFor(it.productId);
      if(!r) continue; // no recipe → no stock needed
      r.items.forEach(ri=>{
        needs[ri.ingredientId] = (needs[ri.ingredientId]||0) + ri.qty * it.qty;
      });
    }
    // check
    const lack: { name:string; need:number; have:number; unit:string }[] = [];
    for(const ingId of Object.keys(needs)){
      const need = needs[ingId];
      const ing = ingredients.find(x=>x.id===ingId);
      if(!ing){ lack.push({ name:`#${ingId}`, need, have:0, unit:"" }); continue; }
      if((ing.stock||0) < need){
        lack.push({ name:ing.name, need, have:ing.stock||0, unit:ing.unit });
      }
    }
    if(lack.length){
      const msg = lack.map(l=>`- ${l.name}: perlu ${l.need}${l.unit}, tersedia ${l.have}${l.unit}`).join("\n");
      alert("Stok tidak cukup untuk transaksi ini:\n"+msg);
      return false;
    }
    // deduct
    for(const ingId of Object.keys(needs)){
      const ing = ingredients.find(x=>x.id===ingId); if(!ing) continue;
      await updateDoc(doc(db,"ingredients", ing.id), { stock: Math.max(0, (ing.stock||0) - needs[ingId]) });
    }
    return true;
  }

  // Loyalty calc
  function calcEarnedPoints(amount:number){ return Math.floor((amount||0) / LOYAL_POINT_VALUE); }

  // Print 80mm
  function printReceipt(rec: Omit<Sale,"id"> & {saleId?:string}){
    const itemsHtml = rec.items.map(i=>`<tr><td>${i.name}${i.note?`<div style='font-size:10px;opacity:.7'>${i.note}</div>`:""}</td><td style='text-align:center'>${i.qty}x</td><td style='text-align:right'>${IDR(i.price*i.qty)}</td></tr>`).join("");
    const w = window.open("", "_blank", "width=380,height=600"); if(!w) return;
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
  <img src="${LOGO_SRC}" class="logo"/>
  <h2>NamiPOS — ${OUTLET}</h2>
  <div class="meta">${rec.saleId||"DRAFT"}<br/>${new Date().toLocaleString("id-ID",{hour12:false})}</div>
  <hr/>
  <table style="width:100%;border-collapse:collapse">
    ${itemsHtml}
    <tr class="tot"><td>Subtotal</td><td></td><td style="text-align:right">${IDR(rec.subtotal)}</td></tr>
    ${rec.tax?`<tr class="tot"><td>Pajak</td><td></td><td style="text-align:right">${IDR(rec.tax)}</td></tr>`:""}
    ${rec.service?`<tr class="tot"><td>Service</td><td></td><td style="text-align:right">${IDR(rec.service)}</td></tr>`:""}
    ${rec.discount?`<tr class="tot"><td>Diskon</td><td></td><td style="text-align:right">-${IDR(rec.discount)}</td></tr>`:""}
    ${rec.pointsRedeemed?`<tr class="tot"><td>Redeem Poin</td><td></td><td style="text-align:right">-${IDR(redeemValue)}</td></tr>`:""}
    <tr class="tot"><td>Total</td><td></td><td style="text-align:right">${IDR(rec.total)}</td></tr>
    ${rec.payMethod==="cash"
      ? `<tr><td>Tunai</td><td></td><td style='text-align:right'>${IDR(rec.cash||0)}</td></tr>
         <tr><td>Kembali</td><td></td><td style='text-align:right'>${IDR(rec.change||0)}</td></tr>`
      : `<tr><td>Metode</td><td></td><td style='text-align:right'>${rec.payMethod.toUpperCase()}</td></tr>`}
  </table>
  <p class="meta">Terima kasih! Follow @namipos</p>
</div>
<script>window.print()</script></body></html>`;
    w.document.write(html); w.document.close();
  }

  // Finalize sale
  async function finalize(){
    if(!user?.email) return alert("Belum login.");
    if(!activeShift?.id) return alert("Buka shift dahulu.");
    if(cart.length===0) return alert("Keranjang kosong.");
    if(payMethod==="cash" && cash<total) return alert("Uang tunai kurang.");

    // check stock & deduct
    const ok = await checkAndDeductStock(cart);
    if(!ok) return;

    // loyalty
    const phone = customerPhone.trim();
    const earned = calcEarnedPoints(total);
    const redeemed = redeemFree ? LOYAL_REDEEM_THRESHOLD : 0;

    const payload: Omit<Sale,"id"> = {
      outlet: OUTLET, shiftId: activeShift.id, cashierEmail: user.email,
      time: serverTimestamp(),
      items: cart.map(i=>({ name:i.name, price:i.price, qty:i.qty, ...(i.note?{note:i.note}:{}) })),
      subtotal, discount: discount||0, tax: taxVal, service: svcVal, total, payMethod,
      ...(payMethod==="cash"?{ cash, change }:{ }), customerPhone: phone||null, customerName: customerName||null,
      pointsEarned: earned, pointsRedeemed: redeemed
    };

    const ref = await addDoc(collection(db,"sales"), payload as any);

    // loyalty update
    if(phone.length>=8){
      const cref = doc(db,"customers", phone);
      const s = await getDoc(cref);
      if(s.exists()){
        const c = s.data() as any;
        const before = Number(c.points||0);
        const after = Math.max(0, before + earned - redeemed);
        await updateDoc(cref, { name: customerName||c.name||"", points: after, lastVisit: serverTimestamp() });
      }else{
        await setDoc(cref, { phone, name: customerName||"Member", points: Math.max(0, earned - redeemed), lastVisit: serverTimestamp() });
      }
    }

    printReceipt({ ...payload, saleId: ref.id });
    clearCart();
    if(tab==="history") await loadHistory(false);
    await refreshDashboard();
  }

  // History
  async function loadHistory(append:boolean){
    setHistoryLoading(true);
    try{
      const cons:any[] = [ where("outlet","==",OUTLET), orderBy("time","desc"), limit(50) ];
      if(append && histCursor) cons.push(startAfter(histCursor));
      const qh = query(collection(db,"sales"), ...cons);
      const s = await getDocs(qh);
      const rows: Sale[] = s.docs.map(d=>({ id:d.id, ...(d.data() as any) }));
      setHistory(prev=> append? [...prev, ...rows] : rows);
      setHistCursor(s.docs.length? s.docs[s.docs.length-1]: null);
    }finally{ setHistoryLoading(false); }
  }
  async function deleteSale(id:string){
    if(!isOwner) return alert("Khusus admin/owner.");
    if(!confirm("Hapus transaksi ini?")) return;
    await deleteDoc(doc(db,"sales", id));
    await loadHistory(false);
  }

  // Dashboard
  async function refreshDashboard(){
    const qToday = query(
      collection(db,"sales"),
      where("outlet","==",OUTLET),
      where("time", ">=", Timestamp.fromDate(startOfDay())),
      where("time", "<=", Timestamp.fromDate(endOfDay()))
    );
    const s = await getDocs(qToday);
    let omzet=0, trx=0;
    const cnt = new Map<string, number>();
    s.forEach(d=>{
      const x = d.data() as any;
      omzet += x.total||0; trx += 1;
      (x.items||[]).forEach((it:any)=> cnt.set(it.name, (cnt.get(it.name)||0) + (it.qty||0)));
    });
    setTodayOmzet(omzet); setTodayTrx(trx);
    const top = Array.from(cnt.entries()).map(([name,qty])=>({name,qty})).sort((a,b)=>b.qty-a.qty).slice(0,5);
    setTopToday(top);
  }
  useEffect(()=>{ refreshDashboard().catch(()=>{}); },[]);

  // PRODUCTS CRUD
  async function upsertProduct(p: Partial<Product> & { id?: string }){
    if(!isOwner) return alert("Akses khusus owner.");
    const id = p.id || uid();
    const payload = {
      outlet: OUTLET,
      name: (p.name||"Produk").trim(),
      price: Number(p.price)||0,
      category: (p.category||"Signature").trim(),
      active: p.active!==false,
      imageUrl: (p.imageUrl || LOGO_SRC).trim(),
    };
    await setDoc(doc(db,"products", id), payload, { merge:true });
  }
  async function deactivateProduct(id:string){ if(!isOwner) return alert("Khusus owner"); await updateDoc(doc(db,"products", id), { active:false }); }
  async function activateProduct(id:string){ if(!isOwner) return alert("Khusus owner"); await updateDoc(doc(db,"products", id), { active:true }); }
  async function deleteProduct(id:string){ if(!isOwner) return alert("Khusus owner"); if(!confirm("Hapus produk ini?")) return; await deleteDoc(doc(db,"products", id)); }

  // INVENTORY CRUD (sederhana: tambah/edit di Firestore langsung dari tabel)
  async function upsertIngredient(i: Partial<Ingredient> & { id?:string }){
    if(!isOwner) return alert("Khusus owner");
    const id = i.id || uid();
    const payload = {
      outlet: OUTLET,
      name: (i.name||"Bahan").trim(),
      unit: (i.unit||"pcs").trim(),
      stock: Number(i.stock)||0,
      min: Number(i.min)||0,
    };
    await setDoc(doc(db,"ingredients", id), payload, { merge:true });
  }
  async function deleteIngredient(id:string){ if(!isOwner) return alert("Khusus owner"); if(!confirm("Hapus bahan ini?")) return; await deleteDoc(doc(db,"ingredients", id)); }

  // RECIPE CRUD minimal (link product -> ingredients)
  async function setRecipeForProduct(productId:string, items: {ingredientId:string; qty:number}[]){
    if(!isOwner) return alert("Khusus owner");
    const id = `REC-${productId}`;
    await setDoc(doc(db,"recipes", id), { id, outlet: OUTLET, productId, items }, { merge:true });
  }

  // AUTH handlers
  async function doLogin(e?:React.FormEvent){ e?.preventDefault(); setAuthLoading(true);
    try{ await signInWithEmailAndPassword(auth, email.trim(), password); setEmail(""); setPassword(""); setTab("pos"); }
    catch(e:any){ alert("Login gagal: "+(e?.message||e)); } finally{ setAuthLoading(false); } }
  async function doLogout(){ await signOut(auth); }

  // PUBLIC ORDER ROUTE (no login)
  if(isPublicOrder){
    return <PublicOrderPage products={products} />;
  }

  // LOGIN PAGE
  if(!user){
    return (
      <div className="min-h-screen bg-gradient-to-br from-emerald-50 to-white flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-6 border">
          <div className="flex items-center gap-3 mb-4">
            <img src={LOGO_SRC} className="h-10 w-10 rounded-xl" />
            <div>
              <h1 className="text-2xl font-bold">NamiPOS — Login</h1>
              <p className="text-xs text-neutral-500">@{OUTLET}</p>
            </div>
          </div>
          <form onSubmit={doLogin} className="space-y-3">
            <input className="w-full border rounded-lg p-3" placeholder="Email" value={email} onChange={e=>setEmail(e.target.value)} />
            <input className="w-full border rounded-lg p-3" placeholder="Password" type="password" value={password} onChange={e=>setPassword(e.target.value)} />
            <button disabled={authLoading} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg p-3">{authLoading?"Masuk...":"Masuk"}</button>
          </form>
          <a href="/order" className="mt-3 block text-center text-emerald-600 text-sm underline">Buka halaman Order Pelanggan</a>
        </div>
      </div>
    );
  }

  // MAIN UI
  return (
    <div className="min-h-screen bg-neutral-50">
      {/* Topbar */}
      <header className="sticky top-0 z-30 bg-white/80 backdrop-blur border-b">
        <div className="max-w-7xl mx-auto px-3 sm:px-4 md:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src={LOGO_SRC} className="h-8 w-8 rounded-xl" />
            <div>
              <div className="font-bold">NamiPOS — {OUTLET}</div>
              <div className="text-[11px] text-neutral-500">Masuk: {user.email}{isOwner?" · owner":" · staff"}</div>
            </div>
          </div>
          <nav className="flex gap-2">
            <button onClick={()=>setTab("pos")} className={`px-3 py-1.5 rounded-lg border ${tab==="pos"?"bg-emerald-50 border-emerald-200":"bg-white"}`}>Kasir</button>
            <button onClick={()=>{ setTab("history"); loadHistory(false); }} className={`px-3 py-1.5 rounded-lg border ${tab==="history"?"bg-emerald-50 border-emerald-200":"bg-white"}`}>Riwayat</button>
            {isOwner && <button onClick={()=>setTab("products")} className={`px-3 py-1.5 rounded-lg border ${tab==="products"?"bg-emerald-50 border-emerald-200":"bg-white"}`}>Produk</button>}
            {isOwner && <button onClick={()=>setTab("inventory")} className={`px-3 py-1.5 rounded-lg border ${tab==="inventory"?"bg-emerald-50 border-emerald-200":"bg-white"}`}>Inventori</button>}
            {isOwner && <button onClick={()=>{ setTab("dashboard"); refreshDashboard(); }} className={`px-3 py-1.5 rounded-lg border ${tab==="dashboard"?"bg-emerald-50 border-emerald-200":"bg-white"}`}>Dashboard</button>}
            <button onClick={doLogout} className="px-3 py-1.5 rounded-lg border bg-rose-50">Keluar</button>
          </nav>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-3 sm:px-4 md:px-6 py-4">
        {/* Shift */}
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
                  <button key={p.id} onClick={()=>addToCart(p)} className="text-left rounded-2xl border bg-white p-3 hover:shadow">
                    <img src={p.imageUrl||LOGO_SRC} className="h-20 w-full rounded-xl object-cover mb-2"/>
                    <div className="font-medium leading-tight">{p.name}</div>
                    <div className="text-xs text-neutral-500">{p.category||"Signature"}</div>
                    <div className="mt-1 font-semibold">{IDR(p.price)}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Cart */}
            <div className="md:col-span-5">
              <div className="bg-white rounded-2xl border p-3">
                {/* customer */}
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
                      <div key={ci.id} className="grid grid-cols-12 items-center gap-2 rounded-xl border p-2">
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

                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={redeemFree} onChange={e=>setRedeemFree(e.target.checked)} />
                    <span>Redeem 10 poin → gratis 1 minuman</span>
                  </label>

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
                      <input type="number" className="border rounded-lg px-3 py-2 w-40" placeholder="Tunai diterima" value={cash} onChange={e=>setCash(Number(e.target.value)||0)} />
                      <div className="text-sm">Kembali: <b>{IDR(change)}</b></div>
                    </div>
                  )}
                  {payMethod!=="cash" && (
                    <div className="border rounded-xl p-2 bg-emerald-50">
                      <div className="text-sm mb-1">Scan untuk bayar:</div>
                      <img src={QRIS_IMG_SRC} alt="QRIS" className="w-40" />
                      <div className="text-xs text-neutral-500 mt-1">* Setelah sukses, tekan “Selesai”.</div>
                    </div>
                  )}
                </div>

                <div className="flex justify-between gap-2">
                  <button className="px-3 py-2 rounded-lg border" onClick={clearCart}>Bersihkan</button>
                  <div className="flex gap-2">
                    <button className="px-3 py-2 rounded-lg border" disabled={cart.length===0} onClick={()=>printReceipt({
                      outlet: OUTLET, shiftId: activeShift?.id||null, cashierEmail: user.email, time: null,
                      items: cart.map(i=>({ name:i.name, price:i.price, qty:i.qty, ...(i.note?{note:i.note}:{}) })),
                      subtotal, discount, tax: taxVal, service: svcVal, total, payMethod, cash, change,
                      customerPhone, customerName, pointsEarned:0, pointsRedeemed: redeemFree?LOYAL_REDEEM_THRESHOLD:0, saleId:"DRAFT"
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
                  <th className="py-2">Waktu</th><th>Kasir</th><th>Pelanggan</th><th>Item</th><th className="text-right">Total</th><th className="text-right">Aksi</th>
                </tr></thead>
                <tbody>
                  {history.map(s=>(
                    <tr key={s.id} className="border-b hover:bg-emerald-50/40">
                      <td className="py-2">{s.time? new Date(s.time.toDate()).toLocaleString("id-ID",{hour12:false}) : "-"}</td>
                      <td>{s.cashierEmail}</td>
                      <td>{s.customerPhone || "-"}</td>
                      <td className="truncate">{(s.items||[]).map(i=>`${i.name}x${i.qty}`).join(", ")}</td>
                      <td className="text-right font-medium">{IDR(s.total)}</td>
                      <td className="text-right">{isOwner && <button className="px-2 py-1 border rounded text-rose-600" onClick={()=>s.id && deleteSale(s.id)}>Hapus</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {history.length===0 && <div className="text-sm text-neutral-500">Belum ada transaksi.</div>}
            </div>
          </section>
        )}

        {/* PRODUCTS */}
        {tab==="products" && isOwner && (
          <section className="bg-white rounded-2xl border p-3">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-lg font-semibold">Manajemen Produk</h2>
              <div className="flex gap-2">
                <button className="px-3 py-2 rounded-lg border" onClick={()=>upsertProduct({ name:"Produk Baru", price:10000, category:"Signature", active:true, imageUrl:LOGO_SRC })}>+ Tambah</button>
              </div>
            </div>
            <div className="overflow-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left border-b">
                  <th>Nama & Kategori</th><th className="text-right">Harga</th><th>Gambar</th><th className="text-right">Aksi</th>
                </tr></thead>
                <tbody>
                  {products.map(p=>(
                    <tr key={p.id} className="border-b align-top">
                      <td className="py-2">
                        <input className="border rounded px-2 py-1 w-full"
                          defaultValue={p.name}
                          onBlur={e=>upsertProduct({ id:p.id, name:e.target.value, price:p.price, category:p.category, active:p.active, imageUrl:p.imageUrl })}
                          placeholder="Nama produk"/>
                        <div className="text-[11px] text-neutral-500">{p.category||"Signature"}</div>
                      </td>
                      <td className="py-2 text-right">
                        <input className="border rounded px-2 py-1 w-28 text-right"
                          defaultValue={p.price}
                          onBlur={e=>upsertProduct({ id:p.id, name:p.name, price:Number(e.target.value)||0, category:p.category, active:p.active, imageUrl:p.imageUrl })}/>
                      </td>
                      <td className="py-2">
                        <input className="border rounded px-2 py-1 w-full"
                          defaultValue={p.imageUrl||""}
                          onBlur={e=>upsertProduct({ id:p.id, imageUrl:e.target.value, name:p.name, price:p.price, category:p.category, active:p.active })}
                          placeholder="Image URL (https://...)"/>
                        <img src={p.imageUrl||LOGO_SRC} alt="" className="mt-1 h-10 rounded border object-cover"/>
                      </td>
                      <td className="py-2 text-right space-x-2">
                        {p.active!==false
                          ? <button className="px-2 py-1 border rounded" onClick={()=>deactivateProduct(p.id)}>Nonaktifkan</button>
                          : <button className="px-2 py-1 border rounded" onClick={()=>activateProduct(p.id)}>Aktifkan</button>}
                        <button className="px-2 py-1 border rounded text-rose-600" onClick={()=>deleteProduct(p.id)}>Hapus</button>
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
              <h2 className="text-lg font-semibold">Inventori & Resep</h2>
              <div className="flex gap-2">
                <button className="px-3 py-2 rounded-lg border" onClick={()=>upsertIngredient({ name:"Bahan Baru", unit:"gr", stock:0, min:0 })}>+ Tambah Bahan</button>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Bahan */}
              <div className="border rounded-xl p-3">
                <h3 className="font-semibold mb-2">Bahan</h3>
                <table className="w-full text-sm">
                  <thead><tr className="text-left border-b"><th>Nama</th><th>Satuan</th><th className="text-right">Stok</th><th className="text-right">Aksi</th></tr></thead>
                  <tbody>
                    {ingredients.map(i=>(
                      <tr key={i.id} className="border-b">
                        <td className="py-2">
                          <input className="border rounded px-2 py-1 w-full" defaultValue={i.name}
                            onBlur={e=>upsertIngredient({ id:i.id, name:e.target.value, unit:i.unit, stock:i.stock, min:i.min })}/>
                        </td>
                        <td>
                          <input className="border rounded px-2 py-1 w-20" defaultValue={i.unit}
                            onBlur={e=>upsertIngredient({ id:i.id, name:i.name, unit:e.target.value, stock:i.stock, min:i.min })}/>
                        </td>
                        <td className="text-right">
                          <input type="number" className="border rounded px-2 py-1 w-24 text-right" defaultValue={i.stock}
                            onBlur={e=>upsertIngredient({ id:i.id, name:i.name, unit:i.unit, stock:Number(e.target.value)||0, min:i.min })}/>
                        </td>
                        <td className="text-right">
                          <button className="px-2 py-1 border rounded text-rose-600" onClick={()=>deleteIngredient(i.id)}>Hapus</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {ingredients.length===0 && <div className="text-sm text-neutral-500">Belum ada data inventori.</div>}
              </div>

              {/* Resep */}
              <div className="border rounded-xl p-3">
                <h3 className="font-semibold mb-2">Resep</h3>
                <table className="w-full text-xs">
                  <thead><tr className="text-left border-b"><th>Produk</th><th>Bahan (qty)</th><th className="text-right">Aksi</th></tr></thead>
                  <tbody>
                    {products.map(p=>{
                      const r = recipes.find(x=>x.productId===p.id);
                      return (
                        <tr key={p.id} className="border-b align-top">
                          <td className="py-2">{p.name}</td>
                          <td className="py-2">
                            <textarea
                              className="border rounded p-2 w-full"
                              defaultValue={(r?.items||[]).map(it=>{
                                const ing = ingredients.find(g=>g.id===it.ingredientId);
                                return `${ing?ing.name:it.ingredientId}:${it.qty}`;
                              }).join("\n")}
                              placeholder="Format: NAMA_BAHAN:QTY per baris"
                              onBlur={async e=>{
                                const lines = (e.target.value||"").split("\n").map(x=>x.trim()).filter(Boolean);
                                const items: {ingredientId:string; qty:number}[] = [];
                                for(const ln of lines){
                                  const [n, q] = ln.split(":");
                                  if(!n || !q) continue;
                                  const ing = ingredients.find(g=>g.name.toLowerCase()===n.toLowerCase());
                                  items.push({ ingredientId: ing?ing.id:n, qty: Number(q)||0 });
                                }
                                await setRecipeForProduct(p.id, items);
                                alert("Resep disimpan.");
                              }}
                            />
                          </td>
                          <td className="py-2 text-right">
                            <span className="text-neutral-500">{(r?.items||[]).length} bahan</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {products.length===0 && <div className="text-sm text-neutral-500">Tambahkan produk terlebih dahulu.</div>}
              </div>
            </div>
          </section>
        )}

        {/* DASHBOARD */}
        {tab==="dashboard" && isOwner && (
          <section className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <KPI title="Omzet Hari Ini" value={IDR(todayOmzet)} />
              <KPI title="Transaksi" value={String(todayTrx)} />
              <KPI title="Avg Ticket" value={todayTrx? IDR(Math.round(todayOmzet/todayTrx)) : "Rp0"} />
              <KPI title="Menu Teratas" value={topToday[0]?.name || "-"} />
            </div>
            <div className="bg-white border rounded-2xl p-4">
              <div className="font-semibold mb-2">5 Menu Terlaris (Hari Ini)</div>
              <table className="w-full text-sm">
                <thead><tr className="border-b text-left"><th className="py-2">Menu</th><th className="text-right">Qty</th></tr></thead>
                <tbody>
                  {topToday.length===0 && <tr><td className="py-2 text-neutral-500" colSpan={2}>Belum ada data.</td></tr>}
                  {topToday.map((t,i)=>(
                    <tr key={i} className="border-b"><td className="py-2">{t.name}</td><td className="text-right">{t.qty}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

/* Small UI */
function KPI({title, value}:{title:string; value:string}) {
  return (
    <div className="bg-white border rounded-2xl p-4">
      <div className="text-[12px] text-neutral-500">{title}</div>
      <div className="text-xl font-bold mt-1">{value}</div>
    </div>
  );
}