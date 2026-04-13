const cheerio = require('cheerio');
const RESTAURANTS = require('./restaurants');

// --- Helpers ---

function isJunk(name) {
  const lower = name.toLowerCase();
  return !name
    || lower.includes('nezveřejnil')
    || lower.includes('zavřeno')
    || lower.includes('nebylo zadáno')
    || lower.includes('pro tento den');
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

function parseMenickaCz(html, restaurant) {
  const $ = cheerio.load(html);
  const today = new Date();
  const dayNum = today.getDate();
  const monthNum = today.getMonth() + 1;
  const dateStr = `${dayNum}.${monthNum}.`;

  let todayMenu = null;

  // New menicka.cz structure: div.menicka > div.nadpis (date) + ul > li.polevka/li.jidlo
  $('div.menicka').each((i, menickaEl) => {
    if (todayMenu) return;
    const nadpis = $(menickaEl).find('div.nadpis').first();
    if (!nadpis.length) return;
    const nadpisText = nadpis.text();
    if (!nadpisText.includes(dateStr)) return;

    const menu = { soups: [], meals: [] };

    $(menickaEl).find('li.polevka, li.jidlo').each((j, li) => {
      const $li = $(li);
      const price = $li.find('.cena').text().trim();
      const polozka = $li.find('.polozka').clone();
      polozka.find('.poradi').remove();
      const name = polozka.text().trim().replace(/\s+/g, ' ');

      if (isJunk(name)) return;

      if ($li.hasClass('polevka')) {
        menu.soups.push({ name, price });
      } else {
        menu.meals.push({ name, price });
      }
    });

    menu.soups = dedupe(menu.soups);
    menu.meals = dedupe(menu.meals);

    if (menu.soups.length > 0 || menu.meals.length > 0) {
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

function parseBistro22(html) {
  const $ = cheerio.load(html);
  const today = new Date();
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

        nameEl.find('.menu-list_item-weight').remove();
        let name = nameEl.text().trim().replace(/\s+/g, ' ');
        const price = priceEl.text().trim();

        if (name && !isJunk(name)) {
          if (isFirstItem && !price) {
            menu.soups.push({ name, price: '' });
          } else {
            menu.meals.push({ name, price });
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

// --- QWERTY parser (z HTML, hledá obrázek → OCR se dělá externě) ---

function parseQwertyHtml(html) {
  const $ = cheerio.load(html);

  let menuImageUrl = null;
  $('img').each((i, img) => {
    const src = $(img).attr('src') || $(img).attr('data-src') || '';
    if (src && !src.includes('Vizitka') && src.includes('cbaul-cdnwnd.com')) {
      menuImageUrl = src;
    }
  });

  return menuImageUrl;
}

function isSoupName(name) {
  const lower = name.toLowerCase();
  return /krém|polévka|polévk|vývar|bouillon|minestrone|gazpacho/.test(lower);
}

function parseQwertyOcr(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  const today = new Date();
  const daysMap = {
    'pondeli': 1, 'pondělí': 1, 'pondéli': 1,
    'utery': 2, 'úterý': 2,
    'streda': 3, 'středa': 3,
    'ctvrtek': 4, 'čtvrtek': 4,
    'patek': 5, 'pátek': 5,
  };
  const todayDow = today.getDay();

  let section = null;
  let currentDow = null;

  const dailySoup = [];
  const dailyMeal = [];
  const weeklyItems = [];

  const prices = [];
  for (const line of lines) {
    const priceMatch = line.match(/^(\d{2,3})\s*(?:kč|Kč|KC)?\s*$/i);
    if (priceMatch) prices.push(priceMatch[1] + ' Kč');
  }

  for (const line of lines) {
    const lower = line.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const lowerOrig = line.toLowerCase();

    if (/^\d{2,3}\s*(?:kč|Kč|KC)?$/i.test(line)) continue;
    if (/^[\d,\s\.]+$/.test(line)) continue;
    if (line.length < 4) continue;
    if (lowerOrig.includes('menu 1') || lowerOrig.includes('qwerty') || lowerOrig.includes('owerty')) continue;

    if (lowerOrig.includes('jídelní lístek') || lowerOrig.includes('jidelni listek')) {
      section = 'menu';
      continue;
    }
    if (lowerOrig.includes('týdenní') || lowerOrig.includes('tydenni')) {
      section = 'weekly';
      continue;
    }

    let foundDay = false;
    for (const [dayName, dow] of Object.entries(daysMap)) {
      if (lower.includes(dayName.normalize('NFD').replace(/[\u0300-\u036f]/g, ''))) {
        section = 'day';
        currentDow = dow;
        foundDay = true;
        break;
      }
    }
    if (foundDay) continue;

    if (section === 'menu') continue;

    let name = line.trim();

    if (section === 'day' && currentDow === todayDow) {
      if (dailySoup.length === 0) {
        dailySoup.push({ name, price: '' });
      } else if (dailyMeal.length === 0) {
        dailyMeal.push({ name, price: '180 Kč' });
      }
    } else if (section === 'weekly') {
      if (isSoupName(name)) {
        dailySoup.push({ name, price: '20 Kč' });
      } else {
        weeklyItems.push({ name, price: '' });
      }
    }
  }

  const weeklyPrices = prices.slice(5);
  weeklyItems.forEach((item, i) => {
    if (weeklyPrices[i]) item.price = weeklyPrices[i];
  });

  return {
    soups: dedupe(dailySoup),
    meals: dedupe(dailyMeal),
    weekly: dedupe(weeklyItems),
  };
}

// --- Main scrape function ---

async function scrapeAll() {
  const results = [];

  for (const restaurant of RESTAURANTS) {
    try {
      if (restaurant.id === 'qwerty') {
        // QWERTY se scrapuje přes speciální API route (OCR)
        // Tady jen vrátíme placeholder, OCR se dělá v /api/scrape-qwerty
        results.push({
          id: 'qwerty',
          name: 'QWERTY',
          slug: 'qwerty',
          logo: '/logos/qwerty.png',
          sourceUrl: restaurant.url,
          menu: null,
          closed: true,
          scrapedAt: new Date().toISOString(),
        });
        continue;
      }

      const res = await fetch(restaurant.url);
      let html;
      if (restaurant.id === 'bistro22') {
        html = await res.text();
      } else {
        const buffer = await res.arrayBuffer();
        const decoder = new TextDecoder('windows-1250');
        html = decoder.decode(buffer);
      }

      let data;
      if (restaurant.id === 'bistro22') {
        data = parseBistro22(html);
      } else {
        data = parseMenickaCz(html, restaurant);
      }

      results.push(data);
    } catch (err) {
      results.push({
        id: restaurant.id,
        name: restaurant.name,
        slug: restaurant.slug,
        logo: restaurant.logo,
        sourceUrl: restaurant.url,
        menu: null,
        closed: true,
        error: err.message,
        scrapedAt: new Date().toISOString(),
      });
    }
  }

  return {
    date: new Date().toLocaleDateString('cs-CZ'),
    scrapedAt: new Date().toISOString(),
    restaurants: results,
  };
}

module.exports = { scrapeAll, parseQwertyHtml, parseQwertyOcr };
