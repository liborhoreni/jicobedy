const cheerio = require('cheerio');
const RESTAURANTS = require('./restaurants');
const { pragueNow, pragueDateString } = require('./date');

// --- Helpers ---

function isJunk(name) {
  const lower = name.toLowerCase();
  return !name
    || lower.includes('nezveřejnil')
    || lower.includes('zavřeno')
    || lower.includes('nebylo zadáno')
    || lower.includes('pro tento den');
}

function normalizeAllergens(s) {
  if (!s) return '';
  return s
    .replace(/\s+/g, ' ')
    .replace(/\s*,\s*/g, ', ')
    .replace(/^[,\s]+|[,\s]+$/g, '')
    .trim();
}

// Vrací { name, allergens } — alergeny se z názvu vytáhnou (číselný seznam jako v ČR), ne zahodí.
function cleanName(name) {
  let allergens = '';

  // /1a, 3, 7/ nebo (1, 3, 7) na konci — bereme jako alergeny jen když uvnitř je číslice.
  // Bez té podmínky se ukrajovala i závorka, která alergeny není: "Salát (vege)" → "Salát".
  name = name.replace(/\s*[\/\(]\s*([\d,\s a-zA-Z]*)\s*[\/\)]\s*$/, (full, inner) => {
    if (!/\d/.test(inner)) return full;
    allergens = inner;
    return '';
  });

  // A 1, 7, 8, 9 na konci — i s písmenem (1a) a překlepem "la" místo "1a" (Jean Paul's)
  if (!allergens) {
    name = name.replace(/\s*\bA\s+((?:\d{1,2}[a-h]?|l[a-h])(?:[\s,]+(?:\d{1,2}[a-h]?|l[a-h]))*)[\s,]*$/, (full, inner) => {
      allergens = inner.replace(/\bl(?=[a-h])/g, '1');
      return '';
    });
  }

  name = name.replace(/^\s*[MS]\s+/, '').trim();  // M/S prefix (Cookpoint)

  return { name, allergens: normalizeAllergens(allergens) };
}

