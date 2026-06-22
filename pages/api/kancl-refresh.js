import { getRedis } from '../../lib/kv';
import { fetchKanclWeekly, todayKey } from '../../lib/kancl-fb';

export const config = {
  maxDuration: 60,
};

// Stáhne týdenní menu KANCL Bistra z FB (přes Apify + Claude OCR) a uloží do KV `kancl:week`.
// Apify se volá JEN když nemáme menu pokrývající dnešek → fakticky ~1× týdně (skoro nula nákladů).
// Spouští Mac mini cron před ranním /api/scrape; runScrape pak `kancl:week` mergne do id 8518.
export default async function handler(req, res) {
  const kv = getRedis();
  if (!kv) return res.status(500).json({ error: 'KV není nakonfigurované' });

  try {
    const tk = todayKey();
    const cached = await kv.get('kancl:week');
    if (cached && cached.fromKey <= tk && tk <= cached.toKey) {
      return res.json({ ok: true, skipped: 'have-current-week', range: cached.range });
    }

    const result = await fetchKanclWeekly();
    if (!result) {
      return res.json({ ok: true, found: false, note: 'Žádný FB příspěvek s menu pokrývající dnešek' });
    }

    await kv.set('kancl:week', result);
    res.json({ ok: true, found: true, range: result.range, items: result.menu.soups.length + result.menu.meals.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
