import { getRedis } from '../../lib/kv';

export default async function handler(req, res) {
  const kv = getRedis();
  if (!kv) {
    // KV není nakonfigurované — radši přiznat chybu než servírovat stará/klamavá data
    res.setHeader('Cache-Control', 'no-store');
    return res.status(503).json({ error: 'Menu se nepodařilo načíst.' });
  }
  try {
    const data = await kv.get('menus');
    // Vercel edge cache — šetří KV čtení a zrychluje načtení (jen pro úspěšnou odpověď)
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    res.json(data || { date: null, restaurants: [], scrapedAt: null });
  } catch (err) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(503).json({ error: 'Menu se nepodařilo načíst.' });
  }
}
