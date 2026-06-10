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

    // Stav posledního scrapu — odliší rozbitý parser od zavřené restaurace
    const menus = await kv.get('menus');
    const scrape = {
      scrapedAt: menus?.scrapedAt || null,
      restaurants: (menus?.restaurants || []).map(r => ({
        name: r.name,
        closed: !!r.closed,
        error: r.error || null,
      })),
    };

    res.json({ favorites: sorted, totalFavorites: Number(totalFavorites), usersToday: Number(usersToday), scrape });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
