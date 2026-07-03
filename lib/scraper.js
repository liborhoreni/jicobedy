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

  // /1a, 3, 7/ nebo (1, 3, 7) na konci — bereme jako alergeny jen když uvnitř je číslice
  name = name.replace(/\s*[\/\(]\s*([\d,\s a-zA-Z]*)\s*[\/\)]\s*$/, (full, inner) => {
    if (/\d/.test(inner)) allergens = inner;
    return '';
  });

  // A 1, 7, 8, 9 na konci
  if (!allergens) {
    name = name.replace(/\s*\bA\s+([\d,\s]+)\s*$/, (full, inner) => {
      allergens = inner;
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

      if ($li.hasClass('polevka') && isSoupName(name)) {
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

function parseBistro22(html, dateOverride) {
  const $ = cheerio.load(html);
  const today = pragueNow(dateOverride);
  const dayNum = today.getDate();
  const monthNum = String(today.getMonth() + 1).padStart(2, '0');
  const yearNum = today.getFullYear();
  const dateStr = `${String(dayNum).padStart(2, '0')}.${monthNum}.${yearNum}`;

  let todayMenu = null;

  const dayDivs = $('div.menu-list_day');
  dayDivs.each((i, dayEl) => {
    if (todayMenu) return;
    const dayText = $(dayEl).text().trim();
    if (!dayText.includes(dateStr)) return;

    const menu = { soups: [], meals: [] };
    let isFirstItem = true;

    let el = $(dayEl).next();
    while (el.length && !el.hasClass('menu-list_day')) {
      if (el.hasClass('menu-list_item')) {
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
        const allergens = normalizeAllergens(weightAllergens) || cleaned.allergens;
        const price = priceEl.text().trim();

        if (name && !isJunk(name)) {
          if (isFirstItem && !price) {
            menu.soups.push({ name, price: '', allergens });
          } else {
            menu.meals.push({ name, price, allergens });
          }
          isFirstItem = false;
        }
      }
      el = el.next();
    }

    menu.soups = dedupe(menu.soups);
    menu.meals = dedupe(menu.meals);

    if (menu.soups.length > 0 || menu.meals.length > 0) {
      todayMenu = menu;
    }
  });

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

function isSoupName(name) {
  const lower = name.toLowerCase();
  if (/buchtičky|buchty|knedlíčky|dezert|koláč|zmrzlin|játra|řízek|steak|kuře|svíčková|panenka|kachní steh|kachní prsa/.test(lower)) return false;
  return /polévka|polévk|vývar|bouillon|minestrone|gazpacho|krém|česnečka|česneková|čočková|gulášov|bramboračka/.test(lower);
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
      const buffer = await res.arrayBuffer();
      const decoder = new TextDecoder('windows-1250');
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
