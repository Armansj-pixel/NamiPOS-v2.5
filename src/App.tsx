// src/App.tsx — NamiPOS V2.4 (Public Order Menu)
// =================================================
import React, { useEffect, useMemo, useState } from "react";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import {
  getFirestore,
  collection,
  query,
  where,
  getDocs,
  addDoc,
  updateDoc,
  doc,
  serverTimestamp,
} from "firebase/firestore";
import app from "./lib/firebase";

const auth = getAuth(app);
const db = getFirestore(app);

// ================== KONFIG ==================
const OUTLET = "MTHaryono"; // ganti sesuai outlet
const CURRENCY = "IDR";
const IDR = (n: number) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: CURRENCY,
    maximumFractionDigits: 0,
  }).format(n || 0);

// ================ APP =======================
export default function App() {
  const [user, setUser] = useState<any>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("kasir");
  const [shiftOpen, setShiftOpen] = useState(false);

  // Rute publik: /order
  const isPublicOrder =
    typeof window !== "undefined" &&
    (window.location.pathname === "/order" ||
      window.location.hash.startsWith("#/order"));

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err: any) {
      alert("Login gagal: " + err.message);
    }
  }
  async function handleLogout() {
    await signOut(auth);
  }

  async function handleOpenShift() {
    const code = prompt("Masukkan kode shift:");
    if (!code) return;
    try {
      await addDoc(collection(db, "shifts"), {
        outlet: OUTLET,
        openedBy: user?.email,
        openAt: serverTimestamp(),
        isOpen: true,
        code,
      });
      setShiftOpen(true);
      alert("Shift dibuka!");
    } catch (e: any) {
      alert("Gagal buka shift: " + e.message);
    }
  }
  async function handleCloseShift() {
    try {
      // cari shift aktif
      const q = query(
        collection(db, "shifts"),
        where("outlet", "==", OUTLET),
        where("isOpen", "==", true)
      );
      const snap = await getDocs(q);
      if (snap.empty) {
        alert("Tidak ada shift aktif.");
        return;
      }
      const d = snap.docs[0];
      await updateDoc(doc(db, "shifts", d.id), {
        isOpen: false,
        closeAt: serverTimestamp(),
      });
      setShiftOpen(false);
      alert("Shift ditutup!");
    } catch (e: any) {
      alert("Gagal tutup shift: " + e.message);
    }
  }

  // ====== RENDER untuk /order (tanpa login) ======
  if (isPublicOrder) {
    return <PublicOrder outlet={OUTLET} />;
  }

  if (loading) return <p>Loading…</p>;

  if (!user)
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-50">
        <form
          onSubmit={handleLogin}
          className="bg-white p-6 rounded-xl shadow-md border w-80"
        >
          <img
            src="/logo-pos.png"
            alt="NamiPOS"
            className="h-12 mx-auto mb-3"
            onError={(e: any) => (e.currentTarget.style.display = "none")}
          />
          <h2 className="text-lg font-semibold mb-4 text-center">
            Login ke NamiPOS
          </h2>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            className="w-full border rounded p-2 mb-2"
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            className="w-full border rounded p-2 mb-3"
          />
          <button
            type="submit"
            className="w-full bg-green-700 text-white rounded p-2"
          >
            Masuk
          </button>
        </form>
      </div>
    );

  return (
    <div className="min-h-screen bg-neutral-50 p-4">
      <header className="flex justify-between items-center mb-4">
        <div className="flex items-center gap-3">
          <img
            src="/logo-pos.png"
            alt="NamiPOS"
            className="h-8"
            onError={(e: any) => (e.currentTarget.style.display = "none")}
          />
          <div>
            <h1 className="font-bold text-lg">NamiPOS — {OUTLET}</h1>
            <p className="text-sm text-neutral-600">
              Masuk: {user.email} ·{" "}
              <span className="font-medium">
                {user.email.includes("owner") ? "owner" : "staff"}
              </span>
            </p>
          </div>
        </div>
        <nav className="space-x-2">
          {["Dashboard", "Kasir", "Riwayat", "Produk", "Inventori", "Resep"].map(
            (tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab.toLowerCase())}
                className={`px-3 py-1 rounded border ${
                  activeTab === tab.toLowerCase()
                    ? "bg-green-100 border-green-700"
                    : "bg-white"
                }`}
              >
                {tab}
              </button>
            )
          )}
          <a
            href="/order"
            className="px-3 py-1 rounded border bg-emerald-50"
            target="_blank"
            rel="noreferrer"
          >
            Link Order Publik
          </a>
          <button
            onClick={handleLogout}
            className="px-3 py-1 rounded bg-red-50 text-red-700 border"
          >
            Keluar
          </button>
        </nav>
      </header>

      <section className="bg-white p-4 rounded-xl shadow border">
        <div className="flex items-center justify-between mb-3">
          {!shiftOpen ? (
            <>
              <p className="text-neutral-500">Belum ada shift aktif</p>
              <button
                onClick={handleOpenShift}
                className="bg-green-700 text-white rounded px-3 py-1"
              >
                Buka Shift
              </button>
            </>
          ) : (
            <>
              <p>
                <b>Shift</b> OPEN • {user.email}
              </p>
              <button
                onClick={handleCloseShift}
                className="bg-red-600 text-white rounded px-3 py-1"
              >
                Tutup Shift
              </button>
            </>
          )}
        </div>

        {/* Placeholder tab — jaga fitur lama tetap ada */}
        {activeTab === "dashboard" && <div>Dashboard Ringkasan</div>}
        {activeTab === "kasir" && <div>Kasir Aktif</div>}
        {activeTab === "riwayat" && <div>Riwayat Transaksi</div>}
        {activeTab === "produk" && <div>Manajemen Produk</div>}
        {activeTab === "inventori" && <div>Inventori & Stok</div>}
        {activeTab === "resep" && <div>Manajemen Resep</div>}
      </section>
    </div>
  );
}

