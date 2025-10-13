// src/App.tsx — NamiPOS V2.4.4 (UI Rapi + Kasir + Orders + Public Order + Shift + Dashboard)
import React, { useEffect, useMemo, useState } from "react";
import {
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  User,
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
  onSnapshot,
} from "firebase/firestore";
import app from "./lib/firebase";

// Firebase instances
const auth = getAuth(app);
const db = getFirestore(app);

// Safe getter for input/textarea value (to avoid TS HTMLElement .value errors)
function getFieldValue(id: string): string {
  const el = document.getElementById(id) as
    | HTMLInputElement
    | HTMLTextAreaElement
    | null;
  return (el?.value ?? "").trim();
}

// Currency helper
const IDR = (n: number) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(n || 0);

type Page = "login" | "dashboard" | "kasir" | "orders" | "public";

type Product = {
  id: string;
  name: string;
  price: number;
  category?: string;
  active?: boolean;
};

type CartItem = {
  id: string;
  name: string;
  price: number;
  qty: number;
};

type ShiftLite = {
  id: string;
  user: string;
} | null;

export default function App() {
  // Auth
  const [user, setUser] = useState<User | null>(null);
  const [page, setPage] = useState<Page>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // Kasir
  const [products, setProducts] = useState<Product[]>([]);
  const [queryText, setQueryText] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const subtotal = useMemo(
    () => cart.reduce((s, i) => s + (Number(i.price) || 0) * (Number(i.qty) || 0), 0),
    [cart]
  );
  const [shift, setShift] = useState<ShiftLite>(null);

  // Orders Inbox
  const [orders, setOrders] = useState<any[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);

  // Mount: auth watch
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setPage(u ? "kasir" : "login");
    });
    return () => unsub();
  }, []);

  // Load products (live)
  useEffect(() => {
    if (!user) return;
    const qProd = query(collection(db, "products"));
    const unsub = onSnapshot(qProd, (snap) => {
      const rows = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as any),
      })) as Product[];
      setProducts(rows.filter((p) => p.active !== false));
    });
    return () => unsub();
  }, [user]);

  // Filtered products
  const filteredProducts = useMemo(() => {
    const q = queryText.toLowerCase();
    return products.filter((p) => p.name?.toLowerCase().includes(q));
  }, [products, queryText]);

  // --- AUTH ---
  const handleLogin = async () => {
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch (err: any) {
      alert("Login gagal: " + (err?.message || err));
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
    setUser(null);
    setPage("login");
  };

  // --- SHIFT ---
  const openShift = async () => {
    if (!user?.email) return alert("Belum login");
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

  // --- KASIR handlers ---
  const addToCart = (p: Product) => {
    setCart((prev) => {
      const idx = prev.findIndex((i) => i.id === p.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], qty: next[idx].qty + 1 };
        return next;
      }
      return [...prev, { id: p.id, name: p.name, price: p.price, qty: 1 }];
    });
  };
  const incQty = (id: string) =>
    setCart((prev) =>
      prev.map((i) => (i.id === id ? { ...i, qty: i.qty + 1 } : i))
    );
  const decQty = (id: string) =>
    setCart((prev) =>
      prev.map((i) =>
        i.id === id ? { ...i, qty: Math.max(1, i.qty - 1) } : i
      )
    );
  const rmItem = (id: string) =>
    setCart((prev) => prev.filter((i) => i.id !== id));
  const clearCart = () => setCart([]);

  const handleSaveSale = async () => {
    if (!user?.email) return alert("Belum login");
    if (!cart.length) return alert("Keranjang kosong");
    try {
      const ref = await addDoc(collection(db, "sales"), {
        items: cart,
        total: subtotal,
        cashier: user.email,
        time: serverTimestamp(),
      });
      alert("Transaksi tersimpan #" + ref.id);
      setCart([]);
    } catch (err: any) {
      alert("Gagal simpan transaksi: " + (err?.message || err));
    }
  };

  // --- ORDERS INBOX ---
  const loadOrders = async () => {
    setOrdersLoading(true);
    try {
      const snap = await getDocs(
        query(collection(db, "orders"), orderBy("time", "desc"))
      );
      setOrders(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
    } finally {
      setOrdersLoading(false);
    }
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

  // ========== UI COMPONENTS ==========
  const Shell: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <div className="min-h-screen bg-neutral-50">
      <header className="sticky top-0 z-30 bg-white/80 backdrop-blur border-b">
        <div className="max-w-7xl mx-auto px-3 md:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img
              src="/logo-pos.png"
              alt="NamiPOS"
              className="h-7"
              onError={(e: any) => (e.currentTarget.style.display = "none")}
            />
            <div>
              <div className="font-bold">NamiPOS — MTHaryono</div>
              <div className="text-[11px] text-neutral-500">
                Masuk: {user?.email || "-"}
              </div>
            </div>
          </div>
          <nav className="flex gap-2">
            {(["dashboard", "kasir", "orders", "public"] as Page[]).map((t) => (
              <button
                key={t}
                onClick={() => setPage(t)}
                className={`px-3 py-1.5 rounded-lg border ${
                  page === t ? "bg-emerald-50 border-emerald-300" : "bg-white"
                }`}
              >
                {t === "dashboard"
                  ? "Dashboard"
                  : t === "kasir"
                  ? "Kasir"
                  : t === "orders"
                  ? "Orders"
                  : "Order Publik"}
              </button>
            ))}
            <button
              onClick={handleLogout}
              className="px-3 py-1.5 rounded-lg border bg-rose-50 text-rose-700"
            >
              Keluar
            </button>
          </nav>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-3 md:px-6 py-4">{children}</main>
    </div>
  );

  // ========== PAGES ==========
  // LOGIN
  if (page === "login") {
    return (
      <div className="min-h-screen bg-neutral-50 flex items-center justify-center p-4">
        <div className="w-full max-w-sm bg-white border rounded-2xl shadow-sm p-6">
          <div className="flex items-center gap-3 mb-4 justify-center">
            <img
              src="/logo-pos.png"
              alt="NamiPOS"
              className="h-9"
              onError={(e: any) => (e.currentTarget.style.display = "none")}
            />
            <h1 className="text-xl font-bold">NamiPOS</h1>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleLogin();
            }}
            className="space-y-3"
          >
            <input
              className="w-full border rounded-lg p-3"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <input
              className="w-full border rounded-lg p-3"
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button className="w-full bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg p-3">
              Masuk
            </button>
          </form>
          <p className="text-xs text-neutral-500 mt-3 text-center">
            Masuk untuk mengelola POS
          </p>
        </div>
      </div>
    );
  }

  // DASHBOARD
  if (page === "dashboard") {
    return (
      <Shell>
        <section className="bg-white rounded-2xl shadow-sm border p-4">
          <h2 className="font-bold text-lg mb-2">Dashboard</h2>
          <p className="text-sm text-neutral-600">
            Selamat datang, <b>{user?.email}</b>
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
            <KPI title="Produk Aktif" value={String(products.length)} />
            <KPI title="Keranjang Saat Ini" value={String(cart.length)} />
            <KPI title="Subtotal Keranjang" value={IDR(subtotal)} />
            <KPI title="Status Shift" value={shift ? "OPEN" : "CLOSED"} />
          </div>
        </section>
      </Shell>
    );
  }

  // KASIR
  if (page === "kasir") {
    return (
      <Shell>
        <section className="bg-white rounded-2xl shadow-sm border p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold text-lg">Kasir</h2>
            <button
              onClick={shift ? closeShift : openShift}
              className={`px-3 py-2 rounded-lg ${
                shift ? "bg-rose-600" : "bg-emerald-600"
              } text-white`}
            >
              {shift ? "Tutup Shift" : "Buka Shift"}
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
            {/* Produk */}
            <div className="md:col-span-7">
              <div className="mb-3">
                <input
                  className="w-full border rounded-lg px-3 py-2"
                  placeholder="Cari menu…"
                  value={queryText}
                  onChange={(e) => setQueryText(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {filteredProducts.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => addToCart(p)}
                    className="text-left rounded-2xl border bg-white p-3 hover:shadow"
                  >
                    <div className="h-20 w-full rounded-xl bg-gradient-to-br from-emerald-50 to-emerald-100 mb-2" />
                    <div className="font-medium leading-tight">{p.name}</div>
                    <div className="mt-1 font-semibold">
                      {IDR(Number(p.price || 0))}
                    </div>
                  </button>
                ))}
                {filteredProducts.length === 0 && (
                  <div className="text-sm text-neutral-500">
                    Produk tidak ditemukan.
                  </div>
                )}
              </div>
            </div>

            {/* Keranjang */}
            <div className="md:col-span-5">
              <div className="rounded-2xl border p-3">
                <h3 className="font-semibold mb-2">Keranjang</h3>
                {cart.length === 0 ? (
                  <div className="text-sm text-neutral-500">
                    Belum ada item.
                  </div>
                ) : (
                  <>
                    <div className="space-y-2">
                      {cart.map((i) => (
                        <div
                          key={i.id}
                          className="grid grid-cols-12 items-center gap-2 border rounded-xl p-2"
                        >
                          <div className="col-span-6">
                            <div className="font-medium leading-tight">
                              {i.name}
                            </div>
                            <div className="text-xs text-neutral-500">
                              {IDR(i.price)}
                            </div>
                          </div>
                          <div className="col-span-4 flex items-center justify-end gap-2">
                            <button
                              className="px-2 py-1 border rounded"
                              onClick={() => decQty(i.id)}
                            >
                              -
                            </button>
                            <div className="w-8 text-center font-medium">
                              {i.qty}
                            </div>
                            <button
                              className="px-2 py-1 border rounded"
                              onClick={() => incQty(i.id)}
                            >
                              +
                            </button>
                          </div>
                          <div className="col-span-2 flex justify-end">
                            <button
                              className="px-2 py-1 rounded border"
                              onClick={() => rmItem(i.id)}
                            >
                              x
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="border-t mt-3 pt-3 flex items-center justify-between text-lg font-semibold">
                      <span>Total</span>
                      <span>{IDR(subtotal)}</span>
                    </div>
                    <div className="mt-3 flex gap-2 justify-end">
                      <button
                        className="px-3 py-2 rounded-lg border"
                        onClick={clearCart}
                      >
                        Bersihkan
                      </button>
                      <button
                        onClick={handleSaveSale}
                        className="px-3 py-2 rounded-lg bg-emerald-600 text-white"
                      >
                        Simpan & Cetak
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </section>
      </Shell>
    );
  }

  // ORDERS INBOX
  if (page === "orders") {
    return (
      <Shell>
        <section className="bg-white rounded-2xl shadow-sm border p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-bold">Daftar Order Masuk</h2>
            <button
              onClick={loadOrders}
              className="px-3 py-2 rounded-lg border"
              disabled={ordersLoading}
            >
              {ordersLoading ? "Memuat…" : "Muat Ulang"}
            </button>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
            {orders.map((o) => (
              <div key={o.id} className="border rounded-2xl p-3">
                <div className="font-semibold">
                  {o.name} ({o.phone})
                </div>
                <div className="text-xs text-neutral-500 mb-2">
                  Status: {o.status}
                </div>
                <ul className="text-sm list-disc ml-4">
                  {o.items?.map((it: any, i: number) => (
                    <li key={i}>
                      {it.name} x{it.qty}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            {orders.length === 0 && !ordersLoading && (
              <div className="text-sm text-neutral-500">Belum ada pesanan.</div>
            )}
          </div>
        </section>
      </Shell>
    );
  }

  // PUBLIC ORDER
  if (page === "public") {
    return (
      <Shell>
        <section className="max-w-lg mx-auto bg-white rounded-2xl shadow-sm border p-4">
          <div className="flex items-center gap-2 mb-3">
            <img
              src="/logo-pos.png"
              className="h-7"
              onError={(e: any) => (e.currentTarget.style.display = "none")}
            />
            <div className="font-semibold">Order Online — MTHaryono</div>
          </div>

          <div className="space-y-2">
            <input
              id="field_name"
              className="border rounded-lg px-3 py-2 w-full"
              placeholder="Nama"
            />
            <input
              id="field_phone"
              className="border rounded-lg px-3 py-2 w-full"
              placeholder="No HP"
            />
            <textarea
              id="field_items"
              className="border rounded-lg px-3 py-2 w-full"
              placeholder="Pesanan (pisahkan koma, contoh: Matcha, Red Velvet, Brown Sugar)"
            />
          </div>

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
              // optional: reset
              const ids = ["field_name", "field_phone", "field_items"];
              ids.forEach((id) => {
                const el = document.getElementById(id) as
                  | HTMLInputElement
                  | HTMLTextAreaElement
                  | null;
                if (el) el.value = "";
              });
            }}
            className="mt-3 bg-emerald-600 text-white w-full py-2 rounded-lg"
          >
            Kirim Pesanan
          </button>
        </section>
      </Shell>
    );
  }

  return null;
}

// Small KPI card
function KPI({ title, value }: { title: string; value: string }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border p-4">
      <div className="text-[12px] text-neutral-500">{title}</div>
      <div className="text-xl font-bold mt-1">{value}</div>
    </div>
  );
}