import { runScrape } from '../../lib/scrape-runner';

export const config = {
  maxDuration: 60,
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
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
