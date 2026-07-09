import Anthropic from '@anthropic-ai/sdk';
import { pragueNow } from './date';
import { todayKey } from './kancl-fb';
import { runApify } from './apify';

// QWERTY publikoval menu jako obrázek na Webnode webu, ten ale byl zrušen (HTTP 410).
// Menu teď bereme z jejich FB stránky: přes Apify (Facebook Posts Scraper) stáhneme
// poslední příspěvky, najdeme nejnovější s fotkou menu, fotku přečteme Claude Vision OCR
// a vrátíme strukturované menu vč. alergenů a rozsahu dnů (fromKey/toKey). QWERTY postuje
// menu na celý týden jedním obrázkem, proto ho cachujeme týdně v KV `qwerty:week`
// (jako KANCL) — Apify se pak volá ~1×/týden. runScrape ho mergne do restaurace id 'qwerty'.

const QWERTY_PAGE = 'https://www.facebook.com/QwertyRestaurant/';
const ACTOR = 'apify~facebook-posts-scraper';

const MENU_ITEM = {
  type: 'object',
  properties: { name: { type: 'string' }, price: { type: 'string' }, allergens: { type: 'string' } },
  required: ['name', 'price', 'allergens'],
  additionalProperties: false,
};
// dateRange = datum/rozsah napsaný na obrázku ("Menu 22.6.–26.6.2026"). Slouží k ověření,
// že menu platí pro dnešek — QWERTY postuje nový týdenní obrázek v pondělí, takže bez kontroly
// data by se v novém týdnu (než stihnou postnout) zobrazilo staré menu z minulého týdne.
const DATE_RANGE = {
  type: 'object',
  properties: {
    found: { type: 'boolean' },
    fromDay: { type: 'integer' }, fromMonth: { type: 'integer' },
    toDay: { type: 'integer' }, toMonth: { type: 'integer' },
  },
  required: ['found', 'fromDay', 'fromMonth', 'toDay', 'toMonth'],
  additionalProperties: false,
};
const MENU_SCHEMA = {
  type: 'object',
  properties: {
    isMenu: { type: 'boolean' },
    dateRange: DATE_RANGE,
    soups: { type: 'array', items: MENU_ITEM },
    meals: { type: 'array', items: MENU_ITEM },
    weekly: { type: 'array', items: MENU_ITEM },
  },
  required: ['isMenu', 'dateRange', 'soups', 'meals', 'weekly'],
  additionalProperties: false,
};

const DAYS = ['neděle', 'pondělí', 'úterý', 'středa', 'čtvrtek', 'pátek', 'sobota'];

