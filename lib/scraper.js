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

function cleanName(name) {
  return name
    .replace(/\s*[\/\(]\s*[\d,\s a-zA-Z]*[\/\)]\s*$/, '')  // Remove allergens like /1a, 3, 7/ or (1, 3, 7)
    .replace(/\s*A\s+[\d,\s]+\s*$/, '')                     // Remove allergens like A 1, 7, 8, 9
    .replace(/^\s*[MS]\s+/, '')                              // Remove M or S prefix (Cookpoint)
    .trim();
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
      polozka.find('.poradi, em').remove();
      let name = cleanName(polozka.text().trim().replace(/\s+/g, ' '));

      if (isJunk(name)) return;

      if ($li.hasClass('polevka') && isSoupName(name)) {
        menu.soups.push({ name, price });
      } else if (/^Týdenní menu:\s*/i.test(name)) {
        name = name.replace(/^Týdenní menu:\s*/i, '');
        menu.weekly.push({ name, price });
      } else {
        menu.meals.push({ name, price });
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

// --- Cookpoint parser (cookpoint.cz) ---

function parseCookpoint(html) {
  const $ = cheerio.load(html);
  const menu = { soups: [], meals: [], weekly: [] };

  $('table').each((ti, table) => {
    $(table).find('tr').each((ri, tr) => {
      const nameEl = $(tr).find('strong.mname');
      const priceEl = $(tr).find('td.price');
      if (!nameEl.length) return;

      const rawName = nameEl.text().trim();
      const price = priceEl.text().trim().replace(/\u00a0/g, ' ');

      // Extract side dish from <small> tag (after weight, before allergens)
      const smallText = $(tr).find('small').text().trim();
      let sideDish = '';
      if (smallText) {
        sideDish = smallText
          .replace(/\(Alergeny[^)]*\)/gi, '')  // remove allergens
          .replace(/^\d+[,.]?\d*\s*(g|kg|ml|l|ks)\s*,?\s*/i, '')  // remove weight
          .replace(/\s+/g, ' ')
          .trim()
          .replace(/,\s*$/, '');
      }

      const fullName = sideDish ? `${rawName}, ${sideDish}` : rawName;
      const name = cleanName(fullName);
      if (!name || isJunk(name)) return;

      if (ti === 0) {
        // First table = denní menu
        if (ri === 0 && isSoupName(name)) {
          menu.soups.push({ name, price });
        } else {
          menu.meals.push({ name, price });
        }
      } else {
        // Second table = týdenní nabídka
        menu.weekly.push({ name, price });
      }
    });
  });

  menu.soups = dedupe(menu.soups);
  menu.meals = dedupe(menu.meals);
  menu.weekly = dedupe(menu.weekly);

  const hasMenu = menu.soups.length > 0 || menu.meals.length > 0 || menu.weekly.length > 0;
  return {
    id: '4931',
    name: 'Jídelna CEITEC',
    slug: 'cook-point',
    logo: '/logos/cookpoint.jpg',
    sourceUrl: 'https://www.cookpoint.cz/',
    menu: hasMenu ? menu : null,
    closed: !hasMenu,
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

        nameEl.find('.menu-list_item-weight').remove();
        let name = cleanName(nameEl.text().trim().replace(/\s+/g, ' '));
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

// --- QWERTY parser (z HTML, hledá obrázek menu → OCR dělá Claude Vision ve scrape-runner) ---

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

    const res = await fetch(restaurant.url);
    let html;
    if (restaurant.id === 'bistro22' || restaurant.id === '4931') {
      html = await res.text();
    } else {
      const buffer = await res.arrayBuffer();
      const decoder = new TextDecoder('windows-1250');
      html = decoder.decode(buffer);
    }

    if (restaurant.id === '4931') {
      return parseCookpoint(html);
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

module.exports = { scrapeAll, parseQwertyHtml };
