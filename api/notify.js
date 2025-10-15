// api/notify.js — Vercel Serverless Function (Node runtime, no types)
export default async function handler(req, res) {
  const token = process.env.TG_BOT_TOKEN;
  const chatId = process.env.TG_CHAT_ID;

  if (!token || !chatId) {
    return res.status(500).json({ ok: false, error: "Missing TG_BOT_TOKEN or TG_CHAT_ID" });
  }

  // Ambil text dari POST body (JSON) atau dari query ?text=...
  let text = "";
  try {
    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
      text = body.text || "";
    } else if (req.method === "GET") {
      text = (req.query && req.query.text) || "Ping dari /api/notify ✅";
    }
  } catch (e) {
    return res.status(400).json({ ok: false, error: "Invalid JSON body" });
  }

  if (!text) return res.status(400).json({ ok: false, error: "No text provided" });

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const tgResp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text })
  });

  const data = await tgResp.json();
  return res.status(200).json(data);
}