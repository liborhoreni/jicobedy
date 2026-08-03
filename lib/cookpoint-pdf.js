import { createHash } from 'crypto';
import Anthropic from '@anthropic-ai/sdk';
import { pragueNow, weekKey } from './date';

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

async function parsePdf(buffer, apiKey) {
  const base64 = Buffer.from(buffer).toString('base64');
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

// Z rozpadu týdne vybere dnešek → { soups, meals, weekly } nebo null.
function pickToday(days, dateOverride) {
  if (!Array.isArray(days)) return null;
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

// Vrátí dnešní menu { soups, meals, weekly } nebo null.
export async function fetchCookpointToday(dateOverride, kv) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  // Poslední úspěšně načtený týden — když teď něco selže, ukážeme radši jeho než nic.
  // Jen pokud je z tohoto týdne; starší záznam by znamenal menu z minulého týdne.
  let cached = null;
  try { cached = await kv.get('cookpoint:week'); } catch {}
  const fallback = () => {
    if (!cached || !Array.isArray(cached.days)) return null;
    if (cached.weekKey !== weekKey(dateOverride)) {
      console.warn('CEITEC: v cache je jen minulý týden, radši nic neukazujeme');
      return null;
    }
    return pickToday(cached.days, dateOverride);
  };

  const url = await findPdfUrl();
  if (!url) {
    console.warn('CEITEC: na cookpoint.cz nenalezeno PDF s menu');
    return fallback();
  }

  const pdfRes = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (jicobedy menu fetcher)' },
  });
  if (!pdfRes.ok) {
    console.warn(`CEITEC: PDF ${url} vrátilo HTTP ${pdfRes.status}`);
    return fallback();
  }
  const buffer = await pdfRes.arrayBuffer();
  if (Buffer.from(buffer).subarray(0, 4).toString('latin1') !== '%PDF') {
    console.warn('CEITEC: odpověď není PDF (nejspíš ochranná stránka)');
    return fallback();
  }

  // Cache podle OBSAHU PDF, ne podle URL — kdyby jídelna přepsala stejný soubor novým
  // týdnem (jako to dělá Jean Paul's), cache na URL by zamrzla na starém menu.
  const hash = createHash('sha256').update(Buffer.from(buffer)).digest('hex');
  if (cached && cached.hash === hash && Array.isArray(cached.days)) {
    return pickToday(cached.days, dateOverride);
  }

  const days = await parsePdf(buffer, apiKey);
  if (!days || !days.length) {
    console.warn('CEITEC: z PDF se nepodařilo přečíst rozpad týdne');
    return fallback();
  }
  try {
    await kv.set('cookpoint:week', { url, hash, weekKey: weekKey(dateOverride), days });
  } catch {}
  return pickToday(days, dateOverride);
}
