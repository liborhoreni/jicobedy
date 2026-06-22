import Anthropic from '@anthropic-ai/sdk';
import { pragueNow } from './date';

// KANCL Bistro publikuje TÝDENNÍ menu jen jako fotku na svém FB ("MENU dd/m - dd/m").
// menicka.cz má stejná jídla, ale BEZ alergenů. Tady přes Apify (Facebook Posts Scraper)
// stáhneme nejnovější příspěvek s menu pokrývající dnešek, fotku přečteme Claude Vision OCR
// a vrátíme strukturované menu vč. alergenů. Výsledek cachuje /api/kancl-refresh do KV
// (`kancl:week`), runScrape ho pak mergne do restaurace id 8518.

const KANCL_PAGE = 'https://www.facebook.com/p/KANCL-bistro-100089043302243/';
const ACTOR = 'apify~facebook-posts-scraper';

const MENU_ITEM = {
  type: 'object',
  properties: { name: { type: 'string' }, price: { type: 'string' }, allergens: { type: 'string' } },
  required: ['name', 'price', 'allergens'],
  additionalProperties: false,
};
const MENU_SCHEMA = {
  type: 'object',
  properties: { soups: { type: 'array', items: MENU_ITEM }, meals: { type: 'array', items: MENU_ITEM } },
  required: ['soups', 'meals'],
  additionalProperties: false,
};

// "MENU 22/6 - 26/6 ✨" / "m e n u 1 / 6 - 5 / 6" → { fromKey:622, toKey:626 } (key = měsíc*100+den)
export function parseRange(text) {
  const s = (text || '').replace(/\s+/g, '');
  const m = s.match(/(\d{1,2})\/(\d{1,2})-(\d{1,2})\/(\d{1,2})/);
  if (!m) return null;
  const fromKey = (+m[2]) * 100 + (+m[1]);
  const toKey = (+m[4]) * 100 + (+m[3]);
  return { range: `${+m[1]}/${+m[2]} - ${+m[3]}/${+m[4]}`, fromKey, toKey };
}

export function todayKey(dateOverride) {
  const t = pragueNow(dateOverride);
  return (t.getMonth() + 1) * 100 + t.getDate();
}

// Den, pro který chceme menu: dnešek (po–pá); o víkendu nejbližší pondělí.
// KANCL postuje nové týdenní menu v so/ne, ale rozsah v postu je po–pá (víkend nezahrnuje),
// takže o víkendu musíme cílit na pondělí, ne na dnešek.
export function relevantKey(dateOverride) {
  const t = pragueNow(dateOverride);
  const dow = t.getDay(); // 0=ne … 6=so
  const d = new Date(t);
  if (dow === 6) d.setDate(t.getDate() + 2);      // sobota → pondělí
  else if (dow === 0) d.setDate(t.getDate() + 1); // neděle → pondělí
  return (d.getMonth() + 1) * 100 + d.getDate();
}

// Spustí Apify actor (async run + poll) a vrátí pole příspěvků.
async function runApify(token, resultsLimit = 5) {
  const input = { captionText: false, resultsLimit, startUrls: [{ url: KANCL_PAGE }] };
  let res = await fetch(`https://api.apify.com/v2/acts/${ACTOR}/runs?token=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const body = await res.json();
  if (!body.data) throw new Error('Apify run nešlo spustit: ' + JSON.stringify(body).slice(0, 200));
  const { id: runId, defaultDatasetId: dsId } = body.data;

  let status = body.data.status;
  for (let i = 0; i < 18 && status !== 'SUCCEEDED' && status !== 'FAILED' && status !== 'ABORTED'; i++) {
    await new Promise(r => setTimeout(r, 2500));
    const r = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${token}`);
    status = (await r.json()).data.status;
  }
  if (status !== 'SUCCEEDED') throw new Error('Apify run skončil stavem ' + status);

  const items = await (await fetch(`https://api.apify.com/v2/datasets/${dsId}/items?token=${token}&clean=true`)).json();
  return Array.isArray(items) ? items : [];
}

async function ocrMenu(imgUrl, apiKey) {
  const imgRes = await fetch(imgUrl);
  if (!imgRes.ok) return null;
  const base64 = Buffer.from(await imgRes.arrayBuffer()).toString('base64');
  const mediaType = imgUrl.includes('.png') ? 'image/png' : 'image/jpeg';

  const client = new Anthropic({ apiKey });
  const resp = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2048,
    output_config: { format: { type: 'json_schema', schema: MENU_SCHEMA } },
    messages: [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
      { type: 'text', text: `Toto je týdenní menu restaurace KANCL Bistro. Přepiš jídla.
- "soups" = polévky (vývar, krém)
- "meals" = hlavní jídla + focaccia + případný PÁTEČNÍ SPECIÁL (k jeho názvu přidej na konec " (pátek)")
- "name" = název jídla BEZ alergenů a BEZ ceny
- "price" = cena ve formátu "189,-" (přesně jak v obrázku)
- "allergens" = čísla alergenů z čísel v závorce za jídlem, čárkou oddělená, např. "1, 3, 7" (jen čísla, bez závorek). Pozor na malá čísla — pečlivě rozliš 3 a 2. Když u jídla alergeny nejsou, prázdný string.` },
    ]}],
  });
  const text = resp.content.find(b => b.type === 'text')?.text ?? '';
  try {
    const json = JSON.parse(text);
    const norm = (arr) => (arr || []).filter(i => i && i.name).map(i => ({
      name: String(i.name).trim(), price: (i.price || '').trim(), allergens: (i.allergens || '').trim(),
    }));
    return { soups: norm(json.soups), meals: norm(json.meals), weekly: [] };
  } catch {
    return null;
  }
}

// Hlavní funkce: vrátí { range, fromKey, toKey, menu, scrapedAt } pro týden pokrývající dnešek,
// nebo null když nic vhodného nenajde / chybí klíče.
export async function fetchKanclWeekly(dateOverride) {
  const token = process.env.APIFY_TOKEN;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!token || !apiKey) return null;

  const rk = relevantKey(dateOverride);
  const posts = await runApify(token);

  // najdi příspěvek, jehož rozsah pokrývá relevantní den (dnešek, o víkendu pondělí);
  // při shodě ber nejnovější
  let best = null;
  for (const p of posts) {
    const r = parseRange(p.text);
    if (!r || rk < r.fromKey || rk > r.toKey) continue;
    if (!best || new Date(p.time) > new Date(best.post.time)) best = { post: p, r };
  }
  if (!best) return null;

  const imgUrl = best.post.media?.[0]?.photo_image?.uri || best.post.media?.[0]?.thumbnail;
  if (!imgUrl) return null;

  const menu = await ocrMenu(imgUrl, apiKey);
  if (!menu || (menu.soups.length === 0 && menu.meals.length === 0)) return null;

  return { range: best.r.range, fromKey: best.r.fromKey, toKey: best.r.toKey, menu, scrapedAt: new Date().toISOString() };
}
