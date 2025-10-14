import React, { useEffect, useMemo, useState } from "react";
import {
  addDoc, collection, doc, getDoc, getDocs, onSnapshot,
  orderBy, query, serverTimestamp, setDoc, updateDoc,
  where, limit, startAfter
} from "firebase/firestore";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { auth, db } from "./lib/firebase";

/* =============================
   CONFIGURATION
============================= */
const OUTLET = "MTHaryono";
const OUTLET_LOCATION = { lat: -6.4007, lng: 106.9591 }; // Lokasi outlet (contoh: Cileungsi)
const OWNER_EMAILS = new Set(["antonius.arman123@gmail.com", "ayuismaalabibbah@gmail.com"]);
const QRIS_IMG_SRC = "/qris.png";

/* =============================
   TYPES
============================= */
type Product = { id: string; name: string; price: number; category?: string; active?: boolean; outlet?: string };
type Ingredient = { id: string; name: string; unit: string; stock: number; min?: number; outlet?: string };
type CartItem = { id: string; productId: string; name: string; price: number; qty: number; note?: string };
type Order = {
  id?: string;
  name: string;
  phone: string;
  address: string;
  location?: { lat: number; lng: number };
  distanceKm?: number;
  payMethod: "qris" | "cod";
  status: "pending" | "confirmed" | "delivered" | "cancelled";
  items: CartItem[];
  total: number;
  createdAt?: any;
};

/* =============================
   UTILITIES
============================= */
const uid = () => Math.random().toString(36).slice(2, 10);
const IDR = (n: number) => new Intl.NumberFormat("id-ID",{style:"currency",currency:"IDR",maximumFractionDigits:0}).format(n||0);
const haversine = (lat1:number, lon1:number, lat2:number, lon2:number) => {
  const R = 6371; const dLat = (lat2-lat1)*Math.PI/180; const dLon = (lon2-lon1)*Math.PI/180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
};

