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
      content: `Pro každé jídlo urči, jestli je vegetariánské (bez masa, bez ryb).

Odpověz POUZE jako JSON pole true/false ve stejném pořadí. Žádný jiný text.

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
        item.veggie = !!results[idx];
        idx++;
      }
    }
  }

  return restaurants;
}

module.exports = { classifyVeggie };
