import { getRedis } from '../../lib/kv';

// Neveřejné měření: kolik lidí si vyřadí který alergen / maso.
// Počítáme jen ZAPNUTÍ filtru (zakliknutí), ne vypnutí.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const kv = getRedis();
  if (!kv) return res.status(200).json({ ok: true });

  const { type, value } = req.body || {};

  try {
    if (type === 'allergen') {
      const num = parseInt(value, 10);
      if (isNaN(num) || num < 1 || num > 14) return res.status(400).json({ error: 'bad value' });
      await kv.hincrby('filter:allergens', String(num), 1);
    } else if (type === 'meat') {
      await kv.incr('filter:meat');
    } else {
      return res.status(400).json({ error: 'bad type' });
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
