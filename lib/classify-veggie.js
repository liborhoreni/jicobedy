const Anthropic = require('@anthropic-ai/sdk');

// KV hash s trvalou cache verdiktů — menu se týdně opakují,
// takže AI voláme jen pro jídla, která jsme ještě neviděli
const CACHE_KEY = 'veggie-cache';

function normalizeName(name) {
  return name.toLowerCase().trim().replace(/\s+/g, ' ');
}

function collectItems(restaurants) {
  const items = [];
  for (const r of restaurants) {
    if (!r.menu) continue;
    for (const section of ['soups', 'meals', 'weekly']) {
      for (const item of r.menu[section] || []) {
        items.push(item);
      }
    }
  }
  return items;
}

async function classifyUnknown(names) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || names.length === 0) return null;

  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2048,
    output_config: {
      format: {
        type: 'json_schema',
        schema: {
          type: 'object',
          properties: {
            results: { type: 'array', items: { type: 'boolean' } },
          },
          required: ['results'],
          additionalProperties: false,
        },
      },
    },
    messages: [{
      role: 'user',
      content: `Pro každé jídlo urči, jestli je vegetariánské (bez masa, bez ryb).

Vrať pole results s true/false ve stejném pořadí a stejné délce jako seznam jídel.

Vegetariánské = neobsahuje žádné maso ani ryby. Vejce, sýr, mléko jsou OK.

Příklady:
- "Gulášová polévka" → false (hovězí)
- "Mrkvový krém" → true
- "Smažený sýr" → true
- "Kuřecí řízek" → false
- "Penne se sýrovou omáčkou" → true
- "Katův šleh" → false (vepřové maso)
- "Svíčková na smetaně" → false (hovězí)
- "Koprová omáčka s vejcem" → true
- "Bramboračka" → true
- "Spaghetti bolognese" → false (mleté maso)
- "Caesar salát s kuřecím masem" → false
- "PIZZA: Diavola/Ventricina/Americana/Quattro Formaggi" → false (některé druhy obsahují maso/salám)
- Pokud řádek obsahuje MIX vegetariánských a masových jídel, označ jako false

Seznam jídel:
${names.map((name, i) => `${i + 1}. ${name}`).join('\n')}`,
    }],
  });

  let results;
  try {
    const text = response.content.find(b => b.type === 'text')?.text ?? '';
    results = JSON.parse(text).results;
  } catch {
    return null;
  }

  if (!Array.isArray(results) || results.length !== names.length) return null;
  return results;
}

async function classifyVeggie(restaurants, kv) {
  const items = collectItems(restaurants);
  if (items.length === 0) return restaurants;

  const uniqueKeys = [...new Set(items.map(i => normalizeName(i.name)))];

  // 1) Načti verdikty z cache
  const verdicts = {};
  if (kv) {
    try {
      const cached = await kv.hmget(CACHE_KEY, ...uniqueKeys);
      if (cached) Object.assign(verdicts, cached);
    } catch (e) {
      console.error('Veggie cache read failed:', e.message);
    }
  }

  // 2) Neznámá jídla klasifikuj přes Claude
  const unknown = uniqueKeys.filter(k => verdicts[k] === undefined || verdicts[k] === null);
  if (unknown.length > 0) {
    const results = await classifyUnknown(unknown);
    if (results) {
      const fresh = {};
      unknown.forEach((k, i) => {
        verdicts[k] = !!results[i];
        fresh[k] = !!results[i];
      });
      if (kv) {
        try {
          await kv.hset(CACHE_KEY, fresh);
        } catch (e) {
          console.error('Veggie cache write failed:', e.message);
        }
      }
    }
  }

  // 3) Aplikuj verdikty na položky menu
  for (const item of items) {
    const v = verdicts[normalizeName(item.name)];
    if (v !== undefined && v !== null) item.veggie = v === true || v === 'true';
  }

  return restaurants;
}

module.exports = { classifyVeggie };
