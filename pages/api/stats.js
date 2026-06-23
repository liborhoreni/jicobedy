import { getRedis } from '../../lib/kv';

const ALLERGEN_LABELS = {
  1: 'Lepek (obiloviny)', 2: 'Korýši', 3: 'Vejce', 4: 'Ryby', 5: 'Arašídy',
  6: 'Sója', 7: 'Mléko a laktóza', 8: 'Ořechy', 9: 'Celer', 10: 'Hořčice',
  11: 'Sezam', 12: 'Oxid siřičitý', 13: 'Vlčí bob (lupina)', 14: 'Měkkýši',
};

export default async function handler(req, res) {
  const kv = getRedis();
  if (!kv) return res.json({ favorites: {}, totalFavorites: 0, usersToday: 0, filters: { allergens: [], meat: 0 } });

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

    // Neveřejné měření filtrů: kolik zakliknutí který alergen / maso
    const filterAllergensRaw = await kv.hgetall('filter:allergens') || {};
    const filterAllergens = Object.entries(filterAllergensRaw)
      .map(([num, count]) => ({
        num: Number(num),
        label: ALLERGEN_LABELS[Number(num)] || `#${num}`,
        count: Number(count),
      }))
      .filter(f => f.count > 0)
      .sort((a, b) => b.count - a.count);
    const filterMeat = Number(await kv.get('filter:meat')) || 0;

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

    res.json({
      favorites: sorted,
      totalFavorites: Number(totalFavorites),
      usersToday: Number(usersToday),
      filters: { allergens: filterAllergens, meat: filterMeat },
      scrape,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
