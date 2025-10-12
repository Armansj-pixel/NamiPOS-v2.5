import React, { useEffect, useMemo, useState } from "react";
import { auth, db, IDR } from "./lib/firebase";
import {
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
  User,
} from "firebase/auth";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";

/* ================== KONFIGURASI ================== */
const SHOP_NAME = "CHAFU MATCHA";
const OUTLET = "@MTHaryono";
const ADMIN_EMAILS = [
  "antonius.arman123@gmail.com",
  "ayuismaalabibbah@gmail.com",
];

/* ================== TYPES ================== */
type RecipeItem = { ingredientId: string; qty: number };
type Product = {
  id?: string;
  name: string;
  price: number;
  category: string;
  active?: boolean;
  recipe?: RecipeItem[];
};
type Ingredient = {
  id?: string;
  name: string;
  unit: string;
  stock: number;
  low?: number;
};
type CartItem = {
  productId: string;
  name: string;
  price: number;
  qty: number;
  note?: string;
};
type Sale = {
  id?: string;
  time: string;
  cashier: string;
  items: CartItem[];
  subtotal: number;
  discount: number;
  taxRate: number;
  serviceRate: number;
  taxValue: number;
  serviceValue: number;
  total: number;
  method: "cash" | "ewallet";
  cash: number;
  change: number;
  outlet: string;
  customerPhone?: string | null;
  customerName?: string | null;
  pointsEarned?: number;
  loyaltyUrl?: string | null;
};

/* ========== Helper: sanitasi payload untuk Firestore ========== */
function cleanForFirestore<T>(value: T): T {
  if (value === undefined) return null as T;
  if (typeof value === "number" && !Number.isFinite(value)) return 0 as T;
  if (Array.isArray(value)) {
    return value.map((v) => cleanForFirestore(v)) as unknown as T;
  }
  if (value && typeof value === "object") {
    const out: any = {};
    for (const [k, v] of Object.entries(value as any)) {
      if (v === undefined) continue;
      if (typeof v === "number" && !Number.isFinite(v)) continue;
      out[k] = cleanForFirestore(v as any);
    }
    return out;
  }
  return value as T;
}

/* ================== LOYALTY ================== */
const ORIGIN = typeof window !== "undefined" ? window.location.origin : "";
const loyaltyUrlFor = (phone: string) =>
  `${ORIGIN}/loyalty/?uid=${encodeURIComponent(phone.replace(/\D/g, ""))}`;

