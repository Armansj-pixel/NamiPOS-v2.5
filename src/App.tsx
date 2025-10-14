import React, { useEffect, useMemo, useState } from "react";
import {
  addDoc, collection, deleteDoc, doc, getDoc, getDocs, limit,
  onSnapshot, orderBy, query, serverTimestamp, setDoc, startAfter,
  Timestamp, updateDoc, where, writeBatch
} from "firebase/firestore";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { getDownloadURL, getStorage, ref as storageRef, uploadBytes } from "firebase/storage";
import app, { auth, db } from "./lib/firebase";

/* ==========================
   KONFIG
========================== */
const OUTLET = "MTHaryono";
const OWNER_EMAILS = new Set([
  "antonius.arman123@gmail.com",
  "ayuismaalabibbah@gmail.com",
]);
const QRIS_IMG_SRC = "/qris.png"; // taruh file di /public/qris.png
const LOGO_SRC = "/logo.png";     // opsional, taruh di /public/logo.png

// Loyalty
const POINT_EARN_RATE = 15000; // Rp 15.000 = 1 poin
const POINTS_FOR_FREE = 10;    // 10 poin = 1 minuman gratis

/* ==========================
   TYPES
========================== */
type Product = { id: string; name: string; price: number; category?: string; active?: boolean; outlet?: string; imgUrl?: string };
type Ingredient = { id: string; name: string; unit: string; stock: number; min?: number; outlet?: string };
type CartItem = { id: string; productId: string; name: string; price: number; qty: number; note?: string };
type Shift = { id: string; outlet: string; openBy: string; openAt: Timestamp; closeAt?: Timestamp | null; openCash?: number; isOpen: boolean };
type RecipeItem = { ingredientId: string; name: string; unit: string; qty: number };
type RecipeDoc = { productId: string; items: RecipeItem[] };

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
  usedPoints?: number; earnedPoints?: number;
};

/* ==========================
   UTIL
========================== */
const uid = () => Math.random().toString(36).slice(2, 10);
const IDR = (n: number) => new Intl.NumberFormat("id-ID",{style:"currency",currency:"IDR",maximumFractionDigits:0}).format(n||0);

