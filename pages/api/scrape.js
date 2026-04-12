import { getRedis } from '../../lib/kv';
import { scrapeAll, parseQwertyOcr } from '../../lib/scraper';
import { classifyVeggie } from '../../lib/classify-veggie';

export const config = {
  maxDuration: 60,
};

export default async function handler(req, res) {
  try {
    const kv = getRedis();
    const data = await scrapeAll();

    // QWERTY OCR: zkus načíst uložený OCR text
    const qwertyOcr = await kv.get('qwerty-ocr').catch(() => null);
    if (qwertyOcr) {
      const qwertyIndex = data.restaurants.findIndex(r => r.id === 'qwerty');
      if (qwertyIndex >= 0) {
        const menu = parseQwertyOcr(qwertyOcr);
        const hasMenu = menu.soups.length > 0 || menu.meals.length > 0 || menu.weekly.length > 0;
        data.restaurants[qwertyIndex] = {
          ...data.restaurants[qwertyIndex],
          menu: hasMenu ? menu : null,
          closed: !hasMenu,
        };
      }
    }

    // Classify vegetarian items via AI
    try {
      data.restaurants = await classifyVeggie(data.restaurants);
    } catch (e) {
      console.error('Veggie classification failed:', e.message);
    }

    await kv.set('menus', data);
    res.json({ ok: true, date: data.date, count: data.restaurants.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
