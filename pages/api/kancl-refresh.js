import { getRedis } from '../../lib/kv';
import { fetchKanclWeekly, relevantKey } from '../../lib/kancl-fb';

export const config = {
  maxDuration: 60,
};

// Stáhne týdenní menu KANCL Bistra z FB (přes Apify + Claude OCR) a uloží do KV `kancl:week`.
// Apify se volá JEN když nemáme menu pokrývající dnešek → fakticky ~1× týdně (skoro nula nákladů).
// Spouští Mac mini cron před ranním /api/scrape; runScrape pak `kancl:week` mergne do id 8518.
export default async function handler(req, res) {
  // Ochrana proti zneužití: endpoint spouští placený Apify + Claude OCR.
  // Volá ho Mac mini cron s ?key=CRON_SECRET (nebo Authorization: Bearer).
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
    const rk = relevantKey();
    const cached = await kv.get('kancl:week');
    const coversMenu = cached && cached.menu && cached.fromKey <= rk && rk <= cached.toKey;
    const coversVacation = cached && cached.vacation && cached.vacation.fromKey <= rk && rk <= cached.vacation.toKey;
    if (coversMenu) return res.json({ ok: true, skipped: 'have-current-week', range: cached.range });
    if (coversVacation) return res.json({ ok: true, skipped: 'on-vacation', notice: cached.vacation.notice });

    const result = await fetchKanclWeekly();
    if (!result) {
      return res.json({ ok: true, found: false, note: 'Žádný FB příspěvek s menu pokrývající dnešek' });
    }

    await kv.set('kancl:week', result);
    if (result.vacation) {
      return res.json({ ok: true, found: true, vacation: true, notice: result.vacation.notice });
    }
    res.json({ ok: true, found: true, range: result.range, items: result.menu.soups.length + result.menu.meals.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
