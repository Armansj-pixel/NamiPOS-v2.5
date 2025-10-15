// api/notify.ts
// Vercel Serverless Function (tanpa import tipe khusus)

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method Not Allowed' });
    return;
  }

  const body =
    typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});

  const chatId = (globalThis as any).process?.env?.TG_CHAT_ID;
  const token  = (globalThis as any).process?.env?.TG_BOT_TOKEN;

  if (!token || !chatId) {
    res.status(500).json({ ok: false, error: 'Missing TG_BOT_TOKEN/TG_CHAT_ID env' });
    return;
  }

  const text = body.text || 'New order';

  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text })
    });
    const data = await r.json();
    res.status(200).json(data);
  } catch (e: any) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}