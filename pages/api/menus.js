import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  try {
    const data = await kv.get('menus');
    if (data) {
      res.json(data);
    } else {
      res.json({ date: null, restaurants: [], scrapedAt: null });
    }
  } catch (err) {
    // Fallback: pokud KV není dostupné (lokální dev)
    res.json({ date: null, restaurants: [], scrapedAt: null, error: err.message });
  }
}
