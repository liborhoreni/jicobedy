import { getRedis } from '../../lib/kv';

export default async function handler(req, res) {
  const kv = getRedis();
  if (!kv) return res.json({ favorites: {}, totalFavorites: 0, usersToday: 0 });

  try {
    const favorites = await kv.hgetall('favorites') || {};
    const totalFavorites = (await kv.get('favorites:total')) || 0;

    const today = new Date().toISOString().slice(0, 10);
    const usersToday = await kv.scard(`users:${today}`) || 0;

    // Sort favorites by count descending
    const sorted = Object.entries(favorites)
      .map(([meal, count]) => ({ meal, count: Number(count) }))
      .filter(f => f.count > 0)
      .sort((a, b) => b.count - a.count);

    res.json({ favorites: sorted, totalFavorites: Number(totalFavorites), usersToday: Number(usersToday) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
