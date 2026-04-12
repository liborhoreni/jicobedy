import { getRedis } from '../../lib/kv';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const kv = getRedis();
  if (!kv) return res.status(200).json({ ok: true });

  const { meal, action } = req.body;
  if (!meal || !action) return res.status(400).json({ error: 'missing meal or action' });

  try {
    if (action === 'add') {
      await kv.hincrby('favorites', meal, 1);
      await kv.incr('favorites:total');
    } else if (action === 'remove') {
      await kv.hincrby('favorites', meal, -1);
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