// Pošle fotku (+ text postu) Claude Vision a vytáhne dnešní menu. Vrací null, když to není menu.
async function extractMenu({ imgUrl, postText, dayName, apiKey }) {
  const content = [];
  if (imgUrl) {
    const imgRes = await fetch(imgUrl);
    if (!imgRes.ok) return null;
    const base64 = Buffer.from(await imgRes.arrayBuffer()).toString('base64');
    const mediaType = imgUrl.includes('.png') ? 'image/png' : 'image/jpeg';
    content.push({ type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } });
  }
  content.push({ type: 'text', text: `Toto je příspěvek z Facebooku restaurace QWERTY${postText ? ` (text příspěvku: "${postText.slice(0, 500)}")` : ''}. Vytáhni denní menu pro den "${dayName}".

- Obrázek může obsahovat jen dnešní menu, nebo celý týden — najdi sekci pro "${dayName}".
- "isMenu" = true jen když obrázek/text reálně obsahuje jídelní menu pro "${dayName}"; jinak false.
- "dateRange" = datum nebo rozsah dat napsaný na obrázku (např. hlavička "Menu 22.6.–26.6.2026" nebo "Týden 22.–26.6."). Když najdeš rozsah, vyplň fromDay/fromMonth (první den) a toDay/toMonth (poslední den) a found=true. Když je tam jen JEDNO datum (denní menu), dej stejné hodnoty do from i to. Když na obrázku ŽÁDNÉ datum není, found=false a čísla 0.
- "soups" = polévky pro "${dayName}"
- "meals" = hlavní jídla pro "${dayName}"
- "weekly" = jídla ze sekce "Týdenní nabídka" (pokud v příspěvku je), jinak prázdné pole
- IGNORUJ stálý jídelní lístek (stálá jídla dostupná pořád)
- "name" = název jídla BEZ alergenů a BEZ gramáže
- "price" = cena ve formátu "180 Kč"; pokud cena není uvedená, prázdný string
- "allergens" = čísla alergenů čárkou oddělená, např. "1, 3, 7" (jen čísla, bez písmene "A" a slova "alergeny"); pokud nejsou, prázdný string
- Pokud příspěvek NENÍ jídelní menu nebo den "${dayName}" v něm není, vrať isMenu=false a prázdná pole.` });

  const client = new Anthropic({ apiKey });
  const resp = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    output_config: { format: { type: 'json_schema', schema: MENU_SCHEMA } },
    messages: [{ role: 'user', content }],
  });

  const text = resp.content.find(b => b.type === 'text')?.text ?? '';
  try {
    const json = JSON.parse(text);
    if (!json.isMenu) return null;
    const cleanPrice = (p) => (!p || /neuveden|není|nelze|^[-–—?]/i.test(p)) ? '' : p.trim();
    const norm = (arr) => (arr || []).filter(i => i && i.name).map(i => ({
      name: String(i.name).trim(), price: cleanPrice(i.price), allergens: (i.allergens || '').trim(),
    }));
    return { dateRange: json.dateRange, soups: norm(json.soups), meals: norm(json.meals), weekly: norm(json.weekly) };
  } catch {
    return null;
  }
}

// Hlavní funkce: najde nejnovější FB příspěvek s dnešním menu a vrátí { menu, scrapedAt } nebo null.
export async function fetchQwertyMenu(dateOverride) {
  const token = process.env.APIFY_TOKEN;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!token || !apiKey) return null;

  const dayName = DAYS[pragueNow(dateOverride).getDay()];
  const tk = todayKey(dateOverride); // měsíc*100+den
  const posts = await runApify(token, { actor: ACTOR, startUrl: QWERTY_PAGE, resultsLimit: 3 });

  // nejnovější napřed; OCR zkusíme jen na příspěvcích s fotkou (max 4), dokud nenajdeme menu
  const withPhoto = posts
    .map(p => ({ p, imgUrl: p.media?.[0]?.photo_image?.uri || p.media?.[0]?.thumbnail || null }))
    .filter(x => x.imgUrl)
    .sort((a, b) => new Date(b.p.time) - new Date(a.p.time))
    .slice(0, 4);

  for (const { p, imgUrl } of withPhoto) {
    const menu = await extractMenu({ imgUrl, postText: p.text, dayName, apiKey });
    // přeskoč promo/nemenu příspěvky (např. fotka jídla bez jídelníčku)
    if (!menu || !(menu.soups.length || menu.meals.length || menu.weekly.length)) continue;

    // První skutečné menu (příspěvky jsou od nejnovějšího) je rozhodující. Ověř, že datum
    // napsané na obrázku pokrývá dnešek — QWERTY postuje nové týdenní menu až v pondělí, takže
    // bez téhle kontroly OCR vytáhne den ze starého obrázku z minulého týdne. Když datum nepokrývá
    // dnešek (nebo na obrázku není), menu nezobrazíme — starší příspěvky mají jen ještě starší
    // data, nemá smysl je číst. Frontend pak ukáže „restaurace zatím nezveřejnila menu".
    const dr = menu.dateRange;
    if (dr && dr.found) {
      const fromKey = dr.fromMonth * 100 + dr.fromDay;
      const toKey = dr.toMonth * 100 + dr.toDay;
      if (tk >= fromKey && tk <= toKey) {
        const { dateRange, ...menuData } = menu;
        return { menu: menuData, fromKey, toKey, scrapedAt: new Date().toISOString() };
      }
    }
    return null;
  }
  return null;
}

export { todayKey };