function dedupe(items) {
  const seen = new Set();
  return items.filter(item => {
    const key = item.name.toLowerCase().trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// --- menicka.cz parser ---

function parseMenickaCz(html, restaurant, dateOverride) {
  const $ = cheerio.load(html);
  const today = pragueNow(dateOverride);
  const dayNum = today.getDate();
  const monthNum = today.getMonth() + 1;
  // Hranice před dnem, jinak "1.1." matchne i "11.1." nebo "21.1."
  const dateRe = new RegExp(`(^|\\D)${dayNum}\\.\\s*${monthNum}\\.`);

  let todayMenu = null;

  // New menicka.cz structure: div.menicka > div.nadpis (date) + ul > li.polevka/li.jidlo
  $('div.menicka').each((i, menickaEl) => {
    if (todayMenu) return;
    const nadpis = $(menickaEl).find('div.nadpis').first();
    if (!nadpis.length) return;
    const nadpisText = nadpis.text();
    if (!dateRe.test(nadpisText)) return;

    const menu = { soups: [], meals: [], weekly: [] };

    $(menickaEl).find('li.polevka, li.jidlo').each((j, li) => {
      const $li = $(li);
      const price = $li.find('.cena').text().trim();
      const polozka = $li.find('.polozka').clone();
      // menicka.cz dává každý alergen jako <em title="...">N</em>
      const emAllergens = polozka.find('em')
        .map((k, em) => $(em).text().trim()).get()
        .filter(t => /^\d/.test(t)).join(', ');
      polozka.find('.poradi, em').remove();
      const cleaned = cleanName(polozka.text().trim().replace(/\s+/g, ' '));
      let name = cleaned.name;
      const allergens = normalizeAllergens(emAllergens) || cleaned.allergens;

      if (isJunk(name)) return;

      if ($li.hasClass('polevka') && !isNotSoup(name)) {
        menu.soups.push({ name, price, allergens });
      } else if (/^Týdenní menu:\s*/i.test(name)) {
        name = name.replace(/^Týdenní menu:\s*/i, '');
        menu.weekly.push({ name, price, allergens });
      } else {
        menu.meals.push({ name, price, allergens });
      }
    });

    menu.soups = dedupe(menu.soups);
    menu.meals = dedupe(menu.meals);
    menu.weekly = dedupe(menu.weekly);

    if (menu.soups.length > 0 || menu.meals.length > 0 || menu.weekly.length > 0) {
      todayMenu = menu;
    }
  });

  return {
    id: restaurant.id,
    name: restaurant.name,
    slug: restaurant.slug,
    logo: restaurant.logo,
    sourceUrl: restaurant.url,
    menu: todayMenu,
    closed: !todayMenu,
    scrapedAt: new Date().toISOString(),
  };
}

// --- Bistro 22 parser ---

// Jedna položka jídelníčku Bistra 22 → { name, price, allergens } nebo null.
function parseBistro22Item($, el) {
  const nameEl = el.find('.menu-list_item-name');
  const priceEl = el.find('.menu-list_item-price');

  // Bistro22 dává váhu i alergeny do <small.menu-list_item-weight>; alergeny = "( 1, 7 )"
  let weightAllergens = '';
  nameEl.find('.menu-list_item-weight').each((k, w) => {
    const m = $(w).text().match(/\(\s*([\d,\s]+)\s*\)/);
    if (m) weightAllergens = m[1];
  });
  nameEl.find('.menu-list_item-weight').remove();
  const cleaned = cleanName(nameEl.text().trim().replace(/\s+/g, ' '));
  const name = cleaned.name;
  if (!name || isJunk(name)) return null;

  return {
    name,
    price: priceEl.text().trim(),
    allergens: normalizeAllergens(weightAllergens) || cleaned.allergens,
  };
}

// Položky pod nadpisem `dayEl` až po další nadpis.
function bistro22SectionItems($, dayEl) {
  const items = [];
  let el = $(dayEl).next();
  while (el.length && !el.hasClass('menu-list_day')) {
    if (el.hasClass('menu-list_item')) {
      const item = parseBistro22Item($, el);
      if (item) items.push(item);
    }
    el = el.next();
  }
  return items;
}

function parseBistro22(html, dateOverride) {
  const $ = cheerio.load(html);
  const today = pragueNow(dateOverride);
  const dayNum = today.getDate();
  const monthNum = String(today.getMonth() + 1).padStart(2, '0');
  const yearNum = today.getFullYear();
  const dateStr = `${String(dayNum).padStart(2, '0')}.${monthNum}.${yearNum}`;

  // Nadpisy sekcí mají stejnou třídu jako dny. Ty bez data ("Týdenní nabídka…",
  // "Tortilly:") platí celý týden → jdou do weekly, ne do denního menu.
  const DAY_HEADING = /\d{1,2}\.\d{1,2}\.\d{4}/;

  let todayMenu = null;
  const weekly = [];

  $('div.menu-list_day').each((i, dayEl) => {
    const heading = $(dayEl).text().trim();

    if (!DAY_HEADING.test(heading)) {
      weekly.push(...bistro22SectionItems($, dayEl));
      return;
    }

    if (todayMenu || !heading.includes(dateStr)) return;

    const menu = { soups: [], meals: [], weekly: [] };
    bistro22SectionItems($, dayEl).forEach((item, idx) => {
      // První položka dne bez ceny je polévka (je v ceně menu).
      if (idx === 0 && !item.price) menu.soups.push({ ...item, price: '' });
      else menu.meals.push(item);
    });

    menu.soups = dedupe(menu.soups);
    menu.meals = dedupe(menu.meals);

    if (menu.soups.length > 0 || menu.meals.length > 0) {
      todayMenu = menu;
    }
  });

  if (todayMenu) todayMenu.weekly = dedupe(weekly);

  return {
    id: 'bistro22',
    name: 'Bistro 22',
    slug: 'bistro-22',
    logo: '/logos/bistro22.jpg',
    sourceUrl: 'https://bistro22.cz/',
    menu: todayMenu,
    closed: !todayMenu,
    scrapedAt: new Date().toISOString(),
  };
}

// menicka.cz sama označí řádek jako polévku (li.polevka) — tomu věříme.
// Dřív se navíc vyžadovalo, aby název obsahoval slovo jako "polévka" nebo "vývar",
// jenže tím propadla většina běžných názvů (Kulajda, Dršťková, Rajská, Zelňačka…)
// a skončily mezi hlavními jídly. Tenhle seznam proto jen odchytí případy, kdy
// restaurace do řádku polévky napíše dezert nebo hlavní chod.
function isNotSoup(name) {
  return /buchtičky|buchty|dezert|koláč|zmrzlin|řízek|steak|svíčková|panenka|kachní/i.test(name);
}

// --- Main scrape function ---

async function scrapeOne(restaurant, dateOverride) {
  try {
    if (restaurant.id === 'qwerty') {
      // QWERTY je obrázkové menu — placeholder, OCR přes Claude Vision dělá scrape-runner
      return {
        id: 'qwerty',
        name: 'QWERTY',
        slug: 'qwerty',
        logo: '/logos/qwerty.png',
        sourceUrl: restaurant.url,
        menu: null,
        closed: true,
        scrapedAt: new Date().toISOString(),
      };
    }

    if (restaurant.id === '4931') {
      // Cookpoint/CEITEC má menu v týdenním PDF — placeholder, PDF parsuje scrape-runner
      return {
        id: '4931',
        name: 'Jídelna CEITEC',
        slug: 'cook-point',
        logo: '/logos/cookpoint.jpg',
        sourceUrl: 'https://www.cookpoint.cz/',
        menu: null,
        closed: true,
        scrapedAt: new Date().toISOString(),
      };
    }

    // Timeout, ať zaseknutý web restaurace nepodrží celý scrape až do zabití platformou.
    const res = await fetch(restaurant.url, {
      signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': 'Mozilla/5.0 (jicobedy menu fetcher)' },
    });
    let html;
    if (restaurant.id === 'bistro22') {
      html = await res.text();
    } else {
      // menicka.cz historicky posílala windows-1250, v červenci 2026 přešla na UTF-8.
      // Kódování proto bereme z Content-Type hlavičky, windows-1250 zůstává jen jako fallback.
      const buffer = await res.arrayBuffer();
      const contentType = res.headers.get('content-type') || '';
      const charsetMatch = contentType.match(/charset=([\w-]+)/i);
      const charset = charsetMatch ? charsetMatch[1] : 'windows-1250';
      let decoder;
      try {
        decoder = new TextDecoder(charset);
      } catch {
        decoder = new TextDecoder('windows-1250');
      }
      html = decoder.decode(buffer);
    }

    if (restaurant.id === 'bistro22') {
      return parseBistro22(html, dateOverride);
    }
    return parseMenickaCz(html, restaurant, dateOverride);
  } catch (err) {
    return {
      id: restaurant.id,
      name: restaurant.name,
      slug: restaurant.slug,
      logo: restaurant.logo,
      sourceUrl: restaurant.url,
      menu: null,
      closed: true,
      error: err.message,
      scrapedAt: new Date().toISOString(),
    };
  }
}

async function scrapeAll(dateOverride) {
  const results = await Promise.all(
    RESTAURANTS.map(r => scrapeOne(r, dateOverride))
  );

  return {
    date: pragueDateString(),
    scrapedAt: new Date().toISOString(),
    restaurants: results,
  };
}

module.exports = { scrapeAll };
