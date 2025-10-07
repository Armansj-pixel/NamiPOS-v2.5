import React, { useEffect, useMemo, useState } from "react";

/** ====== Types ====== */
interface Product { id: number; name: string; price: number; }
interface CartItem extends Product { qty: number; }
interface SaleRecord {
  id: string;
  time: string;       // string lokal untuk tampil
  timeMs: number;     // number epoch utk perhitungan harian
  items: CartItem[];
  subtotal: number;
  cash: number;
  change: number;
}

/** ====== Data ====== */
const PRODUCTS: Product[] = [
  { id: 1, name: "Matcha OG", price: 15000 },
  { id: 2, name: "Matcha Cloud", price: 18000 },
  { id: 3, name: "Strawberry Cream Matcha", price: 17000 },
  { id: 4, name: "Choco Matcha", price: 17000 },
  { id: 5, name: "Matcha Cookies", price: 17000 },
  { id: 6, name: "Honey Matcha", price: 18000 },
  { id: 7, name: "Coconut Matcha", price: 18000 },
  { id: 8, name: "Orange Matcha", price: 17000 },
];

const IDR = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n || 0);

const nowStr = () => new Date().toLocaleString("id-ID", { hour12: false });
const uid = () => Math.random().toString(36).slice(2, 9).toUpperCase();

/** ====== Storage Keys ====== */
const K_SALES = "chafu.sales.v1";
function IDR(n:number){ // jika fungsi IDR sudah ada, hapus duplikat ini
  return new Intl.NumberFormat("id-ID",{style:"currency",currency:"IDR",maximumFractionDigits:0}).format(n||0);
}

