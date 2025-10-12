import React, { useEffect, useMemo, useState } from "react";
import { auth, db, IDR } from "./lib/firebase";
import {
  signInWithEmailAndPassword, onAuthStateChanged, signOut, User
} from "firebase/auth";
import {
  collection, doc, getDoc, getDocs, addDoc, setDoc, updateDoc, deleteDoc,
  query, where, orderBy, serverTimestamp, increment
} from "firebase/firestore";

/* ================== KONFIG ================== */
const SHOP_NAME = "CHAFU MATCHA";
const OUTLET = "@MTHaryono";
const ADMIN_EMAILS = ["antonius.arman123@gmail.com", "ayuismaalabibbah@gmail.com"];

/* ================== TYPES ================== */
type Product = {
  id?: string;
  name: string;
  price: number;
  category: string;
  active?: boolean;
  recipe?: { ingredientId: string; qty: number }[]; // per cup
};
type Ingredient = { id?: string; name: string; unit: string; stock: number; low?: number };
type CartItem = { productId: string; name: string; price: number; qty: number; note?: string };
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

/* ========= helper: bersihkan undefined ========= */
function cleanForFirestore<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((v) => cleanForFirestore(v)) as unknown as T;
  }
  if (value && typeof value === "object") {
    const out: any = {};
    for (const [k, v] of Object.entries(value as any)) {
      if (v === undefined) continue;
      out[k] = cleanForFirestore(v as any);
    }
    return out;
  }
  return (value === undefined ? null : value) as T;
}

