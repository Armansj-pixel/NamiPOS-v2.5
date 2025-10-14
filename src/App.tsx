import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  addDoc, collection, deleteDoc, doc, getDoc, getDocs, limit, onSnapshot,
  orderBy, query, serverTimestamp, setDoc, startAfter, Timestamp, updateDoc, where
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
const QRIS_IMG_SRC = "/qris.png";   // siapkan di /public
const LOGO_IMG_SRC = "/logo.png";   // opsional, siapkan di /public

/* ==========================
   TYPES
========================== */
type Product = {
  id: string;
  name: string;
  price: number;
  category?: string;
  active?: boolean;
  imgUrl?: string;
  outlet?: string;
};

type Ingredient = {
  id: string;
  name: string;
  unit: string;
  stock: number;
  min?: number;
  outlet?: string;
};

type CartItem = {
  id: string;
  productId: string;
  name: string;
  price: number;
  qty: number;
  note?: string;
};

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
  source?: "pos" | "order";
  orderId?: string;
  deliveryFee?: number;
};

type Recipe = {
  productId: string;
  items: { ingredientId: string; qty: number }[];
};

type Order = {
  id: string;
  outlet: string;
  items: { productId?: string; name: string; price: number; qty: number }[];
  customer: { name: string; phone: string; address: string };
  payMethod: "qris" | "cod";
  status: "pending" | "confirmed" | "delivering" | "done" | "cancelled";
  createdAt: Timestamp | null;
  assignedShiftId?: string | null;
  note?: string;
  distanceKm?: number | null;
  deliveryFee?: number | null;
};

/* ==========================
   UTILITIES
========================== */
const uid = () => Math.random().toString(36).slice(2, 10);
const IDR = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n || 0);

const startOfDay = (d = new Date()) => { const x = new Date(d); x.setHours(0,0,0,0); return x; };
const endOfDay   = (d = new Date()) => { const x = new Date(d); x.setHours(23,59,59,999); return x; };
const daysAgo = (n:number) => { const x=new Date(); x.setDate(x.getDate()-n); return x; };

const qparam = (key:string, dflt="") =>
  new URLSearchParams(window.location.search).get(key) ?? dflt;

