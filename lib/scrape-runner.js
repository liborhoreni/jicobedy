import { getRedis } from './kv';
import { scrapeAll } from './scraper';
import { classifyVeggie } from './classify-veggie';
import { fetchJeanPaulsWeekly } from './jeanpauls-weekly';
import { fetchCookpointToday } from './cookpoint-pdf';
import { todayKey } from './kancl-fb';
import { fetchQwertyMenu } from './qwerty-fb';
import { hasMenuData } from './menu';
import { pragueNow } from './date';

export async function runScrape(dateOverride) {
  const kv = getRedis();
  if (!kv) {
    throw new Error('KV není nakonfigurované (chybí KV_REST_API_URL / KV_REST_API_TOKEN)');
  }

  const data = await scrapeAll(dateOverride);

  // QWERTY: denní menu z FB (Apify + OCR), cache v KV `qwerty:day`. Webnode web s obrázkem
  // menu byl zrušen (HTTP 410), proto bereme menu z FB stránky. Self-healing: když pro dnešek
  // cache nemáme, dotáhneme z FB rovnou tady (Apify ~1× za pracovní den — druhý scrape už cache najde).
  // /api/qwerty-refresh dělá totéž a hodí se na ruční warm-up/test.
  try {
    const tk = todayKey(dateOverride);
    let qwerty = await kv.get('qwerty:day');
    if (!(qwerty && qwerty.menu && qwerty.dateKey === tk)) {
      const fresh = await fetchQwertyMenu(dateOverride);
      if (fresh) {
        qwerty = { dateKey: tk, menu: fresh.menu, scrapedAt: fresh.scrapedAt };
        await kv.set('qwerty:day', qwerty);
      }
    }
    if (qwerty && qwerty.menu && qwerty.dateKey === tk) {
      const idx = data.restaurants.findIndex(r => r.id === 'qwerty');
      if (idx >= 0) {
        data.restaurants[idx] = { ...data.restaurants[idx], menu: qwerty.menu, closed: !hasMenuData({ menu: qwerty.menu }) };
      }
    }
  } catch (e) {
    console.error('QWERTY FB merge failed:', e.message);
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

  // Cookpoint / Jídelna CEITEC: web přešel na týdenní PDF (Oxygen Builder), denní menu už není
  // v HTML. PDF najdeme, přes Claude vytáhneme týden (cache v KV `cookpoint:week`) a vezmeme dnešek.
  try {
    const cp = await fetchCookpointToday(dateOverride, kv);
    if (cp) {
      const idx = data.restaurants.findIndex(r => r.id === '4931');
      if (idx >= 0) {
        data.restaurants[idx] = { ...data.restaurants[idx], menu: cp, closed: !hasMenuData({ menu: cp }) };
      }
    }
  } catch (e) {
    console.error('Cookpoint PDF failed:', e.message);
  }

  // KANCL Bistro: týdenní menu z FB (Apify + OCR), nacachované /api/kancl-refresh v KV `kancl:week`.
  // menicka u Kanclu nemá alergeny → když máme FB menu pokrývající dnešek, nahradíme jím menicka data.
  try {
    const kancl = await kv.get('kancl:week');
    const tk = todayKey(dateOverride);
    if (kancl && kancl.menu && kancl.fromKey <= tk && tk <= kancl.toKey) {
      const idx = data.restaurants.findIndex(r => r.id === '8518');
      if (idx >= 0) {
        const isFri = pragueNow(dateOverride).getDay() === 5;
        const drop = (arr) => (arr || []).filter(i => isFri || !/\(pátek\)/i.test(i.name));
        const menu = { soups: drop(kancl.menu.soups), meals: drop(kancl.menu.meals), weekly: [] };
        data.restaurants[idx] = { ...data.restaurants[idx], menu, closed: !hasMenuData({ menu }) };
      }
    }
  } catch (e) {
    console.error('Kancl FB merge failed:', e.message);
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
