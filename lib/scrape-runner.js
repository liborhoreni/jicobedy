import Anthropic from '@anthropic-ai/sdk';
import { getRedis } from './kv';
import { scrapeAll, parseQwertyHtml } from './scraper';
import { classifyVeggie } from './classify-veggie';
import { fetchJeanPaulsWeekly } from './jeanpauls-weekly';
import { hasMenuData } from './menu';
import { pragueNow } from './date';

const MENU_ITEM_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    price: { type: 'string' },
  },
  required: ['name', 'price'],
  additionalProperties: false,
};

const QWERTY_SCHEMA = {
  type: 'object',
  properties: {
    soup: { anyOf: [MENU_ITEM_SCHEMA, { type: 'null' }] },
    meal: { anyOf: [MENU_ITEM_SCHEMA, { type: 'null' }] },
    weekly: { type: 'array', items: MENU_ITEM_SCHEMA },
  },
  required: ['soup', 'meal', 'weekly'],
  additionalProperties: false,
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

  const today = pragueNow(dateOverride);
  const days = ['neděle', 'pondělí', 'úterý', 'středa', 'čtvrtek', 'pátek', 'sobota'];
  const dayName = days[today.getDay()];

  // Send to Claude — structured outputs guarantee valid JSON
  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    output_config: { format: { type: 'json_schema', schema: QWERTY_SCHEMA } },
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
        { type: 'text', text: `Toto je jídelní lístek restaurace QWERTY. Menu má tuto strukturu:
- Pod každým dnem (Pondělí, Úterý, ...) jsou VŽDY DVĚ položky: první je POLÉVKA, druhá je HLAVNÍ JÍDLO
- Pod "Týdenní nabídka" jsou jídla dostupná celý týden
- Pod "Jídelní lístek" jsou stálá jídla — ty IGNORUJ

Vrať menu pro den "${dayName}" a týdenní nabídku.

Pravidla:
- "soup" = PRVNÍ položka pod daným dnem (to je vždy polévka)
- "meal" = DRUHÁ položka pod daným dnem (to je vždy hlavní jídlo)
- "weekly" = POUZE položky ze sekce "Týdenní nabídka" VČETNĚ pizzy (pizza jako jeden řádek se všemi druhy)
- IGNORUJ kompletně sekci "Jídelní lístek" — žádné položky z ní nezahrnuj
- Ceny ve formátu "180 Kč" — u každé položky přiřaď její cenu; pokud cena není uvedená, dej prázdný string
- Názvy BEZ alergenů a BEZ gramáže
- Pokud den "${dayName}" v menu není, vrať null pro soup i meal` },
      ],
    }],
  });

  try {
    const text = response.content.find(b => b.type === 'text')?.text ?? '';
    const json = JSON.parse(text);
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

export async function runScrape(dateOverride) {
  const kv = getRedis();
  if (!kv) {
    throw new Error('KV není nakonfigurované (chybí KV_REST_API_URL / KV_REST_API_TOKEN)');
  }

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

  // Jean Paul's: týdenní menu (pondělí–pátek) z PDF na jpbistro.cz — menicka.cz ho nemá
  try {
    const day = pragueNow(dateOverride).getDay(); // 0=ne … 6=so
    const isWeekday = day >= 1 && day <= 5;
    if (isWeekday) {
      const weekly = await fetchJeanPaulsWeekly();
      if (weekly.length > 0) {
        const idx = data.restaurants.findIndex(r => r.id === '3884');
        if (idx >= 0) {
          const r = data.restaurants[idx];
          const menu = r.menu || { soups: [], meals: [], weekly: [] };
          const existing = new Set((menu.weekly || []).map(w => w.name.toLowerCase().trim()));
          const dailyNames = new Set((menu.meals || []).map(m => m.name.toLowerCase().trim()));
          for (const item of weekly) {
            const key = item.name.toLowerCase().trim();
            if (!existing.has(key) && !dailyNames.has(key)) {
              (menu.weekly = menu.weekly || []).push(item);
              existing.add(key);
            }
          }
          data.restaurants[idx] = { ...r, menu, closed: !hasMenuData({ menu }) };
        }
      }
    }
  } catch (e) {
    console.error("Jean Paul's weekly menu failed:", e.message);
  }

  // Classify vegetarian items via AI (with KV cache)
  try {
    data.restaurants = await classifyVeggie(data.restaurants, kv);
  } catch (e) {
    console.error('Veggie classification failed:', e.message);
  }

  await kv.set('menus', data);

  return {
    date: data.date,
    total: data.restaurants.length,
    withMenu: data.restaurants.filter(hasMenuData).length,
  };
}
