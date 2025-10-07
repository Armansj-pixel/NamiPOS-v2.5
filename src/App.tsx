import React, { useState } from "react";

interface Product {
  id: number;
  name: string;
  price: number;
}

interface CartItem extends Product {
  qty: number;
}

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
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(n || 0);

export default function App() {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cash, setCash] = useState<number>(0);

  const addToCart = (p: Product) => {
    setCart((prev) => {
      const exist = prev.find((it) => it.id === p.id);
      if (exist) {
        return prev.map((it) =>
          it.id === p.id ? { ...it, qty: it.qty + 1 } : it
        );
      }
      return [...prev, { ...p, qty: 1 }];
    });
  };

  const removeFromCart = (id: number) => {
    setCart((prev) => prev.filter((it) => it.id !== id));
  };

  const changeQty = (id: number, qty: number) => {
    setCart((prev) =>
      prev.map((it) => (it.id === id ? { ...it, qty: Math.max(1, qty) } : it))
    );
  };

  const subtotal = cart.reduce((s, it) => s + it.price * it.qty, 0);
  const change = cash - subtotal;

  const reset = () => {
    setCart([]);
    setCash(0);
  };

  const finalize = () => {
    const msg = `Transaksi selesai!\nTotal: ${IDR(subtotal)}\nKembali: ${IDR(
      change
    )}`;
    alert(msg);
  };

  return (
    <div
      style={{
        fontFamily: "Poppins, system-ui, sans-serif",
        background: "#f6f7f6",
        minHeight: "100vh",
        padding: 20,
      }}
    >
      <header
        style={{
          textAlign: "center",
          marginBottom: 20,
          paddingBottom: 10,
          borderBottom: "2px solid #2e7d32",
        }}
      >
        <h1 style={{ color: "#2e7d32", margin: 0 }}>🍵 CHAFU MATCHA POS</h1>
        <p style={{ color: "#666", marginTop: 6 }}>
          Modern Ritual — ketenangan di setiap gelas
        </p>
      </header>

      <main
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 20,
          maxWidth: 1000,
          margin: "0 auto",
        }}
      >
        {/* Kiri: Menu */}
        <section>
          <h2 style={{ marginTop: 0 }}>Menu Minuman</h2>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 10,
            }}
          >
            {PRODUCTS.map((p) => (
              <button
                key={p.id}
                onClick={() => addToCart(p)}
                style={{
                  padding: 12,
                  borderRadius: 10,
                  border: "1px solid #ddd",
                  background: "#fff",
                  textAlign: "left",
                  cursor: "pointer",
                }}
              >
                <strong>{p.name}</strong>
                <br />
                <span>{IDR(p.price)}</span>
              </button>
            ))}
          </div>
        </section>

        {/* Kanan: Keranjang */}
        <section>
          <h2 style={{ marginTop: 0 }}>Keranjang</h2>

          {cart.length === 0 ? (
            <p style={{ color: "#777" }}>Belum ada item.</p>
          ) : (
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                marginBottom: 10,
              }}
            >
              <thead>
                <tr style={{ background: "#2e7d32", color: "#fff" }}>
                  <th style={{ textAlign: "left", padding: 6 }}>Produk</th>
                  <th style={{ textAlign: "left", padding: 6 }}>Qty</th>
                  <th style={{ textAlign: "left", padding: 6 }}>Harga</th>
                  <th style={{ width: 40 }} />
                </tr>
              </thead>
              <tbody>
                {cart.map((it) => (
                  <tr key={it.id}>
                    <td style={{ padding: 6 }}>{it.name}</td>
                    <td style={{ padding: 6 }}>
                      <input
                        type="number"
                        value={it.qty}
                        min={1}
                        onChange={(e) =>
                          changeQty(it.id, parseInt(e.target.value) || 1)
                        }
                        style={{ width: 60 }}
                      />
                    </td>
                    <td style={{ padding: 6 }}>{IDR(it.price * it.qty)}</td>
                    <td style={{ padding: 6 }}>
                      <button
                        onClick={() => removeFromCart(it.id)}
                        title="Hapus"
                        style={{
                          background: "none",
                          border: "none",
                          color: "crimson",
                          cursor: "pointer",
                          fontSize: 18,
                        }}
                      >
                        ✖
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <hr />

          <div style={{ marginTop: 10 }}>
            <p>
              <strong>Subtotal:</strong> {IDR(subtotal)}
            </p>

            <div style={{ marginBottom: 10 }}>
              <label>
                Tunai:{" "}
                <input
                  type="number"
                  value={cash}
                  onChange={(e) => setCash(parseInt(e.target.value) || 0)}
                  style={{ width: 140 }}
                />
              </label>
            </div>

            <p>
              <strong>Kembali:</strong>{" "}
              <span
                style={{
                  color: change < 0 ? "crimson" : "#2e7d32",
                  fontWeight: 600,
                }}
              >
                {IDR(change)}
              </span>
            </p>

            <div style={{ marginTop: 14 }}>
              <button
                onClick={reset}
                style={{
                  background: "#9e9e9e",
                  color: "#fff",
                  padding: "10px 18px",
                  borderRadius: 8,
                  border: "none",
                  marginRight: 10,
                  cursor: "pointer",
                }}
              >
                Bersihkan
              </button>
              <button
                onClick={finalize}
                disabled={subtotal <= 0 || (cash < subtotal && cash !== 0)}
                style={{
                  background: "#2e7d32",
                  color: "#fff",
                  padding: "10px 18px",
                  borderRadius: 8,
                  border: "none",
                  cursor: "pointer",
                  opacity: subtotal <= 0 ? 0.6 : 1,
                }}
              >
                Selesai
              </button>
            </div>
          </div>
        </section>
      </main>

      <footer
        style={{ textAlign: "center", marginTop: 36, color: "#555", fontSize: 13 }}
      >
        © {new Date().getFullYear()} CHAFU MATCHA — Modern Ritual.
      </footer>
    </div>
  );
}