/* ================= LOYALTY ================== */
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

  /* Tabs & POS */
  const [tab, setTab] = useState<"pos" | "history" | "products" | "inventory" | "settings">("pos");
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

  /* Product CRUD */
  async function saveProduct(p: Product) {
    if (!isAdmin) return alert("Khusus owner/admin.");
    if (!p.name || p.price <= 0) return alert("Nama & harga wajib.");
    if (p.id) {
      await setDoc(doc(db, "products", p.id), p as any, { merge: true });
    } else {
      await addDoc(collection(db, "products"), {
        ...p,
        active: p.active !== false,
        createdAt: serverTimestamp(),
      });
    }
    await loadProducts();
  }
  async function deleteProductById(id: string) {
    if (!isAdmin) return alert("Khusus owner/admin.");
    if (!confirm("Hapus produk ini?")) return;
    await deleteDoc(doc(db, "products", id));
    await loadProducts();
  }

  /* Ingredient CRUD */
  async function saveIngredient(i: Ingredient) {
    if (!isAdmin) return alert("Khusus owner/admin.");
    if (!i.name) return alert("Nama bahan wajib.");
    const payload = {
      name: i.name,
      unit: i.unit,
      stock: Number(i.stock || 0),
      low: Number(i.low || 0),
      updatedAt: serverTimestamp(),
    };
    if (i.id) {
      await setDoc(doc(db, "ingredients", i.id), payload, { merge: true });
    } else {
      await addDoc(collection(db, "ingredients"), { ...payload, createdAt: serverTimestamp() });
    }
    await loadIngredients();
  }
  async function deleteIngredientById(id: string) {
    if (!isAdmin) return alert("Khusus owner/admin.");
    if (!confirm("Hapus bahan ini?")) return;
    await deleteDoc(doc(db, "ingredients", id));
    await loadIngredients();
  }

  /* POS helpers */
  function addToCart(p: Product) {
    setCart((prev) => {
      const f = prev.find((x) => x.productId === p.id && (x.note || "") === (note || ""));
      if (f) return prev.map((x) => (x === f ? { ...x, qty: x.qty + 1 } : x));
      return [...prev, { productId: p.id!, name: p.name, price: p.price, qty: 1, note: note || undefined }];
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
        need[r.ingredientId] = (need[r.ingredientId] || 0) + r.qty * ci.qty;
      }
    }
    for (const [ingId, qty] of Object.entries(need)) {
      const ref = doc(db, "ingredients", ingId);
      const snap = await getDoc(ref);
      if (!snap.exists()) continue;
      const cur = (snap.data() as any).stock || 0;
      await updateDoc(ref, { stock: Math.max(0, cur - qty), updatedAt: serverTimestamp() });
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
      ? `https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(s.loyaltyUrl)}`
      : "";

    const html = `
<!doctype html><html><head><meta charset="utf-8"><title>Struk</title>
<style>
  @media print { @page { size: 80mm auto; margin: 0; } body { margin:0; } }
  body { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  .wrap { width: 76mm; margin: 0 auto; padding: 3mm; }
  h2 { margin: 4px 0; text-align: center; font-size: 14px; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 2px 0; font-size: 12px; border-bottom: 1px dashed #ddd; }
  .tot td { border-bottom: none; font-weight: 700; }
  .meta { font-size: 11px; text-align: center; opacity: .8; }
  .logo { display:block;margin:0 auto 6px auto;width:36mm;height:auto;image-rendering: pixelated; }
</style></head>
<body>
  <div class="wrap">
    <img src="/logo.png" class="logo" onerror="this.style.display='none'"/>
    <h2>${SHOP_NAME}</h2>
    <div class="meta">${OUTLET}<br/>Kasir: ${s.cashier}<br/>${new Date(s.time).toLocaleString("id-ID",{hour12:false})}</div>
    <hr/>
    <table>${rows}
      <tr class="tot"><td>Subtotal</td><td></td><td style="text-align:right">${s.subtotal.toLocaleString("id-ID")}</td></tr>
      ${s.discount ? `<tr class="tot"><td>Diskon</td><td></td><td style="text-align:right">-${s.discount.toLocaleString("id-ID")}</td></tr>` : ""}
      ${s.taxValue ? `<tr class="tot"><td>Pajak (${s.taxRate}%)</td><td></td><td style="text-align:right">${s.taxValue.toLocaleString("id-ID")}</td></tr>` : ""}
      ${s.serviceValue ? `<tr class="tot"><td>Service (${s.serviceRate}%)</td><td></td><td style="text-align:right">${s.serviceValue.toLocaleString("id-ID")}</td></tr>` : ""}
      <tr class="tot"><td>Total</td><td></td><td style="text-align:right">${s.total.toLocaleString("id-ID")}</td></tr>
      ${s.method === "cash"
        ? `<tr><td>Tunai</td><td></td><td style="text-align:right">${s.cash.toLocaleString("id-ID")}</td></tr>
           <tr><td>Kembali</td><td></td><td style="text-align:right">${s.change.toLocaleString("id-ID")}</td></tr>`
        : `<tr><td>Pembayaran</td><td></td><td style="text-align:right">E-Wallet</td></tr>`
      }
    </table>
    ${qr ? `<div class="meta" style="margin:8px 0 2px">Scan untuk cek poin loyalty</div>
            <img src="${qr}" style="display:block;margin:0 auto 4px auto"/>
            <div class="meta" style="word-break:break-all;font-size:10px">${s.loyaltyUrl}</div>` : ""}
    <p class="meta">Terima kasih! Follow @chafumatcha</p>
  </div>
  <script>window.print()</script>
</body></html>`;
    w.document.write(html);
    w.document.close();
  }

  /* FINALIZE — print dulu, baru async (hindari popup blocked) */
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
      price: ci.price,
      qty: ci.qty,
      note: ci.note ?? null,
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
      customerName: useLoyalty ? (customerKnown ? customerName : customerName.trim()) : null,
      pointsEarned: pointsEarned || 0,
      loyaltyUrl: useLoyalty ? loyaltyUrlFor(customerPhone) : null,
    };

    // cetak dulu
    printReceipt80mm(s);

    // simpan (bersihkan undefined)
    try {
      const payload = cleanForFirestore(s);
      const ref = await addDoc(collection(db, "sales"), { ...payload, createdAt: serverTimestamp() });
      s.id = ref.id;

      if (useLoyalty) {
        if (!customerKnown) await createCustomer(customerPhone.trim(), customerName.trim());
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
          <input placeholder="Email" style={input} value={email} onChange={(e) => setEmail(e.target.value)} />
          <input placeholder="Password" type="password" style={input} value={pass} onChange={(e) => setPass(e.target.value)} />
          <button style={btnPrimary} onClick={async () => { try { await signInWithEmailAndPassword(auth, email, pass); } catch (e: any) { alert(e.message); } }}>Masuk</button>
          <p style={{ fontSize: 12, opacity: 0.6, marginTop: 8 }}>Owner/admin: hanya email terdaftar yang bisa ubah produk & inventori.</p>
        </div>
      </div>
    );
  }

  return (
    <div style={wrap}>
      <InlineStyle />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <img src="/logo.png" alt="logo" style={{ width: 36, height: 36, objectFit: "contain", borderRadius: 8 }} onError={(e: any) => (e.currentTarget.style.display = "none")} />
          <div>
            <h2 style={{ margin: "4px 0" }}>{SHOP_NAME} — Kasir</h2>
            <small>{OUTLET}</small>
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <small>Masuk: {user.email} {isAdmin ? "(owner)" : "(staff)"} </small>
          <button onClick={() => setTab("pos")}>Kasir</button>
          <button onClick={() => { setTab("history"); loadSales(); }}>Riwayat</button>
          <button onClick={() => setTab("products")}>Produk</button>
          <button onClick={() => setTab("inventory")}>Inventori</button>
          <button onClick={() => setTab("settings")}>Pengaturan</button>
          <button style={btnDanger} onClick={() => signOut(auth)}>Keluar</button>
        </div>
      </div>

      {tab === "pos" && (
        <div className="grid-pos">
          <div style={card}>
            <h3>Menu</h3>
            <div className="grid-menu">
              {products.filter((p) => p.active !== false).map((p) => (
                <button key={p.id} style={tile} onClick={() => addToCart(p)}>
                  <div style={{ fontWeight: 600 }}>{p.name}</div>
                  <div style={{ fontSize: 12, opacity: 0.7 }}>{p.category}</div>
                  <div style={{ marginTop: 4 }}>{IDR(p.price)}</div>
                </button>
              ))}
            </div>
          </div>

          <div style={card}>
            <h3>Keranjang</h3>
            {cart.length === 0 ? (
              <p style={{ opacity: 0.7 }}>Belum ada item.</p>
            ) : (
              <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
                {cart.map((ci, idx) => (
                  <li key={idx} style={{ border: "1px solid #eee", borderRadius: 10, padding: 8, display: "grid", gridTemplateColumns: "1fr auto auto", gap: 10, alignItems: "center" }}>
                    <div>
                      <div style={{ fontWeight: 600 }}>{ci.name}</div>
                      {ci.note && <div style={{ fontSize: 12, opacity: 0.7 }}>{ci.note}</div>}
                    </div>
                    <div>{IDR(ci.price)}</div>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <button onClick={() => dec(idx)}>-</button>
                      <b>{ci.qty}</b>
                      <button onClick={() => inc(idx)}>+</button>
                      <button onClick={() => rm(idx)} style={{ marginLeft: 6 }}>×</button>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
              <input placeholder="Catatan (opsional)" style={input} value={note} onChange={(e) => setNote(e.target.value)} />

              <div style={row}><span>Subtotal</span><b>{IDR(subtotal)}</b></div>
              <div style={row}><span>Pajak %</span><input type="number" style={inputSm} value={taxRate} onChange={(e) => setTaxRate(Number(e.target.value) || 0)} /></div>
              <div style={row}><span>Service %</span><input type="number" style={inputSm} value={serviceRate} onChange={(e) => setServiceRate(Number(e.target.value) || 0)} /></div>
              <div style={row}><span>Diskon (Rp)</span><input type="number" style={inputSm} value={discount} onChange={(e) => setDiscount(Number(e.target.value) || 0)} /></div>
              <div style={{ ...row, fontSize: 18 }}><span>Total</span><span>{IDR(total)}</span></div>

              <div className="pay-grid">
                <select value={method} onChange={(e) => setMethod(e.target.value as any)} style={input}>
                  <option value="cash">Cash</option>
                  <option value="ewallet">E-Wallet</option>
                </select>
                {method === "cash" ? (
                  <input type="number" placeholder="Tunai (Rp)" style={input} value={cash} onChange={(e) => setCash(Number(e.target.value) || 0)} />
                ) : (
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <img src="/qris.png" alt="QRIS" style={{ height: 40, objectFit: "contain" }} onError={(e: any) => (e.currentTarget.style.display = "none")} />
                    <small>Scan QRIS untuk bayar.</small>
                  </div>
                )}
              </div>

              {/* Loyalty */}
              <div style={{ borderTop: "1px dashed #ddd", paddingTop: 8 }}>
                <div className="loyalty-grid">
                  <input placeholder="No HP (opsional)" style={input} value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} />
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <input
                      placeholder={customerKnown ? "Nama otomatis" : "Nama (wajib jika baru)"}
                      style={{ ...input, flex: 1, background: customerKnown ? "#f3f4f6" : "#fff" }}
                      value={customerName}
                      disabled={customerKnown}
                      onChange={(e) => setCustomerName(e.target.value)}
                    />
                    <span style={{ border: "1px solid #e5e7eb", borderRadius: 999, padding: "6px 10px", fontSize: 12 }}>
                      {lookingUp ? "cek..." : `Poin: ${customerPoints}`}
                    </span>
                  </div>
                </div>
              </div>

              <div className="actions">
                <button onClick={clearCartAll}>Bersihkan</button>
                <button style={btnPrimary} disabled={cart.length === 0 || (method === "cash" && cash < total)} onClick={finalize}>
                  Selesaikan & Cetak
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === "history" && (
        <div style={{ ...card, marginTop: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3>Riwayat Transaksi</h3>
            <button onClick={loadSales}>{loading ? "Memuat..." : "Muat Ulang"}</button>
          </div>
          {sales.length === 0 ? (
            <p style={{ opacity: 0.7 }}>Belum ada transaksi.</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={th}>Waktu</th>
                    <th style={th}>ID</th>
                    <th style={th}>Item</th>
                    <th style={thRight}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {sales.map((s) => (
                    <tr key={s.id}>
                      <td style={td}>{new Date(s.time).toLocaleString("id-ID", { hour12: false })}</td>
                      <td style={td}>{s.id}</td>
                      <td style={td}>{s.items.map((i) => `${i.name} x${i.qty}`).join(", ")}</td>
                      <td style={tdRight}>{IDR(s.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === "products" && (
        <ProductsCard
          isAdmin={isAdmin}
          products={products}
          ingredients={ingredients}
          onSave={saveProduct}
          onDelete={deleteProductById}
        />
      )}

      {tab === "inventory" && (
        <InventoryCard
          isAdmin={isAdmin}
          ingredients={ingredients}
          onSave={saveIngredient}
          onDelete={deleteIngredientById}
        />
      )}

      {tab === "settings" && (
        <div style={{ ...card, marginTop: 12 }}>
          <h3>Pengaturan</h3>
          <p>• Nama toko: <b>{SHOP_NAME}</b></p>
          <p>• Outlet: <b>{OUTLET}</b></p>
          <p>• Owner/Admin:</p>
          <ul>{ADMIN_EMAILS.map((m) => <li key={m}>{m}</li>)}</ul>
          <p style={{ fontSize: 12, opacity: 0.7 }}>Logo: <code>public/logo.png</code>, QRIS: <code>public/qris.png</code>.</p>
        </div>
      )}
    </div>
  );
}

/* ============== Products Card ============== */
function ProductsCard({
  isAdmin, products, ingredients, onSave, onDelete,
}: {
  isAdmin: boolean;
  products: Product[];
  ingredients: Ingredient[];
  onSave: (p: Product) => void | Promise<void>;
  onDelete: (id: string) => void | Promise<void>;
}) {
  const empty: Product = { name: "", price: 0, category: "Signature", active: true, recipe: [] };
  const [form, setForm] = useState<Product>(empty);

  function addRecipeRow() {
    setForm((f) => ({ ...f, recipe: [...(f.recipe || []), { ingredientId: ingredients[0]?.id || "", qty: 1 }] }));
  }
  function updateRecipe(idx: number, patch: Partial<{ ingredientId: string; qty: number }>) {
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
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3>Produk</h3>
        <button onClick={() => setForm(empty)}>Produk Baru</button>
      </div>

      <div className="prod-grid">
        <input style={input} placeholder="Nama" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input style={input} placeholder="Kategori" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
        <input style={input} type="number" placeholder="Harga" value={form.price} onChange={(e) => setForm({ ...form, price: Number(e.target.value) || 0 })} />
        <label style={{ fontSize: 12 }}>
          <input type="checkbox" checked={form.active !== false} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Aktif
        </label>
      </div>

      <div style={{ border: "1px dashed #ddd", borderRadius: 10, padding: 8, marginBottom: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <b>Recipe (Inventori)</b>
          <button onClick={addRecipeRow}>+ Bahan</button>
        </div>
        {(form.recipe || []).length === 0 ? (
          <p style={{ opacity: 0.7 }}>Belum ada bahan.</p>
        ) : (
          <div className="recipe-grid">
            {form.recipe!.map((r, idx) => (
              <React.Fragment key={idx}>
                <select style={input} value={r.ingredientId} onChange={(e) => updateRecipe(idx, { ingredientId: e.target.value })}>
                  {ingredients.map((ing) => (
                    <option key={ing.id} value={ing.id}>
                      {ing.name} ({ing.unit})
                    </option>
                  ))}
                </select>
                <input style={input} type="number" min={0} step="0.01" value={r.qty} onChange={(e) => updateRecipe(idx, { qty: Number(e.target.value) || 0 })} />
                <button onClick={() => rmRecipe(idx)}>Hapus</button>
              </React.Fragment>
            ))}
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 8 }}>
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
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={th}>Nama</th>
              <th style={th}>Kategori</th>
              <th style={thRight}>Harga</th>
              <th style={th}>Aktif</th>
              <th style={thRight}>Aksi</th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.id}>
                <td style={td}>{p.name}</td>
                <td style={td}>{p.category}</td>
                <td style={tdRight}>{IDR(p.price)}</td>
                <td style={td}>{p.active !== false ? "Ya" : "Tidak"}</td>
                <td style={tdRight}>
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
  isAdmin, ingredients, onSave, onDelete,
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
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3>Inventori</h3>
        <button onClick={() => setForm(empty)}>Bahan Baru</button>
      </div>

      <div className="inv-grid">
        <input style={input} placeholder="Nama bahan" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input style={input} placeholder="Unit (gr/ml/pcs)" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} />
        <input style={input} type="number" placeholder="Stok" value={form.stock} onChange={(e) => setForm({ ...form, stock: Number(e.target.value) || 0 })} />
        <input style={input} type="number" placeholder="Ambang (low)" value={form.low || 0} onChange={(e) => setForm({ ...form, low: Number(e.target.value) || 0 })} />
        <button style={btnPrimary} disabled={!isAdmin} onClick={() => onSave(form)}>{form.id ? "Simpan" : "Tambah"}</button>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={th}>Nama</th>
              <th style={th}>Unit</th>
              <th style={thRight}>Stok</th>
              <th style={thRight}>Low</th>
              <th style={thRight}>Aksi</th>
            </tr>
          </thead>
          <tbody>
            {ingredients.map((i) => (
              <tr key={i.id} style={{ background: i.stock <= (i.low || 0) ? "#fff7ed" : undefined }}>
                <td style={td}>{i.name}</td>
                <td style={td}>{i.unit}</td>
                <td style={tdRight}>{i.stock}</td>
                <td style={tdRight}>{i.low || 0}</td>
                <td style={tdRight}>
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
      .grid-pos { display:grid; grid-template-columns: 1fr; gap:12px; }
      .grid-menu { display:grid; grid-template-columns: 1fr 1fr; gap:8px; }
      .pay-grid, .loyalty-grid, .prod-grid, .recipe-grid, .inv-grid { display:grid; gap:8px; }
      .recipe-grid { grid-template-columns: 2fr 1fr auto; }
      .prod-grid   { grid-template-columns: 1fr 1fr 1fr auto; align-items:center; }
      .inv-grid    { grid-template-columns: 2fr 1fr 1fr 1fr auto; align-items:center; }
      .actions     { display:flex; gap:8px; justify-content:space-between; flex-wrap:wrap; }
      @media (max-width:768px){
        .grid-menu { grid-template-columns: 1fr; }
        .recipe-grid { grid-template-columns: 1fr 1fr auto; }
        .prod-grid { grid-template-columns: 1fr 1fr; }
        .inv-grid { grid-template-columns: 1fr 1fr; }
      }
      @media (min-width:769px){ .grid-pos { grid-template-columns: 1fr 1fr; } }
    `}</style>
  );
}

/* ============== Mini tokens ============== */
const wrap: React.CSSProperties = { padding: 12, maxWidth: 1100, margin: "0 auto" };
const card: React.CSSProperties = { border: "1px solid #e5e7eb", borderRadius: 12, padding: 12, background: "#fff" };
const input: React.CSSProperties = { border: "1px solid #e5e7eb", borderRadius: 8, padding: "10px 12px", width: "100%" };
const inputSm: React.CSSProperties = { ...input, width: 140 };
const row: React.CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 };
const tile: React.CSSProperties = { textAlign: "left", border: "1px solid #e5e7eb", borderRadius: 12, padding: 10, background: "#fff" };
const btnPrimary: React.CSSProperties = { border: "1px solid #2e7d32", background: "#2e7d32", color: "#fff", padding: "8px 12px", borderRadius: 10 };
const btnDanger: React.CSSProperties = { border: "1px solid #e53935", background: "#e53935", color: "#fff", padding: "8px 12px", borderRadius: 10 };
const th: React.CSSProperties = { textAlign: "left", borderBottom: "1px solid #e5e7eb", padding: "10px 8px" };
const thRight: React.CSSProperties = { ...th, textAlign: "right" };
const td: React.CSSProperties = { borderBottom: "1px solid #f3f4f6", padding: "8px" };
const tdRight: React.CSSProperties = { ...td, textAlign: "right" };