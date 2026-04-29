import { getRedis } from '../../lib/kv';
import { scrapeAll, parseQwertyHtml } from '../../lib/scraper';
import { classifyVeggie } from '../../lib/classify-veggie';
import Anthropic from '@anthropic-ai/sdk';

export const config = {
  maxDuration: 60,
};

async function ocrQwertyMenu(dateOverride) {
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

  const today = dateOverride ? new Date(dateOverride) : new Date();
  const days = ['neděle', 'pondělí', 'úterý', 'středa', 'čtvrtek', 'pátek', 'sobota'];
  const dayName = days[today.getDay()];

  // Send to Claude — get structured JSON directly
  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
        { type: 'text', text: `Toto je jídelní lístek restaurace QWERTY. Menu má tuto strukturu:
- Pod každým dnem (Pondělí, Úterý, ...) jsou VŽDY DVĚ položky: první je POLÉVKA, druhá je HLAVNÍ JÍDLO
- Pod "Týdenní nabídka" jsou jídla dostupná celý týden
- Pod "Jídelní lístek" jsou stálá jídla — ty IGNORUJ

Vrať JSON s menu pro den "${dayName}" a týdenní nabídku.

Formát (POUZE JSON, žádný jiný text):
{
  "soup": {"name": "název polévky", "price": "cena Kč"},
  "meal": {"name": "název hlavního jídla", "price": "cena Kč"},
  "weekly": [{"name": "název", "price": "cena Kč"}, ...]
}

Pravidla:
- "soup" = PRVNÍ položka pod daným dnem (to je vždy polévka)
- "meal" = DRUHÁ položka pod daným dnem (to je vždy hlavní jídlo)
- "weekly" = POUZE položky ze sekce "Týdenní nabídka" VČETNĚ pizzy (pizza jako jeden řádek se všemi druhy)
- IGNORUJ kompletně sekci "Jídelní lístek" — žádné položky z ní nezahrnuj
- Ceny ve formátu "180 Kč" — u každé položky přiřaď její cenu
- Názvy BEZ alergenů a BEZ gramáže
- Pokud den "${dayName}" v menu není, vrať null pro soup i meal` },
      ],
    }],
  });

  try {
    const text = response.content[0].text.trim();
    const json = JSON.parse(text.replace(/```json\n?/g, '').replace(/```/g, ''));
    const menu = { soups: [], meals: [], weekly: [] };

    const cleanPrice = (p) => {
      if (!p) return '';
      if (/neuveden|není|nelze|^[-–—?]/i.test(p)) return '';
      return p;
    };

    if (json.soup && json.soup.name) {
      menu.soups.push({ name: json.soup.name, price: cleanPrice(json.soup.price) });
    }
    if (json.meal && json.meal.name) {
      menu.meals.push({ name: json.meal.name, price: cleanPrice(json.meal.price) });
    }
    if (Array.isArray(json.weekly)) {
      for (const item of json.weekly) {
        if (item.name) menu.weekly.push({ name: item.name, price: cleanPrice(item.price) });
      }
    }

    return menu;
  } catch {
    return null;
  }
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
    const dateOverride = req.query.date || null;

    const data = await scrapeAll(dateOverride);

    // QWERTY: OCR přes Claude Vision → strukturovaný JSON
    try {
      const qwertyMenu = await ocrQwertyMenu(dateOverride);
      if (qwertyMenu) {
        const qwertyIndex = data.restaurants.findIndex(r => r.id === 'qwerty');
        if (qwertyIndex >= 0) {
          const hasMenu = qwertyMenu.soups.length > 0 || qwertyMenu.meals.length > 0 || qwertyMenu.weekly.length > 0;
          data.restaurants[qwertyIndex] = {
            ...data.restaurants[qwertyIndex],
            menu: hasMenu ? qwertyMenu : null,
            closed: !hasMenu,
          };
        }
      }
    } catch (e) {
      console.error('QWERTY OCR failed:', e.message);
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
