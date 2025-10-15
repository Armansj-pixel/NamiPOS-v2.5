// api/notify.ts — Vercel Serverless Function (Node 18)
import type { VercelRequest, VercelResponse } from "vercel";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method Not Allowed" });

    const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!;
    const CHAT_ID = process.env.TELEGRAM_CHAT_ID!;
    if (!BOT_TOKEN || !CHAT_ID) return res.status(500).json({ ok: false, error: "Missing env" });

    const {
      orderId, outlet, customerName, customerPhone, address,
      distance, method, items, subtotal, shipping, total, timeISO
    } = req.body || {};

    const lines = [
      `🛎️ <b>Order Baru</b> #${orderId || "-"}`,
      `Outlet: <b>${outlet}</b>`,
      `Nama: <b>${customerName}</b>`,
      `HP: <b>${customerPhone}</b>`,
      `Alamat: ${address}`,
      distance != null ? `Jarak: ${distance} km` : null,
      `Metode: <b>${(method || "").toUpperCase()}</b>`,
      "",
      "<b>Items</b>:",
      ...(Array.isArray(items) ? items.map((i: any) => `• ${i.name} x${i.qty} — Rp${(i.price || 0).toLocaleString("id-ID")}`) : []),
      "",
      `Subtotal: Rp${(subtotal || 0).toLocaleString("id-ID")}`,
      `Ongkir: Rp${(shipping || 0).toLocaleString("id-ID")}`,
      `Total: <b>Rp${(total || 0).toLocaleString("id-ID")}</b>`,
      timeISO ? `Waktu: ${timeISO}` : null,
    ].filter(Boolean);

    const text = lines.join("\n");

    const resp = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: "HTML" }),
    });

    const json = await resp.json();
    if (!json.ok) return res.status(500).json({ ok: false, error: json });

    return res.status(200).json({ ok: true });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || e });
  }
}