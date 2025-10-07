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

const formatIDR = (num: number) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(num);

export default function App() {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cash, setCash] = useState<number>(0);

  const addToCart = (product: Product) => {
    setCart((prev) => {
      const exist = prev.find((item) => item.id === product.id);
      if (exist) {
        return prev.map((item) =>
          item.id === product.id ? { ...item, qty: item.qty + 1 } : item
        );
      }
      return [...prev, { ...product, qty: 1 }];
    });
  };

  const removeFromCart = (id: number) => {
    setCart((prev) => prev.filter((item) => item.id !== id));
  };

  const changeQty = (id: number, qty: number) => {
    setCart((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, qty: Math.max(1, qty) } : item
      )
    );
  };

  const subtotal = cart.reduce((sum, item) => sum + item.price * item.qty, 0);
  const change = cash - subtotal;

  const reset = () => {
    setCart([]);
    setCash(0);
  };

  return (
    <div
      style={{
        fontFamily: "Poppins, sans-serif",
        backgroundColor: "#f6f7f6",
        minHeight: "100vh",
        padding: "20px",
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
        <h1 style={{ color: "#2e7d32" }}>🍵 CHAFU MATCHA POS</h1>
        <p style={{ color: "#666" }}>
          Modern Ritual, Hembusan Ketenangan dalam Setiap Gelas
        </p>
      </header>

      <main
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "20px",
          maxWidth: 1000,
          margin: "0 auto",
        }}
      >
        {/* Left side - Products */}
        <div>
          <h2>Menu Minuman</h2>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "10px",
            }}
          >
            {PRODUCTS.map((p) => (
              <button
                key={p.id}
                onClick={() => addToCart(p)}
                style={{
                  padding: "12px",
                  borderRadius: "10px",
                  border: "1px solid #ccc",
                  background: "#fff",
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <strong>{p.name}</strong>
                <br />
                <span>{formatIDR(p.price)}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Right side - Cart */}
        <div>
          <h2>Keranjang</h2>
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
                <tr
                  style={{
                    backgroundColor: "#2e7d32",
                    color: "white",
                    textAlign: "left",
                  }}
                >
                  <th style={{ padding: "6px" }}>Produk</th>
                  <th>Qty</th>
                  <th>Harga</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {cart.map((item) => (
                  <tr key={item.id}>
                    <td style={{ padding: "6px" }}>{item.name}</td>
                    <td>
                      <input
                        type="number"
                        value={item.qty}
                        onChange={(e) =>
                          changeQty(item.id, parseInt(e.target.value))
                        }
                        style={{ width: 50 }}
                      />
                    </td>
                    <td>{formatIDR(item.price * item.qty)}</td>
                    <td>
                      <button
                        onClick={() => removeFromCart(item.id)}
                        style={{
                          background: "none",
                          border: "none",
                          color: "red",
                          cursor: "pointer",
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
              <strong>Subtotal:</strong> {formatIDR(subtotal)}
            </p>
            <div style={{ marginBottom: 10 }}>
              <label>
                Tunai:{" "}
                <input
                  type="number"
                  value={cash}
                  onChange={(e) => setCash(parseInt(e.target.value) || 0)}
                  style={{ width: 120 }}
                />
              </label>
            </div>
            <p>
              <strong>Kembali:</strong>{" "}
              <span
                style={{
                  color: change < 0 ? "red" : "#2e7d32",
                  fontWeight: 600,
                }}
              >
                {formatIDR(change)}
              </span>
            </p>

            <div style={{ marginTop: 15 }}>
              <button
                onClick={reset}
                style={{
                  backgroundColor: "#999",
                  color: "#fff",
                  padding: "10px 20px",
                  borderRadius: 8,
                  marginRight: 10,
                  border: "none",
                  cursor: "pointer",
                }}
              >
                Bersihkan
              </button>
              <button
                onClick={() =>
                  alert(
                    `Transaksi selesai!\nTotal: ${formatIDR(
                      subtotal
                    )}\nKembal
