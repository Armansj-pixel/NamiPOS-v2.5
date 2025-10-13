// src/App.tsx — NamiPOS V2.4 (Public Order Beta)
// ===============================================
import React, { useEffect, useState } from "react";
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
  orderBy,
  getDocs,
  addDoc,
  updateDoc,
  doc,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import app from "./lib/firebase";

const auth = getAuth(app);
const db = getFirestore(app);

const OUTLET = "MTHaryono"; // Ganti sesuai outlet

export default function App() {
  const [user, setUser] = useState<any>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("kasir");
  const [shift, setShift] = useState<any>(null);

  // --- Rute publik: /order (boleh diakses tanpa login)
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

  async function handleLogin(e: any) {
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
      const ref = collection(db, "shifts");
      await addDoc(ref, {
        outlet: OUTLET,
        openedBy: user?.email,
        openAt: serverTimestamp(),
        isOpen: true,
        code,
      });
      alert("Shift dibuka!");
    } catch (e: any) {
      alert("Gagal buka shift: " + e.message);
    }
  }

  async function handleCloseShift() {
    try {
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
      const shiftDoc = snap.docs[0];
      await updateDoc(doc(db, "shifts", shiftDoc.id), {
        isOpen: false,
        closeAt: serverTimestamp(),
      });
      alert("Shift ditutup!");
      setShift(null);
    } catch (e: any) {
      alert("Gagal tutup shift: " + e.message);
    }
  }

  // ====== RENDER ======
  if (isPublicOrder) {
    return <PublicOrder outlet={OUTLET} />;
  }

  if (loading) return <p>Loading...</p>;

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
            onError={(e: any) => {
              e.currentTarget.style.display = "none";
            }}
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
        <div>
          <h1 className="font-bold text-lg">NamiPOS — {OUTLET}</h1>
          <p className="text-sm text-neutral-600">
            Masuk: {user.email} ·{" "}
            <span className="font-medium">
              {user.email.includes("owner") ? "owner" : "staff"}
            </span>
          </p>
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
          <button
            onClick={handleLogout}
            className="px-3 py-1 rounded bg-red-50 text-red-700 border"
          >
            Keluar
          </button>
        </nav>
      </header>

      <section className="bg-white p-4 rounded-xl shadow border">
        {shift ? (
          <div className="flex items-center justify-between mb-3">
            <p>
              <b>Shift</b> OPEN • {user.email}
            </p>
            <button
              onClick={handleCloseShift}
              className="bg-red-600 text-white rounded px-3 py-1"
            >
              Tutup Shift
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2 mb-3">
            <p className="text-neutral-500">Belum ada shift aktif</p>
            <button
              onClick={handleOpenShift}
              className="bg-green-700 text-white rounded px-3 py-1"
            >
              Buka Shift
            </button>
          </div>
        )}

        {activeTab === "dashboard" && <Dashboard />}
        {activeTab === "kasir" && <Kasir />}
        {activeTab === "produk" && <Produk />}
        {activeTab === "inventori" && <Inventori />}
        {activeTab === "resep" && <Resep />}
        {activeTab === "riwayat" && <Riwayat />}
      </section>
    </div>
  );
}

// --- Komponen placeholder (dummy, masih seperti di V2 stabil)
function Dashboard() {
  return <p>Dashboard Ringkasan Penjualan</p>;
}
function Kasir() {
  return <p>Halaman Kasir Aktif</p>;
}
function Produk() {
  return <p>Manajemen Produk</p>;
}
function Inventori() {
  return <p>Inventori & Stok</p>;
}
function Resep() {
  return <p>Manajemen Resep</p>;
}
function Riwayat() {
  return <p>Riwayat Transaksi</p>;
}

// --- Komponen order publik tanpa login ---
function PublicOrder({ outlet }: { outlet: string }) {
  return (
    <div className="min-h-screen bg-neutral-50 flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-white rounded-2xl shadow border p-6 text-center">
        <img
          src="/logo-pos.png"
          alt="NamiPOS"
          className="h-12 mx-auto mb-3"
          onError={(e: any) => {
            e.currentTarget.style.display = "none";
          }}
        />
        <h1 className="text-xl font-bold mb-1">Order Online — {outlet}</h1>
        <p className="text-sm text-neutral-600">
          Halaman pemesanan publik (beta).<br />
          Anda sudah bisa mengakses <code>/order</code> tanpa login.
        </p>

        <a
          href="/"
          className="inline-block mt-4 px-4 py-2 rounded-lg border hover:bg-neutral-50"
        >
          Kembali ke POS
        </a>
      </div>
    </div>
  );
}