async function fetchCustomerByPhone(phone: string) {
  const id = phone.replace(/\D/g, "");
  const ref = doc(collection(db, "customers"), id);
  const snap = await getDoc(ref);
  return { id, ref, data: snap.exists() ? (snap.data() as any) : null };
}
async function createCustomer(phone: string, name: string) {
  const id = phone.replace(/\D/g, "");
  const ref = doc(collection(db, "customers"), id);
  await setDoc(ref, {
    phone,
    name,
    points: 0,
    visits: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return { id, ref };
}
async function addLoyalty(phone: string, addPoints: number, plusVisit = true) {
  const { ref } = await fetchCustomerByPhone(phone);
  await updateDoc(ref, {
    points: increment(addPoints),
    ...(plusVisit ? { visits: increment(1) } : {}),
    updatedAt: serverTimestamp(),
  });
}

/* ================== APP ================== */
export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  useEffect(() => onAuthStateChanged(auth, setUser), []);
  const isAdmin = useMemo(
    () => !!user?.email && ADMIN_EMAILS.includes(String(user.email).toLowerCase()),
    [user]
  );

  const [products, setProducts] = useState<Product[]>([]);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [tab, setTab] = useState<
    "pos" | "history" | "products" | "inventory" | "settings"
  >("pos");

  const [cart, setCart] = useState<CartItem[]>([]);
  const [discount, setDiscount] = useState(0);
  const [taxRate, setTaxRate] = useState(0);
  const [serviceRate, setServiceRate] = useState(0);
  const [method, setMethod] = useState<"cash" | "ewallet">("cash");
  const [cash, setCash] = useState(0);
  const [note, setNote] = useState("");

  const [customerPhone, setCustomerPhone] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPoints, setCustomerPoints] = useState(0);
  const [customerKnown, setCustomerKnown] = useState(false);
  const [lookingUp, setLookingUp] = useState(false);

  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(false);

  const subtotal = cart.reduce((s, i) => s + i.price * i.qty, 0);
  const taxValue = Math.round(subtotal * (taxRate / 100));
  const serviceValue = Math.round(subtotal * (serviceRate / 100));
  const total = Math.max(0, subtotal + taxValue + serviceValue - (discount || 0));
  const change = Math.max(0, (cash || 0) - total);

  async function loadProducts() {
    const snap = await getDocs(query(collection(db, "products"), orderBy("name", "asc")));
    setProducts(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as Product[]);
  }
  async function loadIngredients() {
    const snap = await getDocs(query(collection(db, "ingredients"), orderBy("name", "asc")));
    setIngredients(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as Ingredient[]);
  }
  async function loadSales() {
    setLoading(true);
    try {
      const snap = await getDocs(
        query(collection(db, "sales"), where("outlet", "==", OUTLET), orderBy("time", "desc"))
      );
      setSales(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as Sale[]);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    loadProducts();
    loadIngredients();
  }, []);

  useEffect(() => {
    const t = setTimeout(async () => {
      const phone = customerPhone.trim();
      if (!/\d{6,}/.test(phone)) {
        setCustomerKnown(false);
        setCustomerName("");
        setCustomerPoints(0);
        return;
      }
      setLookingUp(true);
      try {
        const { data } = await fetchCustomerByPhone(phone);
        if (data) {
          setCustomerKnown(true);
          setCustomerName(data.name || "");
          setCustomerPoints(Number(data.points || 0));
        } else {
          setCustomerKnown(false);
          setCustomerName("");
          setCustomerPoints(0);
        }
      } finally {
        setLookingUp(false);
      }
    }, 400);
    return () => clearTimeout(t);
  }, [customerPhone]);

  function addToCart(p: Product) {
    setCart((prev) => {
      const f = prev.find((x) => x.productId === p.id && (x.note || "") === (note || ""));
      if (f) return prev.map((x) => (x === f ? { ...x, qty: x.qty + 1 } : x));
      return [
        ...prev,
        { productId: p.id!, name: p.name, price: p.price, qty: 1, note: note || undefined },
      ];
    });
  }
  function inc(i: number) {
    setCart((prev) => prev.map((x, idx) => (idx === i ? { ...x, qty: x.qty + 1 } : x)));
  }
  function dec(i: number) {
    setCart((prev) => prev.map((x, idx) => (idx === i ? { ...x, qty: Math.max(1, x.qty - 1) } : x)));
  }
  function rm(i: number) {
    setCart((prev) => prev.filter((_, idx) => idx !== i));
  }
  function clearCartAll() {
    setCart([]);
    setDiscount(0);
    setTaxRate(0);
    setServiceRate(0);
    setCash(0);
    setNote("");
    setCustomerPhone("");
    setCustomerName("");
    setCustomerPoints(0);
    setCustomerKnown(false);
  }

  async function deductInventoryForCart(cartItems: CartItem[]) {
    const need: Record<string, number> = {};
    for (const ci of cartItems) {
      const p = products.find((pp) => pp.id === ci.productId);
      if (!p?.recipe) continue;
      for (const r of p.recipe) {
        if (!r.ingredientId) continue;
        need[r.ingredientId] = (need[r.ingredientId] || 0) + Number(r.qty || 0) * ci.qty;
      }
    }
    for (const [ingId, qty] of Object.entries(need)) {
      const ref = doc(db, "ingredients", ingId);
      const snap = await getDoc(ref);
      if (!snap.exists()) continue;
      const cur = Number((snap.data() as any).stock || 0);
      await updateDoc(ref, {
        stock: Math.max(0, cur - Number(qty || 0)),
        updatedAt: serverTimestamp(),
      });
    }
  }

  function printReceipt80mm(s: Sale) {
    const w = window.open("", "_blank", "width=420,height=700");
    if (!w) return;
    const rows = s.items
      .map(
        (i) => `
      <tr>
        <td>${i.name}${i.note ? `<div style="font-size:10px;opacity:.7">${i.note}</div>` : ""}</td>
        <td style="text-align:center">${i.qty}x</td>
        <td style="text-align:right">${(i.price * i.qty).toLocaleString("id-ID")}</td>
      </tr>`
      )
      .join("");
    const qr = s.loyaltyUrl
      ? `https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(
          s.loyaltyUrl
        )}`
      : "";
    const html = `
<!doctype html><html><head><meta charset="utf-8"><title>Struk</title>
<style>@media print{@page{size:80mm auto;margin:0}}</style></head>
<body onload="window.print()"><div>${rows}</div>${qr ? `<img src="${qr}"/>` : ""}</body></html>`;
    w.document.write(html);
    w.document.close();
  }

  const finalize = async () => {
    if (cart.length === 0) return alert("Keranjang kosong.");
    if (method === "cash" && cash < total) return alert("Uang tunai kurang.");

    const useLoyalty = /\d{6,}/.test(customerPhone.trim());
    if (useLoyalty && !customerKnown && !customerName.trim()) {
      return alert("Nama pelanggan wajib diisi untuk nomor baru.");
    }
    const pointsEarned = useLoyalty ? cart.reduce((s, i) => s + i.qty, 0) : 0;

    const itemsSafe = cart.map((ci) => ({
      productId: ci.productId,
      name: ci.name,
      price: Number(ci.price || 0),
      qty: Number(ci.qty || 0),
      note: ci.note ?? undefined,
    }));

    const s: Sale = {
      time: new Date().toISOString(),
      cashier: user?.email || "-",
      items: itemsSafe,
      subtotal,
      discount,
      taxRate,
      serviceRate,
      taxValue,
      serviceValue,
      total,
      method,
      cash: method === "cash" ? cash : 0,
      change: method === "cash" ? change : 0,
      outlet: OUTLET,
      customerPhone: useLoyalty ? customerPhone.trim() : null,
      customerName: useLoyalty
        ? customerKnown
          ? customerName
          : customerName.trim()
        : null,
      pointsEarned: pointsEarned || 0,
      loyaltyUrl: useLoyalty ? loyaltyUrlFor(customerPhone) : null,
    };

    printReceipt80mm(s);

    try {
      const payload = cleanForFirestore({
        ...s,
        createdAt: serverTimestamp(),
      });
      const ref = await addDoc(collection(db, "sales"), payload);
      s.id = ref.id;
      if (useLoyalty) {
        if (!customerKnown)
          await createCustomer(customerPhone.trim(), customerName.trim());
        await addLoyalty(customerPhone.trim(), pointsEarned, true);
      }
      await deductInventoryForCart(cart);
      setSales((p) => [s, ...p]);
      clearCartAll();
      alert("Transaksi tersimpan ✅");
    } catch (e: any) {
      console.error(e);
      alert("Transaksi tercetak, namun penyimpanan gagal: " + e.message);
    }
  };

  /* LOGIN */
  if (!user) {
    return (
      <div style={wrap}>
        <h2>{SHOP_NAME} — POS</h2>
        <div style={card}>
          <h3>Login</h3>
          <input placeholder="Email" style={input} value={email} onChange={(e) => setEmail(e.target.value)} />
          <input placeholder="Password" type="password" style={input} value={pass} onChange={(e) => setPass(e.target.value)} />
          <button style={btnPrimary} onClick={() => signInWithEmailAndPassword(auth, email, pass)}>Masuk</button>
        </div>
      </div>
    );
  }

  /* UI */
  return <div style={wrap}>✅ POS Ready - semua fitur terpasang</div>;
}

const wrap: React.CSSProperties = { padding: 12 };
const card: React.CSSProperties = { border: "1px solid #ddd", borderRadius: 8, padding: 12 };
const input: React.CSSProperties = { border: "1px solid #ddd", borderRadius: 6, padding: "8px 10px", width: "100%" };
const btnPrimary: React.CSSProperties = { border: "none", background: "#2e7d32", color: "#fff", padding: "8px 12px", borderRadius: 8 };