function printReceipt(rec: {
  id: string;
  time: string;
  items: { name: string; qty: number; price: number }[];
  subtotal: number;
  cash: number;
  change: number;
}) {
  const w = window.open("", "_blank", "width=380,height=600");
  if(!w) return;
  const itemsHtml = rec.items.map(i =>
    `<tr>
      <td>${i.name}</td>
      <td style="text-align:center">${i.qty}x</td>
      <td style="text-align:right">${IDR(i.price * i.qty)}</td>
    </tr>`
  ).join("");

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
  <title>Struk</title>
  <style>
    body{font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Courier New", monospace;}
    .wrap{width:280px;margin:0 auto}
    h2{margin:8px 0;text-align:center}
    table{width:100%;border-collapse:collapse}
    td{padding:4px 0;border-bottom:1px dashed #ddd;font-size:12px;vertical-align:top}
    .tot td{border-bottom:none;font-weight:700}
    .meta{font-size:12px;text-align:center;opacity:.8}
  </style></head><body>
    <div class="wrap">
      <h2>CHAFU MATCHA</h2>
      <div class="meta">${rec.id}<br/>${rec.time}</div>
      <hr/>
      <table>
        ${itemsHtml}
        <tr class="tot"><td>Subtotal</td><td></td><td style="text-align:right">${IDR(rec.subtotal)}</td></tr>
        <tr><td>Dibayar</td><td></td><td style="text-align:right">${IDR(rec.cash)}</td></tr>
        <tr><td>Kembali</td><td></td><td style="text-align:right">${IDR(rec.change)}</td></tr>
      </table>
      <p class="meta">Terima kasih! Follow @chafumatcha</p>
    </div>
    <script>window.print()</script>
  </body></html>`;
  w.document.write(html);
  w.document.close();
}



/** ====== App ====== */
export default function App() {
  // POS state
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cash, setCash] = useState<number>(0);

  // History state
  const [sales, setSales] = useState<SaleRecord[]>(() => {
    try { return JSON.parse(localStorage.getItem(K_SALES) || "[]"); } catch { return []; }
  });

  // UI tabs
  const [tab, setTab] = useState<"pos" | "history">("pos");
  <thead>
  <tr style={{ background:"#2e7d32", color:"#fff" }}>
    <th style={{ textAlign:"left", padding:6 }}>Waktu</th>
    <th style={{ textAlign:"left", padding:6 }}>ID</th>
    <th style={{ textAlign:"left", padding:6 }}>Item</th>
    <th style={{ textAlign:"left", padding:6 }}>Subtotal</th>
    <th style={{ width:90, padding:6 }}>Aksi</th> {/* <- tambahkan ini */}
  </tr>
</thead>

  <tbody>
  {sales.map(s => (
    <tr key={s.id}>
      <td style={{ padding:6 }}>{s.time}</td>
      <td style={{ padding:6 }}>{s.id}</td>
      <td style={{ padding:6 }}>{s.items.map(i=>`${i.name} x${i.qty}`).join(", ")}</td>
      <td style={{ padding:6 }}>{IDR(s.subtotal)}</td>
      <td style={{ padding:6 }}>
        <button
          onClick={()=>printReceipt({
            id: s.id,
            time: s.time,
            items: s.items.map(i=>({ name:i.name, qty:i.qty, price:i.price })),
            subtotal: s.subtotal,
            cash: s.cash,
            change: s.change
          })}
          style={{ background:"#2e7d32", color:"#fff", border:"none", borderRadius:8, padding:"6px 10px", cursor:"pointer" }}
        >
          Cetak
        </button>
      </td>
    </tr>
  ))}
</tbody>


  // Persist sales
  useEffect(() => {
    localStorage.setItem(K_SALES, JSON.stringify(sales));
  }, [sales]);

  /** ====== Cart helpers ====== */
  const addToCart = (p: Product) => {
    setCart(prev => {
      const exist = prev.find(it => it.id === p.id);
      if (exist) return prev.map(it => it.id === p.id ? { ...it, qty: it.qty + 1 } : it);
      return [...prev, { ...p, qty: 1 }];
    });
  };
  const removeFromCart = (id: number) => setCart(prev => prev.filter(it => it.id !== id));
  const changeQty = (id: number, qty: number) =>
    setCart(prev => prev.map(it => it.id === id ? { ...it, qty: Math.max(1, qty) } : it));

  const subtotal = useMemo(() => cart.reduce((s, it) => s + it.price * it.qty, 0), [cart]);
  const change = cash - subtotal;
  const resetCart = () => { setCart([]); setCash(0); };

  /** ====== Finalize: save to history ====== */
  const finalize = () => {
    if (cart.length === 0) return alert("Keranjang kosong.");
    if (cash < subtotal) return alert("Tunai kurang.");
    const rec: SaleRecord = {
      id: `CM-${new Date().getFullYear()}${String(new Date().getMonth()+1).padStart(2,"0")}-${uid()}`,
      time: nowStr(),
      timeMs: Date.now(),
      items: cart,
      subtotal,
      cash,
      change: Math.max(0, change),
    };
    setSales(prev => [rec, ...prev]);
    resetCart();
    alert(`Transaksi tersimpan!\nID: ${rec.id}\nTotal: ${IDR(rec.subtotal)}\nKembali: ${IDR(rec.change)}`);
    setTab("history");
  };
const rec: SaleRecord = {
  id: `CM-${new Date().getFullYear()}${String(new Date().getMonth()+1).padStart(2,"0")}-${uid()}`,
  time: nowStr(),
  timeMs: Date.now(),
  items: cart,
  subtotal,
  cash,
  change: Math.max(0, change),
};

setSales(prev => [rec, ...prev]);

// CETAK OTOMATIS:
printReceipt({
  id: rec.id,
  time: rec.time,
  items: rec.items.map(i=>({ name:i.name, qty:i.qty, price:i.price })),
  subtotal: rec.subtotal,
  cash: rec.cash,
  change: rec.change
});

resetCart();
alert(`Transaksi tersimpan!\nID: ${rec.id}\nTotal: ${IDR(rec.subtotal)}\nKembali: ${IDR(rec.change)}`);
setTab("history");

  /** ====== Export CSV ====== */
  const exportCSV = () => {
    const rows = [
      ["ID","Waktu","Item (qty)","Subtotal","Tunai","Kembali"],
      ...sales.map(s => [
        s.id,
        s.time,
        s.items.map(i => `${i.name} x${i.qty}`).join("; "),
        String(s.subtotal),
        String(s.cash),
        String(s.change),
      ])
    ];
    const csv = rows.map(r => r.map(v => `"${String(v).replaceAll('"','""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `chafu_sales_${new Date().toISOString().slice(0,10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  /** ====== Small helpers ====== */
  const Section: React.FC<{title: string; children: React.ReactNode}> = ({title, children}) => (
    <section style={{background:"#fff", border:"1px solid #eee", borderRadius:12, padding:14}}>
      <h2 style={{marginTop:0}}>{title}</h2>
      {children}
    </section>
  );

  return (
    <div style={{ fontFamily: "Poppins, system-ui, sans-serif", background:"#f6f7f6", minHeight:"100vh" }}>
      <header style={{ padding:"16px 20px", borderBottom:"2px solid #2e7d32", display:"flex", gap:12, alignItems:"center", justifyContent:"space-between" }}>
        <div>
          <h1 style={{ color:"#2e7d32", margin:0 }}>🍵 CHAFU MATCHA POS</h1>
          <div style={{ color:"#666", fontSize:12 }}>Modern Ritual — ketenangan di setiap gelas</div>
        </div>
        <div style={{ display:"flex", gap:8 }}>
          <button onClick={()=>setTab("pos")} style={{ padding:"8px 12px", borderRadius:8, border: tab==="pos" ? "2px solid #2e7d32" : "1px solid #ddd", background:"#fff", cursor:"pointer" }}>Kasir</button>
          <button onClick={()=>setTab("history")} style={{ padding:"8px 12px", borderRadius:8, border: tab==="history" ? "2px solid #2e7d32" : "1px solid #ddd", background:"#fff", cursor:"pointer" }}>Riwayat</button>
        </div>
      </header>

      {tab==="pos" ? (
        <main style={{ padding:20, display:"grid", gridTemplateColumns:"1fr 1fr", gap:20, maxWidth:1100, margin:"0 auto" }}>
          {/* Menu */}
          <Section title="Menu Minuman">
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
              {PRODUCTS.map(p => (
                <button key={p.id} onClick={()=>addToCart(p)}
                  style={{ padding:12, borderRadius:10, border:"1px solid #ddd", background:"#fff", textAlign:"left", cursor:"pointer" }}>
                  <strong>{p.name}</strong><br/><span>{IDR(p.price)}</span>
                </button>
              ))}
            </div>
          </Section>

          {/* Keranjang */}
          <Section title="Keranjang">
            {cart.length===0 ? (
              <p style={{ color:"#777" }}>Belum ada item.</p>
            ) : (
              <table style={{ width:"100%", borderCollapse:"collapse", marginBottom:10 }}>
                <thead>
                  <tr style={{ background:"#2e7d32", color:"#fff" }}>
                    <th style={{ textAlign:"left", padding:6 }}>Produk</th>
                    <th style={{ textAlign:"left", padding:6, width:80 }}>Qty</th>
                    <th style={{ textAlign:"left", padding:6 }}>Total</th>
                    <th style={{ width:40 }} />
                  </tr>
                </thead>
                <tbody>
                  {cart.map(it => (
                    <tr key={it.id}>
                      <td style={{ padding:6 }}>{it.name}</td>
                      <td style={{ padding:6 }}>
                        <input type="number" min={1} value={it.qty} onChange={e=>changeQty(it.id, parseInt(e.target.value)||1)} style={{ width:60 }}/>
                      </td>
                      <td style={{ padding:6 }}>{IDR(it.price*it.qty)}</td>
                      <td style={{ padding:6 }}>
                        <button onClick={()=>removeFromCart(it.id)} style={{ background:"none", border:"none", color:"crimson", cursor:"pointer", fontSize:18 }}>✖</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <hr/>

            <div style={{ marginTop:10 }}>
              <p><strong>Subtotal:</strong> {IDR(subtotal)}</p>
              <div style={{ marginBottom:10 }}>
                <label>Tunai:{" "}
                  <input type="number" value={cash} onChange={e=>setCash(parseInt(e.target.value)||0)} style={{ width:140 }}/>
                </label>
              </div>
              <p><strong>Kembali:</strong> <span style={{ color:change<0?"crimson":"#2e7d32", fontWeight:600 }}>{IDR(change)}</span></p>

              <div style={{ marginTop:14 }}>
                <button onClick={()=>{ setCart([]); setCash(0); }}
                        style={{ background:"#9e9e9e", color:"#fff", padding:"10px 18px", borderRadius:8, border:"none", marginRight:10, cursor:"pointer" }}>
                  Bersihkan
                </button>
                <button onClick={finalize}
                        disabled={cart.length===0 || cash<subtotal}
                        style={{ background:"#2e7d32", color:"#fff", padding:"10px 18px", borderRadius:8, border:"none", cursor:"pointer", opacity:(cart.length===0||cash<subtotal)?0.6:1 }}>
                  Selesaikan & Simpan
                </button>
              </div>
            </div>
          </Section>
        </main>
      ) : (
        <main style={{ padding:20, maxWidth:1100, margin:"0 auto", display:"grid", gap:20 }}>
          <Section title="Riwayat Transaksi">
            {sales.length===0 ? (
              <p style={{ color:"#777" }}>Belum ada transaksi.</p>
            ) : (
              <div style={{ overflowX:"auto" }}>
                <table style={{ width:"100%", borderCollapse:"collapse" }}>
                  <thead>
                    <tr style={{ background:"#2e7d32", color:"#fff" }}>
                      <th style={{ textAlign:"left", padding:6 }}>Waktu</th>
                      <th style={{ textAlign:"left", padding:6 }}>ID</th>
                      <th style={{ textAlign:"left", padding:6 }}>Item</th>
                      <th style={{ textAlign:"left", padding:6 }}>Subtotal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sales.map(s => (
                      <tr key={s.id}>
                        <td style={{ padding:6 }}>{s.time}</td>
                        <td style={{ padding:6 }}>{s.id}</td>
                        <td style={{ padding:6 }}>{s.items.map(i=>`${i.name} x${i.qty}`).join(", ")}</td>
                        <td style={{ padding:6 }}>{IDR(s.subtotal)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div style={{ marginTop:12, display:"flex", gap:8 }}>
              <button onClick={exportCSV}
                      style={{ background:"#2e7d32", color:"#fff", padding:"8px 14px", borderRadius:8, border:"none", cursor:"pointer" }}>
                Export CSV
              </button>
              <button onClick={()=>{ if(confirm("Hapus semua riwayat?")) setSales([]); }}
                      style={{ background:"#c62828", color:"#fff", padding:"8px 14px", borderRadius:8, border:"none", cursor:"pointer" }}>
                Hapus Semua
              </button>
            </div>
          </Section>

          <Section title="Ringkasan Hari Ini">
            {(() => {
              const toKey = (ms:number) => new Date(ms).toISOString().slice(0,10);
              const todayKey = toKey(Date.now());
              const todaySales = sales.filter(s => toKey(s.timeMs)===todayKey);
              const omzet = todaySales.reduce((a,b)=>a+b.subtotal,0);
              const trx = todaySales.length;
              const aov = trx ? Math.round(omzet/trx) : 0;
              return (
                <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:10 }}>
                  <div style={{ border:"1px solid #eee", borderRadius:10, padding:12 }}>
                    <div style={{ fontSize:12, color:"#666" }}>Omzet</div>
                    <div style={{ fontSize:18, fontWeight:700 }}>{IDR(omzet)}</div>
                  </div>
                  <div style={{ border:"1px solid #eee", borderRadius:10, padding:12 }}>
                    <div style={{ fontSize:12, color:"#666" }}>Transaksi</div>
                    <div style={{ fontSize:18, fontWeight:700 }}>{trx}</div>
                  </div>
                  <div style={{ border:"1px solid #eee", borderRadius:10, padding:12 }}>
                    <div style={{ fontSize:12, color:"#666" }}>AOV</div>
                    <div style={{ fontSize:18, fontWeight:700 }}>{IDR(aov)}</div>
                  </div>
                </div>
              );
            })()}
          </Section>
        </main>
      )}

      <footer style={{ textAlign:"center", margin:"18px 0 30px", color:"#555", fontSize:13 }}>
        © {new Date().getFullYear()} CHAFU MATCHA — Modern Ritual.
      </footer>
    </div>
  );
}