/* ==========================
   PUBLIC ORDER (tanpa login)
========================== */
function PublicOrder(){
  const outlet = qparam("outlet", OUTLET);
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<{productId:string; id:string; name:string; price:number; qty:number}[]>([]);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [pay, setPay] = useState<"qris"|"cod">("qris");
  const [distanceKm, setDistanceKm] = useState<number>(0);
  const [perKm, setPerKm] = useState<number>(3000);

  const deliveryFee = useMemo(()=> Math.max(0, Math.round((distanceKm||0)*(perKm||0))), [distanceKm, perKm]);
  const subtotal = useMemo(()=> cart.reduce((s,i)=>s+i.price*i.qty,0), [cart]);
  const grandTotal = subtotal + deliveryFee;

  useEffect(()=>{
    const qProd = query(
      collection(db,"products"),
      where("outlet","==",outlet),
      where("active","==",true),
      orderBy("name","asc")
    );
    const unsub = onSnapshot(qProd, snap=>{
      const rows = snap.docs.map(d=>{
        const x = d.data() as any;
        return { id:d.id, name:x.name, price:x.price, category:x.category, active:x.active, imgUrl:x.imgUrl, outlet:x.outlet } as Product;
      });
      setProducts(rows);
    });
    return ()=>unsub();
  },[outlet]);

  const add = (p:Product)=> setCart(prev=>{
    const exist = prev.find(x=>x.productId===p.id);
    if(exist) return prev.map(x=> x.productId===p.id? {...x, qty:x.qty+1 }:x);
    return [...prev, { productId:p.id, id:p.id, name:p.name, price:p.price, qty:1 }];
  });
  const inc = (id:string)=> setCart(prev=> prev.map(x=> x.id===id? {...x, qty:x.qty+1 }:x));
  const dec = (id:string)=> setCart(prev=> prev.map(x=> x.id===id? {...x, qty:Math.max(1,x.qty-1) }:x));
  const rm  = (id:string)=> setCart(prev=> prev.filter(x=> x.id!==id));

  async function submit(){
    if(!name.trim() || !phone.trim() || !address.trim()){ alert("Nama/HP/Alamat wajib diisi."); return; }
    if(cart.length===0){ alert("Keranjang kosong."); return; }
    try{
      await addDoc(collection(db,"orders"), {
        outlet,
        items: cart.map(i=>({ productId:i.productId, name:i.name, price:i.price, qty:i.qty })),
        customer: { name:name.trim(), phone:phone.trim(), address:address.trim() },
        payMethod: pay,
        status: "pending",
        createdAt: serverTimestamp(),
        distanceKm: distanceKm || null,
        deliveryFee: deliveryFee || null,
      });
      alert("Pesanan berhasil dibuat! Kami akan konfirmasi secepatnya.");
      setCart([]); setName(""); setPhone(""); setAddress("");
    }catch(e:any){
      alert("Gagal membuat pesanan: "+(e?.message||e));
    }
  }

  return (
    <div className="min-h-screen bg-neutral-50">
      <header className="sticky top-0 bg-white border-b px-4 py-3 flex justify-between">
        <div className="flex items-center gap-2">
          <img src={LOGO_IMG_SRC} alt="logo" className="h-7 w-7 rounded-md object-contain" onError={(e)=>{(e.currentTarget as HTMLImageElement).style.display="none"}}/>
          <div className="font-bold">NamiPOS — Order • {outlet}</div>
        </div>
        <a href="/" className="text-sm underline">Masuk POS</a>
      </header>

      <main className="max-w-6xl mx-auto p-4 grid grid-cols-1 md:grid-cols-12 gap-4">
        {/* Produk */}
        <section className="md:col-span-7">
          <div className="bg-white border rounded-2xl p-3">
            <div className="font-semibold mb-2">Menu</div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 gap-3">
              {products.map(p=>(
                <button key={p.id} onClick={()=>add(p)} className="text-left rounded-2xl border bg-white p-3 hover:shadow">
                  {p.imgUrl
                    ? <img src={p.imgUrl} alt={p.name} className="h-24 w-full object-cover rounded-xl mb-2"/>
                    : <div className="h-24 rounded-xl bg-gradient-to-br from-emerald-50 to-emerald-100 mb-2"/>}
                  <div className="font-medium leading-tight">{p.name}</div>
                  <div className="mt-1 font-semibold">{IDR(p.price)}</div>
                </button>
              ))}
              {products.length===0 && <div className="text-sm text-neutral-500">Belum ada menu aktif untuk outlet ini.</div>}
            </div>
          </div>
        </section>

        {/* Keranjang & Data */}
        <section className="md:col-span-5">
          <div className="bg-white border rounded-2xl p-3 space-y-3">
            <div className="font-semibold">Keranjang</div>
            {cart.length===0 ? (
              <div className="text-sm text-neutral-500">Belum ada item.</div>
            ) : (
              <div className="space-y-2">
                {cart.map(i=>(
                  <div key={i.id} className="grid grid-cols-12 items-center gap-2 border rounded-xl p-2">
                    <div className="col-span-6"><div className="font-medium">{i.name}</div></div>
                    <div className="col-span-2 text-right text-sm">{IDR(i.price)}</div>
                    <div className="col-span-3 flex items-center justify-end gap-2">
                      <button className="px-2 py-1 border rounded" onClick={()=>dec(i.id)}>-</button>
                      <div className="w-8 text-center font-medium">{i.qty}</div>
                      <button className="px-2 py-1 border rounded" onClick={()=>inc(i.id)}>+</button>
                    </div>
                    <div className="col-span-1 text-right">
                      <button className="px-2 py-1 border rounded" onClick={()=>rm(i.id)}>x</button>
                    </div>
                  </div>
                ))}
                <div className="flex justify-between"><span>Subtotal</span><span className="font-semibold">{IDR(subtotal)}</span></div>
              </div>
            )}

            <div className="h-px bg-neutral-200"/>
            <div className="font-semibold">Data Pengantaran</div>
            <input className="border rounded-lg px-3 py-2 w-full" placeholder="Nama lengkap" value={name} onChange={e=>setName(e.target.value)} />
            <input className="border rounded-lg px-3 py-2 w-full" placeholder="No. HP/WhatsApp" value={phone} onChange={e=>setPhone(e.target.value)} />
            <textarea className="border rounded-lg px-3 py-2 w-full" placeholder="Alamat lengkap" rows={3} value={address} onChange={e=>setAddress(e.target.value)} />

            <div className="grid grid-cols-2 gap-2">
              <label className="text-sm">Jarak (km)
                <input type="number" min={0} step="0.1" className="border rounded-lg px-3 py-2 w-full"
                  value={distanceKm} onChange={e=>setDistanceKm(Number(e.target.value)||0)} />
              </label>
              <label className="text-sm">Tarif/km
                <input type="number" min={0} step="100" className="border rounded-lg px-3 py-2 w-full"
                  value={perKm} onChange={e=>setPerKm(Number(e.target.value)||0)} />
              </label>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <label className="border rounded-lg p-2 flex items-center gap-2">
                <input type="radio" name="pay" value="qris" checked={pay==="qris"} onChange={()=>setPay("qris")} />
                <span>Bayar Online (QRIS)</span>
              </label>
              <label className="border rounded-lg p-2 flex items-center gap-2">
                <input type="radio" name="pay" value="cod" checked={pay==="cod"} onChange={()=>setPay("cod")} />
                <span>COD</span>
              </label>
            </div>

            <div className="flex justify-between text-sm">
              <span>Ongkir</span><span>{IDR(deliveryFee)}</span>
            </div>
            <div className="flex justify-between font-semibold">
              <span>Total</span><span>{IDR(grandTotal)}</span>
            </div>

            <button
              disabled={cart.length===0}
              onClick={submit}
              className="w-full py-3 rounded-lg bg-emerald-600 text-white disabled:opacity-50"
            >
              Pesan Sekarang
            </button>
            <div className="text-xs text-neutral-500 text-center">
              Dengan menekan tombol, Anda setuju pesanan diproses sesuai ketersediaan.
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

/* ==========================
   APP (POS + Admin)
========================== */
export default function App() {
  // Halaman publik /order tanpa login
  if (window.location.pathname.startsWith("/order")) {
    return <PublicOrder />;
  }

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

  /* ---- Orders (admin) ---- */
  const [orders, setOrders] = useState<Order[]>([]);
  const [ordersLoading] = useState(false);
  const lastOrderTimeRef = useRef<number>(0);
  const beep = useMemo(()=>{
    try{ return new Audio("data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABYAAAAAAABERERERERERERERERERERERERERERERERERERER"); }catch{ return null; }
  },[]);
  const [orderFilter, setOrderFilter] = useState<"all"|"pending"|"confirmed"|"delivering"|"done"|"cancelled">("pending");
  const [orderSearch, setOrderSearch] = useState("");
  const filteredOrders = useMemo(()=>{
    let rows = orders;
    if(orderFilter!=="all") rows = rows.filter(o=>o.status===orderFilter);
    if(orderSearch.trim()){
      const q = orderSearch.trim().toLowerCase();
      rows = rows.filter(o =>
        (o.customer?.name||"").toLowerCase().includes(q) ||
        (o.customer?.phone||"").toLowerCase().includes(q)
      );
    }
    return rows;
  }, [orders, orderFilter, orderSearch]);

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
    const unsub = onAuthStateChanged(auth, u=> setUser(u?.email? {email:u.email}: null));
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
        return { id:d.id, name:x.name, price:x.price, category:x.category, active:x.active, imgUrl:x.imgUrl, outlet:x.outlet };
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

    // orders
    const qOrders = query(
      collection(db, "orders"),
      where("outlet","==", OUTLET),
      orderBy("createdAt", "desc"),
      limit(100)
    );
    const unsubOrders = onSnapshot(qOrders, snap=>{
      const rows: Order[] = snap.docs.map(d=>{
        const x = d.data() as any;
        return {
          id: d.id,
          outlet: x.outlet,
          items: x.items || [],
          customer: x.customer || { name:"", phone:"", address:"" },
          payMethod: x.payMethod || "qris",
          status: x.status || "pending",
          createdAt: x.createdAt || null,
          assignedShiftId: x.assignedShiftId ?? null,
          note: x.note || "",
          distanceKm: x.distanceKm ?? null,
          deliveryFee: x.deliveryFee ?? null,
        } as Order;
      });

      const newest = rows[0]?.createdAt?.toMillis?.() ?? 0;
      if(newest && newest > lastOrderTimeRef.current){
        if(lastOrderTimeRef.current !== 0 && beep){
          beep.currentTime = 0;
          beep.play?.().catch(()=>{});
        }
        lastOrderTimeRef.current = newest;
      } else if(lastOrderTimeRef.current === 0 && newest){
        lastOrderTimeRef.current = newest;
      }
      setOrders(rows);
    }, err=>console.warn("orders onSnapshot:", err));

    // shift awal
    checkActiveShift().catch(e=>console.warn(e));
    // dashboard awal
    loadDashboard().catch(()=>{});

    return ()=>{ unsubProd(); unsubIng(); unsubOrders(); };
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
    await loadDashboard().catch(()=>{});
  }

  /* ==========================
     RESEP & STOCK
  =========================== */
  async function getRecipeByProductId(productId: string): Promise<Recipe | null> {
    try{
      const snap = await getDocs(query(collection(db,"recipes"), where("productId","==",productId), limit(1)));
      if(snap.empty) return null;
      const d = snap.docs[0]; const x = d.data() as any;
      return { productId: x.productId, items: (x.items||[]).map((r:any)=>({ ingredientId:r.ingredientId, qty:Number(r.qty)||0 })) };
    }catch{ return null; }
  }

  async function deductStockForOrderItems(items: {productId?:string; qty:number}[]){
    const need = new Map<string, number>();
    for(const it of items){
      if(!it.productId) continue;
      const recipe = await getRecipeByProductId(it.productId);
      if(!recipe) continue;
      for(const r of recipe.items){
        const cur = need.get(r.ingredientId)||0;
        need.set(r.ingredientId, cur + (r.qty||0) * (it.qty||0));
      }
    }
    for(const [ingredientId, qtyNeed] of need.entries()){
      try{
        const ref = doc(db,"ingredients", ingredientId);
        const d = await getDoc(ref);
        if(!d.exists()) continue;
        const cur = (d.data() as any).stock || 0;
        await updateDoc(ref, { stock: Math.max(0, Math.round(cur - qtyNeed)) });
      }catch(e){}
    }
  }

  /* ==========================
     POS HANDLERS
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
    setCart([]); setDiscount(0); setTaxPct(0); setSvcPct(0); setPayMethod("cash"); setCash(0); setNoteInput("");
    setCustomerPhone(""); setCustomerName(""); setCustomerPoints(null);
  };

  // loyalty auto-lookup
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
  <img src="${LOGO_IMG_SRC}" class="logo" onerror="this.style.display='none'"/>
  <h2>NamiPOS — ${OUTLET}</h2>
  <div class="meta">${saleId||"DRAFT"}<br/>${new Date().toLocaleString("id-ID",{hour12:false})}</div>
  <hr/>
  <table style="width:100%;border-collapse:collapse">
    ${itemsHtml}
    <tr class="tot"><td>Subtotal</td><td></td><td style="text-align:right">${IDR(rec.subtotal)}</td></tr>
    ${rec.tax?`<tr class="tot"><td>Pajak</td><td></td><td style="text-align:right">${IDR(rec.tax)}</td></tr>`:""}
    ${rec.service?`<tr class="tot"><td>Service</td><td></td><td style="text-align:right">${IDR(rec.service)}</td></tr>`:""}
    ${rec.discount?`<tr class="tot"><td>Diskon</td><td></td><td style="text-align:right">-${IDR(rec.discount)}</td></tr>`:""}
    ${rec.deliveryFee?`<tr class="tot"><td>Ongkir</td><td></td><td style="text-align:right">${IDR(rec.deliveryFee)}</td></tr>`:""}
    <tr class="tot"><td>Total</td><td></td><td style="text-align:right">${IDR(rec.total)}</td></tr>
    ${rec.payMethod==="cash"
      ? `<tr><td>Tunai</td><td></td><td style='text-align:right'>${IDR(rec.cash||0)}</td></tr>
         <tr><td>Kembali</td><td></td><td style='text-align:right'>${IDR(rec.change||0)}</td></tr>`
      : `<tr><td>Metode</td><td></td><td style='text-align:right'>${rec.payMethod.toUpperCase()}</td></tr>`
    }
  </table>
  <p class="meta">Terima kasih! — NamiPOS</p>
</div>
<script>window.print();</script>
</body></html>`;
    w.document.write(html); w.document.close();
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

      // loyalty 15k = 1 poin
      const totalForPoints = total;
      if((customerPhone.trim().length)>=8){
        const cref = doc(db,"customers", customerPhone.trim());
        const s = await getDoc(cref);
        const pts = Math.floor(totalForPoints/15000);
        if(s.exists()){
          const c = s.data() as any;
          await updateDoc(cref, { points:(c.points||0)+pts, name: customerName||c.name||"", lastVisit: serverTimestamp() });
        }else{
          await setDoc(cref, { phone: customerPhone.trim(), name: customerName||"Member", points: pts, lastVisit: serverTimestamp() });
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
          time:x.time??null, items:x.items||[],
          subtotal:x.subtotal??0, discount:x.discount??0, tax:x.tax??0, service:x.service??0,
          total:x.total??0, payMethod:x.payMethod??"cash", cash:x.cash??0, change:x.change??0,
          source:x.source, orderId:x.orderId, deliveryFee:x.deliveryFee||0
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
        const t: Date = x.time?.toDate?.() || new Date();
        const key = new Date(t).toISOString().slice(0,10);
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
     ADMIN: Products & Inventory
  =========================== */
  async function upsertProduct(p: Partial<Product> & { id?: string }){
    if(!isOwner) return alert("Akses khusus owner.");
    const id = p.id || uid();
    await setDoc(doc(db,"products", id), {
      outlet: OUTLET,
      name: p.name||"Produk",
      price: Number(p.price)||0,
      category: p.category||"Signature",
      active: p.active!==false,
      imgUrl: p.imgUrl || ""
    }, { merge:true });
  }
  async function deactivateProduct(id:string){
    if(!isOwner) return alert("Akses khusus owner.");
    await updateDoc(doc(db,"products", id), { active:false });
  }
  async function deleteProduct(id:string){
    if(!isOwner) return alert("Akses khusus owner.");
    if(!confirm("Hapus produk ini?")) return;
    await deleteDoc(doc(db, "products", id));
  }
  async function upsertIngredient(i: Partial<Ingredient> & { id?: string }){
    if(!isOwner) return alert("Akses khusus owner.");
    const id = i.id || uid();
    await setDoc(doc(db,"ingredients", id), {
      outlet: OUTLET, name:i.name||"Bahan", unit:i.unit||"pcs",
      stock: Number(i.stock)||0, min: Number(i.min)||0
    }, { merge:true });
  }
  async function deleteIngredient(id:string){
    if(!isOwner) return alert("Akses khusus owner.");
    if(!confirm("Hapus bahan ini?")) return;
    await deleteDoc(doc(db,"ingredients", id));
  }

  /* ==========================
     ORDER → SALE (Done)
  =========================== */
  async function createSaleFromOrder(o: Order) {
    const items = o.items.map(i=>({ name:i.name, price:i.price, qty:i.qty }));
    const subtotal = items.reduce((s,i)=>s + (i.price||0)*(i.qty||0), 0);
    const discount = 0;
    const tax = 0;
    const service = 0;
    const deliveryFee = o.deliveryFee||0;
    const total = subtotal + deliveryFee;

    const pts = Math.floor(total/15000);

    const payload = {
      outlet: OUTLET,
      shiftId: o.assignedShiftId || activeShift?.id || null,
      cashierEmail: user?.email || "system@order",
      customerPhone: o.customer?.phone || null,
      customerName: o.customer?.name || null,
      time: serverTimestamp(),
      items, subtotal, discount, tax, service,
      total, payMethod: o.payMethod==="cod" ? "cash" : "qris",
      cash: o.payMethod==="cod" ? total : 0,
      change: 0,
      source: "order",
      orderId: o.id,
      deliveryFee,
    } as any;

    const saleRef = await addDoc(collection(db,"sales"), payload);

    if((o.customer?.phone||"").trim().length >= 8){
      const cref = doc(db,"customers", o.customer.phone.trim());
      const s = await getDoc(cref);
      if(s.exists()){
        const c = s.data() as any;
        await updateDoc(cref, {
          points: (c.points||0) + pts,
          name: o.customer.name || c.name || "",
          lastVisit: serverTimestamp()
        });
      }else{
        await setDoc(cref, {
          phone: o.customer.phone.trim(),
          name: o.customer.name || "Member",
          points: pts,
          lastVisit: serverTimestamp()
        });
      }
    }
    return saleRef.id;
  }

  async function updateOrderStatus(id:string, status: Order["status"]){
    try{
      const ref = doc(db,"orders", id);
      const snap = await getDoc(ref);
      if(!snap.exists()) throw new Error("Order tidak ditemukan.");
      const o = { id, ...(snap.data() as any) } as Order;

      if(status === "confirmed" && activeShift?.id){
        await updateDoc(ref, { status, assignedShiftId: activeShift.id });
        return;
      }

      if(status === "done"){
        const saleId = await createSaleFromOrder(o);
        try{ await deductStockForOrderItems(o.items || []); }catch(e){ console.warn("deductStock:", e); }
        await updateDoc(ref, { status, assignedShiftId: o.assignedShiftId || activeShift?.id || null, saleId });
        return;
      }

      await updateDoc(ref, { status });
    }catch(e:any){
      alert("Gagal mengubah status: " + (e?.message||e));
    }
  }

  /* ==========================
     UI - LOGIN
  =========================== */
  if(!user){
    return (
      <div className="min-h-screen bg-gradient-to-br from-emerald-50 to-white flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-6 border">
          <div className="flex items-center gap-3 mb-4">
            <img src={LOGO_IMG_SRC} alt="logo" className="h-10 w-10 rounded-lg object-contain" onError={(e)=>{(e.currentTarget as HTMLImageElement).style.display="none"}}/>
            <div>
              <h1 className="text-2xl font-bold">NamiPOS — POS</h1>
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
     UI - APP
  =========================== */
  return (
    <div className="min-h-screen bg-neutral-50">
      {/* Topbar */}
      <header className="sticky top-0 z-30 bg-white/80 backdrop-blur border-b">
        <div className="max-w-7xl mx-auto px-3 sm:px-4 md:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src={LOGO_IMG_SRC} alt="logo" className="h-8 w-8 rounded-md object-contain" onError={(e)=>{(e.currentTarget as HTMLImageElement).style.display="none"}}/>
            <div>
              <div className="font-bold">NamiPOS — {OUTLET}</div>
              <div className="text-[11px] text-neutral-500">Masuk: {user.email}{isOwner?" · owner":" · staff"}</div>
            </div>
          </div>
          <nav className="flex gap-2">
            {isOwner && <button onClick={()=>{ setTab("dashboard"); loadDashboard(); }} className={`px-3 py-1.5 rounded-lg border ${tab==="dashboard"?"bg-emerald-50 border-emerald-200":"bg-white"}`}>Dashboard</button>}
            <button onClick={()=>setTab("pos")} className={`px-3 py-1.5 rounded-lg border ${tab==="pos"?"bg-emerald-50 border-emerald-200":"bg-white"}`}>Kasir</button>
            <button onClick={()=>{ setTab("orders"); }} className={`px-3 py-1.5 rounded-lg border ${tab==="orders"?"bg-emerald-50 border-emerald-200":"bg-white"}`}>Orders</button>
            <button onClick={()=>{ setTab("history"); loadHistory(false); }} className={`px-3 py-1.5 rounded-lg border ${tab==="history"?"bg-emerald-50 border-emerald-200":"bg-white"}`}>Riwayat</button>
            {isOwner && <button onClick={()=>setTab("products")} className={`px-3 py-1.5 rounded-lg border ${tab==="products"?"bg-emerald-50 border-emerald-200":"bg-white"}`}>Produk</button>}
            {isOwner && <button onClick={()=>setTab("inventory")} className={`px-3 py-1.5 rounded-lg border ${tab==="inventory"?"bg-emerald-50 border-emerald-200":"bg-white"}`}>Inventori</button>}
            <a className="px-3 py-1.5 rounded-lg border" href="/order" target="_blank" rel="noreferrer">Link Order Publik</a>
            <button onClick={doLogout} className="px-3 py-1.5 rounded-lg border bg-rose-50">Keluar</button>
          </nav>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-3 sm:px-4 md:px-6 py-4">
        {/* Shift info */}
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
                  <button key={p.id} onClick={()=>addToCart(p)} className="text-left rounded-2xl border bg-white p-3 hover:shadow">
                    {p.imgUrl
                      ? <img src={p.imgUrl} alt={p.name} className="h-20 w-full object-cover rounded-xl mb-2"/>
                      : <div className="h-20 rounded-xl bg-gradient-to-br from-emerald-50 to-emerald-100 mb-2"/>}
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

        {/* ORDERS (Admin) */}
        {tab==="orders" && (
          <section className="bg-white rounded-2xl border p-3">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-lg font-semibold">Orders (Delivery/Takeaway)</h2>
              <div className="flex items-center gap-2">
                <select className="border rounded-lg px-2 py-1 text-sm" value={orderFilter} onChange={e=>setOrderFilter(e.target.value as any)}>
                  <option value="all">Semua</option>
                  <option value="pending">Pending</option>
                  <option value="confirmed">Confirmed</option>
                  <option value="delivering">Delivering</option>
                  <option value="done">Done</option>
                  <option value="cancelled">Cancelled</option>
                </select>
                <input className="border rounded-lg px-2 py-1 text-sm" placeholder="Cari nama/HP…" value={orderSearch} onChange={e=>setOrderSearch(e.target.value)} />
              </div>
            </div>

            <div className="overflow-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left border-b">
                    <th className="py-2">Waktu</th>
                    <th>Pelanggan</th>
                    <th>Item</th>
                    <th>Bayar</th>
                    <th>Status</th>
                    <th className="text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredOrders.map(o=>{
                    const when = o.createdAt ? new Date(o.createdAt.toDate()).toLocaleString("id-ID",{hour12:false}) : "-";
                    const sub = o.items.reduce((s,i)=>s + (i.price||0)*(i.qty||0), 0);
                    const grand = sub + (o.deliveryFee||0);
                    return (
                      <tr key={o.id} className="border-b align-top">
                        <td className="py-2">{when}</td>
                        <td>
                          <div className="font-medium">{o.customer?.name||"-"}</div>
                          <div className="text-xs">
                            <a className="underline" href={`https://wa.me/${(o.customer?.phone||"").replace(/\D/g,"")}`} target="_blank" rel="noreferrer">
                              {o.customer?.phone||"-"}
                            </a>
                          </div>
                          <div className="text-xs text-neutral-600 max-w-xs truncate" title={o.customer?.address||""}>
                            {o.customer?.address||"-"}
                          </div>
                        </td>
                        <td className="max-w-md">
                          <div className="space-y-1">
                            {o.items.map((it,idx)=>(
                              <div key={idx} className="flex justify-between gap-3">
                                <span className="truncate">{it.name} x{it.qty}</span>
                                <span>{IDR((it.price||0)*(it.qty||0))}</span>
                              </div>
                            ))}
                            <div className="border-t pt-1 flex justify-between">
                              <span>Subtotal</span><span>{IDR(sub)}</span>
                            </div>
                            {o.deliveryFee ? (
                              <>
                                <div className="flex justify-between"><span>Ongkir</span><span>{IDR(o.deliveryFee||0)}</span></div>
                                <div className="flex justify-between font-semibold"><span>Grand Total</span><span>{IDR(grand)}</span></div>
                              </>
                            ):null}
                          </div>
                        </td>
                        <td className="uppercase">{o.payMethod}</td>
                        <td>
                          <span className="px-2 py-1 rounded-full text-xs border">
                            {o.status}
                          </span>
                          {o.assignedShiftId && (
                            <div className="text-[11px] text-neutral-500 mt-1">Shift: {o.assignedShiftId}</div>
                          )}
                        </td>
                        <td className="text-right">
                          <div className="flex flex-wrap gap-2 justify-end">
                            {o.status==="pending" && (
                              <button className="px-2 py-1 border rounded" onClick={()=>updateOrderStatus(o.id, "confirmed")}>
                                Confirm
                              </button>
                            )}
                            {o.status==="confirmed" && (
                              <button className="px-2 py-1 border rounded" onClick={()=>updateOrderStatus(o.id, "delivering")}>
                                Start Delivery
                              </button>
                            )}
                            {o.status==="delivering" && (
                              <button className="px-2 py-1 border rounded" onClick={()=>updateOrderStatus(o.id, "done")}>
                                Mark Done
                              </button>
                            )}
                            {o.status!=="done" && o.status!=="cancelled" && (
                              <button className="px-2 py-1 border rounded bg-rose-50" onClick={()=>updateOrderStatus(o.id, "cancelled")}>
                                Cancel
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {filteredOrders.length===0 && (
                <div className="text-sm text-neutral-500">Belum ada order.</div>
              )}
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
                  {historyRows.map(s=>(
                    <tr key={s.id} className="border-b hover:bg-emerald-50/40">
                      <td className="py-2">{s.time? new Date(s.time.toDate()).toLocaleString("id-ID",{hour12:false}) : "-"}</td>
                      <td>{s.cashierEmail}</td>
                      <td>{s.customerPhone || "-"}</td>
                      <td className="truncate">{s.items.map(i=>`${i.name}x${i.qty}`).join(", ")}</td>
                      <td className="text-right font-medium">{IDR(s.total)}</td>
                      <td className="text-right">
                        {isOwner && s.id && (
                          <button className="px-2 py-1 border rounded bg-rose-50" onClick={async()=>{
                            if(!confirm("Hapus transaksi ini?")) return;
                            await deleteDoc(doc(db,"sales", s.id!));
                            loadHistory(false);
                          }}>Hapus</button>
                        )}
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
              <button className="px-3 py-2 rounded-lg border" onClick={()=>upsertProduct({ name:"Produk Baru", price:10000, category:"Signature", active:true })}>+ Tambah</button>
            </div>
            <div className="overflow-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left border-b"><th>Nama</th><th>Kategori</th><th className="text-right">Harga</th><th>Gambar</th><th className="text-right">Aksi</th></tr></thead>
                <tbody>
                  {products.map(p=>(
                    <tr key={p.id} className="border-b">
                      <td className="py-2">{p.name}</td>
                      <td>{p.category||"-"}</td>
                      <td className="text-right">{IDR(p.price)}</td>
                      <td>
                        {p.imgUrl
                          ? <img src={p.imgUrl} alt="" className="h-10 w-10 object-cover rounded" />
                          : <span className="text-xs text-neutral-500">-</span>}
                      </td>
                      <td className="text-right">
                        <div className="flex flex-wrap gap-2 justify-end">
                          <button className="px-2 py-1 border rounded" onClick={async()=>{
                            const name = prompt("Nama produk:", p.name) ?? p.name;
                            const priceStr = prompt("Harga (angka):", String(p.price)) ?? String(p.price);
                            const category = prompt("Kategori:", p.category||"Signature") ?? (p.category||"Signature");
                            const imgUrl = prompt("URL Gambar (opsional):", p.imgUrl||"") ?? (p.imgUrl||"");
                            const price = Number(priceStr)||0;
                            await upsertProduct({ id:p.id, name, price, category, imgUrl });
                          }}>Edit</button>
                          <button className="px-2 py-1 border rounded" onClick={()=>deactivateProduct(p.id)}>Nonaktifkan</button>
                          <button className="px-2 py-1 border rounded bg-rose-50" onClick={()=>deleteProduct(p.id)}>Hapus</button>
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
              <button className="px-3 py-2 rounded-lg border" onClick={()=>upsertIngredient({ name:"Bahan Baru", unit:"pcs", stock:0, min:0 })}>+ Tambah</button>
            </div>
            <div className="overflow-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left border-b"><th>Nama</th><th>Satuan</th><th className="text-right">Stok</th><th className="text-right">Aksi</th></tr></thead>
                <tbody>
                  {ingredients.map(i=>{
                    const low = (i.min||0)>0 && i.stock<= (i.min||0);
                    return (
                      <tr key={i.id} className={`border-b ${low?"bg-amber-50":""}`}>
                        <td className="py-2">{i.name}</td>
                        <td>{i.unit}</td>
                        <td className="text-right">{i.stock}</td>
                        <td className="text-right">
                          <div className="flex flex-wrap gap-2 justify-end">
                            <button className="px-2 py-1 border rounded" onClick={async()=>{
                              const name = prompt("Nama bahan:", i.name) ?? i.name;
                              const unit = prompt("Satuan:", i.unit) ?? i.unit;
                              const stock = Number(prompt("Stok:", String(i.stock)) ?? String(i.stock))||0;
                              const min = Number(prompt("Stok minimum (peringatan):", String(i.min||0)) ?? String(i.min||0))||0;
                              await upsertIngredient({ id:i.id, name, unit, stock, min });
                            }}>Edit</button>
                            <button className="px-2 py-1 border rounded bg-rose-50" onClick={()=>deleteIngredient(i.id)}>Hapus</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {ingredients.length===0 && <div className="text-sm text-neutral-500">Belum ada data inventori.</div>}
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

/* ===== Small UI helpers ===== */
function KPI({title, value}:{title:string; value:string}) {
  return (
    <div className="bg-white border rounded-2xl p-4">
      <div className="text-[12px] text-neutral-500">{title}</div>
      <div className="text-xl font-bold mt-1">{value}</div>
    </div>
  );
}