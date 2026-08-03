import { getRedis } from '../../lib/kv';
import { pragueDayId } from '../../lib/date';

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
      // Odebrání může počítadlo stlačit pod nulu (odebrání bez předchozího přidání,
      // např. po vymazání localStorage) — dorovnáme zpátky na nulu, ať součty sedí.
      const left = await kv.hincrby('favorites', meal, -1);
      if (left < 0) await kv.hset('favorites', { [meal]: 0 });
      const total = await kv.decr('favorites:total');
      if (total < 0) await kv.set('favorites:total', 0);
    }

    // Track unique users (approximate, by day). Denní sada se sama smaže po 40 dnech —
    // bez expirace přibývá jeden klíč denně a nikdy nezmizí.
    const today = pragueDayId();
    const userKey = req.headers['x-forwarded-for'] || 'unknown';
    await kv.sadd(`users:${today}`, userKey);
    await kv.expire(`users:${today}`, 60 * 60 * 24 * 40);

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
