import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  addDoc, collection, doc, getDoc, getDocs, onSnapshot, orderBy, query,
  serverTimestamp, setDoc, Timestamp, updateDoc, where, limit, startAfter
} from "firebase/firestore";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { auth, db } from "./lib/firebase";

/* ==========================
   KONFIGURASI UMUM
========================== */
const OUTLET = "MTHaryono";      // ubah jika punya cabang lain
const OWNER_EMAILS = new Set([
  "antonius.arman123@gmail.com",
  "ayuismaalabibbah@gmail.com",
]);
const QRIS_IMG_SRC = "/qris.png"; // simpan di /public/qris.png

/* ==========================
   TIPE DATA
========================== */
type Product = { id: string; name: string; price: number; category?: string; active?: boolean };
type Ingredient = { id: string; name: string; unit: string; stock: number; min?: number };
type CartItem = { id: string; productId: string; name: string; price: number; qty: number; note?: string };
type Shift = { id: string; outlet: string; openBy: string; openAt: Timestamp; closeAt?: Timestamp | null; openCash?: number; isOpen: boolean };
type Customer = { id: string; phone: string; name: string; points: number; lastVisit?: Timestamp };
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

/* ==========================
   UTIL
========================== */
const uid = () => Math.random().toString(36).slice(2, 10);
const IDR = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n || 0);
export default function App() {
  const [user, setUser] = useState<null | { email: string }>(null);
  const isOwner = !!(user?.email && OWNER_EMAILS.has(user.email));

  const [tab, setTab] = useState<"pos" | "history" | "products" | "inventory">("pos");
  const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [authLoading, setAuthLoading] = useState(false);

  const [products, setProducts] = useState<Product[]>([]);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [discount, setDiscount] = useState(0);
  const [taxPct, setTaxPct] = useState(0);
  const [svcPct, setSvcPct] = useState(0);
  const [payMethod, setPayMethod] = useState<"cash" | "ewallet" | "qris">("cash");
  const [cash, setCash] = useState<number>(0);

  const [customerPhone, setCustomerPhone] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPoints, setCustomerPoints] = useState<number | null>(null);
  const [activeShift, setActiveShift] = useState<Shift | null>(null);
  const [openCash, setOpenCash] = useState<number>(0);
  const [queryText, setQueryText] = useState("");
  const [showQR, setShowQR] = useState(false);

  const subtotal = useMemo(() => cart.reduce((s, i) => s + i.price * i.qty, 0), [cart]);
  const taxVal = Math.round(subtotal * (taxPct / 100));
  const svcVal = Math.round(subtotal * (svcPct / 100));
  const total = Math.max(0, subtotal + taxVal + svcVal - (discount || 0));
  const change = Math.max(0, (cash || 0) - total);

  /* ---------- AUTH ---------- */
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u?.email ? { email: u.email } : null);
    });
    return () => unsub();
  }, []);

  async function doLogin(e?: React.FormEvent) {
    e?.preventDefault();
    try {
      setAuthLoading(true);
      await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch (err: any) {
      alert("Login gagal: " + err.message);
    } finally { setAuthLoading(false); }
  }

  async function doLogout() { await signOut(auth); }

  /* ---------- SHIFT ---------- */
  async function checkActiveShift() {
    const qShift = query(
      collection(db, "shifts"),
      where("outlet", "==", OUTLET),
      where("isOpen", "==", true),
      orderBy("openAt", "desc"),
      limit(1)
    );
    const snap = await getDocs(qShift);
    if (snap.empty) { setActiveShift(null); return; }
    const d = snap.docs[0];
    const x = d.data() as any;
    setActiveShift({ id: d.id, outlet: x.outlet, openBy: x.openBy, openAt: x.openAt, isOpen: true });
  }

  async function openShiftAction() {
    if (!user?.email) return alert("Belum login");
    const id = `SHIFT-${Date.now()}`;
    await setDoc(doc(db, "shifts", id), {
      outlet: OUTLET, openBy: user.email, openAt: serverTimestamp(),
      closeAt: null, isOpen: true, openCash
    });
    setOpenCash(0);
    checkActiveShift();
  }

  async function closeShiftAction() {
    if (!activeShift?.id) return;
    await updateDoc(doc(db, "shifts", activeShift.id), { isOpen: false, closeAt: serverTimestamp() });
    setActiveShift(null);
    alert("Shift ditutup");
  }
/* ---------- POS & LOYALTY ---------- */
  function addToCart(p: Product) {
    setCart(prev => {
      const same = prev.find(c => c.productId === p.id);
      if (same) return prev.map(c => c === same ? { ...c, qty: c.qty + 1 } : c);
      return [...prev, { id: uid(), productId: p.id, name: p.name, price: p.price, qty: 1 }];
    });
  }
  const inc = (id: string) => setCart(p => p.map(c => c.id === id ? { ...c, qty: c.qty + 1 } : c));
  const dec = (id: string) => setCart(p => p.map(c => c.id === id ? { ...c, qty: Math.max(1, c.qty - 1) } : c));
  const rm = (id: string) => setCart(p => p.filter(c => c.id !== id));

  useEffect(() => {
    if (!user || !customerPhone || customerPhone.trim().length < 8) { setCustomerPoints(null); return; }
    (async () => {
      const ref = doc(db, "customers", customerPhone.trim());
      const s = await getDoc(ref);
      if (s.exists()) {
        const c = s.data() as any;
        setCustomerName(c.name || ""); setCustomerPoints(c.points || 0);
      } else setCustomerPoints(0);
    })();
  }, [customerPhone, user]);

  function printReceipt(temp: Sale | null, id?: string) {
    const r = temp!;
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(`<pre>
CHAFU MATCHA — ${OUTLET}
---------------------------
${r.items.map(i => `${i.name} x${i.qty}  ${IDR(i.price * i.qty)}`).join("\n")}
---------------------------
Total: ${IDR(r.total)}
${r.payMethod === "cash" ? `Tunai: ${IDR(r.cash || 0)} | Kembali: ${IDR(r.change || 0)}` : r.payMethod.toUpperCase()}
---------------------------
Terima kasih!
@chafumatcha
</pre><script>window.print()</script>`);
    w.document.close();
  }

  async function finalize() {
    if (!user?.email) return alert("Belum login");
    if (!activeShift?.id) return alert("Buka shift dahulu");
    if (!cart.length) return alert("Keranjang kosong");

    const payload: Omit<Sale, "id"> = {
      outlet: OUTLET, shiftId: activeShift.id, cashierEmail: user.email,
      customerPhone: customerPhone || null, customerName, time: serverTimestamp() as any,
      items: cart.map(i => ({ name: i.name, price: i.price, qty: i.qty })),
      subtotal, discount, tax: taxVal, service: svcVal, total, payMethod, cash, change
    };
    const ref = await addDoc(collection(db, "sales"), payload as any);

    if (customerPhone.trim().length >= 8) {
      const cref = doc(db, "customers", customerPhone.trim());
      const s = await getDoc(cref);
      const pts = Math.floor(total / 10000);
      if (s.exists()) {
        const c = s.data() as any;
        await updateDoc(cref, { points: (c.points || 0) + pts, name: customerName || c.name || "" });
      } else await setDoc(cref, { phone: customerPhone.trim(), name: customerName, points: pts });
    }
    printReceipt(payload as any, ref.id);
    setCart([]);
  }
/* ---------- UI ---------- */
  if (!user) return (
    <div className="p-8 max-w-sm mx-auto">
      <h2 className="text-2xl font-bold mb-3">CHAFU MATCHA — POS</h2>
      <form onSubmit={doLogin} className="space-y-2">
        <input placeholder="Email" className="border p-2 w-full" value={email} onChange={e=>setEmail(e.target.value)} />
        <input placeholder="Password" type="password" className="border p-2 w-full" value={password} onChange={e=>setPassword(e.target.value)} />
        <button className="bg-emerald-600 text-white px-4 py-2 rounded w-full">{authLoading?"Masuk...":"Masuk"}</button>
      </form>
    </div>
  );

  return (
    <div className="p-4">
      <div className="flex justify-between items-center mb-3">
        <h2 className="text-xl font-bold">CHAFU MATCHA — Kasir</h2>
        <button onClick={doLogout} className="text-sm text-rose-600">Keluar</button>
      </div>

      <div className="flex gap-2 mb-3">
        {!activeShift
          ? <><input type="number" placeholder="Kas awal" className="border p-1 w-32" value={openCash} onChange={e=>setOpenCash(Number(e.target.value))} />
              <button onClick={openShiftAction} className="bg-emerald-600 text-white px-2 py-1 rounded">Buka Shift</button></>
          : <button onClick={closeShiftAction} className="bg-rose-600 text-white px-2 py-1 rounded">Tutup Shift</button>}
      </div>

      <input placeholder="Cari produk..." className="border p-2 w-full mb-2" value={queryText} onChange={e=>setQueryText(e.target.value)} />

      <div className="grid grid-cols-2 gap-2 mb-4">
        {products.filter(p=>p.name.toLowerCase().includes(queryText.toLowerCase())).map(p=>(
          <button key={p.id} onClick={()=>addToCart(p)} className="border rounded p-2 text-left hover:bg-emerald-50">
            <div className="font-medium">{p.name}</div>
            <div className="text-xs text-neutral-500">{IDR(p.price)}</div>
          </button>
        ))}
      </div>

      <div className="border rounded p-3">
        {cart.map(c=>(
          <div key={c.id} className="flex justify-between items-center border-b py-1">
            <div>{c.name}</div>
            <div className="flex items-center gap-2">
              <button onClick={()=>dec(c.id)}>-</button>
              <span>{c.qty}</span>
              <button onClick={()=>inc(c.id)}>+</button>
              <button onClick={()=>rm(c.id)}>x</button>
            </div>
          </div>
        ))}
        <div className="mt-2 text-right font-bold">Total: {IDR(total)}</div>
        <button onClick={finalize} className="bg-emerald-600 text-white px-3 py-2 rounded mt-2 w-full">Selesai & Cetak</button>
      </div>
    </div>
  );
}