// ================== PUBLIC ORDER ===================
type Product = {
  id: string;
  name: string;
  price: number;
  category?: string;
  active?: boolean;
  outlet?: string;
};

type CartItem = { productId: string; name: string; price: number; qty: number };

function PublicOrder({ outlet }: { outlet: string }) {
  const [loading, setLoading] = useState(true);
  const [products, setProducts] = useState<Product[]>([]);
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [step, setStep] = useState<"browse" | "checkout" | "done">("browse");
  const [custName, setCustName] = useState("");
  const [custPhone, setCustPhone] = useState("");
  const [custAddr, setCustAddr] = useState("");
  const [orderId, setOrderId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        // ambil produk outlet; filter active di sisi klien
        const q = query(collection(db, "products"), where("outlet", "==", outlet));
        const snap = await getDocs(q);
        const rows: Product[] = snap.docs.map((d) => {
          const x = d.data() as any;
          return {
            id: d.id,
            name: x.name,
            price: x.price || 0,
            category: x.category || "Menu",
            active: x.active !== false,
            outlet: x.outlet,
          };
        });
        setProducts(rows.filter((p) => p.active !== false));
      } catch (e: any) {
        alert("Gagal memuat produk: " + e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [outlet]);

  const shown = useMemo(
    () =>
      products.filter((p) =>
        p.name.toLowerCase().includes(search.toLowerCase())
      ),
    [products, search]
  );

  const subtotal = cart.reduce((s, c) => s + c.price * c.qty, 0);

  function addToCart(p: Product) {
    setCart((prev) => {
      const idx = prev.findIndex((c) => c.productId === p.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], qty: next[idx].qty + 1 };
        return next;
      }
      return [
        ...prev,
        { productId: p.id, name: p.name, price: p.price, qty: 1 },
      ];
    });
  }
  const inc = (i: number) =>
    setCart((prev) => prev.map((c, idx) => (idx === i ? { ...c, qty: c.qty + 1 } : c)));
  const dec = (i: number) =>
    setCart((prev) =>
      prev
        .map((c, idx) => (idx === i ? { ...c, qty: Math.max(1, c.qty - 1) } : c))
        .filter((c) => c.qty > 0)
    );
  const rm = (i: number) =>
    setCart((prev) => prev.filter((_, idx) => idx !== i));

  async function submitOrder() {
    if (!custName || !custPhone || cart.length === 0) {
      alert("Lengkapi data dan keranjang terlebih dahulu.");
      return;
    }
    try {
      const ref = await addDoc(collection(db, "orders"), {
        outlet,
        origin: "public",
        customer: { name: custName, phone: custPhone, address: custAddr },
        items: cart,
        subtotal,
        total: subtotal, // bisa tambah ongkir / pajak nanti
        status: "pending",
        createdAt: serverTimestamp(),
      });
      setOrderId(ref.id);
      setStep("done");
    } catch (e: any) {
      alert("Gagal membuat pesanan: " + e.message);
    }
  }

  if (loading)
    return (
      <div className="min-h-screen flex items-center justify-center">
        Memuat menu…
      </div>
    );

  if (step === "done")
    return (
      <div className="min-h-screen bg-neutral-50 flex items-center justify-center p-6">
        <div className="w-full max-w-md bg-white rounded-2xl shadow border p-6 text-center">
          <img
            src="/logo-pos.png"
            alt="NamiPOS"
            className="h-10 mx-auto mb-2"
            onError={(e: any) => (e.currentTarget.style.display = "none")}
          />
          <h1 className="text-xl font-bold mb-1">Pesanan terkirim!</h1>
          <p className="text-sm text-neutral-600">
            Kode pesanan: <b>{orderId}</b>
          </p>
          <p className="text-sm text-neutral-600 mt-1">
            Kami akan konfirmasi via WhatsApp/SMS ya.
          </p>
          <a
            href="/order"
            className="inline-block mt-4 px-4 py-2 rounded-lg border hover:bg-neutral-50"
          >
            Buat pesanan baru
          </a>
          <a
            href="/"
            className="inline-block mt-4 ml-2 px-4 py-2 rounded-lg border hover:bg-neutral-50"
          >
            Kembali ke POS
          </a>
        </div>
      </div>
    );

  return (
    <div className="min-h-screen bg-neutral-50 p-4">
      <div className="max-w-5xl mx-auto grid md:grid-cols-3 gap-4">
        {/* Katalog */}
        <section className="md:col-span-2">
          <div className="bg-white border rounded-2xl p-3 mb-3">
            <div className="flex items-center gap-2">
              <img
                src="/logo-pos.png"
                alt="NamiPOS"
                className="h-7"
                onError={(e: any) => (e.currentTarget.style.display = "none")}
              />
              <div>
                <div className="font-bold">Order Online — {outlet}</div>
                <div className="text-xs text-neutral-500">
                  Pilih menu, lalu lanjutkan checkout.
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white border rounded-2xl p-3">
            <input
              className="border rounded-lg px-3 py-2 w-full mb-3"
              placeholder="Cari menu…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />

            {shown.length === 0 && (
              <div className="text-sm text-neutral-500">Menu tidak ditemukan.</div>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {shown.map((p) => (
                <button
                  key={p.id}
                  onClick={() => addToCart(p)}
                  className="bg-white rounded-2xl border p-3 text-left hover:shadow"
                >
                  <div className="h-20 rounded-xl bg-gradient-to-br from-emerald-50 to-emerald-100 mb-2" />
                  <div className="font-medium leading-tight">{p.name}</div>
                  <div className="text-xs text-neutral-500">
                    {p.category || "Menu"}
                  </div>
                  <div className="font-semibold mt-1">{IDR(p.price)}</div>
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* Keranjang / Checkout */}
        <aside>
          <div className="bg-white border rounded-2xl p-3">
            <h3 className="font-semibold mb-2">Keranjang</h3>
            {cart.length === 0 ? (
              <div className="text-sm text-neutral-500">
                Belum ada item. Ketuk menu untuk menambahkan.
              </div>
            ) : (
              <div className="space-y-2">
                {cart.map((c, i) => (
                  <div
                    key={i}
                    className="grid grid-cols-12 items-center gap-2 border rounded-xl p-2"
                  >
                    <div className="col-span-6">
                      <div className="font-medium leading-tight">{c.name}</div>
                      <div className="text-xs text-neutral-500">
                        {IDR(c.price)}
                      </div>
                    </div>
                    <div className="col-span-4 flex items-center justify-end gap-2">
                      <button
                        className="px-2 py-1 border rounded"
                        onClick={() => dec(i)}
                      >
                        -
                      </button>
                      <div className="w-8 text-center font-medium">{c.qty}</div>
                      <button
                        className="px-2 py-1 border rounded"
                        onClick={() => inc(i)}
                      >
                        +
                      </button>
                    </div>
                    <div className="col-span-2 text-right">
                      <button
                        className="px-2 py-1 rounded border"
                        onClick={() => rm(i)}
                      >
                        x
                      </button>
                    </div>
                  </div>
                ))}

                <div className="border-t pt-2">
                  <div className="flex items-center justify-between text-sm">
                    <span>Subtotal</span>
                    <span className="font-semibold">{IDR(subtotal)}</span>
                  </div>
                </div>

                {step === "browse" ? (
                  <button
                    className="w-full px-3 py-2 rounded-lg bg-emerald-600 text-white disabled:opacity-50"
                    disabled={cart.length === 0}
                    onClick={() => setStep("checkout")}
                  >
                    Lanjut Checkout
                  </button>
                ) : (
                  <>
                    <div className="grid gap-2">
                      <input
                        className="border rounded-lg px-3 py-2"
                        placeholder="Nama"
                        value={custName}
                        onChange={(e) => setCustName(e.target.value)}
                      />
                      <input
                        className="border rounded-lg px-3 py-2"
                        placeholder="No HP (WA)"
                        value={custPhone}
                        onChange={(e) => setCustPhone(e.target.value)}
                      />
                      <textarea
                        className="border rounded-lg px-3 py-2"
                        placeholder="Alamat (opsional)"
                        value={custAddr}
                        onChange={(e) => setCustAddr(e.target.value)}
                      />
                    </div>
                    <button
                      className="w-full px-3 py-2 rounded-lg bg-emerald-600 text-white"
                      onClick={submitOrder}
                    >
                      Kirim Pesanan ({IDR(subtotal)})
                    </button>
                    <button
                      className="w-full px-3 py-2 rounded-lg border"
                      onClick={() => setStep("browse")}
                    >
                      Kembali
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

          <div className="text-xs text-neutral-500 text-center mt-3">
            Powered by NamiPOS • <a href="/">Kembali ke POS</a>
          </div>
        </aside>
      </div>
    </div>
  );
}