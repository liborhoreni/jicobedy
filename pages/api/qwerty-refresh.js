import { getRedis } from '../../lib/kv';
import { fetchQwertyMenu } from '../../lib/qwerty-fb';
import { todayKey } from '../../lib/kancl-fb';

export const config = {
  maxDuration: 60,
};

// Stáhne týdenní menu QWERTY z FB (přes Apify + Claude OCR) a uloží do KV `qwerty:week`.
// Apify se volá jen když cache nepokrývá dnešek → fakticky ~1× za týden.
// Spouští Mac mini cron PŘED ranním /api/scrape; runScrape pak `qwerty:week` mergne do id 'qwerty'.
export default async function handler(req, res) {
  // Ochrana proti zneužití: endpoint spouští placený Apify + Claude OCR.
  // Chráněno stejně jako /api/scrape (?key=CRON_SECRET nebo Authorization: Bearer).
  // Dokud CRON_SECRET není nastavené, chová se jako dřív (otevřené).
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const authorized =
      req.headers.authorization === `Bearer ${secret}` ||
      req.query.key === secret;
    if (!authorized) return res.status(401).json({ error: 'Unauthorized' });
  }

  const kv = getRedis();
  if (!kv) return res.status(500).json({ error: 'KV není nakonfigurované' });

  try {
    const dk = todayKey();
    const cached = await kv.get('qwerty:week');
    if (cached && cached.menu && cached.fromKey <= dk && dk <= cached.toKey) {
      return res.json({ ok: true, skipped: 'have-week' });
    }

    const result = await fetchQwertyMenu();
    if (!result) {
      return res.json({ ok: true, found: false, note: 'Žádný FB příspěvek s dnešním menu' });
    }

    await kv.set('qwerty:week', { fromKey: result.fromKey, toKey: result.toKey, menu: result.menu, scrapedAt: result.scrapedAt });
    res.json({
      ok: true,
      found: true,
      items: result.menu.soups.length + result.menu.meals.length + result.menu.weekly.length,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
