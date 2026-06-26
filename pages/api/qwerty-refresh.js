import { getRedis } from '../../lib/kv';
import { fetchQwertyMenu } from '../../lib/qwerty-fb';
import { todayKey } from '../../lib/kancl-fb';

export const config = {
  maxDuration: 60,
};

// Stáhne dnešní menu QWERTY z FB (přes Apify + Claude OCR) a uloží do KV `qwerty:day`.
// Apify se volá jen když pro dnešek menu ještě nemáme → fakticky ~1× za pracovní den.
// Spouští Mac mini cron PŘED ranním /api/scrape; runScrape pak `qwerty:day` mergne do id 'qwerty'.
export default async function handler(req, res) {
  const kv = getRedis();
  if (!kv) return res.status(500).json({ error: 'KV není nakonfigurované' });

  try {
    const dk = todayKey();
    const cached = await kv.get('qwerty:day');
    if (cached && cached.dateKey === dk && cached.menu) {
      return res.json({ ok: true, skipped: 'have-today' });
    }

    const result = await fetchQwertyMenu();
    if (!result) {
      return res.json({ ok: true, found: false, note: 'Žádný FB příspěvek s dnešním menu' });
    }

    await kv.set('qwerty:day', { dateKey: dk, menu: result.menu, scrapedAt: result.scrapedAt });
    res.json({
      ok: true,
      found: true,
      items: result.menu.soups.length + result.menu.meals.length + result.menu.weekly.length,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
