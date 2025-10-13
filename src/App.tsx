// src/App.tsx — NamiPOS V2.4.2 (Kasir + Public Order + Orders Inbox)
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
  where,
  orderBy,
  updateDoc,
  deleteDoc,
  doc,
  getDoc,
  serverTimestamp,
} from "firebase/firestore";
import app from "./lib/firebase";

const auth = getAuth(app);
const db = getFirestore(app);

export default function App() {
  const [user, setUser] = useState(null);
  const [page, setPage] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // kasir
  const [cart, setCart] = useState([]);
  const [products, setProducts] = useState([]);
  const [subtotal, setSubtotal] = useState(0);
  const [shift, setShift] = useState(null);

  // orders
  const [orders, setOrders] = useState([]);
  const [publicOrders, setPublicOrders] = useState([]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      if (u) setPage("kasir");
      else setPage("login");
    });
    return () => unsub();
  }, []);

  // --- LOGIN ---
  const handleLogin = async () => {
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err) {
      alert("Login gagal: " + err.message);
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

  const addToCart = (p) => {
    setCart((prev) => [...prev, { ...p, qty: 1 }]);
  };

  const calcSubtotal = () => {
    const total = cart.reduce((sum, i) => sum + i.price * i.qty, 0);
    setSubtotal(total);
  };

  useEffect(calcSubtotal, [cart]);

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
    } catch (err) {
      alert("Gagal simpan transaksi: " + err.message);
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

  // --- PUBLIC ORDERS ---
  const loadOrders = async () => {
    const snap = await getDocs(query(collection(db, "orders"), orderBy("time", "desc")));
    setOrders(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  };

  useEffect(() => {
    if (page === "orders") loadOrders();
  }, [page]);

  const createPublicOrder = async (name, phone, items) => {
    await addDoc(collection(db, "orders"), {
      name,
      phone,
      items,
      time: serverTimestamp(),
      status: "pending",
    });
    alert("Pesanan berhasil dikirim!");
  };

  // --- UI ---

  if (page === "login")
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
        <button
          onClick={handleLogin}
          className="bg-green-600 text-white w-full py-2 rounded"
        >
          Masuk
        </button>
      </div>
    );

  // --- NAVBAR ---
  const Nav = () => (
    <div className="flex flex-wrap gap-2 p-2 border-b">
      <button onClick={() => setPage("dashboard")}>Dashboard</button>
      <button onClick={() => setPage("kasir")}>Kasir</button>
      <button onClick={() => setPage("orders")}>Orders</button>
      <button onClick={() => setPage("public")}>Order Publik</button>
      <button onClick={handleLogout} className="text-red-600">
        Keluar
      </button>
    </div>
  );

  // --- DASHBOARD ---
  if (page === "dashboard")
    return (
      <div className="p-4">
        <Nav />
        <h2 className="font-bold text-xl mb-2">Dashboard</h2>
        <p>Selamat datang, {user.email}</p>
      </div>
    );

  // --- KASIR ---
  if (page === "kasir")
    return (
      <div className="p-4">
        <Nav />
        <h2 className="font-bold text-xl mb-3">Kasir</h2>
        <button
          onClick={shift ? closeShift : openShift}
          className={`px-3 py-1 rounded ${
            shift ? "bg-red-500" : "bg-green-500"
          } text-white`}
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
              <div>Rp {p.price?.toLocaleString()}</div>
            </button>
          ))}
        </div>

        <h3 className="font-semibold mt-4">Keranjang</h3>
        {cart.map((i, idx) => (
          <div key={idx} className="flex justify-between border-b py-1">
            <span>{i.name}</span>
            <span>Rp {i.price?.toLocaleString()}</span>
          </div>
        ))}

        <div className="mt-3 font-bold">
          Total: Rp {subtotal.toLocaleString()}
        </div>
        <button
          onClick={handleSaveSale}
          className="bg-green-600 text-white px-3 py-2 mt-3 rounded"
        >
          Simpan & Cetak
        </button>
      </div>
    );

  // --- ORDERS INBOX ---
  if (page === "orders")
    return (
      <div className="p-4">
        <Nav />
        <h2 className="text-xl font-bold mb-2">Daftar Order Masuk</h2>
        {orders.map((o) => (
          <div key={o.id} className="border p-2 mb-2 rounded">
            <p className="font-semibold">{o.name} ({o.phone})</p>
            <p>Status: {o.status}</p>
            <ul className="list-disc ml-4">
              {o.items?.map((it, i) => (
                <li key={i}>{it.name} x{it.qty}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    );

  // --- PUBLIC ORDER PAGE ---
  if (page === "public")
    return (
      <div className="p-4 max-w-sm mx-auto">
        <h2 className="font-bold text-xl mb-2 text-center">Order Online</h2>
        <input id="name" className="border p-2 w-full mb-2" placeholder="Nama" />
        <input id="phone" className="border p-2 w-full mb-2" placeholder="No HP" />
        <textarea id="items" className="border p-2 w-full mb-2" placeholder="Pesanan (pisahkan koma)"></textarea>
        <button
          onClick={() => {
            const name = document.getElementById("name").value;
            const phone = document.getElementById("phone").value;
            const itemsText = document.getElementById("items").value;
            const items = itemsText.split(",").map((t) => ({ name: t.trim(), qty: 1 }));
            createPublicOrder(name, phone, items);
          }}
          className="bg-green-600 text-white w-full py-2 rounded"
        >
          Kirim Pesanan
        </button>
      </div>
    );

  return null;
}