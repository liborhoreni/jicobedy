import Anthropic from '@anthropic-ai/sdk';

// Týdenní menu Jean Paul's (pobočka Běhounská) NENÍ na menicka.cz — žije jen
// v týdenním PDF "obědového menu" na jpbistro.cz. Tento modul ho najde,
// stáhne a přes Claude vytáhne řádek "Týdenní menu pondělí–pátek".
//
// Denní menu Jean Paul's na jicobédy pochází z menicka.cz (id 3884 = Běhounská),
// takže týdenní položku z této PDF přidáváme ke stejné pobočce → konzistentní.

const BEHOUNSKA_URL = 'https://www.jpbistro.cz/behounska/';

const WEEKLY_SCHEMA = {
  type: 'object',
  properties: {
    found: { type: 'boolean' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          price: { type: 'string' },
          allergens: { type: 'string' },
        },
        required: ['name', 'price', 'allergens'],
        additionalProperties: false,
      },
    },
  },
  required: ['found', 'items'],
  additionalProperties: false,
};

// Najde URL obědového/týdenního menu PDF (NE jídelní lístek / vinnou kartu).
async function findWeeklyPdfUrl() {
  const res = await fetch(BEHOUNSKA_URL, {
    headers: { 'User-Agent': 'Mozilla/5.0 (jicobedy menu fetcher)' },
  });
  const html = await res.text();
  const urls = [...html.matchAll(/href="([^"]+\.pdf)"/gi)].map(m => m[1]);
  if (!urls.length) return null;

  // Vyřaď jídelní lístek / vinnou kartu — chceme PDF s denním+týdenním menu.
  const menuPdf = urls.find(u => !/listek|listk|vinn|karta/i.test(u));
  return menuPdf || urls[0];
}

// Vrátí pole { name, price } pro týdenní menu, nebo [] když nic nenajde.
export async function fetchJeanPaulsWeekly(kv) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return [];

  const pdfUrl = await findWeeklyPdfUrl();
  if (!pdfUrl) return [];

  // cache podle URL PDF — týdenní menu se mění ~1× týdně, ať nevoláme Claude při každém scrapu
  if (kv) {
    try {
      const cached = await kv.get('jeanpauls:week');
      if (cached && cached.url === pdfUrl && Array.isArray(cached.items)) return cached.items;
    } catch {}
  }

  const pdfRes = await fetch(pdfUrl);
  if (!pdfRes.ok) return [];
  const buffer = await pdfRes.arrayBuffer();
  const base64 = Buffer.from(buffer).toString('base64');

  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    output_config: { format: { type: 'json_schema', schema: WEEKLY_SCHEMA } },
    messages: [{
      role: 'user',
      content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
        { type: 'text', text: `Toto je obědové menu restaurace Jean Paul's.

Na konci sekce s denními menu je samostatná sekce nadepsaná "Týdenní menu pondělí–pátek" — jedno (nebo více) jídel dostupných celý týden.

Vrať POUZE položky z této sekce "Týdenní menu pondělí–pátek".

Pravidla:
- "found" = true pokud sekce Týdenní menu existuje, jinak false a prázdné "items"
- "name" = název jídla VČETNĚ přílohy/popisu, ale BEZ alergenů (nezahrnuj "A 1,3,7,8" apod.) a BEZ gramáže
- "price" = cena ve formátu "185 Kč"; pokud chybí, prázdný string
- "allergens" = čísla alergenů u daného jídla jako čárkou oddělený seznam, např. "1, 3, 7" (jen čísla, bez písmene "A" a bez slova "alergeny"). Pokud u jídla žádné alergeny uvedené nejsou, vrať prázdný string ""
- IGNORUJ denní menu (Pondělí/Úterý/…), à la carte, nápoje, dezerty — chci JEN sekci "Týdenní menu pondělí–pátek"` },
      ],
    }],
  });

  let items = [];
  try {
    const text = response.content.find(b => b.type === 'text')?.text ?? '';
    const json = JSON.parse(text);
    if (json.found && Array.isArray(json.items)) {
      items = json.items
        .filter(it => it && it.name)
        .map(it => ({
          name: String(it.name).trim(),
          price: (it.price || '').trim(),
          allergens: (it.allergens || '').trim(),
        }));
    }
  } catch {
    return [];
  }

  // ulož nacachovaný týden (jen když se něco našlo, ať prázdek nezablokuje pozdější pokus)
  if (kv && items.length) {
    try { await kv.set('jeanpauls:week', { url: pdfUrl, items }); } catch {}
  }
  return items;
}
