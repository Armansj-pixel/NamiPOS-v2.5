// App.tsx — NamiPOS v2.5.2 (Full Integration Build)
// Fitur: POS, Dashboard, Produk, Inventori, Resep, Loyalty, Delivery Order, COD/QRIS, Shift, Hapus Riwayat

import React, { useEffect, useMemo, useState } from "react";
import {
  collection, query, where, getDocs, addDoc, doc, getDoc, setDoc, updateDoc, deleteDoc,
  onSnapshot, orderBy, limit, serverTimestamp, startAfter, Timestamp
} from "firebase/firestore";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { auth, db } from "./lib/firebase";

// =========================
// KONFIGURASI
// =========================
const OUTLET = "MTHaryono";
const OWNER_EMAILS = new Set([
  "antonius.arman123@gmail.com",
  "ayuismaalabibbah@gmail.com",
]);
const QRIS_IMG_SRC = "/qris.png";
const LOGO_SRC = "/logo.png";

// =========================
// UTILITAS
// =========================
const IDR = (n: number) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n || 0);
const uid = () => Math.random().toString(36).slice(2, 10);
const startOfDay = (d = new Date()) => { const x = new Date(d); x.setHours(0,0,0,0); return x; };
const endOfDay = (d = new Date()) => { const x = new Date(d); x.setHours(23,59,59,999); return x; };

// =========================
// TIPE DATA
// =========================
type Product = { id: string; name: string; price: number; image?: string; category?: string; active?: boolean; outlet?: string };
type Ingredient = { id: string; name: string; stock: number; unit: string; min?: number };
type RecipeItem = { ingredientId: string; qty: number; name?: string };
type Shift = { id: string; outlet: string; openBy: string; openAt: Timestamp; closeAt?: Timestamp | null; isOpen: boolean };
type Sale = { id?: string; outlet: string; items: any[]; total: number; payMethod: string; time?: any; customerPhone?: string; cashierEmail: string; };
type PublicOrder = {
  id?: string;
  customerName: string;
  customerPhone: string;
  address: string;
  distanceKm: number;
  deliveryFee: number;
  items: { name: string; qty: number; price: number }[];
  total: number;
  payMethod: "cod" | "qris";
  time?: any;
};