/* ==========================
   APP
========================== */
export default function App() {
  /* ---- auth ---- */
  const [user, setUser] = useState<null | { email: string }>(null);
  const isOwner = !!(user?.email && OWNER_EMAILS.has(user.email));

  /* ---- tabs ---- */
  const [tab, setTab] = useState<"dashboard"|"pos"|"history"|"products"|"inventory"|"recipes">("pos");

  /* ---- login form ---- */
  const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [authLoading, setAuthLoading] = useState(false);

  /* ---- master ---- */
  const [products, setProducts] = useState<Product[]>([]);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [recipes, setRecipes] = useState<Record<string, RecipeItem[]>>({}); // key: productId

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
  const [redeem, setRedeem] = useState(false); // tukar 10 poin

  /* ---- shift ---- */
  const [activeShift, setActiveShift] = useState<Shift|null>(null);
  const [openCash, setOpenCash] = useState<number>(0);

  /* ---- history ---- */
  const [historyRows, setHistoryRows] = useState<Sale[]>([]);
  const [histCursor, setHistCursor] = useState<any>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  // computed
  const filteredProducts = useMemo(
    () => products.filter(p => (p.active!==false) && p.name.toLowerCase().includes(queryText.toLowerCase())),
    [products, queryText]
  );
  const subtotal = useMemo(()=> cart.reduce((s,i)=> s + i.price*i.qty, 0), [cart]);
  const taxVal = Math.round(subtotal * (taxPct/100));
  const svcVal = Math.round(subtotal * (svcPct/100));

  // loyalty redeem discount (gratis 1 minuman = 1 item termurah)
  const cheapestItemPrice = cart.length ? Math.min(...cart.map(i=>i.price)) : 0;
  const redeemDiscount = redeem ? cheapestItemPrice : 0;

  const total = Math.max(0, subtotal + taxVal + svcVal - (discount||0) - redeemDiscount);
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
    const qp = query(collection(db,"products"), where("outlet","==",OUTLET));
    const unp = onSnapshot(qp, snap=>{
      const rows: Product[] = snap.docs.map(d=>{
        const x = d.data() as any;
        return { id:d.id, name:x.name, price:x.price, category:x.category, active:x.active, outlet:x.outlet, imgUrl: x.imgUrl||"" };
      });
      setProducts(rows);
    }, err=>alert("Memuat produk gagal.\n"+(err.message||err)));

    // ingredients
    const qi = query(collection(db,"ingredients"), where("outlet","==",OUTLET));
    const uni = onSnapshot(qi, snap=>{
      const rows: Ingredient[] = snap.docs.map(d=>{
        const x = d.data() as any;
        return { id:d.id, name:x.name, unit:x.unit, stock:x.stock??0, min:x.min??0, outlet:x.outlet };
      });
      setIngredients(rows);
    }, err=>alert("Memuat inventori gagal.\n"+(err.message||err)));

    // recipes (load sekali)
    (async()=>{
      const rref = collection(db,"recipes");
      const rqs = query(rref, where("outlet","==",OUTLET));
      const rs = await getDocs(rqs);
      const map: Record<string, RecipeItem[]> = {};
      rs.forEach(d=>{
        const x = d.data() as any;
        map[d.id] = (x.items||[]) as RecipeItem[];
      });
      setRecipes(map);
    })().catch(()=>{});

    checkActiveShift().catch(e=>console.warn(e));

    return ()=>{ unp(); uni(); };
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
    alert("Shift ditutup & direkap.");
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
    setRedeem(false);
  };

  // loyalty: auto lookup by phone
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

  /* stock check berbasiskan resep */
  function checkStockForCart(): { ok: true } | { ok: false; shortages: { name:string; need:number; have:number; unit:string }[] } {
    const needs = new Map<string, {name:string; unit:string; qty:number}>();
    for(const ci of cart){
      const r = recipes[ci.productId] || [];
      for(const it of r){
        const cur = needs.get(it.ingredientId) || { name: it.name, unit: it.unit, qty: 0 };
        cur.qty += it.qty * ci.qty;
        needs.set(it.ingredientId, cur);
      }
    }
    const shortages: {name:string; need:number; have:number; unit:string}[] = [];
    for(const [ingId, need] of needs.entries()){
      const inv = ingredients.find(x=>x.id===ingId);
      const have = inv?.stock ?? 0;
      if(have < need.qty){
        shortages.push({ name: need.name, need: need.qty, have, unit: need.unit });
      }
    }
    return shortages.length ? { ok:false, shortages } : { ok:true };
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
img.logo{display:block;margin:0 auto 6px;height:42px}
img.qr{display:block;margin:6px auto;height:120px}
.badge{display:inline-block;border:1px solid #e5e7eb;border-radius:8px;padding:2px 6px;font-size:11px;margin-top:4px}
</style></head><body>
<div class="wrap">
  ${LOGO_SRC ? `<img src="${LOGO_SRC}" class="logo" onerror="this.style.display='none'"/>` : ""}
  <h2>NamiPOS — ${OUTLET}</h2>
  <div class="meta">${saleId||"DRAFT"}<br/>${new Date().toLocaleString("id-ID",{hour12:false})}</div>
  <hr/>
  <table style="width:100%;border-collapse:collapse">
    ${itemsHtml}
    ${rec.discount?`<tr class="tot"><td>Diskon Manual</td><td></td><td style="text-align:right">-${IDR(rec.discount)}</td></tr>`:""}
    ${rec.usedPoints?`<tr class="tot"><td>Tukar Poin (${rec.usedPoints})</td><td></td><td style="text-align:right">-${IDR(${cheapestItemPrice})}</td></tr>`:""}
    <tr class="tot"><td>Subtotal</td><td></td><td style="text-align:right">${IDR(rec.subtotal)}</td></tr>
    ${rec.tax?`<tr class="tot"><td>Pajak</td><td></td><td style="text-align:right">${IDR(rec.tax)}</td></tr>`:""}
    ${rec.service?`<tr class="tot"><td>Service</td><td></td><td style="text-align:right">${IDR(rec.service)}</td></tr>`:""}
    <tr class="tot"><td>Total</td><td></td><td style="text-align:right">${IDR(rec.total)}</td></tr>
    ${rec.payMethod==="cash"
      ? `<tr><td>Tunai</td><td></td><td style='text-align:right'>${IDR(rec.cash||0)}</td></tr>
         <tr><td>Kembali</td><td></td><td style='text-align:right'>${IDR(rec.change||0)}</td></tr>`
      : `<tr><td>Metode</td><td></td><td style='text-align:right'>${rec.payMethod.toUpperCase()}</td></tr>`
    }
  </table>
  ${rec.payMethod!=="cash" ? `<img src="${QRIS_IMG_SRC}" class="qr" onerror="this.style.display='none'"/>` : ""}
  <div class="meta">Terima kasih! <span class="badge">${rec.earnedPoints||0} pts earned</span></div>
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

    // cek stok resep
    const stockCheck = checkStockForCart();
    if("ok" in stockCheck && !stockCheck.ok){
      const msg = stockCheck.shortages.map(s=>`• ${s.name} kurang: perlu ${s.need} ${s.unit}, stok ${s.have}`).join("\n");
      return alert("Stok tidak cukup:\n\n"+msg);
    }

    // loyalty: earn & redeem
    const usedPoints = redeem && (customerPoints||0) >= POINTS_FOR_FREE ? POINTS_FOR_FREE : 0;
    const earnedPoints = Math.floor(total / POINT_EARN_RATE);

    const payload: Omit<Sale,"id"> = {
      outlet: OUTLET, shiftId: activeShift.id, cashierEmail: user.email,
      customerPhone: customerPhone?.trim()||null, customerName: customerName?.trim()||null,
      time: serverTimestamp() as any,
      items: cart.map(i=> ({ name:i.name, price:i.price, qty:i.qty, ...(i.note?{note:i.note}:{}) })),
      subtotal, discount: (discount||0) + redeemDiscount, tax: taxVal, service: svcVal, total, payMethod,
      ...(payMethod==="cash" ? { cash, change } : {}),
      usedPoints, earnedPoints
    };

    try{
      // simpan sale
      const saleRef = await addDoc(collection(db,"sales"), payload as any);

      // batch: adjust inventory (deduct)
      const batch = writeBatch(db);
      for(const ci of cart){
        const r = recipes[ci.productId] || [];
        for(const it of r){
          const ingRef = doc(db,"ingredients", it.ingredientId);
          const curInv = ingredients.find(x=>x.id===it.ingredientId);
          const newStock = Math.max(0, (curInv?.stock||0) - (it.qty * ci.qty));
          batch.update(ingRef, { stock: newStock });
        }
      }

      // loyalty: update / create
      if((customerPhone.trim().length)>=8){
        const cref = doc(db,"customers", customerPhone.trim());
        const s = await getDoc(cref);
        const base = s.exists() ? (s.data() as any).points || 0 : 0;
        const newPoints = Math.max(0, base - usedPoints + earnedPoints);
        batch.set(cref, {
          phone: customerPhone.trim(),
          name: customerName || (s.exists()? (s.data() as any).name : "Member"),
          points: newPoints,
          lastVisit: serverTimestamp()
        }, { merge: true });
      }

      await batch.commit();

      printReceipt(payload, saleRef.id);
      clearCart();
      if(tab==="history") loadHistory(false);

      alert("Transaksi tersimpan ✅");

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
          total:x.total??0, payMethod:x.payMethod??"cash", cash:x.cash??0, change:x.change??0,
          usedPoints:x.usedPoints||0, earnedPoints:x.earnedPoints||0
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

  async function deleteSale(id?: string){
    if(!isOwner) return alert("Hanya owner.");
    if(!id) return;
    if(!confirm("Hapus transaksi ini?")) return;
    try{
      await deleteDoc(doc(db,"sales", id));
      setHistoryRows(prev => prev.filter(x=>x.id!==id));
    }catch(e:any){
      alert("Gagal menghapus: "+(e?.message||e));
    }
  }

  /* ==========================
     OWNER: PRODUCTS & INVENTORY & RECIPES
  =========================== */

  // Versi aman (update = hanya field yang dikirim)
  async function upsertProduct(p: Partial<Product> & { id?: string }) {
    if (!isOwner) return alert("Akses khusus owner.");
    const id = p.id || uid();
    const ref = doc(db, "products", id);

    if (p.id) {
      const data: any = {};
      if (p.name !== undefined) data.name = p.name;
      if (p.price !== undefined) data.price = Number(p.price) || 0;
      if (p.category !== undefined) data.category = p.category;
      if (p.active !== undefined) data.active = p.active;
      if (p.imgUrl !== undefined) data.imgUrl = p.imgUrl;
      try { await updateDoc(ref, data); }
      catch (e: any) { alert("Gagal menyimpan produk: " + (e?.message || e)); }
      return;
    }

    try {
      await setDoc(ref, {
        outlet: OUTLET,
        name: p.name || "Produk",
        price: Number(p.price) || 0,
        category: p.category || "Signature",
        active: p.active !== false,
        imgUrl: p.imgUrl || "",
      });
    } catch (e: any) {
      alert("Gagal menambah produk: " + (e?.message || e));
    }
  }

  async function deactivateProduct(id:string, active:boolean){
    if(!isOwner) return alert("Akses khusus owner.");
    await updateDoc(doc(db,"products", id), { active });
  }

  async function removeProduct(id:string){
    if(!isOwner) return alert("Hanya owner.");
    if(!confirm("Hapus produk ini?")) return;
    await deleteDoc(doc(db,"products", id));
  }

  // upload gambar ke storage
  const storage = getStorage(app);
  async function uploadProductImage(file: File, productId: string){
    const sref = storageRef(storage, `product_images/${productId}-${Date.now()}`);
    await uploadBytes(sref, file);
    const url = await getDownloadURL(sref);
    await upsertProduct({ id: productId, imgUrl: url });
  }

  // inventory
  async function upsertIngredient(i: Partial<Ingredient> & { id?: string }) {
    if (!isOwner) return alert("Akses khusus owner.");
    const id = i.id || uid();
    const ref = doc(db, "ingredients", id);

    if (i.id) {
      const data: any = {};
      if (i.name !== undefined) data.name = i.name;
      if (i.unit !== undefined) data.unit = i.unit;
      if (i.stock !== undefined) data.stock = Number(i.stock) || 0;
      if (i.min !== undefined) data.min = Number(i.min) || 0;
      try { await updateDoc(ref, data); } 
      catch (e:any) { alert("Gagal menyimpan bahan: " + (e?.message || e)); }
      return;
    }

    try {
      await setDoc(ref, {
        outlet: OUTLET,
        name: i.name || "Bahan",
        unit: i.unit || "pcs",
        stock: Number(i.stock) || 0,
        min: Number(i.min) || 0,
      });
    } catch (e:any) {
      alert("Gagal menambah bahan: " + (e?.message || e));
    }
  }

  async function removeIngredient(id:string){
    if(!isOwner) return alert("Hanya owner.");
    if(!confirm("Hapus bahan ini?")) return;
    await deleteDoc(doc(db,"ingredients", id));
  }

  // recipes
  async function setRecipeForProduct(productId: string, items: RecipeItem[]){
    if(!isOwner) return alert("Akses khusus owner.");
    await setDoc(doc(db,"recipes", productId), {
      outlet: OUTLET,
      productId,
      items
    });
    setRecipes(prev => ({ ...prev, [productId]: items }));
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
            <img src={LOGO_SRC} alt="logo" className="h-10 w-10 rounded-2xl object-cover" onError={(e)=>((e.currentTarget as HTMLImageElement).style.display="none")} />
            <div>
              <h1 className="text-2xl font-bold">NamiPOS — Login</h1>
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
            <img src={LOGO_SRC} alt="logo" className="h-8 w-8 rounded-xl object-cover" onError={(e)=>((e.currentTarget as HTMLImageElement).style.display="none")} />
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
            {isOwner && <button onClick={()=>setTab("recipes")} className={`px-3 py-1.5 rounded-lg border ${tab==="recipes"?"bg-emerald-50 border-emerald-200":"bg-white"}`}>Resep</button>}
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
                    <div className="h-20 rounded-xl mb-2 overflow-hidden bg-emerald-50 flex items-center justify-center">
                      {p.imgUrl ? (
                        <img src={p.imgUrl} alt={p.name} className="h-full w-full object-cover"
                          onError={(e)=>((e.currentTarget as HTMLImageElement).style.display="none")} loading="lazy"/>
                      ) : <div className="w-full h-full bg-gradient-to-br from-emerald-50 to-emerald-100" />}
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

                  {customerPoints!==null && customerPoints>=POINTS_FOR_FREE && cart.length>0 && (
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={redeem} onChange={e=>setRedeem(e.target.checked)} />
                      <span>Tukar {POINTS_FOR_FREE} poin untuk 1 minuman gratis (−{IDR(cheapestItemPrice)})</span>
                    </label>
                  )}

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
                      subtotal, discount: (discount||0) + redeemDiscount, tax: taxVal, service: svcVal, total, payMethod, cash, change,
                      usedPoints: redeem?POINTS_FOR_FREE:0, earnedPoints: Math.floor(total/POINT_EARN_RATE)
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
                  <th className="py-2">Waktu</th><th>Kasir</th><th>Pelanggan</th><th>Item</th><th className="text-right">Total</th>{isOwner && <th className="text-right">Aksi</th>}
                </tr></thead>
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
                          <button className="px-2 py-1 border rounded text-rose-600" onClick={()=>deleteSale(s.id)}>Hapus</button>
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
                <thead>
                  <tr className="text-left border-b">
                    <th>Gambar</th>
                    <th>Link Gambar</th>
                    <th>Nama</th>
                    <th>Kategori</th>
                    <th className="text-right">Harga</th>
                    <th className="text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {products.map(p=>(
                    <tr key={p.id} className="border-b align-top">
                      <td className="py-2 w-[120px]">
                        <div className="h-16 w-24 overflow-hidden rounded bg-neutral-100 mb-2">
                          {p.imgUrl ? <img src={p.imgUrl} alt="preview" className="h-full w-full object-cover" onError={(e)=>((e.currentTarget as HTMLImageElement).style.display="none")} /> : null}
                        </div>
                        <label className="text-xs">
                          <span className="px-2 py-1 border rounded cursor-pointer inline-block">Upload</span>
                          <input type="file" accept="image/*" className="hidden" onChange={async e=>{
                            const f = e.currentTarget.files?.[0];
                            if(!f) return;
                            await uploadProductImage(f, p.id);
                          }}/>
                        </label>
                      </td>

                      <td className="py-2 w-[260px]">
                        <input
                          className="border rounded-lg px-2 py-1 w-full"
                          placeholder="https://…"
                          defaultValue={p.imgUrl || ""}
                          onBlur={(e)=>upsertProduct({ id: p.id, imgUrl: e.currentTarget.value.trim() })}
                        />
                      </td>

                      <td className="py-2">
                        <input
                          className="border rounded-lg px-2 py-1 w-full"
                          defaultValue={p.name}
                          onBlur={(e)=>upsertProduct({ id:p.id, name:e.currentTarget.value })}
                        />
                      </td>

                      <td className="py-2">
                        <input
                          className="border rounded-lg px-2 py-1 w-full"
                          defaultValue={p.category || ""}
                          onBlur={(e)=>upsertProduct({ id:p.id, category:e.currentTarget.value })}
                        />
                      </td>

                      <td className="py-2 text-right">
                        <input
                          type="number"
                          className="border rounded-lg px-2 py-1 w-28 text-right"
                          defaultValue={p.price}
                          onBlur={(e)=>upsertProduct({ id:p.id, price:Number(e.currentTarget.value)||0 })}
                        />
                      </td>

                      <td className="py-2 text-right space-x-2">
                        <button className="px-2 py-1 border rounded" onClick={()=>deactivateProduct(p.id, p.active===false)}> {p.active===false ? "Aktifkan" : "Nonaktifkan"} </button>
                        <button className="px-2 py-1 border rounded text-rose-600" onClick={()=>removeProduct(p.id)}>Hapus</button>
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
                <thead><tr className="text-left border-b"><th>Nama</th><th>Satuan</th><th className="text-right">Stok</th><th className="text-right">Min</th><th className="text-right">Aksi</th></tr></thead>
                <tbody>
                  {ingredients.map(i=>(
                    <tr key={i.id} className="border-b">
                      <td className="py-2">
                        <input className="border rounded-lg px-2 py-1 w-full" defaultValue={i.name} onBlur={(e)=>upsertIngredient({ id:i.id, name:e.currentTarget.value })}/>
                      </td>
                      <td>
                        <input className="border rounded-lg px-2 py-1 w-24" defaultValue={i.unit} onBlur={(e)=>upsertIngredient({ id:i.id, unit:e.currentTarget.value })}/>
                      </td>
                      <td className="text-right">
                        <input type="number" className="border rounded-lg px-2 py-1 w-24 text-right" defaultValue={i.stock} onBlur={(e)=>upsertIngredient({ id:i.id, stock:Number(e.currentTarget.value)||0 })}/>
                      </td>
                      <td className="text-right">
                        <input type="number" className="border rounded-lg px-2 py-1 w-24 text-right" defaultValue={i.min||0} onBlur={(e)=>upsertIngredient({ id:i.id, min:Number(e.currentTarget.value)||0 })}/>
                      </td>
                      <td className="text-right">
                        <button className="px-2 py-1 border rounded text-rose-600" onClick={()=>removeIngredient(i.id)}>Hapus</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {ingredients.length===0 && <div className="text-sm text-neutral-500">Belum ada data inventori.</div>}
            </div>
            {/* Alert stok tipis */}
            <div className="mt-3">
              {ingredients.filter(i=> (i.min||0)>0 && i.stock <= (i.min||0)).length>0 && (
                <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">
                  <b>Peringatan stok menipis:</b>
                  <ul className="list-disc pl-5">
                    {ingredients.filter(i=> (i.min||0)>0 && i.stock <= (i.min||0)).map(i=>(
                      <li key={i.id}>{i.name}: {i.stock} {i.unit} (min {i.min})</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </section>
        )}

        {/* RECIPES */}
        {tab==="recipes" && isOwner && (
          <RecipeEditor
            products={products}
            ingredients={ingredients}
            recipes={recipes}
            onSave={setRecipeForProduct}
          />
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

/* ===== Recipe Editor Component ===== */
function RecipeEditor({
  products, ingredients, recipes,
  onSave
}:{ products: Product[]; ingredients: Ingredient[]; recipes: Record<string, RecipeItem[]>; onSave:(productId:string, items:RecipeItem[])=>void }){
  const [selected, setSelected] = useState<string>("");
  const [rows, setRows] = useState<RecipeItem[]>([]);

  useEffect(()=>{
    if(!selected){ setRows([]); return; }
    setRows(recipes[selected] ? [...recipes[selected]] : []);
  },[selected]);

  function addRow(){
    if(!ingredients.length) return alert("Belum ada data bahan.");
    const base = ingredients[0];
    setRows(prev=> [...prev, { ingredientId: base.id, name: base.name, unit: base.unit, qty: 1 }]);
  }
  function updateRow(i:number, patch: Partial<RecipeItem>){
    setRows(prev => prev.map((r,idx)=> idx===i ? {...r, ...patch} : r));
  }
  function delRow(i:number){ setRows(prev => prev.filter((_,idx)=>idx!==i)); }

  return (
    <section className="bg-white rounded-2xl border p-3">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-lg font-semibold">Resep Produk</h2>
        <div className="flex items-center gap-2">
          <select className="border rounded-lg px-3 py-2" value={selected} onChange={e=>setSelected(e.target.value)}>
            <option value="">Pilih produk…</option>
            {products.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <button className="px-3 py-2 rounded-lg border" onClick={addRow} disabled={!selected}>+ Tambah Bahan</button>
          <button className="px-3 py-2 rounded-lg bg-emerald-600 text-white disabled:opacity-50" disabled={!selected} onClick={()=>onSave(selected, rows)}>Simpan Resep</button>
        </div>
      </div>

      {!selected ? (
        <div className="text-sm text-neutral-500">Pilih produk untuk mengatur resep.</div>
      ) : (
        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left border-b"><th>Bahan</th><th className="text-right">Qty</th><th className="text-right">Satuan</th><th className="text-right">Aksi</th></tr></thead>
            <tbody>
              {rows.map((r,idx)=>(
                <tr key={idx} className="border-b">
                  <td className="py-2">
                    <select
                      className="border rounded-lg px-2 py-1 w-full"
                      value={r.ingredientId}
                      onChange={e=>{
                        const ing = ingredients.find(x=>x.id===e.target.value);
                        if(!ing) return;
                        updateRow(idx, { ingredientId: ing.id, name: ing.name, unit: ing.unit });
                      }}
                    >
                      {ingredients.map(ing=><option key={ing.id} value={ing.id}>{ing.name}</option>)}
                    </select>
                  </td>
                  <td className="text-right">
                    <input type="number" className="border rounded-lg px-2 py-1 w-24 text-right" value={r.qty} onChange={(e)=>updateRow(idx, { qty: Number(e.target.value)||0 })}/>
                  </td>
                  <td className="text-right">{r.unit}</td>
                  <td className="text-right"><button className="px-2 py-1 border rounded text-rose-600" onClick={()=>delRow(idx)}>Hapus</button></td>
                </tr>
              ))}
              {rows.length===0 && <tr><td colSpan={4} className="py-2 text-neutral-500">Belum ada bahan.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}