/* =============================
   MAIN APP
============================= */
export default function App() {
  const [user, setUser] = useState<{ email:string }|null>(null);
  const isOwner = !!(user?.email && OWNER_EMAILS.has(user.email));

  const [tab, setTab] = useState<"pos"|"dashboard"|"order"|"history"|"products"|"inventory">("pos");

  const [email,setEmail] = useState(""); const [password,setPassword]=useState("");
  const [authLoading,setAuthLoading]=useState(false);

  const [products,setProducts]=useState<Product[]>([]);
  const [orders,setOrders]=useState<Order[]>([]);

  /* ============ AUTH ============ */
  useEffect(()=>{ const unsub=onAuthStateChanged(auth,u=>setUser(u?.email?{email:u.email}:null)); return()=>unsub(); },[]);
  async function doLogin(e?:React.FormEvent){ e?.preventDefault(); setAuthLoading(true);
    try{ await signInWithEmailAndPassword(auth,email,password); setTab("pos"); }
    catch(e:any){ alert("Login gagal: "+e.message);} finally{ setAuthLoading(false);}
  }
  async function doLogout(){ await signOut(auth); }

  /* ============ LOAD DATA ============ */
  useEffect(()=>{
    if(!user) return;
    const qProd=query(collection(db,"products"),where("outlet","==",OUTLET));
    const unsubProd=onSnapshot(qProd,s=>{ setProducts(s.docs.map(d=>({id:d.id,...d.data()} as Product))); });
    const unsubOrd=onSnapshot(query(collection(db,"orders"),orderBy("createdAt","desc")),s=>{
      setOrders(s.docs.map(d=>({id:d.id,...d.data()} as Order)));
    });
    return ()=>{unsubProd();unsubOrd();};
  },[user]);

  /* ============ ORDER HANDLING ============ */
  async function confirmOrder(id:string){
    await updateDoc(doc(db,"orders",id),{status:"confirmed"});
  }
  async function deleteOrder(id:string){
    if(!window.confirm("Hapus pesanan ini?"))return;
    await updateDoc(doc(db,"orders",id),{status:"cancelled"});
  }

  /* ============ ORDER PAGE (CUSTOMER SIDE) ============ */
  if(window.location.pathname.startsWith("/order")){
    const [cart,setCart]=useState<CartItem[]>([]);
    const [name,setName]=useState(""); const [phone,setPhone]=useState(""); const [address,setAddress]=useState("");
    const [payMethod,setPayMethod]=useState<"qris"|"cod">("cod");
    const [distance,setDistance]=useState<number|null>(null);
    const subtotal=useMemo(()=>cart.reduce((s,i)=>s+i.price*i.qty,0),[cart]);
    const total=subtotal;
    const add=(p:Product)=>setCart(prev=>[...prev,{id:uid(),productId:p.id,name:p.name,price:p.price,qty:1}]);
    const inc=(id:string)=>setCart(prev=>prev.map(i=>i.id===id?{...i,qty:i.qty+1}:i));
    const dec=(id:string)=>setCart(prev=>prev.map(i=>i.id===id?{...i,qty:Math.max(1,i.qty-1)}:i));
    const rm=(id:string)=>setCart(prev=>prev.filter(i=>i.id!==id));

    useEffect(()=>{
      navigator.geolocation.getCurrentPosition(pos=>{
        const d=haversine(OUTLET_LOCATION.lat,OUTLET_LOCATION.lng,pos.coords.latitude,pos.coords.longitude);
        setDistance(parseFloat(d.toFixed(2)));
      },()=>setDistance(null));
    },[]);

    async function submitOrder(){
      if(!name||!phone||cart.length===0)return alert("Lengkapi data!");
      const payload:Order={name,phone,address,items:cart,payMethod,total,distanceKm:distance??null,status:"pending",createdAt:serverTimestamp()};
      await addDoc(collection(db,"orders"),payload);
      alert("Pesanan berhasil dikirim!");
      setCart([]);
    }

    return (
      <div className="min-h-screen bg-emerald-50 p-4">
        <h1 className="text-xl font-bold mb-3">🧋 Pesan di {OUTLET}</h1>
        <div className="grid gap-2">
          {products.map(p=>(
            <button key={p.id} onClick={()=>add(p)} className="bg-white rounded-xl border p-2 flex justify-between">
              <div><b>{p.name}</b><div className="text-xs">{IDR(p.price)}</div></div>
              <div className="text-emerald-600 font-semibold">+</div>
            </button>
          ))}
        </div>

        {cart.length>0 && (
          <div className="fixed bottom-0 left-0 right-0 bg-white border-t p-3 space-y-2">
            <div className="text-sm">Keranjang:</div>
            {cart.map(i=>(
              <div key={i.id} className="flex justify-between items-center text-sm border-b py-1">
                <span>{i.name}</span>
                <div className="flex gap-2 items-center">
                  <button onClick={()=>dec(i.id)}>-</button>
                  <b>{i.qty}</b>
                  <button onClick={()=>inc(i.id)}>+</button>
                  <button onClick={()=>rm(i.id)}>x</button>
                </div>
              </div>
            ))}
            <div className="text-right font-bold">Total: {IDR(total)}</div>
            <div className="grid gap-2 text-sm">
              <input className="border p-2 rounded" placeholder="Nama" value={name} onChange={e=>setName(e.target.value)} />
              <input className="border p-2 rounded" placeholder="No HP" value={phone} onChange={e=>setPhone(e.target.value)} />
              <textarea className="border p-2 rounded" placeholder="Alamat pengantaran" value={address} onChange={e=>setAddress(e.target.value)} />
              <select className="border p-2 rounded" value={payMethod} onChange={e=>setPayMethod(e.target.value as any)}>
                <option value="cod">Bayar di tempat (COD)</option>
                <option value="qris">Bayar QRIS</option>
              </select>
              {distance && <div className="text-xs text-neutral-600">Estimasi jarak: {distance} km</div>}
              <button onClick={submitOrder} className="bg-emerald-600 text-white p-2 rounded">Kirim Pesanan</button>
            </div>
          </div>
        )}
      </div>
    );
  }

  /* ============ STAFF / OWNER UI ============ */
  if(!user){
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-emerald-50 to-white">
        <form onSubmit={doLogin} className="bg-white rounded-2xl shadow p-6 w-80">
          <h2 className="text-lg font-bold mb-3 text-center">Login NamiPOS</h2>
          <input className="border rounded p-2 w-full mb-2" placeholder="Email" value={email} onChange={e=>setEmail(e.target.value)} />
          <input className="border rounded p-2 w-full mb-3" placeholder="Password" type="password" value={password} onChange={e=>setPassword(e.target.value)} />
          <button className="bg-emerald-600 text-white rounded p-2 w-full" disabled={authLoading}>{authLoading?"Masuk...":"Masuk"}</button>
        </form>
      </div>
    );
  }

  /* ============ MAIN DASHBOARD ============ */
  return (
    <div className="min-h-screen bg-neutral-50">
      <header className="bg-white border-b p-3 flex justify-between items-center">
        <div>
          <div className="font-bold">NamiPOS — {OUTLET}</div>
          <div className="text-xs text-neutral-500">{user.email}{isOwner?" (Owner)":" (Staff)"}</div>
        </div>
        <nav className="flex gap-2">
          <button onClick={()=>setTab("pos")} className={tab==="pos"?"bg-emerald-100 px-3 py-1 rounded":"px-3 py-1"}>Kasir</button>
          {isOwner && <button onClick={()=>setTab("order")} className={tab==="order"?"bg-emerald-100 px-3 py-1 rounded":"px-3 py-1"}>Pesanan</button>}
          <button onClick={()=>setTab("history")} className={tab==="history"?"bg-emerald-100 px-3 py-1 rounded":"px-3 py-1"}>Riwayat</button>
          <button onClick={doLogout} className="text-rose-600">Keluar</button>
        </nav>
      </header>

      <main className="p-4">
        {tab==="order" && (
          <section className="bg-white rounded-xl border p-3">
            <h2 className="text-lg font-semibold mb-2">Pesanan Online</h2>
            <table className="w-full text-sm">
              <thead><tr><th>Nama</th><th>HP</th><th>Total</th><th>Status</th><th>Aksi</th></tr></thead>
              <tbody>
                {orders.map(o=>(
                  <tr key={o.id} className="border-b">
                    <td>{o.name}</td>
                    <td>{o.phone}</td>
                    <td>{IDR(o.total)}</td>
                    <td>{o.status}</td>
                    <td className="space-x-1">
                      {o.status==="pending" && (
                        <>
                          <button onClick={()=>confirmOrder(o.id!)} className="px-2 py-1 border rounded text-emerald-600">Konfirmasi</button>
                          <button onClick={()=>deleteOrder(o.id!)} className="px-2 py-1 border rounded text-rose-600">Tolak</button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {tab==="pos" && (
          <div className="text-sm text-neutral-500">POS tetap menggunakan modul V2.4.9 — silakan lanjutkan transaksi dari layar kasir seperti biasa.</div>
        )}
      </main>
    </div>
  );
}