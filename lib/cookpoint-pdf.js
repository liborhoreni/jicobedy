import Anthropic from '@anthropic-ai/sdk';
import { pragueNow } from './date';

// Cookpoint / Jídelna CEITEC (id 4931) přešel (2026-06) na web v Oxygen Builderu —
// denní menu už NENÍ v HTML, ale v týdenním PDF ("Týdenní menu ke stažení").
// PDF má rozpad po dnech (Po–Pá) vč. alergenů v /.../. Tady ho najdeme, přes Claude
// vytáhneme celý týden (cache v KV podle URL, mění se ~1× týdně) a vrátíme dnešní den.

const DAY_NAMES = ['neděle', 'pondělí', 'úterý', 'středa', 'čtvrtek', 'pátek', 'sobota'];

const ITEM = {
  type: 'object',
  properties: { name: { type: 'string' }, price: { type: 'string' }, allergens: { type: 'string' } },
  required: ['name', 'price', 'allergens'],
  additionalProperties: false,
};
const SCHEMA = {
  type: 'object',
  properties: {
    days: {
      type: 'array',
      items: {
        type: 'object',
        properties: { day: { type: 'string' }, soups: { type: 'array', items: ITEM }, meals: { type: 'array', items: ITEM } },
        required: ['day', 'soups', 'meals'],
        additionalProperties: false,
      },
    },
  },
  required: ['days'],
  additionalProperties: false,
};

async function findPdfUrl() {
  const res = await fetch('https://www.cookpoint.cz/');
  if (!res.ok) return null;
  const html = await res.text();
  // odkaz "Týdenní menu ke stažení" → .pdf ve wp-content/uploads (NE alergeny .jpg)
  const m = html.match(/href="(https:\/\/www\.cookpoint\.cz\/wp-content\/uploads\/[^"]+\.pdf)"/i);
  return m ? m[1] : null;
}

async function parsePdf(url, apiKey) {
  const buf = await (await fetch(url)).arrayBuffer();
  const base64 = Buffer.from(buf).toString('base64');
  const client = new Anthropic({ apiKey });
  const resp = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    output_config: { format: { type: 'json_schema', schema: SCHEMA } },
    messages: [{ role: 'user', content: [
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
      { type: 'text', text: `Týdenní menu jídelny CEITEC, rozpad po dnech (Pondělí–Pátek). Pro KAŽDÝ den vrať:
- "day" = název dne (Pondělí, Úterý, Středa, Čtvrtek, Pátek)
- "soups" = polévka (první řádek dne, je zdarma → bez ceny)
- "meals" = hlavní jídla (včetně "Mac and cheese" a salátu)
- "name" = název jídla BEZ alergenů a BEZ ceny
- "price" = cena ve formátu "175,-" (u polévky prázdný string)
- "allergens" = čísla z /.../ za jídlem, čárkou oddělená "1a, 3, 7" (jen obsah závorky, bez lomítek). Když chybí, prázdný string.` },
    ]}],
  });
  const text = resp.content.find(b => b.type === 'text')?.text ?? '';
  try {
    const days = JSON.parse(text).days;
    return Array.isArray(days) ? days : null;
  } catch {
    return null;
  }
}

// Vrátí dnešní menu { soups, meals, weekly } nebo null.
export async function fetchCookpointToday(dateOverride, kv) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const url = await findPdfUrl();
  if (!url) return null;

  // cache podle URL — PDF se mění ~1× týdně, ať nevoláme Claude při každém scrapu
  let days = null;
  try {
    const cached = await kv.get('cookpoint:week');
    if (cached && cached.url === url && Array.isArray(cached.days)) days = cached.days;
  } catch {}
  if (!days) {
    days = await parsePdf(url, apiKey);
    if (days && days.length) { try { await kv.set('cookpoint:week', { url, days }); } catch {} }
  }
  if (!days) return null;

  const dayName = DAY_NAMES[pragueNow(dateOverride).getDay()];
  const d = days.find(x => (x.day || '').toLowerCase().trim() === dayName);
  if (!d) return null;

  const clean = (arr) => (arr || []).filter(i => i && i.name).map(i => ({
    name: String(i.name).trim(), price: (i.price || '').trim(), allergens: (i.allergens || '').trim(),
  }));
  const menu = { soups: clean(d.soups), meals: clean(d.meals), weekly: [] };
  if (menu.soups.length === 0 && menu.meals.length === 0) return null;
  return menu;
}
