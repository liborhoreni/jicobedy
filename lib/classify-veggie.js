const Anthropic = require('@anthropic-ai/sdk');

async function classifyVeggie(restaurants) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return restaurants;

  // Collect all meal names
  const items = [];
  for (const r of restaurants) {
    if (!r.menu) continue;
    for (const section of ['soups', 'meals', 'weekly']) {
      if (!r.menu[section]) continue;
      for (const item of r.menu[section]) {
        items.push(item.name);
      }
    }
  }

  if (items.length === 0) return restaurants;

  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2048,
    messages: [{
      role: 'user',
      content: `Pro každé jídlo z tohoto seznamu urči dvě věci:
1. Je vegetariánské? (bez masa, bez ryb)
2. Je pikantní? (chilli, pálivé koření, curry, tandoori, diavola, arrabiata apod.)

Odpověz POUZE jako JSON pole objektů ve stejném pořadí. Každý objekt má dvě pole: "v" (vegetariánské) a "s" (spicy/pikantní), obě true/false. Žádný jiný text.

Příklady:
- "Gulášová polévka" → {"v":false,"s":false}
- "Mrkvový krém" → {"v":true,"s":false}
- "Butter chicken" → {"v":false,"s":true}
- "Smažený sýr" → {"v":true,"s":false}
- "Pizza Diavola" → {"v":false,"s":true}
- "Kuřecí Tandoori" → {"v":false,"s":true}

Seznam jídel:
${items.map((name, i) => `${i + 1}. ${name}`).join('\n')}`,
    }],
  });

  let results;
  try {
    const text = response.content[0].text.trim();
    results = JSON.parse(text);
  } catch {
    return restaurants;
  }

  if (!Array.isArray(results) || results.length !== items.length) {
    return restaurants;
  }

  // Map results back to menu items
  let idx = 0;
  for (const r of restaurants) {
    if (!r.menu) continue;
    for (const section of ['soups', 'meals', 'weekly']) {
      if (!r.menu[section]) continue;
      for (const item of r.menu[section]) {
        item.veggie = !!results[idx].v;
        item.spicy = !!results[idx].s;
        idx++;
      }
    }
  }

  return restaurants;
}

module.exports = { classifyVeggie };
