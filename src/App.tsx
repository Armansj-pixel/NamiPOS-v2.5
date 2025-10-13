// src/App.tsx — NamiPOS V2.4.3 (Kasir + Public Order + Orders Inbox)
import React, { useState, useEffect } from "react";
import {
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from "firebase/auth";
import {
  collection,
  addDoc,
  getDocs,
  getFirestore,
  query,
  orderBy,
  updateDoc,
  doc,
  serverTimestamp,
} from "firebase/firestore";
import app from "./lib/firebase";

const auth = getAuth(app);
const db = getFirestore(app);

// util kecil untuk ambil nilai input/textarea aman utk TS
function getFieldValue(id: string): string {
  const el = document.getElementById(id) as
    | HTMLInputElement
    | HTMLTextAreaElement
    | null;
  return (el?.value ?? "").trim();
}

export default function App() {
  const [user, setUser] = useState<any>(null);
  const [page, setPage] = useState<"login" | "dashboard" | "kasir" | "orders" | "public">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // kasir
  const [cart, setCart] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [subtotal, setSubtotal] = useState(0);
  const [shift, setShift] = useState<{ id: string; user: string } | null>(null);

  // orders
  const [orders, setOrders] = useState<any[]>([]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setPage(u ? "kasir" : "login");
    });
    return () => unsub();
  }, []);

  // --- LOGIN ---
  const handleLogin = async () => {
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err: any) {
      alert("Login gagal: " + (err?.message || err));
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
    setUser(null);
    setPage("login");
  };

  // --- KASIR ---
  const loadProducts = async () => {
    const snap = await getDocs(collection(db, "products"));
    setProducts(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  };

  useEffect(() => {
    if (user) loadProducts();
  }, [user]);

  const addToCart = (p: any) => setCart((prev) => [...prev, { ...p, qty: 1 }]);

  useEffect(() => {
    setSubtotal(cart.reduce((sum, i) => sum + (i.price || 0) * (i.qty || 1), 0));
  }, [cart]);

  const handleSaveSale = async () => {
    try {
      const saleRef = await addDoc(collection(db, "sales"), {
        items: cart,
        total: subtotal,
        cashier: user.email,
        time: serverTimestamp(),
      });
      alert("Transaksi tersimpan #" + saleRef.id);
      setCart([]);
    } catch (err: any) {
      alert("Gagal simpan transaksi: " + (err?.message || err));
    }
  };

  // --- SHIFT ---
  const openShift = async () => {
    const ref = await addDoc(collection(db, "shifts"), {
      user: user.email,
      openAt: serverTimestamp(),
      isOpen: true,
    });
    setShift({ id: ref.id, user: user.email });
  };

  const closeShift = async () => {
    if (!shift) return alert("Belum ada shift aktif");
    await updateDoc(doc(db, "shifts", shift.id), {
      isOpen: false,
      closeAt: serverTimestamp(),
    });
    setShift(null);
    alert("Shift ditutup");
  };

  // --- ORDERS INBOX ---
  const loadOrders = async () => {
    const snap = await getDocs(query(collection(db, "orders"), orderBy("time", "desc")));
    setOrders(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  };

  useEffect(() => {
    if (page === "orders") loadOrders();
  }, [page]);

  const createPublicOrder = async (name: string, phone: string, items: any[]) => {
    await addDoc(collection(db, "orders"), {
      name,
      phone,
      items,
      time: serverTimestamp(),
      status: "pending",
    });
    alert("Pesanan berhasil dikirim!");
  };

  // --- UI SHARED ---
  const Nav = () => (
    <div className="flex flex-wrap gap-2 p-2 border-b">
      <button onClick={() => setPage("dashboard")}>Dashboard</button>
      <button onClick={() => setPage("kasir")}>Kasir</button>
      <button onClick={() => setPage("orders")}>Orders</button>
      <button onClick={() => setPage("public")}>Order Publik</button>
      <button onClick={handleLogout} className="text-red-600">Keluar</button>
    </div>
  );

  // --- PAGES ---
  if (page === "login") {
    return (
      <div className="p-4 max-w-sm mx-auto">
        <h1 className="text-2xl font-bold mb-2 text-center">NamiPOS — Login</h1>
        <input
          placeholder="Email"
          className="border p-2 w-full mb-2"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          type="password"
          placeholder="Password"
          className="border p-2 w-full mb-4"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <button onClick={handleLogin} className="bg-green-600 text-white w-full py-2 rounded">
          Masuk
        </button>
      </div>
    );
  }

  if (page === "dashboard") {
    return (
      <div className="p-4">
        <Nav />
        <h2 className="font-bold text-xl mb-2">Dashboard</h2>
        <p>Selamat datang, {user?.email}</p>
      </div>
    );
  }

  if (page === "kasir") {
    return (
      <div className="p-4">
        <Nav />
        <h2 className="font-bold text-xl mb-3">Kasir</h2>
        <button
          onClick={shift ? closeShift : openShift}
          className={`px-3 py-1 rounded ${shift ? "bg-red-500" : "bg-green-500"} text-white`}
        >
          {shift ? "Tutup Shift" : "Buka Shift"}
        </button>

        <div className="grid grid-cols-2 gap-2 my-4">
          {products.map((p) => (
            <button
              key={p.id}
              onClick={() => addToCart(p)}
              className="border p-2 rounded text-left"
            >
              <div className="font-semibold">{p.name}</div>
              <div>Rp {Number(p.price || 0).toLocaleString()}</div>
            </button>
          ))}
        </div>

        <h3 className="font-semibold mt-4">Keranjang</h3>
        {cart.map((i, idx) => (
          <div key={idx} className="flex justify-between border-b py-1">
            <span>{i.name}</span>
            <span>Rp {Number(i.price || 0).toLocaleString()}</span>
          </div>
        ))}

        <div className="mt-3 font-bold">Total: Rp {subtotal.toLocaleString()}</div>
        <button onClick={handleSaveSale} className="bg-green-600 text-white px-3 py-2 mt-3 rounded">
          Simpan & Cetak
        </button>
      </div>
    );
  }

  if (page === "orders") {
    return (
      <div className="p-4">
        <Nav />
        <h2 className="text-xl font-bold mb-2">Daftar Order Masuk</h2>
        {orders.map((o) => (
          <div key={o.id} className="border p-2 mb-2 rounded">
            <p className="font-semibold">
              {o.name} ({o.phone})
            </p>
            <p>Status: {o.status}</p>
            <ul className="list-disc ml-4">
              {o.items?.map((it: any, i: number) => (
                <li key={i}>
                  {it.name} x{it.qty}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    );
  }

  if (page === "public") {
    return (
      <div className="p-4 max-w-sm mx-auto">
        <h2 className="font-bold text-xl mb-2 text-center">Order Online</h2>
        <input id="field_name" className="border p-2 w-full mb-2" placeholder="Nama" />
        <input id="field_phone" className="border p-2 w-full mb-2" placeholder="No HP" />
        <textarea
          id="field_items"
          className="border p-2 w-full mb-2"
          placeholder="Pesanan (pisahkan koma, contoh: Matcha, Red Velvet, Brown Sugar)"
        />
        <button
          onClick={() => {
            const name = getFieldValue("field_name");
            const phone = getFieldValue("field_phone");
            const itemsText = getFieldValue("field_items");
            const items = itemsText
              ? itemsText.split(",").map((t) => ({ name: t.trim(), qty: 1 }))
              : [];
            if (!name || !phone || items.length === 0) {
              alert("Nama, No HP, dan daftar pesanan wajib diisi.");
              return;
            }
            createPublicOrder(name, phone, items);
          }}
          className="bg-green-600 text-white w-full py-2 rounded"
        >
          Kirim Pesanan
        </button>
      </div>
    );
  }

  return null;
}