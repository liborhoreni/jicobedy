import { kv } from '@vercel/kv';
import { scrapeAll, parseQwertyOcr } from '../../lib/scraper';

export const config = {
  maxDuration: 60,
};

export default async function handler(req, res) {
  // Autorizace pro cron volání
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}` && req.method !== 'POST') {
    // Povolit POST pro manuální refresh z frontendu
    if (req.method !== 'POST') {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  try {
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

    await kv.set('menus', data);
    res.json({ ok: true, date: data.date, count: data.restaurants.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
