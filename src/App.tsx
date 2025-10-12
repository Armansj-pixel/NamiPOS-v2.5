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

/* ================== KONFIG ================== */
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
  recipe?: RecipeItem[]; // per 1 cup
};
type Ingredient = {
  id?: string;
  name: string;
  unit: string; // gr/ml/pcs
  stock: number;
  low?: number;
};
type CartItem = {
  productId: string;
  name: string;
  price: number;
  qty: number;
  note?: string; // undefined di state, nanti dipetakan ke null saat simpan
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

/* ========== Helper: sanitasi Firestore ========== */
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
  /* Auth */
  const [user, setUser] = useState<User | null>(null);
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  useEffect(() => onAuthStateChanged(auth, setUser), []);
  const isAdmin = useMemo(
    () => !!user?.email && ADMIN_EMAILS.includes(String(user.email).toLowerCase()),
    [user]
  );

  /* Master data */
  const [products, setProducts] = useState<Product[]>([]);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);

  /* Tabs */
  const [tab, setTab] = useState<
    "pos" | "history" | "products" | "inventory" | "settings"
  >("pos");

  /* POS State */
  const [cart, setCart] = useState<CartItem[]>([]);
  const [discount, setDiscount] = useState(0);
  const [taxRate, setTaxRate] = useState(0);
  const [serviceRate, setServiceRate] = useState(0);
  const [method, setMethod] = useState<"cash" | "ewallet">("cash");
  const [cash, setCash] = useState(0);
  const [note, setNote] = useState("");

  /* Loyalty form */
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPoints, setCustomerPoints] = useState(0);
  const [customerKnown, setCustomerKnown] = useState(false);
  const [lookingUp, setLookingUp] = useState(false);

  /* History */
  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(false);

  /* Derived totals */
  const subtotal = cart.reduce((s, i) => s + i.price * i.qty, 0);
  const taxValue = Math.round(subtotal * (taxRate / 100));
  const serviceValue = Math.round(subtotal * (serviceRate / 100));
  const total = Math.max(0, subtotal + taxValue + serviceValue - (discount || 0));
  const change = Math.max(0, (cash || 0) - total);

  /* Load master */
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

  /* Loyalty lookup (debounce) */
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

  /* POS helpers */
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

  /* Inventory deduction by recipe */
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

  /* Printer 80mm — logo + QR loyalty */
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
<style>
  @media print { @page { size: 80mm auto; margin: 0; } body{margin:0} }
  body { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  .wrap { width: 76mm; margin: 0 auto; padding: 3mm; }
  h2 { margin: 4px 0; text-align: center; font-size: 14px; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 2px 0; font-size: 12px; border-bottom: 1px dashed #ddd; }
  .tot td { border-bottom: none; font-weight: 700; }
  .meta { font-size: 11px; text-align: center; opacity: .8; }
  .logo { display:block;margin:0 auto 6px auto;width:36mm;height:auto;image-rendering:pixelated; }
</style></head>
<body>
  <div class="wrap">
    <img src="/logo.png" class="logo" onerror="this.style.display='none'"/>
    <h2>${SHOP_NAME}</h2>
    <div class="meta">${OUTLET}<br/>Kasir: ${s.cashier}<br/>${new Date(s.time).toLocaleString(
      "id-ID",
      { hour12: false }
    )}</div>
    <hr/>
    <table>${rows}
      <tr class="tot"><td>Subtotal</td><td></td><td style="text-align:right">${s.subtotal.toLocaleString(
        "id-ID"
      )}</td></tr>
      ${
        s.discount
          ? `<tr class="tot"><td>Diskon</td><td></td><td style="text-align:right">-${s.discount.toLocaleString(
              "id-ID"
            )}</td></tr>`
          : ""
      }
      ${
        s.taxValue
          ? `<tr class="tot"><td>Pajak (${s.taxRate}%)</td><td></td><td style="text-align:right">${s.taxValue.toLocaleString(
              "id-ID"
            )}</td></tr>`
          : ""
      }
      ${
        s.serviceValue
          ? `<tr class="tot"><td>Service (${s.serviceRate}%)</td><td></td><td style="text-align:right">${s.serviceValue.toLocaleString(
              "id-ID"
            )}</td></tr>`
          : ""
      }
      <tr class="tot"><td>Total</td><td></td><td style="text-align:right">${s.total.toLocaleString(
        "id-ID"
      )}</td></tr>
      ${
        s.method === "cash"
          ? `<tr><td>Tunai</td><td></td><td style="text-align:right">${s.cash.toLocaleString(
              "id-ID"
            )}</td></tr>
             <tr><td>Kembali</td><td></td><td style="text-align:right">${s.change.toLocaleString(
               "id-ID"
             )}</td></tr>`
          : `<tr><td>Pembayaran</td><td></td><td style="text-align:right">E-Wallet</td></tr>`
      }
    </table>
    ${
      qr
        ? `<div class="meta" style="margin:8px 0 2px">Scan untuk cek poin loyalty</div>
           <img src="${qr}" style="display:block;margin:0 auto 4px auto"/>
           <div class="meta" style="word-break:break-all;font-size:10px">${s.loyaltyUrl}</div>`
        : ""
    }
    <p class="meta">Terima kasih! Follow @chafumatcha</p>
  </div>
  <script>window.print()</script>
</body></html>`;
    w.document.write(html);
    w.document.close();
  }

  /* FINALIZE — print dulu baru simpan (hindari popup blocked) */
  const finalize = async () => {
    if (cart.length === 0) return alert("Keranjang kosong.");
    if (method === "cash" && cash < total) return alert("Uang tunai kurang.");

    const useLoyalty = /\d{6,}/.test(customerPhone.trim());
    if (useLoyalty && !customerKnown && !customerName.trim()) {
      return alert("Nama pelanggan wajib diisi untuk nomor baru.");
    }
    const pointsEarned = useLoyalty ? cart.reduce((s, i) => s + i.qty, 0) : 0;

    // state CartItem harus pakai undefined untuk note (bukan null)
    const itemsSafe: CartItem[] = cart.map((ci) => ({
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

    // cetak dulu supaya popup tidak diblok
    printReceipt80mm(s);

    // simpan
    try {
      const payload = cleanForFirestore({
        ...s,
        // map note undefined -> null di Firestore
        items: s.items.map((i) => ({
          ...i,
          note: i.note ?? null,
        })),
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

      setSales((prev) => [s, ...prev]);
      clearCartAll();
      alert("Transaksi tersimpan ✅");
    } catch (e: any) {
      console.error(e);
      alert("Transaksi tercetak, namun penyimpanan gagal: " + (e?.message || e));
    }
  };

  /* ================== UI ================== */
  if (!user) {
    return (
      <div style={wrap}>
        <InlineStyle />
        <h2 style={{ marginTop: 8 }}>{SHOP_NAME} — POS</h2>
        <div style={card}>
          <h3>Login</h3>
          <input
            placeholder="Email"
            style={input}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <input
            placeholder="Password"
            type="password"
            style={input}
            value={pass}
            onChange={(e) => setPass(e.target.value)}
          />
          <button
            style={btnPrimary}
            onClick={async () => {
              try {
                await signInWithEmailAndPassword(auth, email, pass);
              } catch (e: any) {
                alert(e.message);
              }
            }}
          >
            Masuk
          </button>
          <p style={{ fontSize: 12, opacity: 0.6, marginTop: 8 }}>
            Owner/admin: hanya email terdaftar yang bisa ubah produk & inventori.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={wrap}>
      <InlineStyle />
      {/* Header */}
      <div className="hdr">
        <div className="hdrL">
          <img
            src="/logo.png"
            alt="logo"
            className="logo"
            onError={(e: any) => (e.currentTarget.style.display = "none")}
          />
          <div>
            <h2 className="title">{SHOP_NAME} — Kasir</h2>
            <small>{OUTLET}</small>
          </div>
        </div>
        <div className="hdrR">
          <small>
            Masuk: {user.email} {isAdmin ? "(owner)" : "(staff)"}
          </small>
          <button onClick={() => setTab("pos")}>Kasir</button>
          <button
            onClick={() => {
              setTab("history");
              loadSales();
            }}
          >
            Riwayat
          </button>
          <button onClick={() => setTab("products")}>Produk</button>
          <button onClick={() => setTab("inventory")}>Inventori</button>
          <button onClick={() => setTab("settings")}>Pengaturan</button>
          <button style={btnDanger} onClick={() => signOut(auth)}>
            Keluar
          </button>
        </div>
      </div>

      {/* POS */}
      {tab === "pos" && (
        <div className="grid-pos">
          {/* menu */}
          <div style={card}>
            <h3>Menu</h3>
            <div className="grid-menu">
              {products
                .filter((p) => p.active !== false)
                .map((p) => (
                  <button key={p.id} className="tile" onClick={() => addToCart(p)}>
                    <div className="tileName">{p.name}</div>
                    <div className="tileCat">{p.category}</div>
                    <div className="tilePrice">{IDR(p.price)}</div>
                  </button>
                ))}
            </div>
          </div>

          {/* cart */}
          <div style={card}>
            <h3>Keranjang</h3>
            {cart.length === 0 ? (
              <p style={{ opacity: 0.7 }}>Belum ada item.</p>
            ) : (
              <ul className="cartList">
                {cart.map((ci, idx) => (
                  <li key={idx} className="cartRow">
                    <div>
                      <div className="cartName">{ci.name}</div>
                      {ci.note && <div className="cartNote">{ci.note}</div>}
                    </div>
                    <div>{IDR(ci.price)}</div>
                    <div className="qtyCtl">
                      <button onClick={() => dec(idx)}>-</button>
                      <b>{ci.qty}</b>
                      <button onClick={() => inc(idx)}>+</button>
                      <button onClick={() => rm(idx)} className="xBtn">
                        ×
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <div className="vGap">
              <input
                placeholder="Catatan (opsional)"
                style={input}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />

              <div className="row">
                <span>Subtotal</span>
                <b>{IDR(subtotal)}</b>
              </div>
              <div className="row">
                <span>Pajak %</span>
                <input
                  type="number"
                  className="inpSm"
                  value={taxRate}
                  onChange={(e) => setTaxRate(Number(e.target.value) || 0)}
                />
              </div>
              <div className="row">
                <span>Service %</span>
                <input
                  type="number"
                  className="inpSm"
                  value={serviceRate}
                  onChange={(e) => setServiceRate(Number(e.target.value) || 0)}
                />
              </div>
              <div className="row">
                <span>Diskon (Rp)</span>
                <input
                  type="number"
                  className="inpSm"
                  value={discount}
                  onChange={(e) => setDiscount(Number(e.target.value) || 0)}
                />
              </div>
              <div className="row totalRow">
                <span>Total</span>
                <span>{IDR(total)}</span>
              </div>

              <div className="payGrid">
                <select
                  value={method}
                  onChange={(e) => setMethod(e.target.value as any)}
                  style={input}
                >
                  <option value="cash">Cash</option>
                  <option value="ewallet">E-Wallet</option>
                </select>
                {method === "cash" ? (
                  <input
                    type="number"
                    placeholder="Tunai (Rp)"
                    style={input}
                    value={cash}
                    onChange={(e) => setCash(Number(e.target.value) || 0)}
                  />
                ) : (
                  <div className="qrisRow">
                    <img
                      src="/qris.png"
                      alt="QRIS"
                      className="qris"
                      onError={(e: any) => (e.currentTarget.style.display = "none")}
                    />
                    <small>Scan QRIS untuk bayar.</small>
                  </div>
                )}
              </div>

              {/* Loyalty */}
              <div className="loyalBox">
                <div className="loyalGrid">
                  <input
                    placeholder="No HP (opsional)"
                    style={input}
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                  />
                  <div className="loyalRight">
                    <input
                      placeholder={
                        customerKnown ? "Nama otomatis" : "Nama (wajib jika baru)"
                      }
                      style={{
                        ...input,
                        flex: 1,
                        background: customerKnown ? "#f3f4f6" : "#fff",
                      }}
                      value={customerName}
                      disabled={customerKnown}
                      onChange={(e) => setCustomerName(e.target.value)}
                    />
                    <span className="pill">
                      {lookingUp ? "cek..." : `Poin: ${customerPoints}`}
                    </span>
                  </div>
                </div>
              </div>

              <div className="actions">
                <button onClick={clearCartAll}>Bersihkan</button>
                <button
                  style={btnPrimary}
                  disabled={cart.length === 0 || (method === "cash" && cash < total)}
                  onClick={finalize}
                >
                  Selesaikan & Cetak
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* History */}
      {tab === "history" && (
        <div style={{ ...card, marginTop: 12 }}>
          <div className="hdrTbl">
            <h3>Riwayat Transaksi</h3>
            <button onClick={loadSales}>{loading ? "Memuat..." : "Muat Ulang"}</button>
          </div>
          {sales.length === 0 ? (
            <p style={{ opacity: 0.7 }}>Belum ada transaksi.</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="tbl">
                <thead>
                  <tr>
                    <th className="thL">Waktu</th>
                    <th className="thL">ID</th>
                    <th className="thL">Item</th>
                    <th className="thR">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {sales.map((s) => (
                    <tr key={s.id}>
                      <td className="td">{new Date(s.time).toLocaleString("id-ID", { hour12: false })}</td>
                      <td className="td">{s.id}</td>
                      <td className="td">{s.items.map((i) => `${i.name} x${i.qty}`).join(", ")}</td>
                      <td className="tdR">{IDR(s.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Products */}
      {tab === "products" && (
        <ProductsCard
          isAdmin={isAdmin}
          products={products}
          ingredients={ingredients}
          onSave={saveProduct}
          onDelete={deleteProductById}
        />
      )}

      {/* Inventory */}
      {tab === "inventory" && (
        <InventoryCard
          isAdmin={isAdmin}
          ingredients={ingredients}
          onSave={saveIngredient}
          onDelete={deleteIngredientById}
        />
      )}

      {/* Settings */}
      {tab === "settings" && (
        <div style={{ ...card, marginTop: 12 }}>
          <h3>Pengaturan</h3>
          <p>• Nama toko: <b>{SHOP_NAME}</b></p>
          <p>• Outlet: <b>{OUTLET}</b></p>
          <p>• Owner/Admin:</p>
          <ul>{ADMIN_EMAILS.map((m) => <li key={m}>{m}</li>)}</ul>
          <p style={{ fontSize: 12, opacity: 0.7 }}>
            Logo: <code>public/logo.png</code>, QRIS: <code>public/qris.png</code>.
          </p>
        </div>
      )}
    </div>
  );
}

/* ============== Products Card ============== */
function ProductsCard({
  isAdmin,
  products,
  ingredients,
  onSave,
  onDelete,
}: {
  isAdmin: boolean;
  products: Product[];
  ingredients: Ingredient[];
  onSave: (p: Product) => void | Promise<void>;
  onDelete: (id: string) => void | Promise<void>;
}) {
  const empty: Product = {
    name: "",
    price: 0,
    category: "Signature",
    active: true,
    recipe: [],
  };
  const [form, setForm] = useState<Product>(empty);

  function addRecipeRow() {
    setForm((f) => ({
      ...f,
      recipe: [...(f.recipe || []), { ingredientId: ingredients[0]?.id || "", qty: 1 }],
    }));
  }
  function updateRecipe(idx: number, patch: Partial<RecipeItem>) {
    setForm((f) => {
      const r = [...(f.recipe || [])];
      r[idx] = { ...r[idx], ...patch } as any;
      return { ...f, recipe: r };
    });
  }
  function rmRecipe(idx: number) {
    setForm((f) => {
      const r = [...(f.recipe || [])];
      r.splice(idx, 1);
      return { ...f, recipe: r };
    });
  }

  return (
    <div style={{ ...card, marginTop: 12 }}>
      <div className="hdrTbl">
        <h3>Produk</h3>
        <button onClick={() => setForm(empty)}>Produk Baru</button>
      </div>

      <div className="prodGrid">
        <input
          style={input}
          placeholder="Nama"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
        <input
          style={input}
          placeholder="Kategori"
          value={form.category}
          onChange={(e) => setForm({ ...form, category: e.target.value })}
        />
        <input
          style={input}
          type="number"
          placeholder="Harga"
          value={form.price}
          onChange={(e) => setForm({ ...form, price: Number(e.target.value) || 0 })}
        />
        <label className="chk">
          <input
            type="checkbox"
            checked={form.active !== false}
            onChange={(e) => setForm({ ...form, active: e.target.checked })}
          />{" "}
          Aktif
        </label>
      </div>

      <div className="recipeBox">
        <div className="hdrTbl">
          <b>Recipe (Inventori)</b>
          <button onClick={addRecipeRow}>+ Bahan</button>
        </div>
        {(form.recipe || []).length === 0 ? (
          <p style={{ opacity: 0.7 }}>Belum ada bahan.</p>
        ) : (
          <div className="recipeGrid">
            {form.recipe!.map((r, idx) => (
              <React.Fragment key={idx}>
                <select
                  style={input}
                  value={r.ingredientId}
                  onChange={(e) => updateRecipe(idx, { ingredientId: e.target.value })}
                >
                  {ingredients.map((ing) => (
                    <option key={ing.id} value={ing.id}>
                      {ing.name} ({ing.unit})
                    </option>
                  ))}
                </select>
                <input
                  style={input}
                  type="number"
                  min={0}
                  step="0.01"
                  value={r.qty}
                  onChange={(e) => updateRecipe(idx, { qty: Number(e.target.value) || 0 })}
                />
                <button onClick={() => rmRecipe(idx)}>Hapus</button>
              </React.Fragment>
            ))}
          </div>
        )}
      </div>

      <div className="actRow">
        <button style={btnPrimary} disabled={!isAdmin} onClick={() => onSave(form)}>
          {form.id ? "Simpan Perubahan" : "Tambah Produk"}
        </button>
        {form.id && (
          <button style={btnDanger} disabled={!isAdmin} onClick={() => onDelete(form.id!)}>
            Hapus
          </button>
        )}
      </div>

      <hr style={{ margin: "16px 0" }} />
      <div style={{ overflowX: "auto" }}>
        <table className="tbl">
          <thead>
            <tr>
              <th className="thL">Nama</th>
              <th className="thL">Kategori</th>
              <th className="thR">Harga</th>
              <th className="thL">Aktif</th>
              <th className="thR">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.id}>
                <td className="td">{p.name}</td>
                <td className="td">{p.category}</td>
                <td className="tdR">{IDR(p.price)}</td>
                <td className="td">{p.active !== false ? "Ya" : "Tidak"}</td>
                <td className="tdR">
                  <button onClick={() => setForm(p)}>Edit</button>
                  <button onClick={() => onDelete(p.id!)} style={{ marginLeft: 6 }}>
                    Hapus
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ============== Inventory Card ============== */
function InventoryCard({
  isAdmin,
  ingredients,
  onSave,
  onDelete,
}: {
  isAdmin: boolean;
  ingredients: Ingredient[];
  onSave: (i: Ingredient) => void | Promise<void>;
  onDelete: (id: string) => void | Promise<void>;
}) {
  const empty: Ingredient = { name: "", unit: "gr", stock: 0, low: 10 };
  const [form, setForm] = useState<Ingredient>(empty);

  return (
    <div style={{ ...card, marginTop: 12 }}>
      <div className="hdrTbl">
        <h3>Inventori</h3>
        <button onClick={() => setForm(empty)}>Bahan Baru</button>
      </div>

      <div className="invGrid">
        <input
          style={input}
          placeholder="Nama bahan"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
        <input
          style={input}
          placeholder="Unit (gr/ml/pcs)"
          value={form.unit}
          onChange={(e) => setForm({ ...form, unit: e.target.value })}
        />
        <input
          style={input}
          type="number"
          placeholder="Stok"
          value={form.stock}
          onChange={(e) => setForm({ ...form, stock: Number(e.target.value) || 0 })}
        />
        <input
          style={input}
          type="number"
          placeholder="Ambang (low)"
          value={form.low || 0}
          onChange={(e) => setForm({ ...form, low: Number(e.target.value) || 0 })}
        />
        <button style={btnPrimary} disabled={!isAdmin} onClick={() => onSave(form)}>
          {form.id ? "Simpan" : "Tambah"}
        </button>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table className="tbl">
          <thead>
            <tr>
              <th className="thL">Nama</th>
              <th className="thL">Unit</th>
              <th className="thR">Stok</th>
              <th className="thR">Low</th>
              <th className="thR">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {ingredients.map((i) => (
              <tr
                key={i.id}
                style={{ background: i.stock <= (i.low || 0) ? "#fff7ed" : undefined }}
              >
                <td className="td">{i.name}</td>
                <td className="td">{i.unit}</td>
                <td className="tdR">{i.stock}</td>
                <td className="tdR">{i.low || 0}</td>
                <td className="tdR">
                  <button onClick={() => setForm(i)}>Edit</button>
                  <button onClick={() => onDelete(i.id!)} style={{ marginLeft: 6 }}>
                    Hapus
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ============== Styles & Responsive ============== */
function InlineStyle() {
  return (
    <style>{`
      .hdr{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap}
      .hdrL{display:flex;align-items:center;gap:10px}
      .hdrR{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
      .logo{width:36px;height:36px;object-fit:contain;border-radius:8px}
      .title{margin:4px 0}
      .grid-pos{display:grid;grid-template-columns:1fr;gap:12px}
      .grid-menu{display:grid;grid-template-columns:1fr 1fr;gap:8px}
      .tile{text-align:left;border:1px solid #e5e7eb;border-radius:12px;padding:10px;background:#fff}
      .tileName{font-weight:600}
      .tileCat{font-size:12px;opacity:.7}
      .tilePrice{margin-top:4px}
      .cartList{list-style:none;padding:0;margin:0;display:grid;gap:8px}
      .cartRow{border:1px solid #eee;border-radius:10px;padding:8px;display:grid;grid-template-columns:1fr auto auto;gap:10px;align-items:center}
      .cartName{font-weight:600}
      .cartNote{font-size:12px;opacity:.7}
      .qtyCtl{display:flex;gap:6px;align-items:center}
      .xBtn{margin-left:6px}
      .row{display:flex;justify-content:space-between;align-items:center;gap:8px}
      .inpSm{border:1px solid #e5e7eb;border-radius:8px;padding:8px 10px;width:140px}
      .totalRow{font-size:18px}
      .payGrid{display:grid;gap:8px}
      .qrisRow{display:flex;align-items:center;gap:8px}
      .qris{height:40px;object-fit:contain}
      .loyalBox{border-top:1px dashed #ddd;padding-top:8px}
      .loyalGrid{display:grid;gap:8px}
      .loyalRight{display:flex;gap:8px;align-items:center}
      .pill{border:1px solid #e5e7eb;border-radius:999px;padding:6px 10px;font-size:12px}
      .actions{display:flex;gap:8px;justify-content:space-between;flex-wrap:wrap}
      .hdrTbl{display:flex;justify-content:space-between;align-items:center}
      .tbl{width:100%;border-collapse:collapse}
      .thL{text-align:left;border-bottom:1px solid #e5e7eb;padding:10px 8px}
      .thR{text-align:right;border-bottom:1px solid #e5e7eb;padding:10px 8px}
      .td{border-bottom:1px solid #f3f4f6;padding:8px}
      .tdR{text-align:right;border-bottom:1px solid #f3f4f6;padding:8px}
      .prodGrid{display:grid;gap:8px;grid-template-columns:1fr 1fr 1fr auto;align-items:center}
      .recipeBox{border:1px dashed #ddd;border-radius:10px;padding:8px;margin:8px 0}
      .recipeGrid{display:grid;gap:8px;grid-template-columns:2fr 1fr auto}
      .chk{font-size:12px;display:flex;align-items:center;gap:6px}
      .actRow{display:flex;gap:8px}
      .invGrid{display:grid;gap:8px;grid-template-columns:2fr 1fr 1fr 1fr auto;align-items:center}
      @media (max-width:768px){
        .grid-menu{grid-template-columns:1fr}
        .recipeGrid{grid-template-columns:1fr 1fr auto}
        .prodGrid{grid-template-columns:1fr 1fr}
        .invGrid{grid-template-columns:1fr 1fr}
      }
      @media (min-width:769px){ .grid-pos{grid-template-columns:1fr 1fr} }
    `}</style>
  );
}

/* ============== Mini tokens ============== */
const wrap: React.CSSProperties = { padding: 12, maxWidth: 1100, margin: "0 auto" };
const card: React.CSSProperties = { border: "1px solid #e5e7eb", borderRadius: 12, padding: 12, background: "#fff" };
const input: React.CSSProperties = { border: "1px solid #e5e7eb", borderRadius: 8, padding: "10px 12px", width: "100%" };
const btnPrimary: React.CSSProperties = { border: "1px solid #2e7d32", background: "#2e7d32", color: "#fff", padding: "8px 12px", borderRadius: 10 };
const btnDanger: React.CSSProperties = { border: "1px solid #e53935", background: "#e53935", color: "#fff", padding: "8px 12px", borderRadius: 10 };

/* ============== Master CRUD funcs (di bawah agar komponen bisa pakai) ============== */
async function saveProduct(p: Product) {
  alert("Fungsi dummy — akan di-override di komponen utama."); // placeholder supaya TS tidak error saat hoisting
}
async function deleteProductById(id: string) {
  alert("Fungsi dummy — akan di-override di komponen utama.");
}
async function saveIngredient(i: Ingredient) {
  alert("Fungsi dummy — akan di-override di komponen utama.");
}
async function deleteIngredientById(id: string) {
  alert("Fungsi dummy — akan di-override di komponen utama.");
}