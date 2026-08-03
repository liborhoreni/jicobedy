import { runScrape } from '../../lib/scrape-runner';
import { pragueNow } from '../../lib/date';

// V pondělí je scrape studený (týdenní cache prázdné → Apify + Claude na PDF/OCR)
// a 60 s nestačilo — cron 3. 8. 2026 spadl na timeout a lidem zůstalo páteční menu.
export const config = {
  maxDuration: 300,
};

// Plný scrape — volá ho Vercel cron (Authorization: Bearer CRON_SECRET)
// nebo ručně přes ?key=CRON_SECRET (+ volitelně &date=YYYY-MM-DD)
export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const authorized =
      req.headers.authorization === `Bearer ${secret}` ||
      req.query.key === secret;
    if (!authorized) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  try {
    const result = await runScrape(req.query.date || null);

    // Když v pracovní den nemá menu ANI JEDNA restaurace, je rozbitý sběr, ne shoda náhod.
    // Nenulový stav → Vercel označí cron jako selhaný, takže výpadek jde vidět v přehledu
    // místo aby zapadl (3. 8. 2026 se přesně tohle stalo).
    const day = pragueNow(req.query.date || null).getDay();
    const isWeekday = day >= 1 && day <= 5;
    if (isWeekday && result.withMenu === 0) {
      return res.status(500).json({ ok: false, error: 'Žádná restaurace nemá menu', ...result });
    }

    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
