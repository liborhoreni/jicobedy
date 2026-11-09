import { createHash } from 'crypto';
import Anthropic from '@anthropic-ai/sdk';
import * as cheerio from 'cheerio';
import { pragueNow, weekKey, rangeKeys, todayKey, dayKey, covers } from './date';

// Cookpoint / Jídelna CEITEC (id 4931), web v Oxygen Builderu. Menu je na dvou místech:
// 1) "Denní nabídka" přímo v HTML (tabulka .hpbox) — bez data. Jídelna ji po obědě
//    přepíše na menu DALŠÍHO dne (9. 11. 2026: v 11:55 dnešní, v 16:41 už zítřejší).
// 2) Týdenní PDF ("Týdenní menu ke stažení") — občas se zpozdí a visí tam minulý týden.
// Primárně bereme denní nabídku, PDF (přes Claude, cache v KV) jen jako zálohu.

const DAY_NAMES = ['neděle', 'pondělí', 'úterý', 'středa', 'čtvrtek', 'pátek', 'sobota'];

const ITEM = {
  type: 'object',
  properties: { name: { type: 'string' }, price: { type: 'string' }, allergens: { type: 'string' } },
  required: ['name', 'price', 'allergens'],
  additionalProperties: false,
};
// Rozsah týdne z hlavičky PDF ("02.11 – 06.11.2026"). 0 = v PDF datum není.
const RANGE = {
  type: 'object',
  properties: {
    fromDay: { type: 'integer' }, fromMonth: { type: 'integer' },
    toDay: { type: 'integer' }, toMonth: { type: 'integer' },
  },
  required: ['fromDay', 'fromMonth', 'toDay', 'toMonth'],
  additionalProperties: false,
};
const SCHEMA = {
  type: 'object',
  properties: {
    range: RANGE,
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
  required: ['range', 'days'],
  additionalProperties: false,
};

function findPdfUrl(html) {
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
      { type: 'text', text: `Týdenní menu jídelny CEITEC, rozpad po dnech (Pondělí–Pátek).
"range" = platnost týdne z hlavičky (např. "02.11 – 06.11.2026" → fromDay 2, fromMonth 11, toDay 6, toMonth 11). Když v PDF datum není, vrať všude 0.
Pro KAŽDÝ den vrať:
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
    const parsed = JSON.parse(text);
    return Array.isArray(parsed.days) ? parsed : null;
  } catch {
    return null;
  }
}

// Platí uložený týden pro dnešek? Jídelna nové PDF občas nenahraje včas a na webu
// zůstane minulý týden (9. 11. 2026 ukazovalo pondělí 2. 11.) — proto rozhoduje
// datum z PDF, ne to, kdy jsme ho načetli. Bez data v PDF zbývá týden načtení.
function isCurrent(entry, dateOverride) {
  const r = entry && entry.range;
  if (r && r.fromDay && r.fromMonth && r.toDay && r.toMonth) {
    return covers(rangeKeys(r, dateOverride), todayKey(dateOverride));
  }
  return entry && entry.weekKey === weekKey(dateOverride);
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

// Denní nabídka z HTML → { soups, meals, weekly } nebo null.
// Řádek: <strong class="mname">Název</strong><small><strong>150g, </strong> příloha (Alergeny 3,6,12)</small>
function parseDailyHtml(html) {
  const $ = cheerio.load(html);
  const menu = { soups: [], meals: [], weekly: [] };
  $('#denni-menu .hpbox tr').each((i, tr) => {
    const name = $(tr).find('.mname').text().trim().replace(/\s+/g, ' ');
    if (!name) return;
    const small = $(tr).find('small').clone();
    const portion = small.find('strong').text().trim().replace(/,\s*$/, '');
    small.find('strong').remove();
    let rest = small.text().replace(/\s+/g, ' ').trim();
    let allergens = '';
    rest = rest.replace(/\(\s*Alergeny\s*([^)]*)\)/i, (full, inner) => {
      allergens = inner.split(',').map(a => a.trim()).filter(Boolean).join(', ');
      return '';
    }).trim().replace(/^,\s*|,\s*$/g, '');
    // "Zapečené brambory" + "s brokolicí…" → mezerou; "Kuřecí Teriyaki" + "rýže…" → čárkou
    const sep = /^(s|se|a|na|v|ve|z|ze|do|po|pod|na)\s/i.test(rest) ? ' ' : ', ';
    const item = { name: rest ? `${name}${sep}${rest}` : name, price: $(tr).find('.price').text().replace(/\s+/g, ' ').trim(), allergens };
    // polévka má porci v litrech ("0,25l")
    if (/^\d+([,.]\d+)?\s*l$/i.test(portion) || /polévk/i.test(name)) menu.soups.push(item);
    else menu.meals.push(item);
  });
  return menu.soups.length || menu.meals.length ? menu : null;
}

// Pevné státní svátky (MM-DD), kdy jídelna nevaří; Velikonoce jsou pohyblivé a chybí.
const HOLIDAYS = ['01-01', '05-01', '05-08', '07-05', '07-06', '09-28', '10-28', '11-17', '12-24', '12-25', '12-26'];
function isWorkday(d) {
  const md = `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return d.getDay() >= 1 && d.getDay() <= 5 && !HOLIDAYS.includes(md);
}

// Den oběda (dayKey), ke kterému patří menu poprvé spatřené v čase `now`:
// do 14:00 (konec výdeje) v pracovní den je to dnešek, potom nejbližší další pracovní den.
function lunchDayFor(now) {
  const d = new Date(now);
  if (!(isWorkday(d) && d.getHours() < 14)) {
    do { d.setDate(d.getDate() + 1); } while (!isWorkday(d));
  }
  return dayKey(d);
}

// Denní nabídka platná pro dnešek, nebo null. Pamatujeme si poslední čtyři různé nabídky
// a den oběda, kdy jsme je poprvé viděli — díky tomu odpoledne (kdy už web ukazuje
// zítřek) dál ukážeme dnešní a nabídku, která na webu visí z minula, neukážeme vůbec.
async function dailyFromHtml(html, dateOverride, kv) {
  const menu = parseDailyHtml(html);
  let seen = [];
  try { seen = (await kv.get('cookpoint:daily')) || []; } catch {}
  if (!Array.isArray(seen)) seen = [];
  if (menu) {
    const hash = createHash('sha256').update(JSON.stringify(menu)).digest('hex');
    if (!seen.some(e => e.hash === hash)) {
      seen = [{ hash, lunchDay: lunchDayFor(pragueNow(dateOverride)), menu }, ...seen].slice(0, 4);
      // Testovací běh s ?date= by dnešní nabídku uložil pod smyšlený den a skutečný běh
      // by ji pak už nepřiřadil — ukládáme proto jen při běhu bez přepsaného data.
      if (!dateOverride) {
        try { await kv.set('cookpoint:daily', seen); } catch {}
      }
    }
  }
  const today = todayKey(dateOverride);
  const hit = seen.find(e => e.lunchDay === today);
  return hit ? hit.menu : null;
}

// Vrátí dnešní menu { soups, meals, weekly } nebo null.
export async function fetchCookpointToday(dateOverride, kv) {
  const homeRes = await fetch('https://www.cookpoint.cz/', {
    headers: { 'User-Agent': 'Mozilla/5.0 (jicobedy menu fetcher)' },
  });
  const html = homeRes.ok ? await homeRes.text() : '';

  const daily = await dailyFromHtml(html, dateOverride, kv);
  if (daily) return daily;
  return fetchFromPdf(html, dateOverride, kv);
}

// Záloha: dnešek z týdenního PDF, nebo null.
async function fetchFromPdf(html, dateOverride, kv) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  // Poslední úspěšně načtený týden — když teď něco selže, ukážeme radši jeho než nic.
  // Jen pokud je z tohoto týdne; starší záznam by znamenal menu z minulého týdne.
  let cached = null;
  try { cached = await kv.get('cookpoint:week'); } catch {}
  const fallback = () => {
    if (!cached || !Array.isArray(cached.days)) return null;
    if (!isCurrent(cached, dateOverride)) {
      console.warn('CEITEC: v cache je jen minulý týden, radši nic neukazujeme');
      return null;
    }
    return pickToday(cached.days, dateOverride);
  };

  const url = findPdfUrl(html);
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
  // Záznamy bez `range` (starší formát) načteme znovu, ať víme, pro jaký týden PDF platí.
  let entry = cached && cached.hash === hash && Array.isArray(cached.days) && cached.range ? cached : null;
  if (!entry) {
    const parsed = await parsePdf(buffer, apiKey);
    if (!parsed || !parsed.days.length) {
      console.warn('CEITEC: z PDF se nepodařilo přečíst rozpad týdne');
      return fallback();
    }
    entry = { url, hash, weekKey: weekKey(dateOverride), range: parsed.range, days: parsed.days };
    try { await kv.set('cookpoint:week', entry); } catch {}
  }
  if (!isCurrent(entry, dateOverride)) {
    console.warn('CEITEC: PDF na webu je pro jiný týden (staré, nebo už příští)');
    return fallback();
  }
  return pickToday(entry.days, dateOverride);
}
