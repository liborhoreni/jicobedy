import { getRedis } from './kv';
import { scrapeAll } from './scraper';
import { classifyVeggie } from './classify-veggie';
import { fetchJeanPaulsWeekly } from './jeanpauls-weekly';
import { fetchCookpointToday } from './cookpoint-pdf';
import { hasMenuData } from './menu';
import { pragueNow, todayKey, covers } from './date';

export async function runScrape(dateOverride) {
  const kv = getRedis();
  if (!kv) {
    throw new Error('KV není nakonfigurované (chybí KV_REST_API_URL / KV_REST_API_TOKEN)');
  }

  const data = await scrapeAll(dateOverride);

  // Čtyři doplňky níž na sobě nezávisí (každý sahá na jinou restauraci), ale dřív běžely
  // za sebou — studený pondělní běh, kdy jsou všechny týdenní cache prázdné, tak přetekl
  // 60s limit a lidem zůstalo páteční menu. Pouštíme je proto souběžně.
  await Promise.all([
    mergeQwerty(kv, data, dateOverride),
    mergeJeanPauls(kv, data, dateOverride),
    mergeCookpoint(kv, data, dateOverride),
    mergeKancl(kv, data, dateOverride),
  ]);

  // Classify vegetarian items via AI (with KV cache)
  try {
    data.restaurants = await classifyVeggie(data.restaurants, kv);
  } catch (e) {
    console.error('Veggie classification failed:', e.message);
  }

  await kv.set('menus', data);

  // Stav sběru do KV + do logu. Tiché selhání (3. 8. 2026) se dřív tvářilo jako úspěch,
  // protože v KV prostě zůstala stará data a nikde nebyla stopa, že se něco nepovedlo.
  // `notice` = restaurace sama hlásí dovolenou, to není chyba sběru.
  const problems = data.restaurants.filter(r => !hasMenuData(r) && !r.notice).map(r => r.name);
  if (problems.length) console.error('Sběr skončil bez menu u:', problems.join(', '));
  try {
    await kv.set('scrape:health', {
      date: data.date,
      scrapedAt: data.scrapedAt,
      problems,
      ok: problems.length === 0,
    });
  } catch {}

  return {
    date: data.date,
    total: data.restaurants.length,
    withMenu: data.restaurants.filter(hasMenuData).length,
    problems,
  };
}

async function mergeQwerty(kv, data, dateOverride) {
  // QWERTY: týdenní menu z FB (Apify + OCR) tahá do KV `qwerty:week` výhradně /api/qwerty-refresh
  // (cron: 3× pondělí ráno, 2× úterý — pak už se Apify tento týden nevolá). Tady se cache jen ČTE.
  // Dřívější self-healing (dotáhnout z FB, když cache nepokrývá dnešek) volal Apify z každého
  // frontendového auto-refresh běhu (à 10 min) — když restaurace menu nepostla, spaloval kredity
  // celý den. Když menu v cache není, prostě se nezobrazí.
  try {
    const tk = todayKey(dateOverride);
    const coversMenu = (k) => !!(k && k.menu && covers(k, tk));
    const qwerty = await kv.get('qwerty:week');
    if (coversMenu(qwerty)) {
      const idx = data.restaurants.findIndex(r => r.id === 'qwerty');
      if (idx >= 0) {
        data.restaurants[idx] = { ...data.restaurants[idx], menu: qwerty.menu, closed: !hasMenuData({ menu: qwerty.menu }) };
      }
    }
  } catch (e) {
    console.error('QWERTY FB merge failed:', e.message);
  }
}

async function mergeJeanPauls(kv, data, dateOverride) {
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
}

async function mergeCookpoint(kv, data, dateOverride) {
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
}

async function mergeKancl(kv, data, dateOverride) {
  // KANCL Bistro: týdenní menu z FB (Apify + OCR) tahá do KV `kancl:week` výhradně
  // /api/kancl-refresh (cron: 3× pondělí ráno, 2× úterý). Tady se cache jen ČTE — stejně jako
  // u QWERTY žádný self-healing přes Apify (viz mergeQwerty). menicka u Kanclu nemá alergeny →
  // když máme FB menu pokrývající dnešek, nahradíme jím menicka data. FB příspěvek může taky
  // oznamovat dovolenou (datum v obrázku) → pak místo menu ukážeme hlášku do kdy mají zavřeno.
  try {
    const tk = todayKey(dateOverride);
    const coversMenu = (k) => !!(k && k.menu && covers(k, tk));
    const coversVacation = (k) => !!(k && k.vacation && covers(k.vacation, tk));
    const kancl = await kv.get('kancl:week');
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
}
