import { kv } from '@vercel/kv';

export const config = {
  maxDuration: 60,
};

// Tento endpoint se volá manuálně nebo z lokálního cronu
// Přijímá OCR text z QWERTY menu obrázku a ukládá ho do KV
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { ocrText } = req.body;
    if (!ocrText) {
      return res.status(400).json({ error: 'Missing ocrText' });
    }

    await kv.set('qwerty-ocr', ocrText);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
