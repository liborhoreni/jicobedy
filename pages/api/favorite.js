import { getRedis } from '../../lib/kv';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const kv = getRedis();
  if (!kv) return res.status(200).json({ ok: true });

  const { meal, action } = req.body || {};
  // Validace: název jídla musí být rozumný string (ochrana proti zaplevelení KV).
  if (typeof meal !== 'string' || !meal.trim() || meal.length > 200) {
    return res.status(400).json({ error: 'invalid meal' });
  }
  if (action !== 'add' && action !== 'remove') {
    return res.status(400).json({ error: 'invalid action' });
  }

  try {
    if (action === 'add') {
      await kv.hincrby('favorites', meal, 1);
      await kv.incr('favorites:total');
    } else if (action === 'remove') {
      await kv.hincrby('favorites', meal, -1);
      await kv.decr('favorites:total');
    }

    // Track unique users (approximate, by day)
    const today = new Date().toISOString().slice(0, 10);
    const userKey = req.headers['x-forwarded-for'] || 'unknown';
    await kv.sadd(`users:${today}`, userKey);

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
