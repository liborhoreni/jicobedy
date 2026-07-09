import { getRedis } from './kv';
import { scrapeAll } from './scraper';
import { classifyVeggie } from './classify-veggie';
import { fetchJeanPaulsWeekly } from './jeanpauls-weekly';
import { fetchCookpointToday } from './cookpoint-pdf';
import { todayKey, fetchKanclWeekly } from './kancl-fb';
import { fetchQwertyMenu } from './qwerty-fb';
import { hasMenuData } from './menu';
import { pragueNow } from './date';

export async function runScrape(dateOverride) {
  const kv = getRedis();
  if (!kv) {
    throw new Error('KV není nakonfigurované (chybí KV_REST_API_URL / KV_REST_API_TOKEN)');
  }

  const data = await scrapeAll(dateOverride);

  // QWERTY: týdenní menu z FB (Apify + OCR), cache v KV `qwerty:week`. Webnode web s obrázkem
  // menu byl zrušen (HTTP 410), proto bereme menu z FB stránky. QWERTY postuje menu na celý
  // týden jedním obrázkem, proto cachujeme týdně (jako KANCL): dokud cache pokrývá dnešek,
  // na FB nesaháme. Self-healing: když cache nepokrývá dnešek, dotáhneme z FB (Apify ~1×/týden).
  // /api/qwerty-refresh dělá totéž a hodí se na ruční warm-up/test.
  try {
    const tk = todayKey(dateOverride);
    const coversMenu = (k) => k && k.menu && k.fromKey <= tk && tk <= k.toKey;
    let qwerty = await kv.get('qwerty:week');
    if (!coversMenu(qwerty)) {
      const fresh = await fetchQwertyMenu(dateOverride);
      if (fresh) {
        qwerty = { fromKey: fresh.fromKey, toKey: fresh.toKey, menu: fresh.menu, scrapedAt: fresh.scrapedAt };
        await kv.set('qwerty:week', qwerty);
      }
    }
    if (coversMenu(qwerty)) {
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
      const weekly = await fetchJeanPaulsWeekly(kv);
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

  // KANCL Bistro: týdenní menu z FB (Apify + OCR), nacachované v KV `kancl:week`. menicka u Kanclu
  // nemá alergeny → když máme FB menu pokrývající dnešek, nahradíme jím menicka data. FB příspěvek
  // může taky oznamovat dovolenou (datum v obrázku) → pak místo menu ukážeme hlášku do kdy mají zavřeno.
  // Self-healing jako QWERTY: když cache nepokrývá dnešek, dotáhneme z FB rovnou tady (Apify ~1×/týden).
  try {
    const tk = todayKey(dateOverride);
    const coversMenu = (k) => k && k.menu && k.fromKey <= tk && tk <= k.toKey;
    const coversVacation = (k) => k && k.vacation && k.vacation.fromKey <= tk && tk <= k.vacation.toKey;
    let kancl = await kv.get('kancl:week');
    if (!coversMenu(kancl) && !coversVacation(kancl)) {
      const fresh = await fetchKanclWeekly(dateOverride);
      if (fresh) {
        kancl = fresh;
        await kv.set('kancl:week', fresh);
      }
    }
    const idx = data.restaurants.findIndex(r => r.id === '8518');
    if (idx >= 0) {
      if (coversVacation(kancl)) {
        const menu = { soups: [], meals: [], weekly: [] };
        data.restaurants[idx] = { ...data.restaurants[idx], menu, closed: true, notice: kancl.vacation.notice };
      } else if (coversMenu(kancl)) {
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
