import { getRedis } from '../../lib/kv';
import { runScrape } from '../../lib/scrape-runner';
import { pragueNow } from '../../lib/date';

export const config = {
  maxDuration: 60,
};

// Veřejný "doplň chybějící menu" endpoint pro frontend.
// KV zámek zaručí max. jeden scrape za 10 minut bez ohledu na počet klientů.
export default async function handler(req, res) {
  const kv = getRedis();
  if (!kv) {
    return res.status(500).json({ error: 'KV není nakonfigurované' });
  }

  const day = pragueNow().getDay();
  if (day === 0 || day === 6) {
    return res.json({ ok: true, skipped: 'weekend' });
  }

  // Atomický zámek: NX = nastav jen pokud neexistuje, EX = expirace 10 min
  const lock = await kv.set('scrape:lock', '1', { nx: true, ex: 600 });
  if (lock !== 'OK') {
    return res.json({ ok: true, skipped: 'recently-scraped' });
  }

  try {
    const result = await runScrape(null);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