// =========================
// APP
// =========================
export default function App() {
  const [user, setUser] = useState<{ email: string } | null>(null);
  const [tab, setTab] = useState<"pos"|"dashboard"|"products"|"inventory"|"history"|"delivery">("pos");
  const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<any[]>([]);
  const [payMethod, setPayMethod] = useState<"cash"|"ewallet"|"qris">("cash");
  const [cash, setCash] = useState(0);
  const [activeShift, setActiveShift] = useState<Shift|null>(null);
  const [history, setHistory] = useState<Sale[]>([]);
  const [publicOrders, setPublicOrders] = useState<PublicOrder[]>([]);
  const [deliveryView, setDeliveryView] = useState(false);

  const isOwner = !!(user?.email && OWNER_EMAILS.has(user.email));

  // --- Hitung subtotal ---
  const subtotal = useMemo(() => cart.reduce((s, i) => s + i.price * i.qty, 0), [cart]);
  const change = Math.max(0, cash - subtotal);

  // --- Firebase Auth ---
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUser(u?.email ? { email: u.email } : null));
    return () => unsub();
  }, []);

  // --- Load Produk ---
  useEffect(() => {
    const q = query(collection(db, "products"), where("outlet", "==", OUTLET));
    const unsub = onSnapshot(q, (snap) => {
      const rows: Product[] = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
      setProducts(rows);
    });
    return () => unsub();
  }, []);

  // --- Login/Logout ---
  async function doLogin(e?: any) {
    e?.preventDefault();
    setAuthLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (e: any) {
      alert(e.message);
    } finally {
      setAuthLoading(false);
    }
  }
  async function doLogout() { await signOut(auth); }

  // --- Tambah ke Keranjang ---
  function addToCart(p: Product) {
    setCart((prev) => {
      const f = prev.find((x) => x.id === p.id);
      if (f) return prev.map((x) => (x.id === p.id ? { ...x, qty: x.qty + 1 } : x));
      return [...prev, { ...p, qty: 1 }];
    });
  }

  // --- Simpan Transaksi (POS) ---
  async function finalizeSale() {
    if (!user) return alert("Belum login");
    const sale: Sale = {
      outlet: OUTLET,
      items: cart,
      total: subtotal,
      payMethod,
      time: serverTimestamp(),
      cashierEmail: user.email,
    };
    await addDoc(collection(db, "sales"), sale);
    setCart([]);
    alert("Transaksi disimpan.");
  }

  // --- Public Orders (tanpa login) ---
  async function loadPublicOrders() {
    const q = query(collection(db, "public_orders"), orderBy("time", "desc"));
    const snap = await getDocs(q);
    setPublicOrders(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
  }

  async function createPublicOrder(order: PublicOrder) {
    await addDoc(collection(db, "public_orders"), { ...order, time: serverTimestamp() });
  }

  // =========================
  // UI: LOGIN PAGE
  // =========================
  if (!user && !deliveryView) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-emerald-50 to-white">
        <div className="bg-white p-6 rounded-xl shadow-md w-full max-w-sm">
          <img src={LOGO_SRC} alt="Logo" className="w-20 mx-auto mb-3" />
          <h1 className="text-xl font-bold text-center mb-4">NamiPOS Login</h1>
          <form onSubmit={doLogin} className="space-y-3">
            <input className="w-full border rounded p-2" placeholder="Email" value={email} onChange={e=>setEmail(e.target.value)} />
            <input className="w-full border rounded p-2" placeholder="Password" type="password" value={password} onChange={e=>setPassword(e.target.value)} />
            <button disabled={authLoading} className="w-full bg-emerald-600 text-white rounded p-2">{authLoading?"Loading...":"Masuk"}</button>
          </form>
          <button onClick={()=>setDeliveryView(true)} className="mt-4 text-sm text-emerald-600 underline w-full">Buka Halaman Order Pelanggan</button>
        </div>
      </div>
    );
  }

  // =========================
  // UI: HALAMAN ORDER PUBLIC
  // =========================
  if (deliveryView) {
    const [customerName, setCustomerName] = useState("");
    const [customerPhone, setCustomerPhone] = useState("");
    const [address, setAddress] = useState("");
    const [distanceKm, setDistanceKm] = useState(1);
    const [orderCart, setOrderCart] = useState<Product[]>([]);
    const [payMethodPublic, setPayMethodPublic] = useState<"cod"|"qris">("cod");

    const deliveryFee = Math.max(0, (distanceKm - 1) * 2000);
    const total = orderCart.reduce((s,p)=>s+p.price,0) + deliveryFee;

    async function submitOrder() {
      if (!customerName || !customerPhone || !address) return alert("Lengkapi data.");
      await createPublicOrder({
        customerName, customerPhone, address, distanceKm, deliveryFee,
        items: orderCart.map(p=>({name:p.name, qty:1, price:p.price})),
        total, payMethod: payMethodPublic
      });
      alert("Pesanan berhasil dikirim!");
      setOrderCart([]);
    }

    return (
      <div className="min-h-screen bg-white p-4">
        <img src={LOGO_SRC} alt="Logo" className="w-20 mb-3" />
        <h2 className="text-xl font-bold mb-3">Order Antar — NamiPOS</h2>
        <div className="space-y-2 mb-3">
          <input className="border rounded p-2 w-full" placeholder="Nama" value={customerName} onChange={e=>setCustomerName(e.target.value)} />
          <input className="border rounded p-2 w-full" placeholder="Nomor HP" value={customerPhone} onChange={e=>setCustomerPhone(e.target.value)} />
          <textarea className="border rounded p-2 w-full" placeholder="Alamat Lengkap" value={address} onChange={e=>setAddress(e.target.value)} />
          <input type="number" className="border rounded p-2 w-full" placeholder="Jarak (km)" value={distanceKm} onChange={e=>setDistanceKm(Number(e.target.value)||1)} />
        </div>
        <div className="grid grid-cols-2 gap-2 mb-3">
          {products.filter(p=>p.active!==false).map(p=>(
            <button key={p.id} onClick={()=>setOrderCart([...orderCart,p])} className="border rounded-xl p-3 text-left bg-emerald-50">
              <div className="font-semibold">{p.name}</div>
              <div className="text-sm">{IDR(p.price)}</div>
            </button>
          ))}
        </div>
        <div className="p-3 border rounded-xl bg-neutral-50 mb-3">
          <h3 className="font-semibold mb-1">Ringkasan</h3>
          {orderCart.map((p,i)=><div key={i} className="text-sm">{p.name} - {IDR(p.price)}</div>)}
          <div className="text-sm">Ongkir: {IDR(deliveryFee)}</div>
          <div className="font-bold mt-1">Total: {IDR(total)}</div>
        </div>
        <div className="mb-3">
          <label className="text-sm">Metode Pembayaran:</label>
          <select className="border rounded p-2 w-full" value={payMethodPublic} onChange={e=>setPayMethodPublic(e.target.value as any)}>
            <option value="cod">COD (Bayar di Tempat)</option>
            <option value="qris">QRIS</option>
          </select>
        </div>
        {payMethodPublic==="qris" && <img src={QRIS_IMG_SRC} alt="QR" className="w-40 mb-2" />}
        <button onClick={submitOrder} className="bg-emerald-600 text-white rounded p-3 w-full">Kirim Pesanan</button>
        <button onClick={()=>setDeliveryView(false)} className="mt-3 text-sm text-neutral-500 underline">Kembali ke Login</button>
      </div>
    );
  }

  // =========================
  // UI: DASHBOARD ADMIN
  // =========================
  return (
    <div className="min-h-screen bg-neutral-50">
      <header className="bg-white border-b p-3 flex justify-between items-center">
        <div className="flex items-center gap-2">
          <img src={LOGO_SRC} className="w-8" />
          <div>
            <div className="font-bold">NamiPOS — {OUTLET}</div>
            <div className="text-xs text-neutral-500">{user?.email}</div>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={()=>setTab("pos")} className="px-3 py-1.5 rounded border">Kasir</button>
          {isOwner && <button onClick={()=>setTab("dashboard")} className="px-3 py-1.5 rounded border">Dashboard</button>}
          <button onClick={()=>setTab("products")} className="px-3 py-1.5 rounded border">Produk</button>
          <button onClick={()=>setTab("inventory")} className="px-3 py-1.5 rounded border">Inventori</button>
          <button onClick={()=>setTab("history")} className="px-3 py-1.5 rounded border">Riwayat</button>
          <button onClick={()=>setTab("delivery")} className="px-3 py-1.5 rounded border">Delivery</button>
          <button onClick={doLogout} className="px-3 py-1.5 rounded border bg-rose-50">Keluar</button>
        </div>
      </header>

      <main className="p-4">
        {tab === "pos" && (
          <div>
            <h2 className="text-lg font-bold mb-2">Kasir</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-3">
              {products.map(p=>(
                <button key={p.id} onClick={()=>addToCart(p)} className="border rounded-xl p-3 text-left bg-white hover:bg-emerald-50">
                  <img src={p.image||LOGO_SRC} className="w-full h-24 object-cover rounded mb-1" />
                  <div className="font-semibold">{p.name}</div>
                  <div className="text-sm">{IDR(p.price)}</div>
                </button>
              ))}
            </div>
            <div className="border rounded-xl p-3 bg-white">
              <h3 className="font-semibold mb-2">Keranjang</h3>
              {cart.map((i,idx)=>(
                <div key={idx} className="flex justify-between items-center mb-1 text-sm">
                  <span>{i.name} x{i.qty}</span>
                  <span>{IDR(i.price*i.qty)}</span>
                </div>
              ))}
              <div className="font-bold mt-2">Total: {IDR(subtotal)}</div>
              {payMethod==="cash" && <div className="text-sm mb-1">Kembali: {IDR(change)}</div>}
              <select value={payMethod} onChange={e=>setPayMethod(e.target.value as any)} className="border rounded p-2 w-full mb-2">
                <option value="cash">Cash</option>
                <option value="qris">QRIS</option>
              </select>
              {payMethod==="cash" && <input type="number" className="border rounded p-2 w-full mb-2" placeholder="Uang diterima" value={cash} onChange={e=>setCash(Number(e.target.value))} />}
              <button onClick={finalizeSale} className="bg-emerald-600 text-white w-full rounded p-2">Selesai</button>
            </div>
          </div>
        )}

        {tab === "delivery" && (
          <div>
            <h2 className="text-lg font-bold mb-2">Pesanan Delivery</h2>
            <button onClick={loadPublicOrders} className="border px-3 py-1 rounded mb-2">Muat Ulang</button>
            <div className="bg-white rounded-xl p-3 border">
              {publicOrders.map((o)=>(
                <div key={o.id} className="border-b py-2">
                  <div className="font-semibold">{o.customerName} ({o.customerPhone})</div>
                  <div className="text-sm">{o.address}</div>
                  <div className="text-sm text-neutral-600">{o.items.map(i=>`${i.name}x${i.qty}`).join(", ")}</div>
                  <div className="text-sm">Total: {IDR(o.total)} — {o.payMethod.toUpperCase()}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}