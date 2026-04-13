import { getRedis } from '../../lib/kv';
import { scrapeAll, parseQwertyHtml, parseQwertyOcr } from '../../lib/scraper';
import { classifyVeggie } from '../../lib/classify-veggie';
import Anthropic from '@anthropic-ai/sdk';

export const config = {
  maxDuration: 60,
};

async function ocrQwertyImage() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  // Fetch QWERTY page and find menu image
  const pageRes = await fetch('https://qwerty-restaurant--catering3.webnode.cz/menu/');
  const html = await pageRes.text();
  const imageUrl = parseQwertyHtml(html);
  if (!imageUrl) return null;

  // Download image and convert to base64
  const imgRes = await fetch(imageUrl);
  const imgBuffer = await imgRes.arrayBuffer();
  const base64 = Buffer.from(imgBuffer).toString('base64');
  const mediaType = imageUrl.includes('.png') ? 'image/png' : 'image/jpeg';

  // Send to Claude for OCR
  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 4096,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
        { type: 'text', text: 'Přečti VEŠKERÝ text z tohoto obrázku jídelního lístku. Zachovej strukturu: dny v týdnu, názvy jídel, ceny. Vypiš přesně jak je na obrázku, každou položku na nový řádek. Žádný komentář, jen text z obrázku.' },
      ],
    }],
  });

  return response.content[0].text;
}

function hasMenuData(r) {
  return r.menu && (
    (r.menu.soups && r.menu.soups.length > 0) ||
    (r.menu.meals && r.menu.meals.length > 0) ||
    (r.menu.weekly && r.menu.weekly.length > 0)
  );
}

export default async function handler(req, res) {
  try {
    const kv = getRedis();

    // For cron calls: check if all restaurants already have menus today
    const isCron = req.headers['x-vercel-cron'];
    if (isCron) {
      const cached = await kv.get('menus').catch(() => null);
      if (cached && cached.restaurants) {
        const today = new Date().toISOString().slice(0, 10);
        const cachedToday = cached.scrapedAt && cached.scrapedAt.slice(0, 10) === today;
        const allHaveMenu = cached.restaurants.every(hasMenuData);
        if (cachedToday && allHaveMenu) {
          return res.json({ ok: true, skipped: true, reason: 'all restaurants have menus' });
        }
      }
    }

    const data = await scrapeAll();

    // QWERTY OCR: automaticky přes Claude Vision, fallback na uložený text
    let qwertyOcr = null;
    try {
      qwertyOcr = await ocrQwertyImage();
      if (qwertyOcr) await kv.set('qwerty-ocr', qwertyOcr);
    } catch (e) {
      console.error('QWERTY OCR failed:', e.message);
    }
    if (!qwertyOcr) {
      qwertyOcr = await kv.get('qwerty-ocr').catch(() => null);
    }

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

    const withMenu = data.restaurants.filter(hasMenuData).length;
    res.json({ ok: true, date: data.date, total: data.restaurants.length, withMenu });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
